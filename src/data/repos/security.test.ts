import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Ctx } from "../context";
import { PermissionError } from "../context";
import type { PermissionOverrides } from "@/domain/permissions";
import type { RoleKey } from "@/domain/types";
import { createCustomer, updateCustomer } from "./customers";
import { issueInvoice, registerInvoicePayment, saveInvoiceDraft } from "./invoices";
import { assignMembership, chargeMembership, createPlan } from "./memberships";
import { addTeamMember, registerAccount, setMemberOverrides, updateMember } from "./auth";
import { createExpense } from "./expenses";
import { redactWorkspace } from "../privacy";
import { workspaceFor } from "../visibility";

/**
 * Permisos aplicados por los repositorios (la barrera del cliente; la definitiva es RLS/triggers, ver rls_isolation.sql):
 * excepciones individuales, customers.sensitive, cobro de facturas y cuotas, y gestión de equipo.
 */
let owner: Ctx;
let orgId: string;
const as = (role: RoleKey, overrides?: PermissionOverrides): Ctx => ({ ...owner, user: { id: `u-${role}`, fullName: role, email: `${role}@t` }, role, overrides });
const ov = (grant: PermissionOverrides["grant"] = [], revoke: PermissionOverrides["revoke"] = []): PermissionOverrides => ({ grant, revoke });
const ws = () => owner.store.requireWorkspace();
const draft = { customerName: "Cliente Ejemplo", issueDate: "2026-10-01", dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 1000, taxRateBp: 2100 }] };

beforeEach(async () => {
  const store = new Store(createMemoryKV());
  await store.init();
  const w = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(w);
  await store.openWorkspace(w.organization.id);
  owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
  orgId = w.organization.id;
});

describe("excepciones individuales en los repositorios", () => {
  it("MANAGER + grant: emite facturas y gestiona gastos; sin el grant, no", () => {
    expect(() => saveInvoiceDraft(as("manager"), draft)).toThrow(PermissionError);
    expect(() => createExpense(as("manager"), { description: "Luz", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false })).toThrow(PermissionError);
    const m = as("manager", ov(["invoices.manage", "expenses.manage"]));
    expect(() => saveInvoiceDraft(m, draft)).not.toThrow();
    expect(() => createExpense(m, { description: "Luz", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false })).not.toThrow();
  });

  it("revoke quita lo que da el rol, también al propietario", () => {
    expect(() => createCustomer(as("manager", ov([], ["customers.manage"])), { firstName: "Ana", status: "active" })).toThrow(PermissionError);
    expect(() => createCustomer(as("owner", ov([], ["customers.manage"])), { firstName: "Ana", status: "active" })).toThrow(PermissionError);
    expect(() => createCustomer(as("owner"), { firstName: "Ana", status: "active" })).not.toThrow();
  });

  it("el grant solo abre lo concedido: nada más", () => {
    const e = as("employee", ov(["expenses.manage"]));
    expect(() => createExpense(e, { description: "Luz", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false })).not.toThrow();
    expect(() => saveInvoiceDraft(e, draft)).toThrow(PermissionError);
  });
});

