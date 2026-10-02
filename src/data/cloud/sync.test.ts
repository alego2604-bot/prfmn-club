import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Ctx } from "../context";
import { createCategory, createProduct } from "../repos/catalog";
import { openCashSession } from "../repos/cash";
import { createSale, voidSale } from "../repos/sales";
import { updateOrganization } from "../repos/settings";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../store";
import { COLLECTIONS, entityToRow, toRow, type Row } from "./mapping";
import { CloudSync, diffWorkspaces } from "./sync";

async function setup() {
  const store = new Store(createMemoryKV());
  await store.init();
  const ws = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(ws);
  await store.openWorkspace(ws.organization.id);
  const ctx: Ctx = { store, user: { id: "u1", fullName: "Persona", email: "p@example.com" }, role: "owner", locationIds: null };
  const batches: NonNullable<ReturnType<typeof diffWorkspaces>>[] = [];
  store.onCommit = (prev, next) => {
    const d = diffWorkspaces(prev, next);
    if (d) batches.push(d);
  };
  return { store, ctx, loc: ws.locations[0]!.id, batches };
}

describe("diffWorkspaces (lotes enviados a Supabase)", () => {
  it("una venta = un lote atómico con cabecera, líneas y pagos, sin nº de ticket (lo asigna la BD)", async () => {
    const { ctx, loc, batches } = await setup();
    const p = createProduct(ctx, { name: "Agua", categoryId: null, kind: "physical", price: 150, taxRateBp: 1000, trackStock: true, stockQuantity: 5, posVisible: true });
    openCashSession(ctx, loc, 0);
    batches.length = 0;
    const sale = createSale(ctx, { locationId: loc, lines: [{ productId: p.id, quantity: 2 }], payments: [{ methodKey: "cash", amount: 300 }] });
    expect(batches).toHaveLength(1);
    const ops = batches[0]!.ops.map((o) => `${o.op}:${o.table}`);
    expect(ops).toEqual(["insert:sales", "insert:sale_items", "insert:payments"]); // el stock lo descuenta el servidor
    const saleRow = batches[0]!.ops[0]!.rows[0]!;
    expect(saleRow.number).toBeNull();
    expect(saleRow.organization_id).toBe(sale.organizationId);
    expect(batches[0]!.audit[sale.id]?.action).toBe("insert");
  });

  it("anular solo envía los campos que cambian + la devolución; nunca importes", async () => {
    const { ctx, loc, batches } = await setup();
    const p = createProduct(ctx, { name: "Agua", categoryId: null, kind: "physical", price: 150, taxRateBp: 1000, trackStock: false, posVisible: true });
    openCashSession(ctx, loc, 0);
    const sale = createSale(ctx, { locationId: loc, lines: [{ productId: p.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 150 }] });
    batches.length = 0;
    voidSale(ctx, sale.id, "Error");
    const upd = batches[0]!.ops.find((o) => o.op === "update" && o.table === "sales")!;
    expect(Object.keys(upd.rows[0]!).sort()).toEqual(["id", "status", "void_reason", "voided_at", "voided_by"]);
    expect(batches[0]!.ops.find((o) => o.table === "payments")!.rows[0]!.kind).toBe("refund");
    expect(batches[0]!.audit[sale.id]?.action).toBe("void");
  });

  it("categorías, organización y módulos se traducen a columnas y operaciones del servidor", async () => {
    const { ctx, batches } = await setup();
    createCategory(ctx, { name: "Bebidas", defaultTaxRateBp: 1000 });
    expect(batches[0]!.ops[0]!.rows[0]).toMatchObject({ name: "Bebidas", default_tax_rate_bp: 1000 });
    updateOrganization(ctx, { phone: "+34 600 000 000", modules: [] });
    const last = batches.at(-1)!;
    expect(last.ops).toEqual([
      { table: "organizations", op: "update", rows: [{ id: ctx.store.requireWorkspace().organization.id, phone: "+34 600 000 000" }] },
      { table: "organization_modules", op: "set_modules", rows: [{ module: "fitness", enabled: false }] },
    ]);
  });

  it("sin cambios reales no se envía nada", async () => {
    const { store, batches } = await setup();
    store.update((ws) => ({ ...ws, products: [...ws.products] }));
    expect(batches).toHaveLength(0);
  });
});

/**
 * Supabase simulado: cada descarga lee la foto de `server` tomada al empezar (primera consulta, a `organizations`);
 * `sync_push` responde al instante.
 * Si `gate` existe, cada lectura espera a que se abra (descarga lenta, como en staging).
 */
function fakeSupabase(state: { server: Workspace; gate?: Promise<void> }): SupabaseClient {
  const rowsOf = (table: string, ws: Workspace): Row[] | Row => {
    if (table === "organizations") return toRow(ws.organization);
    const c = COLLECTIONS.find(([, t]) => t === table);
    return c ? (ws[c[0]] as object[]).map((e) => entityToRow(c[0], e)) : [];
  };
  let snapshot = state.server;
  const query = (table: string) => {
    if (table === "organizations") snapshot = state.server; // empieza una descarga: se fija la foto
    let single = false;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "range", "limit"]) chain[m] = () => chain;
    chain.single = () => ((single = true), chain);
    chain.maybeSingle = () => ({ then: (r: (v: unknown) => void) => r({ data: null, error: null }) });
    chain.then = (resolve: (v: unknown) => void) =>
      void (state.gate ?? Promise.resolve()).then(() => {
        const data = rowsOf(table, snapshot);
        resolve({ data: single ? data : Array.isArray(data) ? data : [data], error: null });
      });
    return chain;
  };
  return { from: query, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
}

describe("CloudSync.pull", () => {
  it("una descarga lenta no pisa una escritura hecha (y enviada) mientras descargaba", async () => {
    const { store, ctx, loc } = await setup();
    const kv = createMemoryKV();
    let open!: () => void;
    const state: { server: Workspace; gate?: Promise<void> } = { server: store.requireWorkspace(), gate: new Promise<void>((r) => (open = r)) };
    const sync = new CloudSync(fakeSupabase(state), kv, store);
    (sync as unknown as { orgId: string }).orgId = store.requireWorkspace().organization.id;

    const pulling = sync.pull(); // empieza la descarga: la foto del servidor aún no tiene la caja abierta
    const session = openCashSession(ctx, loc, 0); // el usuario abre caja mientras tanto
    await sync.flush(); // se envía y la cola queda vacía
    state.server = store.requireWorkspace(); // el servidor ya la tiene
    state.gate = undefined;
    open();
    await pulling;

    expect(sync.pending).toBe(0);
    expect(store.requireWorkspace().cashSessions.map((s) => s.id)).toContain(session.id);
  });
});
