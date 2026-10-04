import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV, type KV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Customer } from "@/domain/types";
import { uid } from "@/lib/ids";
import { CloudSync, type Batch, type SyncStatus } from "./sync";
import { fakeServer } from "./fakeServer.testutil";

/**
 * Reenvíos, recarga y envíos en paralelo:
 * - un lote ya confirmado no se vuelve a enviar (sin 409) tras recargar, perder la respuesta o cerrar la pestaña;
 * - la idempotencia del servidor sigue siendo la última barrera (cola vieja restaurada → sin duplicados);
 * - los trozos van de uno en uno y en orden (medido en staging: en paralelo el servidor no escala y supera el
 *   statement_timeout); un interbloqueo se reintenta y el progreso nunca retrocede.
 */
type Server = ReturnType<typeof fakeServer>;

async function boot(server: Server, kv: KV, tab = "t1", orgWs?: ReturnType<typeof buildWorkspace>) {
  server.setLatency(2);
  const store = new Store(kv);
  await store.init();
  const ws = orgWs ?? buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  if (!orgWs) {
    await store.createWorkspace(ws);
    server.seedFrom(ws);
  }
  const sync = new CloudSync(server.sb, kv, store, { tabId: async () => tab, liveTabs: async () => new Set([tab]) });
  const statuses: SyncStatus[] = [];
  const errors: string[] = [];
  sync.onStatus((s) => statuses.push(s));
  sync.onError((e) => errors.push(e));
  await sync.open(ws.organization.id);
  return { store, sync, statuses, errors, ws, orgId: ws.organization.id };
}

const customers = (orgId: string, n: number): Customer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uid(), organizationId: orgId, firstName: `Cliente ${i}`, lastName: "Sintético", status: "active", tags: [],
    createdAt: new Date(2026, 0, 1).toISOString(), updatedAt: new Date(2026, 0, 1).toISOString(),
  }) as Customer);

const rowsOf = (orgId: string, n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, () => ({ id: uid(), organization_id: orgId, ...extra }));
const batch = (orgId: string, table: string, rows: Record<string, unknown>[], group: Batch["group"]): Batch =>
  ({ id: uid(), orgId, createdAt: new Date().toISOString(), ops: [{ table, op: "insert", rows }], audit: {}, group });