describe("customers.sensitive", () => {
  const fiscal = { firstName: "Ana", lastName: "Fiscal", status: "active" as const, taxId: "12345678Z", address: "Calle Falsa 1", postalCode: "28001", city: "Madrid", companyName: "Ana SL", birthDate: "1990-01-01", email: "ana@x.test", phone: "600000000" };

  it("quien no lo tiene no crea clientes con datos fiscales ni personales", () => {
    const e = as("employee");
    for (const k of ["taxId", "address", "postalCode", "city", "companyName", "birthDate"] as const) {
      expect(() => createCustomer(e, { firstName: "Ana", status: "active", [k]: k === "birthDate" ? "1990-01-01" : "x" })).toThrow(PermissionError);
    }
    // contacto operativo sí
    expect(() => createCustomer(e, { firstName: "Ana", status: "active", email: "a@x.test", phone: "600" })).not.toThrow();
  });

  it("quien no lo tiene puede editar la ficha sin perder (ni ver) lo sensible", () => {
    const c = createCustomer(owner, fiscal);
    const e = as("employee");
    const u = updateCustomer(e, c.id, { firstName: "Ana María", status: "active", email: "nuevo@x.test", taxId: "", address: "", postalCode: "", city: "", companyName: "", birthDate: "" });
    expect(u.firstName).toBe("Ana María");
    const stored = ws().customers.find((x) => x.id === c.id)!;
    expect(stored.taxId).toBe("12345678Z");               // no se borró
    expect(stored.address).toBe("Calle Falsa 1");
    expect(stored.birthDate).toBe("1990-01-01");
    expect(() => updateCustomer(e, c.id, { firstName: "Ana", status: "active", taxId: "B12345678" })).toThrow(PermissionError);
    expect(() => updateCustomer(e, c.id, { firstName: "Ana", status: "active", address: "Otra" })).toThrow(PermissionError);
    expect(ws().customers.find((x) => x.id === c.id)!.taxId).toBe("12345678Z");
  });

  it("con el permiso (rol o excepción) se guarda y se edita", () => {
    const withGrant = as("employee", ov(["customers.sensitive"]));
    const c = createCustomer(withGrant, fiscal);
    expect(ws().customers.find((x) => x.id === c.id)!.taxId).toBe("12345678Z");
    expect(() => updateCustomer(withGrant, c.id, { ...fiscal, city: "Sevilla" })).not.toThrow();
    // el rol que lo tiene pero lo pierde por excepción, no
    expect(() => updateCustomer(as("owner", ov([], ["customers.sensitive"])), c.id, { ...fiscal, city: "Otra" })).toThrow(PermissionError);
  });

  it("workspaceFor(false) quita de la vista NIF, dirección, empresa y nacimiento de clientes y la copia fiscal de las facturas", () => {
    const c = createCustomer(owner, fiscal);
    const inv = saveInvoiceDraft(owner, { ...draft, customerId: c.id, customerName: undefined } as never);
    issueInvoice(owner, inv.id);
    expect(ws().customers[0]!.taxId).toBeDefined();
    const withData = workspaceFor(ws(), true);
    const without = workspaceFor(ws(), false);
    expect(withData.customers[0]!.taxId).toBe("12345678Z");
    const cu = without.customers[0]!;
    for (const k of ["taxId", "taxIdNormalized", "taxIdValid", "address", "postalCode", "city", "companyName", "birthDate"] as const) expect(cu[k], k).toBeUndefined();
    expect(cu.email).toBe("ana@x.test");                    // contacto operativo: se conserva
    expect(cu.phone).toBe("600000000");
    expect(without.invoices[0]!.customerTaxId).toBeUndefined();
    expect(without.invoices[0]!.customerAddress).toBeUndefined();
    expect(JSON.stringify(without)).not.toContain("12345678Z");
    expect(JSON.stringify(without)).not.toContain("Calle Falsa");
    expect(JSON.stringify(without)).not.toContain("1990-01-01");
    // el original no se toca y el resultado se memoiza
    expect(ws().customers[0]!.taxId).toBe("12345678Z");
    expect(workspaceFor(ws(), false)).toBe(without);
  });

  it("la auditoría de un cliente no enseña NIF ni dirección a quien no tiene el permiso", () => {
    const c = createCustomer(owner, fiscal);
    updateCustomer(owner, c.id, { ...fiscal, taxId: "B12345678", city: "Sevilla", email: "otro@x.test" });
    const log = ws().auditLogs.filter((l) => l.entityId === c.id && l.action === "update").at(-1)!;
    expect(Object.keys(log.changes ?? {})).toEqual(expect.arrayContaining(["taxId", "city", "email"]));
    const red = redactWorkspace(ws()).auditLogs.filter((l) => l.entityId === c.id && l.action === "update").at(-1)!;
    expect(Object.keys(red.changes ?? {})).toContain("email");
    for (const k of ["taxId", "taxIdNormalized", "taxIdValid", "city", "address"]) expect(Object.keys(red.changes ?? {})).not.toContain(k);
    expect(JSON.stringify(red)).not.toContain("B12345678");
  });

  it("la copia de seguridad JSON sale sin datos sensibles si no se tiene el permiso", async () => {
    createCustomer(owner, fiscal);
    const full = await owner.store.exportWorkspaceJson();
    const safe = await owner.store.exportWorkspaceJson({ canSensitive: false });
    expect(full).toContain("12345678Z");
    expect(safe).not.toContain("12345678Z");
    expect(safe).not.toContain("Calle Falsa");
    expect(safe).toContain("ana@x.test");
  });
});

