import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Store } from "@/data/store";
import { createMemoryKV } from "@/data/persistence";
import { buildWorkspace } from "@/data/workspace";
import type { Ctx } from "@/data/context";
import { createCustomer } from "@/data/repos/customers";
import { issueInvoice, saveInvoiceDraft } from "@/data/repos/invoices";
import { workspaceFor } from "@/data/visibility";
import { quarterPeriod } from "@/lib/dates";
import { buildCsv } from "@/lib/export";
import { DataTable, ExportAllowedContext, type Column } from "@/design-system/components/DataTable";
import { buildGestoriaReport } from "./gestoria";
import { can, type PermissionOverrides } from "@/domain/permissions";
import { buildReport } from "@/domain/reports";
import type { RoleKey } from "@/domain/types";

/** Exportaciones: la interfaz y los ficheros (CSV/Excel/PDF/JSON) enseñan exactamente lo mismo, y exportar es un permiso. */
async function seeded() {
  const store = new Store(createMemoryKV());
  await store.init();
  const w = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  await store.createWorkspace(w);
  await store.openWorkspace(w.organization.id);
  const owner: Ctx = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
  const c = createCustomer(owner, { firstName: "Zulema", lastName: "Quintana", status: "active", taxId: "12345678Z", address: "Calle Secreta 7", email: "zulema@x.test" });
  const f = saveInvoiceDraft(owner, { customerId: c.id, issueDate: "2026-08-10", dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 12100, taxRateBp: 2100 }] } as never);
  issueInvoice(owner, f.id);
  return store.requireWorkspace();
}

describe("exportar tablas: es un permiso (reports.export), aplicado en un solo sitio", () => {
  type Row = { id: string; name: string };
  const columns: Column<Row>[] = [{ id: "name", header: "Nombre", exportValue: (r) => r.name, cell: (r) => r.name }];
  const render = (allowed?: boolean) => {
    const table = createElement(DataTable<Row>, { rows: [{ id: "1", name: "Ana" }], columns, getRowId: (r: Row) => r.id, exportName: "Clientes" });
    return renderToStaticMarkup(allowed === undefined ? table : createElement(ExportAllowedContext.Provider, { value: allowed }, table));
  };

  it("sin permiso la tabla no ofrece exportar; con permiso (o aislada) sí", () => {
    expect(render(false)).not.toContain("Exportar");
    expect(render(true)).toContain("Exportar");
    expect(render()).toContain("Exportar");
  });

  it("quién exporta: OWNER, ADMIN y FINANCE; no MANAGER, STAFF ni VIEWER, salvo excepción", () => {
    const allowed = (role: RoleKey, ov?: PermissionOverrides) => can(role, ov, "reports.export");
    expect(["owner", "admin", "accountant"].every((r) => allowed(r as RoleKey))).toBe(true);
    expect(["manager", "employee", "read_only"].some((r) => allowed(r as RoleKey))).toBe(false);
    expect(allowed("manager", { grant: ["reports.export"], revoke: [] })).toBe(true);
    expect(allowed("accountant", { grant: [], revoke: ["reports.export"] })).toBe(false);
  });
});

describe("ficheros exportados sin datos sensibles", () => {
  it("el paquete de la gestoría (CSV/Excel/PDF salen de estas hojas) no lleva NIF ni dirección de clientes sin customers.sensitive", async () => {
    const raw = await seeded();
    const period = quarterPeriod(2026, 3);
    const withPerm = buildGestoriaReport(workspaceFor(raw, true), period, undefined, { canSensitive: true });
    const withoutPerm = buildGestoriaReport(workspaceFor(raw, false), period, undefined, { canSensitive: false });
    const csvOf = (r: typeof withPerm) => r.sheets.map((s) => buildCsv(s)).join("\n");
    expect(csvOf(withPerm)).toContain("12345678Z");
    expect(csvOf(withoutPerm)).not.toContain("12345678Z");
    expect(csvOf(withoutPerm)).not.toContain("Calle Secreta");
    expect(JSON.stringify(withoutPerm)).not.toContain("12345678Z");
    // la importes y el IVA no cambian: solo se oculta el dato personal
    expect(withoutPerm.vat).toEqual(withPerm.vat);
    expect(withoutPerm.kpis).toEqual(withPerm.kpis);
    // y no se avisa de «facturas sin NIF» cuando es solo que no se ve
    expect(withoutPerm.warnings.some((w) => /sin NIF del cliente/.test(w))).toBe(false);
  });

  it("los informes por área (ventas, clientes, facturas…) tampoco incluyen datos sensibles", async () => {
    const raw = await seeded();
    const ws = workspaceFor(raw, false);
    const period = quarterPeriod(2026, 3);
    for (const key of ["customers", "invoices", "revenue", "payments", "memberships"] as const) {
      const r = buildReport(ws, key, { period, compare: null });
      const text = JSON.stringify(r);
      expect(text, key).not.toContain("12345678Z");
      expect(text, key).not.toContain("Calle Secreta");
    }
  });
});
