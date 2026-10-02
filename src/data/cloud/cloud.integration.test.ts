/**
 * Integración REAL contra Supabase (stack local `scripts/local-supabase/start.sh` o staging).
 * Recorre el CORE con los repositorios de la app y el motor de sincronización, y comprueba desde un
 * SEGUNDO dispositivo (otro cliente, otra caché vacía) que todo está en la base de datos.
 *
 *   BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npm run test:cloud
 *
 * Usa cuentas y empresas sintéticas nuevas en cada ejecución (nunca datos reales).
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import type { Ctx } from "../context";
import { createCategory, createProduct, updateProduct } from "../repos/catalog";
import { createCustomer, addCustomerNote } from "../repos/customers";
import { closeCashSession, openCashSession, reopenCashSession } from "../repos/cash";
import { createSale, voidSale } from "../repos/sales";
import { updateActivityRules, updateOrganization } from "../repos/settings";
import { computeKpis } from "@/domain/analytics";
import { makePeriod, quarterPeriod } from "@/lib/dates";
import { buildGestoriaReport } from "@/features/reports/gestoria";
import { readXlsx } from "@/features/imports/engine/read";
import { analyzeWorkbook } from "@/features/imports/engine/analyze";
import { buildInvoicesPlan } from "@/features/imports/engine/invoicesPlan";
import { commitPlan, revertImport } from "@/features/imports/engine/commit";
import { buildSalesPlan } from "@/features/imports/engine/salesPlan";
import { runImport } from "@/features/imports/engine/pipeline";
import { visibleWorkspace } from "../visibility";
import { addMemberByEmail, createCloudClient, createOrganization, memberships, signIn, signUp, type CloudUser } from "./account";
import { CloudSync } from "./sync";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const run = Date.now().toString(36);

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

/** Un "dispositivo": cliente Supabase + caché local propia + motor de sincronización. */
async function device(): Promise<{ sb: SupabaseClient; store: Store; sync: CloudSync; errors: string[] }> {
  const sb = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const sync = new CloudSync(sb, kv, store);
  const errors: string[] = [];
  sync.onError((m) => errors.push(m));
  return { sb, store, sync, errors };
}

async function account(sb: SupabaseClient, who: string): Promise<CloudUser> {
  const r = await signUp(sb, { fullName: `Usuario ${who}`, email: `${who}-${run}@empresa.test`, password: "contraseña-segura" });
  if (!r.user) throw new Error("El proyecto exige confirmar email: desactívalo en staging para los tests");
  return r.user;
}

const ctxOf = (store: Store, user: CloudUser, role: Ctx["role"] = "owner"): Ctx => ({ store, user, role, locationIds: null });