describe("cobro de cuotas y facturas", () => {
  let n = 0;
  const setup = () => {
    n++;
    const c = createCustomer(owner, { firstName: `Socia ${n}`, status: "active" });
    const plan = createPlan(owner, { name: `Mensual ${n}`, kind: "recurring", billingPeriod: "month", price: 6050, taxRateBp: 2100, openToNew: true });
    const m = assignMembership(owner, { customerId: c.id, planId: plan.id, startDate: "2026-10-01" });
    return { c, plan, m };
  };

  it("OWNER, ADMIN, MANAGER y FINANCE-con-membresías cobran la cuota; STAFF y VIEWER no", () => {
    for (const role of ["owner", "admin", "manager"] as RoleKey[]) {
      const { m } = setup();
      expect(() => chargeMembership(as(role), m.id, { methodKey: "card", issueDate: "2026-10-01" }), role).not.toThrow();
    }
    const { m } = setup();
    for (const role of ["employee", "read_only"] as RoleKey[]) {
      expect(() => chargeMembership(as(role), m.id, { methodKey: "card", issueDate: "2026-10-01" }), role).toThrow(PermissionError);
      expect(() => chargeMembership(as(role), m.id, { issueDate: "2026-10-01" }), `${role} pendiente`).toThrow(PermissionError);
    }
    // FINANCE cobra facturas pero la cuota es de membresías (memberships.manage)
    expect(() => chargeMembership(as("accountant"), m.id, { methodKey: "card", issueDate: "2026-10-01" })).toThrow(PermissionError);
  });

  it("emitir la cuota no exige invoices.manage; cobrarla en el acto exige payments.manage", () => {
    const { m } = setup();
    const noPay = as("manager", ov([], ["payments.manage"]));
    expect(() => chargeMembership(noPay, m.id, { methodKey: "card", issueDate: "2026-10-01" })).toThrow(PermissionError);
    const r = chargeMembership(noPay, m.id, { issueDate: "2026-10-01" });                // «emitir pendiente»
    expect(r.invoice.status).toBe("issued");
    expect(r.charge.status).toBe("invoiced");
    // …y el cobro posterior de esa factura sigue necesitando payments.manage
    expect(() => registerInvoicePayment(noPay, r.invoice.id, { methodKey: "card" })).toThrow(PermissionError);
    expect(() => registerInvoicePayment(as("manager"), r.invoice.id, { methodKey: "card" })).not.toThrow();
  });

  it("el cobro de facturas, parcial o total, exige payments.manage", () => {
    const f = issueInvoice(owner, saveInvoiceDraft(owner, draft).id);
    for (const role of ["employee", "read_only"] as RoleKey[]) {
      expect(() => registerInvoicePayment(as(role), f.id, { methodKey: "card", amount: 100 })).toThrow(PermissionError);
    }
    expect(() => registerInvoicePayment(as("accountant", ov([], ["payments.manage"])), f.id, { methodKey: "card" })).toThrow(PermissionError);
    expect(() => registerInvoicePayment(as("manager"), f.id, { methodKey: "card", amount: 100 })).not.toThrow();   // parcial
    expect(ws().invoices.find((i) => i.id === f.id)!.status).toBe("partially_paid");
  });
});

