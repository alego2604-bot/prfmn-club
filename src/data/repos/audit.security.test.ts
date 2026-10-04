import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Ctx } from "../context";
import { createCustomer } from "./customers";
import { createProduct } from "./catalog";
import { closeCashSession, openCashSession } from "./cash";
import { createSale, voidSale } from "./sales";
import { createExpense } from "./expenses";
import { issueInvoice, registerInvoicePayment, saveInvoiceDraft, voidInvoice } from "./invoices";
import { assignMembership, chargeMembership, createPlan, pauseMembership } from "./memberships";
import { updateActivityRules, updateOrganization } from "./settings";
import { addTeamMember, setMemberOverrides, updateMember } from "./auth";

/**
 * Cada acción sensible deja UN registro de auditoría con autor, acción, entidad y etiqueta (sin ruido: una acción, un registro).
 * En la nube el servidor escribe lo mismo con triggers (supabase/tests/rls_isolation.sql y staging910.integration.test.ts).
 */
let owner: Ctx;
const ws = () => owner.store.requireWorkspace();
const logs = (action: string, entityType?: string) => ws().auditLogs.filter((l) => l.action === action && (!entityType || l.entityType === entityType));

beforeEach(async () => {
  const store = new Store(createMemoryKV());
  await store.init();
  const w = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(w);
  await store.openWorkspace(w.organization.id);
  owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
});

describe("auditoría de acciones sensibles", () => {
  it("equipo: invitar, cambiar rol y cambiar permisos", async () => {
    const orgId = ws().organization.id;
    await addTeamMember(owner, orgId, { fullName: "Marta", email: "marta@t.test", password: "contraseña-1", role: "manager", locationIds: null });
    const m = owner.store.getMeta().members.find((x) => x.role === "manager")!;
    await updateMember(owner, m.id, { role: "employee" });
    await setMemberOverrides(owner, m.id, { grant: ["invoices.manage"], revoke: [] });
    for (const a of ["invite", "role_change", "permission_change"]) {
      expect(logs(a, "organization_members"), a).toHaveLength(1);
      expect(logs(a)[0]).toMatchObject({ actorId: "alex", actorName: "Alex", entityId: expect.any(String), entityLabel: "Marta" });
    }
  });

  it("configuración y datos de la empresa", () => {
    updateOrganization(owner, { city: "Sevilla" });
    updateActivityRules(owner, [], false);
    expect(logs("update", "organizations")).toHaveLength(1);
    expect(logs("update", "organizations")[0]!.changes).toHaveProperty("city");
    expect(logs("update", "organization_settings")).toHaveLength(1);
  });

  it("facturas: emitir, cobrar (parcial y total) y anular", () => {
    const c = createCustomer(owner, { firstName: "Cliente", status: "active" });
    const f = saveInvoiceDraft(owner, { customerId: c.id, issueDate: "2026-10-01", dueDays: 0, lines: [{ description: "S", quantity: 1, unitPrice: 12100, taxRateBp: 2100 }] } as never);
    issueInvoice(owner, f.id);
    registerInvoicePayment(owner, f.id, { methodKey: "card", amount: 5000 });
    registerInvoicePayment(owner, f.id, { methodKey: "card" });
    voidInvoice(owner, f.id, "Error de emisión");
    expect(logs("issue", "invoices")).toHaveLength(1);
    expect(logs("payment", "invoices")).toHaveLength(2);
    expect(logs("void", "invoices")).toHaveLength(1);
    expect(logs("void", "invoices")[0]!.context).toMatchObject({ reason: "Error de emisión" });
  });

  it("caja: venta, devolución al anularla y cierre; gastos; membresías", () => {
    const loc = ws().locations[0]!.id;
    const p = createProduct(owner, { name: "Bono", categoryId: null, kind: "pack", price: 12100, taxRateBp: 2100, trackStock: false, posVisible: true });
    const s = openCashSession(owner, loc, 0);
    const sale = createSale(owner, { locationId: loc, lines: [{ productId: p.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 12100 }] });
    voidSale(owner, sale.id, "Cobro duplicado");
    closeCashSession(owner, s.id, 0);
    expect(logs("insert", "sales")).toHaveLength(1);
    expect(logs("void", "sales")).toHaveLength(1);
    expect(logs("refund", "payments")).toHaveLength(1);
    expect(logs("close")).toHaveLength(1);
    createExpense(owner, { description: "Luz", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false });
    expect(logs("insert", "expenses")).toHaveLength(1);
    const c = createCustomer(owner, { firstName: "Socia", status: "active" });
    const plan = createPlan(owner, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 6050, taxRateBp: 2100, openToNew: true });
    const m = assignMembership(owner, { customerId: c.id, planId: plan.id, startDate: "2026-10-01" });
    chargeMembership(owner, m.id, { methodKey: "card", issueDate: "2026-10-01" });
    pauseMembership(owner, m.id, { reason: "Viaje" });
    expect(logs("charge", "customer_memberships")).toHaveLength(1);
    expect(logs("pause", "customer_memberships")).toHaveLength(1);
    // toda entrada tiene autor y entidad
    for (const l of ws().auditLogs) expect(l.actorId && l.entityType, JSON.stringify(l)).toBeTruthy();
  });

  it("importaciones: el motor registra «import» (ver engine.test.ts) y la reversión «revert»", () => {
    // Cubierto en features/imports/engine/engine.test.ts (import, revert); aquí se fija que la acción existe en el catálogo de etiquetas
    // para que Ajustes → Auditoría la muestre con texto legible.
    return import("@/features/shared/auditLabels").then(({ AUDIT_ACTION }) => {
      for (const a of ["import", "revert", "role_change", "permission_change", "invite", "void", "refund", "payment", "issue", "charge"]) expect(AUDIT_ACTION[a], a).toBeTruthy();
    });
  });
});
