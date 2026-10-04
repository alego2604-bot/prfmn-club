import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Ctx } from "../context";
import { ROLE_PERMISSIONS, roleCan } from "@/domain/permissions";
import type { RoleKey } from "@/domain/types";
import { createCategory, createProduct, updateProduct } from "./catalog";
import { createCustomer } from "./customers";
import { openCashSession } from "./cash";
import { createExpense, createSupplier } from "./expenses";
import { registerInvoicePayment, saveInvoiceDraft } from "./invoices";
import { createPlan } from "./memberships";
import { addLocation, updateOrganization } from "./settings";
import { createTask } from "./tasks";
import { addTeamMember, registerAccount, updateMember } from "./auth";

/**
 * Permisos por rol: el cliente y el servidor deben pensar lo mismo, y cada rol solo puede escribir lo suyo.
 * (La última barrera es RLS en el servidor; esto evita que la interfaz ofrezca, o el repositorio acepte, lo que no toca.)
 */
let owner: Ctx;
let loc: string;
const as = (role: RoleKey): Ctx => ({ ...owner, user: { id: `u-${role}`, fullName: role, email: `${role}@t` }, role });

beforeEach(async () => {
  const store = new Store(createMemoryKV());
  await store.init();
  const ws = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(ws);
  await store.openWorkspace(ws.organization.id);
  owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
  loc = ws.locations[0]!.id;
});

describe("roles: cliente = servidor", () => {
  it("los permisos de cada rol coinciden con los sembrados en la base de datos", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261001000100_foundation.sql", import.meta.url), "utf8");
    const block = sql.slice(sql.indexOf("insert into public.role_permissions"), sql.indexOf("end) as p;"));
    const server: Record<string, string[] | "*"> = {};
    for (const m of block.matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)) {
      const perms = [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
      server[m[1]!] = perms.length === 1 && perms[0] === "*" ? "*" : perms.sort();
    }
    const client = Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([k, v]) => [k, v === "*" ? "*" : [...v].sort()]));
    expect(Object.keys(server).sort()).toEqual(Object.keys(client).sort());
    expect(server).toEqual(client);
  });
});

describe("cada rol solo escribe lo suyo", () => {
  const draft = { customerName: "Cliente Ejemplo", issueDate: "2026-10-01", dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 1000, taxRateBp: 2100 }] };
  const expense = { description: "Luz", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false };

  it("solo lectura: no puede escribir nada", () => {
    const r = as("read_only");
    expect(() => createCustomer(r, { firstName: "Ana", status: "active" })).toThrow();
    expect(() => createCategory(r, { name: "X", defaultTaxRateBp: 2100 })).toThrow();
    expect(() => openCashSession(r, loc, 0)).toThrow();
    expect(() => createExpense(r, expense)).toThrow();
    expect(() => saveInvoiceDraft(r, draft)).toThrow();
    expect(() => createTask(r, { title: "Llamar" })).toThrow();
    expect(() => updateOrganization(r, { name: "Otra" })).toThrow();
  });

  it("encargado: opera el día a día pero no finanzas, facturación ni ajustes", () => {
    const m = as("manager");
    expect(() => createCustomer(m, { firstName: "Ana", status: "active" })).not.toThrow();
    expect(() => openCashSession(m, loc, 0)).not.toThrow();
    expect(() => createExpense(m, expense)).toThrow();
    expect(() => createSupplier(m, { name: "Proveedor" })).toThrow();
    expect(() => saveInvoiceDraft(m, draft)).toThrow();
    expect(() => updateOrganization(m, { name: "Otra" })).toThrow();
    expect(() => addLocation(m, "Centro 2")).toThrow();
  });

  it("encargado: edita fichas de producto pero no su precio", () => {
    const cat = createCategory(owner, { name: "Bebidas", defaultTaxRateBp: 1000 });
    const p = createProduct(owner, { name: "Agua", categoryId: cat.id, kind: "physical", price: 100, taxRateBp: 1000, trackStock: false, posVisible: true });
    const m = as("manager");
    expect(() => updateProduct(m, p.id, { ...p, sku: p.sku ?? "", name: "Agua 50cl" })).not.toThrow();
    expect(() => updateProduct(m, p.id, { ...p, sku: p.sku ?? "", price: 150 })).toThrow();
  });

  it("empleado: vende y atiende clientes; nada de gastos, facturas, tarifas ni ajustes", () => {
    const e = as("employee");
    expect(() => createCustomer(e, { firstName: "Ana", status: "active" })).not.toThrow();
    expect(() => createExpense(e, expense)).toThrow();
    expect(() => saveInvoiceDraft(e, draft)).toThrow();
    expect(() => createPlan(e, { name: "Mensual", kind: "recurring", billingPeriod: "month", price: 5000, taxRateBp: 2100, openToNew: true })).toThrow();
    expect(() => updateOrganization(e, { name: "Otra" })).toThrow();
  });

  it("contable: gastos, facturas y cobros; no caja, catálogo, clientes ni ajustes", () => {
    const a = as("accountant");
    expect(() => createExpense(a, expense)).not.toThrow();
    const inv = saveInvoiceDraft(a, draft);
    expect(inv.status).toBe("draft");
    expect(() => openCashSession(a, loc, 0)).toThrow();
    expect(() => createCategory(a, { name: "X", defaultTaxRateBp: 2100 })).toThrow();
    expect(() => createCustomer(a, { firstName: "Ana", status: "active" })).toThrow();
    expect(() => updateOrganization(a, { name: "Otra" })).toThrow();
    expect(roleCan("accountant", "team.manage")).toBe(false);
  });

  it("cobrar una factura exige poder registrar cobros", () => {
    const inv = saveInvoiceDraft(owner, draft);
    expect(() => registerInvoicePayment(as("manager"), inv.id, { methodKey: "card" })).toThrow();
  });
});

describe("equipo", () => {
  it("solo quien gestiona el equipo puede añadir personas o cambiar roles (y queda en la auditoría)", async () => {
    await registerAccount(owner.store, { fullName: "Persona Ejemplo", email: "persona@empresa.test", password: "contraseña-1" });
    const orgId = owner.store.requireWorkspace().organization.id;
    const input = { fullName: "Persona Ejemplo", email: "persona@empresa.test", password: "contraseña-1", role: "employee" as const, locationIds: null };
    for (const role of ["manager", "employee", "accountant", "read_only"] as RoleKey[]) await expect(addTeamMember(as(role), orgId, input)).rejects.toThrow();
    await addTeamMember(owner, orgId, input);
    const member = owner.store.getMeta().members.find((m) => m.organizationId === orgId && m.role === "employee")!;
    await expect(updateMember(as("employee"), member.id, { role: "admin" })).rejects.toThrow();
    await expect(updateMember(as("manager"), member.id, { role: "admin" })).rejects.toThrow();
    await updateMember(owner, member.id, { role: "manager" });
    expect(owner.store.getMeta().members.find((m) => m.id === member.id)!.role).toBe("manager");
    const logs = owner.store.requireWorkspace().auditLogs.filter((l) => l.entityType === "organization_members");
    expect(logs.map((l) => l.action)).toEqual(["invite", "role_change"]);
  });
});