describe("equipo: owner protegido, sin autoescalada y excepciones (modo local)", () => {
  const member = async (email: string, role: RoleKey) => {
    await addTeamMember(owner, orgId, { fullName: email, email, password: "contraseña-1", role, locationIds: null });
    return owner.store.getMeta().members.find((m) => m.organizationId === orgId && m.userId === owner.store.getMeta().users.find((u) => u.email === email)!.id)!;
  };

  it("nadie modifica al owner ni cambia su propio rol o permisos", async () => {
    const admin = await member("admin@t.test", "admin");
    const ownerMember = { id: "owner-member", organizationId: orgId, userId: owner.user.id, role: "owner" as RoleKey, locationIds: null, status: "active" as const, createdAt: "2026-10-01T00:00:00Z" };
    await owner.store.updateMeta((m) => ({ ...m, members: [...m.members, ownerMember] }));
    const adminCtx: Ctx = { ...owner, user: { id: admin.userId, fullName: "Admin", email: "admin@t.test" }, role: "admin" };
    await expect(updateMember(adminCtx, ownerMember.id, { role: "employee" })).rejects.toThrow();
    await expect(setMemberOverrides(adminCtx, ownerMember.id, ov([], ["team.manage"]))).rejects.toThrow();
    await expect(updateMember(adminCtx, admin.id, { role: "employee" })).rejects.toThrow(/propio/);
    await expect(setMemberOverrides(adminCtx, admin.id, ov([], ["sales.void"]))).rejects.toThrow(/propio/);
    await expect(updateMember(adminCtx, admin.id, { role: "owner" })).rejects.toThrow();
  });

  it("las excepciones se guardan, se auditan y se calculan igual que en el servidor", async () => {
    const m = await member("marta@t.test", "manager");
    await setMemberOverrides(owner, m.id, ov(["expenses.manage", "invoices.manage"], ["sales.void"]));
    const stored = owner.store.getMeta().members.find((x) => x.id === m.id)!;
    expect(stored.permissionOverrides).toEqual({ grant: ["expenses.manage", "invoices.manage"], revoke: ["sales.void"] });
    const logs = ws().auditLogs.filter((l) => l.entityType === "organization_members" && l.action === "permission_change");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.context).toMatchObject({ from: { grant: [], revoke: [] }, to: { grant: ["expenses.manage", "invoices.manage"], revoke: ["sales.void"] } });
    // sin cambios reales, nada que auditar
    await setMemberOverrides(owner, m.id, ov(["invoices.manage", "expenses.manage"], ["sales.void"]));
    expect(ws().auditLogs.filter((l) => l.action === "permission_change")).toHaveLength(1);
  });

  it("un gestor de equipo no concede lo que no tiene; el resto del equipo no gestiona nada", async () => {
    const m = await member("marta2@t.test", "manager");
    const e = await member("eva@t.test", "employee");
    // Marta recibe team.manage por excepción: puede dar lo que tiene, no más
    const marta: Ctx = { ...owner, user: { id: m.userId, fullName: "Marta", email: "marta2@t.test" }, role: "manager", overrides: ov(["team.manage"]) };
    await expect(setMemberOverrides(marta, e.id, ov(["settings.manage"]))).rejects.toThrow(PermissionError);
    await expect(setMemberOverrides(marta, e.id, ov(["catalog.manage"]))).resolves.toBeUndefined();   // lo tiene: sí
    // el rol «manager» sin esa excepción no gestiona el equipo
    await expect(setMemberOverrides(as("manager"), e.id, ov(["catalog.manage"]))).rejects.toThrow(PermissionError);
    await expect(setMemberOverrides(as("accountant"), e.id, ov())).rejects.toThrow(PermissionError);
    await registerAccount(owner.store, { fullName: "Otra", email: "otra@t.test", password: "contraseña-1" });
  });

  it("un miembro de otra empresa no se puede tocar", async () => {
    const other = { id: "m-other", organizationId: "otra-empresa", userId: "u-x", role: "employee" as RoleKey, locationIds: null, status: "active" as const, createdAt: "2026-10-01T00:00:00Z" };
    await owner.store.updateMeta((m) => ({ ...m, members: [...m.members, other] }));
    await expect(updateMember(owner, other.id, { role: "manager" })).rejects.toThrow(/no encontrado/i);
    await expect(setMemberOverrides(owner, other.id, ov(["audit.view"]))).rejects.toThrow(/no encontrado/i);
  });
});
