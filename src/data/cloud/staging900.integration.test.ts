/**
 * Integración REAL con la migración 0900 (stack local o business-os-staging), más allá del flujo feliz:
 *  - protecciones del servidor: líneas de factura emitida no se borran ni se editan, los gastos no se borran,
 *    escritura directa por PostgREST bloqueada, numeración por serie correlativa;
 *  - ciclo de vida de membresías (PENDING, ACTIVE, PAST_DUE, PAUSED, CANCELLED, EXPIRED, cambio de tarifa,
 *    cobro de cuota con factura) y MRR, comprobado desde un segundo dispositivo;
 *  - multicentro: gastos generales solo en el consolidado; ventas y caja por centro;
 *  - roles: un empleado no ve ni crea gastos; otra empresa no ve nada.
 *   BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npm run test:cloud
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import type { Ctx } from "../context";
import { createCustomer } from "../repos/customers";
import { createProduct } from "../repos/catalog";
import { createSale } from "../repos/sales";
import { closeCashSession, openCashSession } from "../repos/cash";
import { addLocation } from "../repos/settings";
import { createExpense, createExpenseCategory, createSupplier, ensureExpenseCategories, markExpensePaid, voidExpense } from "../repos/expenses";
import { duplicateInvoice, issueInvoice, markInvoicePaid, registerInvoicePayment, saveInvoiceDraft, voidInvoice } from "../repos/invoices";
import { assignMembership, cancelMembership, changeMembershipPlan, chargeMembership, createPlan, pauseMembership, reactivateMembership, resumeMembership, updatePlan } from "../repos/memberships";
import { createTask, setTaskStatus } from "../repos/tasks";
import { addMemberByEmail, createCloudClient, createOrganization, signIn, signUp, type CloudUser } from "./account";
import { CloudSync } from "./sync";
import { addDays, makePeriod, startOfDay, toISODate } from "@/lib/dates";
import { cashflowSummary, profitAndLoss, vatSummary } from "@/domain/finance";
import { membershipSummary, membershipView } from "@/domain/memberships";
import { invoiceView } from "@/domain/invoicing";
import { expenseView } from "@/domain/expenses";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const run = `${Date.now().toString(36)}g`;
const PASSWORD = "contraseña-segura";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}
async function device() {
  const sb: SupabaseClient = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const sync = new CloudSync(sb, kv, store);
  const errors: string[] = [];
  sync.onError((m) => errors.push(m));
  return { sb, store, sync, errors };
}
async function account(sb: SupabaseClient, who: string): Promise<CloudUser> {
  const r = await signUp(sb, { fullName: `Usuario ${who}`, email: `${who}-${run}@empresa.test`, password: PASSWORD });
  if (!r.user) throw new Error("El proyecto exige confirmar email");
  return r.user;
}
const iso = (days: number) => toISODate(addDays(startOfDay(new Date()), days));
const push = (sb: SupabaseClient, org: string, table: string, op: string, rows: Record<string, unknown>[]) => sb.rpc("sync_push", { p_org: org, p_batch: { ops: [{ table, op, rows }], audit: {} } });

describe.skipIf(!URL || !KEY)("Supabase 0900: protecciones, ciclo de membresías, multicentro y roles", () => {
  it("valida contra el servidor real lo que la interfaz no puede garantizar sola", async (t) => {
    const d1 = await device();
    const owner = await account(d1.sb, "val");
    if ((await d1.sb.rpc("server_capabilities")).error) { console.warn("⚠ Sin 0900: prueba omitida"); t.skip(); return; }
    const orgId = await createOrganization(d1.sb, { name: `Validación ${run}`, vertical: "fitness", locationName: "Centro A", city: "Ciudad Demo" });
    await d1.sync.open(orgId);
    const ctx: Ctx = { store: d1.store, user: owner, role: "owner", locationIds: null };
    const ws = () => d1.store.requireWorkspace();
    const today = iso(0);
    const locA = ws().locations[0]!.id;
    addLocation(ctx, "Centro B", "Ciudad Demo");
    const locB = ws().locations.find((l) => l.name === "Centro B")!.id;

    // ── Operativa por centro: caja, ventas y cierre
    const prod = createProduct(ctx, { name: "Bono 10", categoryId: null, kind: "pack", price: 12100, taxRateBp: 2100, trackStock: false, posVisible: true });
    const sA = openCashSession(ctx, locA, 10000);
    openCashSession(ctx, locB, 5000);
    createSale(ctx, { locationId: locA, lines: [{ productId: prod.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 12100 }] });
    createSale(ctx, { locationId: locB, lines: [{ productId: prod.id, quantity: 2 }], payments: [{ methodKey: "card", amount: 24200 }] });
    closeCashSession(ctx, sA.id, 22100);

    // ── Gastos: categoría propia, proveedor, con/sin centro, con/sin IVA, pendiente, vencido, pago en lote, anulado
    ensureExpenseCategories(ctx);
    const cat = createExpenseCategory(ctx, `Formación ${run}`, 2100);
    const sup = createSupplier(ctx, { name: "Proveedor Validación", taxId: "B11111111" });
    const eA = createExpense(ctx, { description: "Alquiler A", issueDate: today, dueDate: iso(10), amount: 121000, includesTax: true, taxRateBp: 2100, supplierId: sup.id, categoryId: cat.id, locationId: locA, paid: false });
    const eB = createExpense(ctx, { description: "Luz B", issueDate: iso(-20), dueDate: iso(-3), amount: 10000, includesTax: false, taxRateBp: 2100, supplierId: sup.id, locationId: locB, paid: false });
    const eG = createExpense(ctx, { description: "Gestoría", issueDate: today, amount: 30000, includesTax: false, taxRateBp: 0, paid: true });
    const eV = createExpense(ctx, { description: "Duplicado por error", issueDate: today, amount: 5000, includesTax: true, taxRateBp: 2100, paid: false });
    expect(expenseView(ws().expenses.find((e) => e.id === eB.id)!)).toBe("overdue");
    expect(markExpensePaid(ctx, [eA.id, eB.id])).toBe(2);
    voidExpense(ctx, eV.id, "Registrado dos veces");

    // ── Facturación: borrador editado, emitido, cobro parcial y completo, vencida, anulada, duplicada
    const cli = createCustomer(ctx, { firstName: "Empresa", lastName: "Cliente", status: "active", taxId: "B22222222" });
    const lines = [
      { description: "Línea 1", quantity: 1, unitPrice: 12100, taxRateBp: 2100 },
      { description: "Línea 2", quantity: 2, unitPrice: 5500, taxRateBp: 1000 },
      { description: "Línea 3", quantity: 1, unitPrice: 1000, taxRateBp: 2100, discountPct: 50 },
    ];
    const f1 = saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: today, dueDays: 30, lines, locationId: locA } as never);
    saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: today, dueDays: 30, lines: lines.slice(0, 2), locationId: locA } as never, f1.id);
    await d1.sync.flush();
    expect(d1.errors.join(" | ")).toBe("");
    expect((await d1.sb.from("invoice_items").select("id").eq("invoice_id", f1.id)).data).toHaveLength(2); // línea borrada en el servidor
    issueInvoice(ctx, f1.id);
    registerInvoicePayment(ctx, f1.id, { methodKey: "transfer", amount: 10000 });
    const f2 = saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: iso(-40), dueDays: 15, lines: [lines[0]!] } as never);
    issueInvoice(ctx, f2.id);
    const f3 = duplicateInvoice(ctx, f2.id);
    issueInvoice(ctx, f3.id);
    voidInvoice(ctx, f3.id, "Emitida por error");
    const f4 = saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: today, dueDays: 0, lines: [lines[1]!] } as never);
    issueInvoice(ctx, f4.id);
    markInvoicePaid(ctx, f4.id, "card");

    // ── Membresías: todos los estados
    const plan = createPlan(ctx, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 6050, taxRateBp: 2100, openToNew: true });
    updatePlan(ctx, plan.id, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 7260, taxRateBp: 2100, openToNew: true }); // versión 2
    const plan2 = createPlan(ctx, { name: "Trimestral", kind: "recurring", billingPeriod: "quarter", price: 18150, taxRateBp: 2100, openToNew: true });
    const pack = createPlan(ctx, { name: "Bono 30 días", kind: "pack", billingPeriod: "none", price: 4000, taxRateBp: 2100, openToNew: true, durationDays: 30 });
    const people = ["Activa", "Pausada", "Baja", "Futura", "Vencida", "Caducada", "Cambio"].map((n) => createCustomer(ctx, { firstName: n, lastName: "Sintética", status: "lead" }));
    const [pAct, pPau, pBaj, pFut, pDue, pExp, pCam] = people;
    const mAct = assignMembership(ctx, { customerId: pAct!.id, planId: plan.id, startDate: today, locationId: locA, firstCharge: { methodKey: "card" } });
    const mPau = assignMembership(ctx, { customerId: pPau!.id, planId: plan.id, startDate: today, locationId: locB, firstCharge: { methodKey: "cash" } });
    pauseMembership(ctx, mPau.id, { reason: "Lesión" });
    const mBaj = assignMembership(ctx, { customerId: pBaj!.id, planId: plan.id, startDate: iso(-10), firstCharge: { methodKey: "card" } });
    cancelMembership(ctx, mBaj.id, { reason: "Se muda" });
    const mFut = assignMembership(ctx, { customerId: pFut!.id, planId: plan.id, startDate: iso(7) });
    const mDue = assignMembership(ctx, { customerId: pDue!.id, planId: plan.id, startDate: iso(-40) });
    const mExp = assignMembership(ctx, { customerId: pExp!.id, planId: pack.id, startDate: iso(-60), firstCharge: { methodKey: "cash" } });
    const mCam = assignMembership(ctx, { customerId: pCam!.id, planId: plan.id, startDate: iso(-5), firstCharge: { methodKey: "card" } });
    const mCam2 = changeMembershipPlan(ctx, mCam.id, plan2.id, { startDate: today });
    const view = (id: string) => membershipView(ws().customerMemberships.find((m) => m.id === id)!, ws().membershipCharges);
    expect([view(mAct.id), view(mPau.id), view(mBaj.id), view(mFut.id), view(mDue.id), view(mExp.id), view(mCam.id), view(mCam2.id)])
      .toEqual(["ACTIVE", "PAUSED", "CANCELLED", "PENDING", "PAST_DUE", "EXPIRED", "CANCELLED", "ACTIVE"]);
    expect(ws().customerMemberships.find((m) => m.id === mAct.id)!.price).toBe(7260); // precio de la versión vigente
    // Cuota vencida: dos cobros la ponen al día; cada cobro genera su factura
    const invBefore = ws().invoices.length;
    chargeMembership(ctx, mDue.id, { methodKey: "transfer" });
    chargeMembership(ctx, mDue.id, { methodKey: "transfer" });
    expect(ws().invoices.length).toBe(invBefore + 2);
    expect(view(mDue.id)).toBe("ACTIVE");
    resumeMembership(ctx, mPau.id);
    reactivateMembership(ctx, mBaj.id);
    expect([view(mPau.id), view(mBaj.id)]).toEqual(["ACTIVE", "ACTIVE"]);

    // ── Tareas
    const task = createTask(ctx, { title: "Llamar por la cuota", customerId: pDue!.id, dueDate: iso(1), assigneeId: owner.id, reason: "Cuota vencida" });
    const t2 = createTask(ctx, { title: "Enviar factura", customerId: cli.id, dueDate: today });
    setTaskStatus(ctx, t2.id, "done");

    await d1.sync.flush();
    await d1.sync.pull();
    expect(d1.errors).toEqual([]);

    // ── Protecciones del servidor
    const issuedLine = ws().invoiceItems.find((it) => it.invoiceId === f1.id)!;
    // sync_push solo borra líneas de BORRADORES (filtro + trigger): en una emitida no borra nada (comprobado abajo)
    await push(d1.sb, orgId, "invoice_items", "delete", [{ id: issuedLine.id }]);
    const upd = await push(d1.sb, orgId, "invoice_items", "update", [{ id: issuedLine.id, description: "Cambiada" }]);
    expect(upd.error, "editar una línea de factura emitida debe fallar").toBeTruthy();
    const delExp = await push(d1.sb, orgId, "expenses", "delete", [{ id: eG.id }]);
    expect(delExp.error, "los gastos nunca se borran").toBeTruthy();
    await d1.sb.from("invoice_items").delete().eq("id", issuedLine.id); // PostgREST directo: RLS/trigger lo impiden
    await d1.sb.from("expenses").delete().eq("id", eG.id);
    expect((await d1.sb.from("invoice_items").select("id,description").eq("id", issuedLine.id)).data).toEqual([{ id: issuedLine.id, description: issuedLine.description }]);
    expect((await d1.sb.from("expenses").select("id").eq("id", eG.id)).data).toHaveLength(1);

    // ── Segundo dispositivo (otro login): todo persistido y coherente
    const d2 = await device();
    await signIn(d2.sb, owner.email, PASSWORD);
    await d2.sync.open(orgId);
    const w2 = d2.store.requireWorkspace();
    const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;
    expect(byId(w2.expenses, eA.id)).toMatchObject({ status: "paid", subtotal: 100000, taxTotal: 21000, locationId: locA, categoryId: cat.id });
    expect(byId(w2.expenses, eB.id)).toMatchObject({ status: "paid", total: 12100 });
    expect(byId(w2.expenses, eV.id)).toMatchObject({ status: "void" });
    expect(byId(w2.expenses, eG.id).locationId).toBeUndefined();
    const numbers = w2.invoices.filter((i) => i.status !== "draft").map((i) => i.number!).sort();
    expect(new Set(numbers).size).toBe(numbers.length);
    numbers.forEach((n, i) => expect(Number(n.slice(-5))).toBe(i + 1)); // serie F correlativa, sin huecos
    expect(invoiceView(byId(w2.invoices, f1.id))).toBe("partial");
    expect(invoiceView(byId(w2.invoices, f2.id))).toBe("overdue");
    expect(invoiceView(byId(w2.invoices, f3.id))).toBe("void");
    expect(invoiceView(byId(w2.invoices, f4.id))).toBe("paid");
    expect(w2.invoiceItems.filter((i) => i.invoiceId === f1.id)).toHaveLength(2);
    expect(byId(w2.invoices, f1.id).total).toBe(12100 + 11000);
    const v2 = (id: string) => membershipView(byId(w2.customerMemberships, id), w2.membershipCharges);
    expect([v2(mAct.id), v2(mPau.id), v2(mBaj.id), v2(mFut.id), v2(mDue.id), v2(mExp.id), v2(mCam.id), v2(mCam2.id)])
      .toEqual(["ACTIVE", "ACTIVE", "ACTIVE", "PENDING", "ACTIVE", "EXPIRED", "CANCELLED", "ACTIVE"]);
    expect(w2.planVersions.filter((v) => v.planId === plan.id)).toHaveLength(2);
    expect(byId(w2.tasks, task.id)).toMatchObject({ status: "pending", assigneeId: owner.id, customerId: pDue!.id });
    expect(byId(w2.tasks, t2.id).status).toBe("done");
    expect(w2.cashClosings).toHaveLength(1);

    // Cifras: MRR, resultado consolidado vs por centro (gastos generales solo en el consolidado), IVA y tesorería
    const month = makePeriod("custom", new Date(), { start: addDays(startOfDay(new Date()), -90), end: addDays(startOfDay(new Date()), 1) });
    const refs = { plans: w2.membershipPlans, versions: w2.planVersions, charges: w2.membershipCharges };
    const mrr = membershipSummary(w2.customerMemberships, refs, { start: toISODate(month.start), end: toISODate(month.end) });
    expect(mrr.mrr).toBe(6000 * 4 + 5000); // 4 mensuales a 72,60 € (60 € base) + trimestral 181,50 € (150 € base / 3)
    const all = profitAndLoss(w2, w2.expenses, month);
    const onlyA = profitAndLoss(w2, w2.expenses, month, locA);
    const onlyB = profitAndLoss(w2, w2.expenses, month, locB);
    expect(all.expensesBase).toBe(100000 + 10000 + 30000);
    expect(onlyA.expensesBase + onlyB.expensesBase).toBe(110000); // sin la gestoría (gasto general)
    expect(vatSummary(w2, w2.expenses, month).inputTax).toBe(21000 + 2100);
    const cf = cashflowSummary(w2, w2.expenses, month);
    expect(cf.outflow).toBe(121000 + 12100 + 30000);
    expect(cf.receivable.count).toBeGreaterThanOrEqual(2); // f1 parcial y f2 vencida

    // ── Roles: un empleado no ve ni crea gastos
    const d3 = await device();
    const emp = await account(d3.sb, "empleado");
    await addMemberByEmail(d1.sb, orgId, emp.email, "employee", null);
    expect((await d3.sb.from("expenses").select("id").eq("organization_id", orgId)).data ?? []).toHaveLength(0);
    const empPush = await push(d3.sb, orgId, "expenses", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, issue_date: today, description: "Empleado", subtotal: 100, tax_rate_bp: 0, tax_total: 0, total: 100, status: "pending" }]);
    expect(empPush.error, "un empleado no registra gastos").toBeTruthy();
    // La RLS es la frontera (sync_push es SECURITY INVOKER): tampoco por PostgREST directo
    const empDirect = await d3.sb.from("expenses").insert({ id: crypto.randomUUID(), organization_id: orgId, issue_date: today, description: "Directo", subtotal: 1, tax_rate_bp: 0, tax_total: 0, total: 1, status: "pending" });
    expect(empDirect.error, "un empleado tampoco inserta gastos directamente").toBeTruthy();
    const empUpd = await d3.sb.from("expenses").update({ description: "Cambiado" }).eq("id", eG.id).select("id");
    expect(empUpd.data ?? []).toHaveLength(0);

    // ── Otra empresa no ve nada
    const d4 = await device();
    await account(d4.sb, "ajena");
    await createOrganization(d4.sb, { name: `Ajena ${run}`, vertical: "retail", locationName: "Tienda" });
    for (const tb of ["expenses", "suppliers", "expense_categories", "invoices", "invoice_items", "customer_memberships", "membership_charges", "tasks", "sales", "cash_sessions"]) {
      expect((await d4.sb.from(tb).select("id").eq("organization_id", orgId)).data ?? [], tb).toHaveLength(0);
    }
    const foreign = await push(d4.sb, orgId, "tasks", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, title: "Intrusa", status: "pending" }]);
    expect(foreign.error, "no se escribe en otra empresa").toBeTruthy();
    const foreignDirect = await d4.sb.from("tasks").insert({ id: crypto.randomUUID(), organization_id: orgId, title: "Intrusa", status: "pending" });
    expect(foreignDirect.error, "ni directamente").toBeTruthy();
    expect((await d4.sb.from("invoices").update({ notes: "x" }).eq("id", f1.id).select("id")).data ?? []).toHaveLength(0);
  }, 300_000);
});