describe.skipIf(!URL || !KEY)("Supabase: CORE persistido y visible desde otro dispositivo", () => {
  it("producto → cliente → venta → pago → caja → cierre → dashboard → informe, y aislamiento", async () => {
    // Dispositivo 1: alta, empresa y operativa
    const d1 = await device();
    const owner = await account(d1.sb, "owner");
    const orgId = await createOrganization(d1.sb, { name: `Empresa Sintética ${run}`, vertical: "fitness", locationName: "Centro Norte", city: "Ciudad Demo" });
    await d1.sync.open(orgId);
    const ctx = ctxOf(d1.store, owner);
    const ws0 = d1.store.requireWorkspace();
    expect(ws0.organization.city).toBe("Ciudad Demo");
    expect(ws0.paymentMethods.length).toBeGreaterThan(5);
    const loc = ws0.locations[0]!.id;

    const cat = createCategory(ctx, { name: "Bebidas", defaultTaxRateBp: 1000 });
    const agua = createProduct(ctx, { name: "Agua", categoryId: cat.id, kind: "physical", price: 150, taxRateBp: 1000, trackStock: true, stockQuantity: 20, posVisible: true });
    const bono = createProduct(ctx, { name: "Bono 5", categoryId: null, kind: "pack", price: 5500, taxRateBp: 2100, trackStock: false, posVisible: true });
    const cliente = createCustomer(ctx, { firstName: "Cliente", lastName: "Uno", taxId: "12345678Z", email: "cliente.uno@example.com", status: "active" });
    addCustomerNote(ctx, cliente.id, "Prefiere pagar con tarjeta");
    openCashSession(ctx, loc, 5000);
    const s1 = createSale(ctx, { locationId: loc, lines: [{ productId: agua.id, quantity: 2 }, { productId: bono.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 5000 }, { methodKey: "cash", amount: 800 }], customerId: cliente.id });
    const s2 = createSale(ctx, { locationId: loc, lines: [{ productId: agua.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 150 }] });
    voidSale(ctx, s2.id, "Error de cobro");
    updateProduct(ctx, agua.id, { name: "Agua 50cl", categoryId: cat.id, kind: "physical", price: 160, taxRateBp: 1000, trackStock: true, stockQuantity: 18, posVisible: true }, "Subida de proveedor");
    const session = d1.store.requireWorkspace().cashSessions.find((s) => s.status === "open")!;
    closeCashSession(ctx, session.id, 5000 + 800 + 100, "Sobran 1,00 €");
    updateOrganization(ctx, { phone: "+34 600 000 000", modules: [] });
    updateActivityRules(ctx, d1.store.requireWorkspace().settings.activityRules.slice(0, 2), false);
    await d1.sync.flush();
    expect(d1.errors).toEqual([]);
    expect(d1.sync.pending).toBe(0);
    expect(d1.store.requireWorkspace().sales.find((s) => s.id === s1.id)!.number).toBeGreaterThan(0);
    const local = d1.store.requireWorkspace();

    // Dispositivo 2: misma cuenta, caché vacía → todo viene de la base de datos
    const d2 = await device();
    await signIn(d2.sb, owner.email, "contraseña-segura");
    const ms = await memberships(d2.sb, owner.id);
    expect(ms.orgs.map((o) => o.id)).toContain(orgId);
    expect(ms.members.find((m) => m.organizationId === orgId)!.role).toBe("owner");
    await d2.sync.open(orgId);
    const remote = d2.store.requireWorkspace();

    expect(remote.products.map((p) => [p.name, p.price]).sort()).toEqual([["Agua 50cl", 160], ["Bono 5", 5500]]);
    expect(remote.productPrices.filter((p) => p.productId === agua.id)).toHaveLength(2); // histórico de precios en servidor
    expect(remote.products.find((p) => p.id === agua.id)!.stockQuantity).toBe(18); // 20 − 2 vendidas (la anulada repone)
    expect(remote.customers[0]!.taxIdNormalized).toBe("12345678Z");
    expect(remote.customerNotes).toHaveLength(1);
    expect(remote.sales.map((s) => [s.number, s.status, s.total])).toEqual(local.sales.map((s) => [s.number, s.status, s.total]));
    expect(remote.saleItems).toHaveLength(3);
    expect(remote.payments.filter((p) => p.kind === "refund")).toHaveLength(1);
    expect(remote.payments.find((p) => p.saleId === s1.id && p.methodKey === "cash")!.amount).toBe(800);
    const closing = remote.cashClosings[0]!;
    expect([closing.expectedCash, closing.countedCash, closing.difference, closing.status]).toEqual([5800, 5900, 100, "discrepancy"]);
    expect(remote.organization.phone).toBe("+34 600 000 000");
    expect(remote.organization.modules).toEqual([]);
    expect(remote.settings.activityRules).toHaveLength(2);
    expect(remote.settings.requireCashSession).toBe(false);
    expect(remote.auditLogs.some((l) => l.action === "void" && l.entityType === "sales")).toBe(true);
    expect(remote.auditLogs.find((l) => l.entityType === "cash_closings")?.entityLabel).toMatch(/Cierre v1/);
    expect(remote.auditLogs.every((l) => l.actorName)).toBe(true);

    // Dashboard e informe calculados sobre los datos del servidor = los mismos que en el dispositivo 1
    const p = makePeriod("year", new Date());
    expect(computeKpis(remote, p).salesRevenue).toBe(computeKpis(local, p).salesRevenue);
    expect(computeKpis(remote, p).salesRevenue).toBe(5800);
    const rep = buildGestoriaReport(remote, quarterPeriod(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) + 1));
    expect(rep.fileBase).toContain(String(new Date().getFullYear()));

    // Reapertura desde el dispositivo 2 y venta → el dispositivo 1 lo ve al recargar
    const ctx2 = ctxOf(d2.store, owner);
    reopenCashSession(ctx2, session.id, "Venta olvidada");
    createSale(ctx2, { locationId: loc, lines: [{ productId: bono.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 5500 }] });
    await d2.sync.flush();
    expect(d2.errors).toEqual([]);
    await d1.sync.pull();
    expect(d1.store.requireWorkspace().sales.filter((s) => s.status === "completed")).toHaveLength(2);
    expect(d1.store.requireWorkspace().cashClosings[0]!.supersededAt).toBeTruthy();

    // Aislamiento: otra empresa no ve ni puede escribir nada de esta
    const x = await device();
    const intruder = await account(x.sb, "intruso");
    expect((await x.sb.from("sales").select("id").eq("organization_id", orgId)).data).toEqual([]);
    expect((await x.sb.from("customers").select("id")).data).toEqual([]);
    const forged = await x.sb.rpc("sync_push", { p_org: orgId, p_batch: { ops: [{ table: "customers", op: "insert", rows: [{ id: crypto.randomUUID(), organization_id: orgId, first_name: "X", status: "active", tags: [] }] }] } });
    expect(forged.error?.message).toMatch(/No perteneces/);
    const ownOrg = await createOrganization(x.sb, { name: `Otra ${run}`, vertical: "retail", locationName: "Tienda" });
    const smuggle = await x.sb.rpc("sync_push", { p_org: ownOrg, p_batch: { ops: [{ table: "customers", op: "insert", rows: [{ id: crypto.randomUUID(), organization_id: orgId, first_name: "X", status: "active", tags: [] }] }] } });
    expect(smuggle.error?.message).toMatch(/otra empresa/);
    const tamper = await x.sb.rpc("sync_push", { p_org: ownOrg, p_batch: { ops: [{ table: "sales", op: "update", rows: [{ id: s1.id, total: 1 }] }] } });
    expect(tamper.error).toBeTruthy();
    expect(intruder.id).not.toBe(owner.id);

    // Inmutabilidad financiera también para el owner (por API)
    const del = await d1.sb.from("sales").delete().eq("id", s1.id).select();
    expect(del.data ?? []).toEqual([]);
    const edit = await d1.sb.rpc("sync_push", { p_org: orgId, p_batch: { ops: [{ table: "sales", op: "update", rows: [{ id: s1.id, total: 1, subtotal: 1, tax_total: 0 }] }] } });
    expect(edit.error?.message).toMatch(/no se pueden modificar/);
  }, 120_000);

  it("permisos: un employee no puede cambiar precios; el rechazo restaura el estado real", async () => {
    const d1 = await device();
    const owner = await account(d1.sb, "owner2");
    const orgId = await createOrganization(d1.sb, { name: `Permisos ${run}`, vertical: "retail", locationName: "Tienda" });
    await d1.sync.open(orgId);
    const p = createProduct(ctxOf(d1.store, owner), { name: "Producto", categoryId: null, kind: "physical", price: 1000, taxRateBp: 2100, trackStock: false, posVisible: true });
    await d1.sync.flush();

    const d2 = await device();
    const emp = await account(d2.sb, "empleado");
    await addMemberByEmail(d1.sb, orgId, emp.email, "employee", null);
    await d2.sync.open(orgId);
    // Aunque la app del cliente se manipulase para saltarse la comprobación local, el servidor lo impide
    updateProduct(ctxOf(d2.store, emp, "owner"), p.id, { name: "Producto", categoryId: null, kind: "physical", price: 1, taxRateBp: 2100, trackStock: false, posVisible: true });
    expect(d2.store.requireWorkspace().products[0]!.price).toBe(1);
    await d2.sync.flush();
    await new Promise((r) => setTimeout(r, 300));
    expect(d2.errors[0]).toMatch(/permiso/i);
    expect(d2.store.requireWorkspace().products[0]!.price).toBe(1000);
    // Pero sí puede vender
    const loc = d2.store.requireWorkspace().locations[0]!.id;
    openCashSession(ctxOf(d2.store, emp, "employee"), loc, 0);
    createSale(ctxOf(d2.store, emp, "employee"), { locationId: loc, lines: [{ productId: p.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 1000 }] });
    await d2.sync.flush();
    expect(d2.errors).toHaveLength(1);
    await d1.sync.pull();
    expect(d1.store.requireWorkspace().sales).toHaveLength(1);
  }, 60_000);

  it("importar → validar → guardar → analizar → revertir, persistido", async () => {
    const d1 = await device();
    const owner = await account(d1.sb, "owner3");
    const orgId = await createOrganization(d1.sb, { name: `Importación ${run}`, vertical: "fitness", locationName: "Centro" });
    await d1.sync.open(orgId);
    const ctx = ctxOf(d1.store, owner);
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("JULIO");
    sh.addRow(["Nº", "Factura", "Fecha Factura", "NIF", "Cliente", "Concepto", "Periodo / Concepto", "Descripción", "Base Imp. (€)", "Total (€)", "Método de Pago", "Estado", "IVA 21% Base", "IVA 21% Cuota"]);
    sh.addRow([1, "T2600001", "01/07/2026", "12345678Z", "Cliente Uno", "11 CREDITOS-Precio mensual", "Cuota july 11 CREDITOS", null, 51.24, 62, "Tarjeta de crédito", "Cobrada", 51.24, 10.76]);
    sh.addRow([2, "T2600002", "02/07/2026", "87654321X", "Cliente Dos", "16 CREDITOS", "Cuota july 16 CREDITOS", null, 60.33, 73, "En efectivo", "Cobrada", 60.33, 12.67]);
    sh.addRow([3, "U2600001", "03/07/2026", null, "Cliente Tres", "Drop In", "Drop In", null, 12.4, 15, "Domiciliación bancaria", "Pendiente", 12.4, 2.6]);
    sh.addRow([null, null, null, null, null, null, null, null, null, null, "TOTAL COBRADO →", null, null, null]);
    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const data = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "facturas-sinteticas.xlsx");
    const ws = d1.store.requireWorkspace();
    const plan = buildInvoicesPlan(data, analyzeWorkbook(data), ws, { dateOutsideSheet: "keep", locationId: ws.locations[0]!.id });
    const job = commitPlan(ctx, plan, { name: "facturas-sinteticas.xlsx", sha256: `sha-${run}`, size: buf.byteLength });
    await d1.sync.flush();
    expect(d1.errors).toEqual([]);

    const d2 = await device();
    await signIn(d2.sb, owner.email, "contraseña-segura");
    await d2.sync.open(orgId);
    const r = d2.store.requireWorkspace();
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]!.summary.created.facturas).toBe(3);
    expect(r.invoices.map((i) => i.externalNumber).sort()).toEqual(["T2600001", "T2600002", "U2600001"]);
    expect(r.customers).toHaveLength(3);
    expect(r.importRecords.length).toBeGreaterThanOrEqual(3);
    expect(computeKpis(r, makePeriod("year", new Date(2026, 6, 15))).invoiceRevenue).toBe(15000);

    revertImport(ctxOf(d2.store, owner), job.id, "Fichero equivocado");
    await d2.sync.flush();
    expect(d2.errors).toEqual([]);
    await d1.sync.pull();
    const after = d1.store.requireWorkspace();
    expect(after.imports[0]!.status).toBe("reverted");
    expect(after.invoices.every((i) => i.status === "void")).toBe(true);
  }, 60_000);

  it("importación grande por lotes: oculta mientras dura, COMPLETED al final, visible en otro dispositivo", async () => {
    const d1 = await device();
    const owner = await account(d1.sb, "owner4");
    const orgId = await createOrganization(d1.sb, { name: `Lotes ${run}`, vertical: "fitness", locationName: "Centro" });
    await d1.sync.open(orgId);
    const ctx = ctxOf(d1.store, owner);
    const N = 1500;
    const rows: (string | number | Date)[][] = [["Fecha", "Producto", "Categoría", "Precio", "Unidades", "Importe", "Método"]];
    for (let i = 0; i < N; i++) rows.push([new Date(Date.UTC(2026, 0, 1 + (i % 240), 9 + (i % 10))), i % 4 ? "Agua" : "Drop-In", i % 4 ? "BEBIDAS" : "DROP-IN", i % 4 ? 1 : 15, 1, i % 4 ? 1 : 15, i % 2 ? "Tarjeta" : "Efectivo"]);
    const data = { fileName: "ventas-grandes.xlsx", format: "xlsx" as const, sheets: [{ name: "Ventas", rows }] };
    const ws = d1.store.requireWorkspace();
    const plan = buildSalesPlan(data, analyzeWorkbook(data), ws, { dateOutsideSheet: "keep", locationId: ws.locations[0]!.id });
    let maxChunk = 0;
    let sawProgress = false;
    d1.sync.onStatus((st) => {
      if (st.progress) sawProgress = true;
      if (st.progress && visibleWorkspace(d1.store.requireWorkspace()).sales.length > 0) throw new Error("datos visibles a mitad de importación");
    });
    const origRpc = d1.sb.rpc.bind(d1.sb);
    (d1.sb as unknown as { rpc: typeof origRpc }).rpc = ((fn: string, args: { p_batch: { ops: { rows: unknown[] }[] } }) => {
      maxChunk = Math.max(maxChunk, (args?.p_batch?.ops ?? []).reduce((n, o) => n + o.rows.length, 0));
      return origRpc(fn, args);
    }) as typeof origRpc;
    const r = await runImport(ctx, plan, { name: "ventas-grandes.xlsx", sha256: `big-${run}`, size: 1 }, d1.sync);
    expect(r.state).toBe("COMPLETED");
    expect(sawProgress).toBe(true);
    expect(maxChunk).toBeLessThanOrEqual(300);
    expect(d1.errors).toEqual([]);

    const d2 = await device();
    await signIn(d2.sb, owner.email, "contraseña-segura");
    await d2.sync.open(orgId);
    const w2 = d2.store.requireWorkspace();
    expect(w2.sales.filter((x) => x.importId === r.job.id)).toHaveLength(N);
    const job = w2.imports.find((j) => j.id === r.job.id)!;
    expect(job.status).toBe("completed");
    expect(job.pipeline?.state).toBe("COMPLETED");
    expect(job.pipeline?.events.map((e) => e.state)).toEqual(["IMPORTING", "COMPLETED"]);
    expect(visibleWorkspace(w2).sales).toHaveLength(N);
  }, 240_000);
});
