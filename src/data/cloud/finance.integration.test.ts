/**
 * Integración REAL (stack local o staging con la migración 0900): gastos, proveedores, membresías con cuota,
 * borrador de factura editado (borrado de líneas) y emitido con número del servidor, cobro parcial, tareas y
 * puesta en marcha. Todo se comprueba desde un SEGUNDO dispositivo y con aislamiento entre empresas.
 *   BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npm run test:cloud
 * Si el servidor aún no tiene la 0900 (server_capabilities), se omite con un aviso.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import type { Ctx } from "../context";
import { createCustomer } from "../repos/customers";
import { createExpense, createSupplier, ensureExpenseCategories, markExpensePaid } from "../repos/expenses";
import { issueInvoice, registerInvoicePayment, saveInvoiceDraft } from "../repos/invoices";
import { assignMembership, createPlan, pauseMembership, resumeMembership } from "../repos/memberships";
import { createTask } from "../repos/tasks";
import { updateOnboarding } from "../repos/settings";
import { createCloudClient, createOrganization, signIn, signUp, type CloudUser } from "./account";
import { CloudSync } from "./sync";
import { toISODate } from "@/lib/dates";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const run = `${Date.now().toString(36)}f`;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}
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
  if (!r.user) throw new Error("El proyecto exige confirmar email");
  return r.user;
}

describe.skipIf(!URL || !KEY)("Supabase 0900: finanzas, membresías y seguimiento persistidos", () => {
  it("gasto, proveedor, membresía con cuota, borrador editado y emitido, cobro parcial, tarea; visible en otro dispositivo y aislado", async (t) => {
    const d1 = await device();
    const owner = await account(d1.sb, "fin"); // server_capabilities() solo responde a usuarios autenticados
    const caps = await d1.sb.rpc("server_capabilities");
    if (caps.error) {
      console.warn("⚠ El servidor no tiene la migración 0900 (server_capabilities): prueba omitida");
      t.skip();
      return;
    }
    const orgId = await createOrganization(d1.sb, { name: `Finanzas ${run}`, vertical: "fitness", locationName: "Centro Norte", city: "Ciudad Demo" });
    await d1.sync.open(orgId);
    const ctx: Ctx = { store: d1.store, user: owner, role: "owner", locationIds: null };
    const ws = () => d1.store.requireWorkspace();
    expect(ws().server?.schema).toBeGreaterThanOrEqual(900);
    const today = toISODate(new Date());
    const loc = ws().locations[0]!.id;

    ensureExpenseCategories(ctx);
    const sup = createSupplier(ctx, { name: "Proveedor Sintético", taxId: "B12345678" });
    const rent = ws().expenseCategories.find((c) => c.name === "Alquiler")!;
    const e1 = createExpense(ctx, { description: "Alquiler", issueDate: today, amount: 121000, includesTax: true, taxRateBp: 2100, supplierId: sup.id, categoryId: rent.id, locationId: loc, supplierInvoiceNumber: `A-${run}`, paid: false, dueDate: today });
    createExpense(ctx, { description: "Software", issueDate: today, amount: 1000, includesTax: false, taxRateBp: 2100, paid: true });
    markExpensePaid(ctx, [e1.id]);

    const c = createCustomer(ctx, { firstName: "Socia", lastName: "Sintética", status: "lead", taxId: "12345678Z" });
    const plan = createPlan(ctx, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 6000, taxRateBp: 2100, openToNew: true });
    const m = assignMembership(ctx, { customerId: c.id, planId: plan.id, startDate: today, locationId: loc, firstCharge: { methodKey: "card" } });
    pauseMembership(ctx, m.id, { reason: "Viaje" });
    resumeMembership(ctx, m.id);

    const lines = [
      { description: "Servicio A", quantity: 2, unitPrice: 6050, taxRateBp: 2100 },
      { description: "Servicio B", quantity: 1, unitPrice: 1100, taxRateBp: 1000, discountPct: 10 },
    ];
    const d = saveInvoiceDraft(ctx, { customerId: c.id, issueDate: today, dueDays: 15, lines });
    saveInvoiceDraft(ctx, { customerId: c.id, issueDate: today, dueDays: 15, lines: [lines[0]!] }, d.id); // quita una línea → borrado en el servidor
    issueInvoice(ctx, d.id);
    registerInvoicePayment(ctx, d.id, { methodKey: "transfer", amount: 5000 });
    createTask(ctx, { title: "Llamar para renovar", customerId: c.id, dueDate: today });
    updateOnboarding(ctx, { done: "fiscal" });

    await d1.sync.flush();
    await d1.sync.pull();
    expect(d1.errors).toEqual([]);
    // Números asignados por el servidor (cuota primero, factura manual después), correlativos y sin huecos
    const numbers = ws().invoices.filter((i) => i.status !== "draft").map((i) => i.number).sort();
    expect(numbers).toHaveLength(2);
    for (const n of numbers) expect(n).toMatch(/^F\d{4}-\d{5}$/);
    expect(new Set(numbers).size).toBe(2);
    expect(Number(numbers[1]!.slice(-5)) - Number(numbers[0]!.slice(-5))).toBe(1);

    // Segundo dispositivo: todo persistido
    const d2 = await device();
    await signIn(d2.sb, owner.email, "contraseña-segura");
    await d2.sync.open(orgId);
    const w2 = d2.store.requireWorkspace();
    expect(w2.suppliers.map((s) => s.name)).toEqual(["Proveedor Sintético"]);
    expect(w2.expenses).toHaveLength(2);
    expect(w2.expenses.find((x) => x.id === e1.id)).toMatchObject({ status: "paid", taxTotal: 21000, supplierId: sup.id });
    expect(w2.customerMemberships).toHaveLength(1);
    expect(w2.customerMemberships[0]).toMatchObject({ status: "active", price: 6000 });
    expect(w2.membershipCharges).toHaveLength(1);
    expect(w2.customers.find((x) => x.id === c.id)!.status).toBe("active");
    const inv = w2.invoices.find((i) => i.id === d.id)!;
    expect(inv).toMatchObject({ status: "partially_paid", amountPaid: 5000, total: 12100 });
    expect(w2.invoiceItems.filter((it) => it.invoiceId === d.id)).toHaveLength(1);
    expect(w2.tasks).toHaveLength(1);
    expect(w2.settings.onboarding?.done).toContain("fiscal");
    expect(w2.documentSeries.find((s) => s.id === inv.seriesId)!.nextNumber).toBe(3);
    expect(w2.auditLogs.some((l) => l.entityType === "expenses")).toBe(true);
    expect(w2.auditLogs.some((l) => l.entityType === "customer_memberships" && l.action === "pause")).toBe(true);

    // Aislamiento: otra empresa no ve nada de la primera
    const d3 = await device();
    await account(d3.sb, "otra");
    await createOrganization(d3.sb, { name: `Otra ${run}`, vertical: "retail", locationName: "Tienda" });
    for (const t of ["expenses", "suppliers", "customer_memberships", "membership_charges", "tasks", "document_series"]) {
      const r = await d3.sb.from(t).select("id").eq("organization_id", orgId);
      expect(r.data ?? []).toHaveLength(0);
    }
  }, 180_000);
});
