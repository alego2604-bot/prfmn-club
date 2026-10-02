import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV, type KV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Customer } from "@/domain/types";
import { uid } from "@/lib/ids";
import { batchRows, CHUNK_MAX_ROWS, CloudSync, splitBatch, type Batch, type Op, type SyncStatus } from "./sync";

/**
 * Servidor simulado con la semántica de `sync_push`: cada llamada es UNA transacción (o entra todo o nada),
 * clave primaria única por tabla y fallos programables (respuesta perdida, timeout, rechazo de negocio).
 */
function fakeServer() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const calls: number[] = [];
  const plan: { kind: "lose" | "timeoutOver" | "reject"; n?: number; once?: boolean }[] = [];
  const tbl = (t: string) => tables.get(t) ?? tables.set(t, new Map()).get(t)!;
  const rpc = async (_fn: string, args: { p_batch: { ops: Op[] } }) => {
    const ops = args.p_batch.ops;
    const rows = ops.reduce((n, o) => n + o.rows.length, 0);
    calls.push(rows);
    const timeout = plan.find((p) => p.kind === "timeoutOver" && rows > (p.n ?? 0));
    if (timeout) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const reject = plan.find((p) => p.kind === "reject" && calls.length === p.n);
    if (reject) return { data: null, error: { code: "23514", message: "violates check constraint" } };
    // Transacción: validar todo antes de aplicar
    for (const o of ops) if (o.op === "insert") for (const r of o.rows) if (tbl(o.table).has(String(r.id))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    for (const o of ops) for (const r of o.rows) tbl(o.table).set(String(r.id), { ...tbl(o.table).get(String(r.id)), ...r });
    const lose = plan.findIndex((p) => p.kind === "lose");
    if (lose >= 0) {
      plan.splice(lose, 1);
      return { data: null, error: { message: "TypeError: Failed to fetch" } }; // se aplicó, pero la respuesta no llegó
    }
    return { data: [], error: null };
  };
  const from = (table: string) => {
    const failing = { then: (res: (v: unknown) => void) => res({ data: null, error: { message: "sin red en el test", code: "PGRST000" } }) };
    const chain: Record<string, unknown> = {
      select: () => chain,
      in: (_c: string, ids: string[]) => Promise.resolve({ data: ids.filter((id) => tbl(table).has(id)).map((id) => ({ id })), error: null }),
    };
    for (const m of ["eq", "order", "range", "limit", "single", "maybeSingle"]) chain[m] = () => failing;
    return chain;
  };
  return { sb: { rpc, from } as unknown as SupabaseClient, tables, calls, plan, count: (t: string) => tbl(t).size };
}

async function setup(server = fakeServer(), kv: KV = createMemoryKV(), tab = "t1", live: string[] = [tab]) {
  const store = new Store(kv);
  await store.init();
  const ws = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(ws);
  const sync = new CloudSync(server.sb, kv, store, { tabId: async () => tab, liveTabs: async () => new Set(live) });
  const statuses: SyncStatus[] = [];
  const errors: string[] = [];
  sync.onStatus((s) => statuses.push(s));
  sync.onError((e) => errors.push(e));
  await sync.open(ws.organization.id).catch(() => undefined);
  await sync.flush();
  return { server, store, sync, statuses, errors, orgId: ws.organization.id, kv };
}

const customers = (orgId: string, n: number): Customer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uid(), organizationId: orgId, firstName: `Cliente ${i}`, lastName: "Sintético", status: "active", tags: [],
    createdAt: new Date(2026, 0, 1).toISOString(), updatedAt: new Date(2026, 0, 1).toISOString(),
  }) as Customer);

describe("splitBatch", () => {
  it("respeta el orden de operaciones, los límites y lleva la auditoría con su fila", () => {
    const ids = Array.from({ length: 1000 }, () => uid());
    const b = {
      orgId: "o", ops: [
        { table: "sales", op: "insert" as const, rows: ids.slice(0, 400).map((id) => ({ id })) },
        { table: "sale_items", op: "insert" as const, rows: ids.slice(400).map((id) => ({ id })) },
      ],
      audit: { [ids[999]!]: { action: "insert" }, huérfano: { action: "x" } },
    };
    const parts = splitBatch(b);
    expect(parts.length).toBe(4);
    expect(parts.every((p) => batchRows(p) <= CHUNK_MAX_ROWS)).toBe(true);
    expect(parts.flatMap((p) => p.ops.flatMap((o) => o.rows.map((r) => r.id)))).toEqual(ids);
    expect(parts[1]!.ops.map((o) => o.table)).toEqual(["sales", "sale_items"]); // frontera dentro del trozo
    expect(parts[3]!.audit[ids[999]!]).toBeDefined();
    expect(parts[0]!.audit.huérfano).toBeDefined();
    expect(splitBatch({ orgId: "o", ops: [{ table: "x", op: "insert", rows: [{ id: "1" }] }], audit: {} })).toHaveLength(1);
  });

  it("también corta por tamaño", () => {
    const big = "x".repeat(10_000);
    const parts = splitBatch({ orgId: "o", ops: [{ table: "t", op: "insert", rows: Array.from({ length: 100 }, () => ({ id: uid(), big })) }], audit: {} });
    expect(parts.length).toBeGreaterThan(3);
  });
});

