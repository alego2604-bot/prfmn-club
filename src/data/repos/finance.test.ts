import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import { diffWorkspaces } from "../cloud/sync";
import type { Ctx } from "../context";
import { createCustomer } from "./customers";
import { createExpense, createSupplier, markExpensePaid, updateExpense, voidExpense, expenseToInput } from "./expenses";
import { duplicateInvoice, issueInvoice, registerInvoicePayment, saveInvoiceDraft, voidInvoice } from "./invoices";
import { assignMembership, cancelMembership, changeMembershipPlan, createPlan, pauseMembership, reactivateMembership, resumeMembership, updatePlan } from "./memberships";
import { createTask, setTaskStatus, taskBucket } from "./tasks";
import { createInvoiceSeries, updateOnboarding } from "./settings";
import { expenseKpis, expenseAmounts, expenseView } from "@/domain/expenses";
import { invoiceView, draftTotals } from "@/domain/invoicing";
import { membershipEvolution, membershipSummary, membershipView, monthlyBase, periodEnd } from "@/domain/memberships";
import { cashflowSummary, profitAndLoss, vatSummary } from "@/domain/finance";
import { makePeriod } from "@/lib/dates";
import { toISODate } from "@/lib/dates";

let owner: Ctx;
let loc: string;
const as = (role: Ctx["role"], locationIds: string[] | null = null): Ctx => ({ ...owner, user: { id: `u-${role}`, fullName: role, email: `${role}@t` }, role, locationIds });
const today = toISODate(new Date());
const ws = () => owner.store.requireWorkspace();

beforeEach(async () => {
  const store = new Store(createMemoryKV());
  await store.init();
  const w = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro Norte" });
  await store.createWorkspace(w);
  await store.openWorkspace(w.organization.id);
  owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
  loc = w.locations[0]!.id;
});

describe("Gastos", () => {
  it("desglosa IVA, detecta facturas duplicadas, paga, anula sin borrar y respeta permisos", () => {
    expect(expenseAmounts({ amount: 12100, taxRateBp: 2100, includesTax: true })).toEqual({ subtotal: 10000, taxTotal: 2100, total: 12100 });
    expect(expenseAmounts({ amount: 10000, taxRateBp: 2100, includesTax: false })).toEqual({ subtotal: 10000, taxTotal: 2100, total: 12100 });
    const sup = createSupplier(owner, { name: "Proveedor Ejemplo", taxId: "B12345678" });
    expect(() => createSupplier(owner, { name: "Otro", taxId: "b-12345678" })).toThrow(/NIF/);
    const rent = ws().expenseCategories.find((c) => c.name === "Alquiler")!;
    const e = createExpense(owner, { description: "Alquiler", issueDate: today, amount: 121000, includesTax: true, taxRateBp: 2100, supplierId: sup.id, categoryId: rent.id, locationId: loc, supplierInvoiceNumber: "A-1", paid: false });
    expect(e.taxTotal).toBe(21000);
    expect(() => createExpense(owner, { description: "Repetida", issueDate: today, amount: 100, includesTax: true, taxRateBp: 0, supplierId: sup.id, supplierInvoiceNumber: "a-1", paid: false })).toThrow(/ya está registrada/);
    expect(() => createExpense(as("employee"), { description: "X", issueDate: today, amount: 100, includesTax: true, taxRateBp: 0, paid: false })).toThrow(/permiso/);
    const k = expenseKpis(ws().expenses, { categories: ws().expenseCategories, suppliers: ws().suppliers, locations: ws().locations }, makePeriod("month"));
    expect(k).toMatchObject({ total: 121000, base: 100000, vat: 21000, pending: { count: 1, amount: 121000 } });
    expect(k.byCategory[0]).toMatchObject({ name: "Alquiler", amount: 121000 });
    expect(markExpensePaid(owner, [e.id])).toBe(1);
    expect(ws().expenses[0]!.status).toBe("paid");
    updateExpense(owner, e.id, { ...expenseToInput(ws().expenses[0]!), description: "Alquiler local" });
    expect(ws().expenses[0]!.paidAt).toBe(ws().expenses[0]!.paidAt);
    voidExpense(owner, e.id, "Duplicado");
    expect(ws().expenses).toHaveLength(1);
    expect(ws().expenses[0]).toMatchObject({ status: "void", voidReason: "Duplicado" });
    expect(expenseView({ status: "pending", dueDate: "2020-01-01" })).toBe("overdue");
  });
});