describe("reenvíos sin 409", () => {
  it("respuesta perdida: el reintento comprueba antes de reenviar (sin 409, sin duplicados)", async () => {
    const server = fakeServer();
    const { store, sync, errors, orgId } = await boot(server, createMemoryKV());
    server.plan.push({ kind: "lose" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 120)] }));
    await sync.flush();
    expect(sync.status.state).toBe("offline");
    await sync.flush();
    expect(server.count("customers")).toBe(120);
    expect(sync.pending).toBe(0);
    expect(server.errors).not.toContain("23505");
    expect(errors).toEqual([]);
  });

  it("recarga durante el envío (el servidor lo aplicó, la pestaña no recibió la respuesta): no se reenvía", async () => {
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    server.plan.push({ kind: "hang" });
    a.store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(a.orgId, 50)] }));
    await new Promise((r) => setTimeout(r, 30)); // el lote ya está en el servidor; la respuesta nunca llega
    a.sync.close(); // recarga
    const calls = server.calls.length;
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    expect(server.count("customers")).toBe(50);
    expect(b.sync.pending).toBe(0);
    expect(server.calls.length).toBe(calls); // ni un solo sync_push más
    expect(server.errors).not.toContain("23505");
  });

  it("pestaña cerrada tras la confirmación: al reabrir no queda nada que enviar", async () => {
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    a.store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(a.orgId, 30)] }));
    await a.sync.flush();
    a.sync.close();
    const calls = server.calls.length;
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    expect(server.calls.length).toBe(calls);
    expect(server.count("customers")).toBe(30);
    expect(await kv.get<string[]>(`inflight:${a.orgId}:t1`)).toEqual([]);
  });

  it("pestaña cerrada antes de enviar: al reabrir se envía una vez, sin comprobación ni 409", async () => {
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    a.sync.close(); // sin empresa abierta: la escritura queda en la cola y no sale
    const orgId = a.orgId;
    await kv.set(`outbox:${orgId}:t1`, [batch(orgId, "customers", rowsOf(orgId, 40), undefined)]);
    const reads = server.reads();
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    expect(server.count("customers")).toBe(40);
    expect(server.errors).toEqual([]);
    expect(b.sync.pending).toBe(0);
    expect(server.reads() - reads).toBeGreaterThan(0); // la descarga normal; ninguna comprobación de ids hace falta
  });

  it("pestaña cerrada (otra) con un lote en vuelo: la que adopta su cola también hereda la comprobación", async () => {
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv, "cerrada");
    server.plan.push({ kind: "hang" });
    a.store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(a.orgId, 25)] }));
    await new Promise((r) => setTimeout(r, 30));
    a.sync.close();
    const store = new Store(kv);
    await store.init();
    const sync = new CloudSync(server.sb, kv, store, { tabId: async () => "nueva", liveTabs: async () => new Set(["nueva"]) });
    await sync.open(a.orgId);
    await sync.flush();
    expect(server.count("customers")).toBe(25);
    expect(server.errors).not.toContain("23505");
    expect(await kv.get(`inflight:${a.orgId}:cerrada`)).toBeUndefined();
  });

  it("última barrera: una cola vieja restaurada (sin marcas) no duplica nada", async () => {
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    const orgId = a.orgId;
    const stale = batch(orgId, "customers", rowsOf(orgId, 60), undefined);
    await a.sync.close();
    await kv.set(`outbox:${orgId}:t1`, [stale]);
    // El servidor ya lo tenía (p. ej. se restauró una copia antigua del navegador)
    server.count("customers"); // crea la tabla
    for (const r of stale.ops[0]!.rows) server.tables.get("customers")!.set(String(r.id), r);
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    expect(server.count("customers")).toBe(60);
    expect(b.sync.pending).toBe(0);
    expect(b.errors).toEqual([]);
  });

  it("segundo dispositivo ve exactamente lo mismo tras una respuesta perdida", async () => {
    const server = fakeServer();
    const a = await boot(server, createMemoryKV());
    server.plan.push({ kind: "lose" });
    a.store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(a.orgId, 80)] }));
    await a.sync.flush();
    await a.sync.flush();
    const store = new Store(createMemoryKV());
    await store.init();
    const other = new CloudSync(server.sb, createMemoryKV(), store, { tabId: async () => "ipad", liveTabs: async () => new Set(["ipad"]) });
    await other.open(a.orgId);
    expect(store.requireWorkspace().customers.length).toBe(a.store.requireWorkspace().customers.length);
  });
});