describe("CloudSync con lotes grandes", () => {
  it("un alta masiva se envía en trozos ordenados, con progreso y espera por grupo", async () => {
    const { server, store, sync, statuses, orgId } = await setup();
    sync.tagNext({ id: "g1", label: "Importando clientes" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 700)] }));
    await sync.waitGroup("g1");
    expect(server.count("customers")).toBe(700);
    expect(server.calls.length).toBe(3);
    expect(Math.max(...server.calls)).toBeLessThanOrEqual(CHUNK_MAX_ROWS);
    const progress = statuses.map((s) => s.progress).filter(Boolean);
    expect(progress[0]).toMatchObject({ groupId: "g1", label: "Importando clientes", total: 3 });
    expect(progress.some((p) => p!.done === 2)).toBe(true);
    expect(sync.pending).toBe(0);
  });

  it("respuesta perdida + reintento: idempotente, sin duplicados ni error al usuario", async () => {
    const { server, store, sync, errors, orgId } = await setup();
    server.plan.push({ kind: "lose" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 450)] }));
    await sync.flush(); // primer trozo entra, la respuesta se pierde → offline
    expect(sync.status.state).toBe("offline");
    await sync.flush(); // reintento: 23505 → se comprueba qué existe → se da por confirmado y sigue
    expect(server.count("customers")).toBe(450);
    expect(sync.pending).toBe(0);
    expect(errors).toEqual([]);
  });

  it("un trozo que supera el statement_timeout se divide y se reintenta", async () => {
    const { server, store, sync, errors, orgId } = await setup();
    server.plan.push({ kind: "timeoutOver", n: 120 });
    sync.tagNext({ id: "g2", label: "Demo" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 300)] }));
    await sync.waitGroup("g2");
    expect(server.count("customers")).toBe(300);
    expect(Math.max(...server.calls.filter((n, i) => i === server.calls.length - 1 || n <= 120))).toBeLessThanOrEqual(120);
    expect(errors).toEqual([]);
  });

  it("fallo parcial: se descarta el resto del grupo, lo confirmado queda identificado y la espera falla", async () => {
    const { server, store, sync, errors, orgId } = await setup();
    server.plan.push({ kind: "reject", n: 2 });
    sync.tagNext({ id: "g3", label: "Importando" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 900)] }));
    await expect(sync.waitGroup("g3")).rejects.toThrow(/check constraint/);
    expect(server.count("customers")).toBe(300); // solo el primer trozo
    expect(sync.pending).toBe(0);
    expect(sync.hasGroup("g3")).toBe(false);
    expect(errors.length).toBe(1);
  });

  it("cancelar descarta lo pendiente del grupo", async () => {
    const { server, store, sync, orgId } = await setup();
    server.plan.push({ kind: "lose" }); // se queda offline tras el primer trozo
    sync.tagNext({ id: "g4", label: "Importando" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 900)] }));
    const waiting = sync.waitGroup("g4");
    await sync.flush();
    const dropped = await sync.cancelGroup("g4");
    expect(dropped).toBe(3);
    await expect(waiting).rejects.toThrow(/cancelada/);
    expect(sync.pending).toBe(0);
    expect(server.count("customers")).toBe(300);
  });

  it("adopta la cola de una pestaña cerrada y no toca la de una pestaña viva", async () => {
    const kv = createMemoryKV();
    const first = await setup(fakeServer(), kv, "t1");
    const orgId = first.orgId;
    const mk = (n: number): Batch => ({ id: uid(), orgId, createdAt: new Date().toISOString(), ops: [{ table: "customers", op: "insert", rows: customers(orgId, n).map((c) => ({ id: c.id, organization_id: orgId })) }], audit: {} });
    await kv.set(`outbox:${orgId}:cerrada`, [mk(5)]);
    await kv.set(`outbox:${orgId}:viva`, [mk(7)]);
    await kv.set(`outbox:${orgId}`, [mk(2)]); // formato anterior, sin pestaña
    const server = fakeServer();
    const store = new Store(kv);
    await store.init();
    const sync = new CloudSync(server.sb, kv, store, { tabId: async () => "t2", liveTabs: async () => new Set(["t2", "viva"]) });
    await sync.open(orgId).catch(() => undefined);
    await sync.flush();
    expect(server.count("customers")).toBe(7);
    expect(await kv.get(`outbox:${orgId}:cerrada`)).toBeUndefined();
    expect(await kv.get(`outbox:${orgId}`)).toBeUndefined();
    expect(await kv.get<Batch[]>(`outbox:${orgId}:viva`)).toHaveLength(1);
    await sync.discardLocal(orgId);
    expect((await kv.keys()).filter((k) => k.startsWith("outbox:"))).toEqual([]);
  });
});