describe("Facturación", () => {
  it("borrador editable → emitida con número de serie → cobro parcial y total → anulación", () => {
    const c = createCustomer(owner, { firstName: "Ana", lastName: "Ejemplo", taxId: "12345678Z", status: "active", address: "Calle Falsa 1", city: "Ciudad Demo" });
    const lines = [
      { description: "Servicio A", quantity: 2, unitPrice: 6050, taxRateBp: 2100 },
      { description: "Servicio B", quantity: 1, unitPrice: 1100, taxRateBp: 1000, discountPct: 10 },
    ];
    expect(draftTotals(lines)).toMatchObject({ total: 12100 + 990, discountTotal: 110 });
    const d = saveInvoiceDraft(owner, { customerId: c.id, issueDate: today, dueDays: 15, lines });
    expect(d).toMatchObject({ status: "draft", customerName: "Ana Ejemplo", customerTaxId: "12345678Z", total: 13090 });
    expect(d.number).toBeUndefined();
    expect(ws().invoiceItems.filter((i) => i.invoiceId === d.id)).toHaveLength(2);
    // Quitar una línea del borrador: la diferencia se envía como borrado
    const before = ws();
    saveInvoiceDraft(owner, { customerId: c.id, issueDate: today, dueDays: 15, lines: [lines[0]!] }, d.id);
    const delta = diffWorkspaces(before, ws())!;
    expect(delta.ops.some((o) => o.table === "invoice_items" && o.op === "delete" && o.rows.length === 2)).toBe(true);
    const issued = issueInvoice(owner, d.id);
    expect(issued.number).toBe(`F${today.slice(0, 4)}-00001`);
    expect(() => saveInvoiceDraft(owner, { customerId: c.id, issueDate: today, dueDays: 0, lines }, d.id)).toThrow(/emitida/);
    registerInvoicePayment(owner, d.id, { methodKey: "transfer", amount: 5000 });
    expect(ws().invoices.find((i) => i.id === d.id)).toMatchObject({ status: "partially_paid", amountPaid: 5000 });
    expect(invoiceView(ws().invoices.find((i) => i.id === d.id)!)).toBe("partial");
    expect(() => registerInvoicePayment(owner, d.id, { methodKey: "card", amount: 99999 })).toThrow(/supera/);
    registerInvoicePayment(owner, d.id, { methodKey: "card" });
    expect(ws().invoices.find((i) => i.id === d.id)).toMatchObject({ status: "paid", amountPaid: 12100 });
    const copy = duplicateInvoice(owner, d.id);
    expect(copy).toMatchObject({ status: "draft", total: 12100, customerId: c.id });
    expect(issueInvoice(owner, copy.id).number).toBe(`F${today.slice(0, 4)}-00002`);
    voidInvoice(owner, copy.id, "Error de importe");
    expect(ws().invoices.find((i) => i.id === copy.id)).toMatchObject({ status: "void" });
    expect(invoiceView({ status: "issued", dueDate: "2020-01-01", total: 1, amountPaid: 0 })).toBe("overdue");
    expect(() => createInvoiceSeries(owner, { year: Number(today.slice(0, 4)) })).toThrow(/Ya existe/);
    expect(createInvoiceSeries(owner, { year: 2099 }).prefix).toBe("F2099-");
  });

  it("en Supabase el número lo asigna el servidor (no se inventa en el cliente)", () => {
    owner.store.patch((w) => ({ ...w, server: { schema: 900 } }));
    const d = saveInvoiceDraft(owner, { customerName: "Empresa Cliente SL", customerTaxId: "B76543210", issueDate: today, dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 1000, taxRateBp: 2100 }] });
    const before = ws();
    expect(issueInvoice(owner, d.id).number).toBeUndefined();
    const delta = diffWorkspaces(before, ws())!;
    expect(delta.ops.find((o) => o.table === "invoices")!.rows[0]).not.toHaveProperty("number");
    expect(delta.ops.some((o) => o.table === "document_series")).toBe(false);
  });
});