describe("orden, reintentos y progreso", () => {
  async function queued(server: Server, make: (orgId: string, g: (i: number, total: number) => Batch["group"]) => Batch[]) {
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    a.sync.close();
    const g = (index: number, total: number) => ({ id: "demo:x", label: "Preparando la empresa demo", index, total });
    const list = make(a.orgId, g);
    await kv.set(`outbox:${a.orgId}:t1`, list);
    return { kv, a, list };
  }

  it("ventas, líneas y cobros se envían de uno en uno y en orden", async () => {
    const server = fakeServer();
    const { kv, a } = await queued(server, (orgId, g) => [
      ...Array.from({ length: 3 }, (_, i) => batch(orgId, "sales", rowsOf(orgId, 10), g(i, 9))),
      ...Array.from({ length: 3 }, (_, i) => batch(orgId, "sale_items", rowsOf(orgId, 10), g(3 + i, 9))),
      ...Array.from({ length: 3 }, (_, i) => batch(orgId, "payments", rowsOf(orgId, 10), g(6 + i, 9))),
    ]);
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    expect([...server.maxInFlight.values()].every((n) => n === 1)).toBe(true);
    expect(server.count("sales") + server.count("sale_items") + server.count("payments")).toBe(90);
    expect(b.sync.pending).toBe(0);
  });

  it("un interbloqueo (40P01) se reintenta: todo entra una vez, sin error para el usuario ni descartar el grupo", async () => {
    const server = fakeServer();
    const { kv, a } = await queued(server, (orgId, g) => Array.from({ length: 6 }, (_, i) => batch(orgId, "sale_items", rowsOf(orgId, 10), g(i, 6))));
    const before = server.calls.length;
    server.plan.push({ kind: "deadlock", n: before + 2 });
    const b = await boot(server, kv, "t1", a.ws);
    for (let i = 0; i < 5 && b.sync.pending; i++) await b.sync.flush().then(() => new Promise((r) => setTimeout(r, 2100)));
    expect(server.count("sale_items")).toBe(60);
    expect(b.sync.pending).toBe(0);
    expect(b.errors).toEqual([]);
    expect(server.errors).toContain("40P01");
  }, 20_000);

  it("progreso monotónico aunque un trozo se divida", async () => {
    const server = fakeServer();
    const { kv, a } = await queued(server, (orgId, g) => [
      ...Array.from({ length: 2 }, (_, i) => batch(orgId, "sales", rowsOf(orgId, 30), g(i, 8))),
      ...Array.from({ length: 6 }, (_, i) => batch(orgId, "payments", rowsOf(orgId, i === 3 ? 60 : 30), g(2 + i, 8))),
    ]);
    server.plan.push({ kind: "timeoutOver", n: 50 }); // el trozo de 60 filas se divide en dos
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    const done = b.statuses.map((s) => s.progress?.done).filter((d): d is number => d !== undefined);
    expect(done.length).toBeGreaterThan(2);
    for (let i = 1; i < done.length; i++) expect(done[i]!).toBeGreaterThanOrEqual(done[i - 1]!);
    expect(server.count("payments")).toBe(210);
    expect(b.sync.pending).toBe(0);
  });

  it("un cambio hecho justo al terminar el envío sale sin esperar a otro aviso", async () => {
    const server = fakeServer();
    const { store, sync, orgId } = await boot(server, createMemoryKV());
    server.setLatency(0);
    sync.tagNext({ id: "g", label: "Importando" });
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 20)] }));
    await sync.waitGroup("g");
    // Como el cierre de una importación: se escribe en cuanto el grupo se confirma
    store.update((ws) => ({ ...ws, customers: [...ws.customers, ...customers(orgId, 1)] }));
    await new Promise((r) => setTimeout(r, 30));
    expect(server.count("customers")).toBe(21);
    expect(sync.pending).toBe(0);
  });

  it("dos descargas pedidas a la vez se sirven con una sola", async () => {
    const server = fakeServer();
    const { sync } = await boot(server, createMemoryKV());
    const before = server.reads();
    await Promise.all([sync.pull(), sync.pull()]);
    const one = server.reads() - before;
    const again = server.reads();
    await sync.pull();
    expect(server.reads() - again).toBe(one);
  });
});

describe("demo", () => {
  it("demo temprana y completa: se sube entera, con progreso que nunca retrocede y sin errores", async () => {
    const { fillDemoWorkspace } = await import("../demo");
    const server = fakeServer();
    const kv = createMemoryKV();
    const { store, sync, statuses, errors, orgId } = await boot(server, kv);
    sync.tagNext({ id: `demo:${orgId}`, label: "Preparando la empresa demo" });
    store.update((ws) => fillDemoWorkspace(ws, "u1"));
    await sync.waitGroup(`demo:${orgId}`);
    const done = statuses.map((s) => s.progress?.done).filter((d): d is number => d !== undefined);
    for (let i = 1; i < done.length; i++) expect(done[i]!).toBeGreaterThanOrEqual(done[i - 1]!);
    expect(errors).toEqual([]);
    expect(server.count("sales")).toBe(store.requireWorkspace().sales.length);
    expect(server.count("payments")).toBe(store.requireWorkspace().payments.length);
    expect(server.errors).toEqual([]);
  }, 30_000);

  it("demo con corte de red a mitad: se reanuda sola y queda completa una sola vez", async () => {
    const { fillDemoWorkspace } = await import("../demo");
    const server = fakeServer();
    const kv = createMemoryKV();
    const a = await boot(server, kv);
    server.plan.push({ kind: "hang" });
    a.sync.tagNext({ id: `demo:${a.orgId}`, label: "Preparando la empresa demo" });
    a.store.update((ws) => fillDemoWorkspace(ws, "u1"));
    await new Promise((r) => setTimeout(r, 50));
    a.sync.close(); // recarga a mitad de la siembra
    await a.store.flush();
    const b = await boot(server, kv, "t1", a.ws);
    await b.sync.flush();
    const local = b.store.requireWorkspace();
    expect(b.sync.pending).toBe(0);
    expect(server.count("sales")).toBe(local.sales.length);
    expect(server.count("sale_items")).toBe(local.saleItems.length);
    expect(server.errors).not.toContain("23505");
  }, 30_000);
});