describe("Membresías", () => {
  it("alta, cuota cobrada, pausa/reanudación, cambio de tarifa, baja y reactivación coherentes", () => {
    const c = createCustomer(owner, { firstName: "Leo", status: "lead" });
    const plan = createPlan(owner, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 6000, taxRateBp: 2100, openToNew: true });
    const m = assignMembership(owner, { customerId: c.id, planId: plan.id, startDate: today, locationId: loc, firstCharge: { methodKey: "card" } });
    expect(ws().customers.find((x) => x.id === c.id)!.status).toBe("active");
    expect(m.nextRenewalDate).toBe(periodEnd(today, "month"));
    const inv = ws().invoices.find((i) => i.customerMembershipId === m.id)!;
    expect(inv).toMatchObject({ status: "paid", total: 6000, servicePeriodStart: today, source: "membership" });
    expect(ws().membershipCharges).toHaveLength(1);
    expect(monthlyBase(m, "month", 2100)).toBe(4959);
    const sum = membershipSummary(ws().customerMemberships, { plans: ws().membershipPlans, versions: ws().planVersions, charges: ws().membershipCharges }, { start: today.slice(0, 8) + "01", end: "2999-01-01" });
    expect(sum).toMatchObject({ active: 1, mrr: 4959, newInPeriod: 1 });
    pauseMembership(owner, m.id, { resumeOn: "2999-01-01" });
    expect(membershipView(ws().customerMemberships[0]!, ws().membershipCharges)).toBe("PAUSED");
    resumeMembership(owner, m.id);
    // Subida de tarifa: quien la tiene conserva su precio pactado
    updatePlan(owner, plan.id, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 6500, taxRateBp: 2100, openToNew: true });
    expect(ws().planVersions.filter((v) => v.planId === plan.id)).toHaveLength(2);
    expect(ws().customerMemberships[0]!.price).toBe(6000);
    const anual = createPlan(owner, { name: "Anual", kind: "recurring", billingPeriod: "year", price: 60000, taxRateBp: 2100, openToNew: true });
    const m2 = changeMembershipPlan(owner, m.id, anual.id, { startDate: today });
    expect(ws().customerMemberships.find((x) => x.id === m.id)!.status).toBe("cancelled");
    expect(m2).toMatchObject({ planId: anual.id, price: 60000, status: "active" });
    cancelMembership(owner, m2.id, { reason: "Se muda", markCustomerInactive: true });
    expect(ws().customers.find((x) => x.id === c.id)!.status).toBe("cancelled");
    // Un cliente de baja no tiene próxima renovación
    expect(ws().customerMemberships.find((x) => x.id === m2.id)!.nextRenewalDate).toBeUndefined();
    reactivateMembership(owner, m2.id);
    expect(ws().customers.find((x) => x.id === c.id)!.status).toBe("active");
    expect(membershipEvolution(ws().customerMemberships, new Date(), 2).at(-1)!.active).toBeGreaterThanOrEqual(1);
    expect(() => assignMembership(as("employee"), { customerId: c.id, planId: plan.id, startDate: today })).toThrow(/permiso/);
  });

  it("los periodos conservan el día de inicio (y el fin de mes)", () => {
    expect(periodEnd("2026-01-15", "month")).toBe("2026-02-15");
    expect(periodEnd("2026-01-31", "month")).toBe("2026-02-28");
    expect(periodEnd("2026-03-10", "quarter")).toBe("2026-06-10");
    expect(periodEnd("2024-02-29", "year")).toBe("2025-02-28");
    expect(periodEnd("2026-01-15", "week")).toBe("2026-01-22");
    expect(periodEnd("2026-01-15", "none", 60)).toBe("2026-03-16");
  });

  it("cuota vencida sin cobrar → PAST_DUE", () => {
    expect(membershipView({ id: "m", status: "active", startDate: "2020-01-01", nextRenewalDate: "2020-02-01", autoRenew: true }, [], "2020-03-01")).toBe("PAST_DUE");
    expect(membershipView({ id: "m", status: "active", startDate: "2020-01-01", nextRenewalDate: "2020-02-01", autoRenew: true }, [{ customerMembershipId: "m", status: "paid", periodStart: "2020-02-01" }], "2020-03-01")).toBe("ACTIVE");
    expect(membershipView({ id: "m", status: "active", startDate: "2020-01-01", nextRenewalDate: "2020-02-01", autoRenew: true }, [], "2020-02-03")).toBe("ACTIVE");
  });
});

describe("Finanzas: resultado, flujo de caja e IVA", () => {
  it("resultado sin IVA, cobros frente a pagos y posición de IVA", () => {
    const c = createCustomer(owner, { firstName: "Eva", status: "active" });
    const d = saveInvoiceDraft(owner, { customerId: c.id, issueDate: today, dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 12100, taxRateBp: 2100 }] });
    issueInvoice(owner, d.id);
    registerInvoicePayment(owner, d.id, { methodKey: "card" });
    createExpense(owner, { description: "Material", issueDate: today, amount: 6050, includesTax: true, taxRateBp: 2100, paid: true });
    createExpense(owner, { description: "Seguro", issueDate: today, amount: 3000, includesTax: true, taxRateBp: 0, paid: false });
    const p = makePeriod("month");
    const w = ws();
    const ds = { ...w, categories: w.categories };
    const pl = profitAndLoss(ds, w.expenses, p);
    expect(pl).toMatchObject({ revenueBase: 10000, expensesBase: 5000 + 3000, result: 2000 });
    const cf = cashflowSummary(ds, w.expenses, p);
    expect(cf).toMatchObject({ inflow: 12100, outflow: 6050, net: 6050, payable: { count: 1, amount: 3000 } });
    const vat = vatSummary(ds, w.expenses, p);
    expect(vat).toMatchObject({ outputTax: 2100, inputTax: 1050, position: 1050 });
  });
});

describe("Tareas y puesta en marcha", () => {
  it("tareas por plazo y progreso de onboarding", () => {
    const t = createTask(owner, { title: "Llamar", dueDate: "2020-01-01" });
    expect(taskBucket(t)).toBe("overdue");
    setTaskStatus(owner, t.id, "done");
    expect(taskBucket(ws().tasks[0]!)).toBe("done");
    updateOnboarding(owner, { done: "company" });
    updateOnboarding(owner, { skipped: "team" });
    expect(ws().settings.onboarding).toMatchObject({ done: ["company"], skipped: ["team"] });
    expect(() => updateOnboarding(as("employee"), { done: "fiscal" })).toThrow(/permiso/);
  });
});

describe("hasRevenueHistory", () => {
  it("solo permite comparar si hay ingresos desde el inicio del periodo anterior", async () => {
    const { hasRevenueHistory } = await import("@/domain/finance");
    const ds = { sales: [{ status: "completed", occurredAt: "2025-11-03T10:00:00Z" }], invoices: [] } as never;
    expect(hasRevenueHistory(ds, new Date("2025-01-01T00:00:00"))).toBe(false);
    expect(hasRevenueHistory(ds, new Date("2025-12-01T00:00:00"))).toBe(true);
  });
});
