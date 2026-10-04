import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "@/data/store";
import { createMemoryKV } from "@/data/persistence";
import { buildWorkspace } from "@/data/workspace";
import type { Ctx } from "@/data/context";
import { createCustomer } from "@/data/repos/customers";
import { createProduct } from "@/data/repos/catalog";
import { openCashSession } from "@/data/repos/cash";
import { createSale } from "@/data/repos/sales";
import { createExpense, createSupplier } from "@/data/repos/expenses";
import { issueInvoice, saveInvoiceDraft } from "@/data/repos/invoices";
import { addLocation } from "@/data/repos/settings";
import { workspaceFor } from "@/data/visibility";
import { can as roleCan, type Permission, type PermissionOverrides } from "@/domain/permissions";
import type { RoleKey } from "@/domain/types";
import { ALL_ITEMS, isPlanned, NAV, routePath } from "./nav";
import { ROUTE_PERMISSIONS } from "./routePermissions";
import { buildEntries, searchEntries } from "./commandSearch";

describe("navegación y rutas directas", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

  it("cada ruta protegida de App.tsx sale de ROUTE_PERMISSIONS y no hay permisos escritos a mano en las rutas", () => {
    const used = [...appSource.matchAll(/<Guard route="([^"]+)">/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(20);
    for (const r of used) expect(ROUTE_PERMISSIONS[r], `ruta ${r}`).toBeDefined();
    // toda entrada de la tabla se usa en alguna ruta (si no, sería un permiso que no se aplica)
    for (const r of Object.keys(ROUTE_PERMISSIONS)) expect(used, `ruta sin guard: ${r}`).toContain(r);
    expect(appSource).not.toMatch(/<Guard perm="/);
  });

  it("el menú y la ruta piden el mismo permiso: lo que no se ve, tampoco se abre escribiendo la URL", () => {
    for (const item of ALL_ITEMS.filter((i) => !isPlanned(i))) {
      const path = routePath(item);
      if (path === "/ajustes") continue;                  // Ajustes: la ruta es común; cada pestaña tiene su permiso (ver más abajo)
      expect(item.perm, `${item.label} sin permiso`).toBeDefined();
      expect(ROUTE_PERMISSIONS[path], `${item.label} (${path}) sin guard de ruta`).toBe(item.perm);
    }
    // las rutas planificadas también se protegen con su permiso
    expect(appSource).toMatch(/item\.perm \? <Guard perm=\{item\.perm\}>/);
  });

  it("acciones sensibles: crear/editar facturas y la puesta en marcha tienen su propio permiso", () => {
    expect(ROUTE_PERMISSIONS["/facturas/nueva"]).toBe("invoices.manage");
    expect(ROUTE_PERMISSIONS["/facturas/:id/editar"]).toBe("invoices.manage");
    expect(ROUTE_PERMISSIONS["/bienvenida"]).toBe("settings.manage");
    expect(ROUTE_PERMISSIONS["/importaciones/nueva"]).toBe("imports.run");
  });

  it("por rol y excepción: cada módulo del menú es visible solo con su permiso", () => {
    const visible = (role: RoleKey, ov?: PermissionOverrides) => ALL_ITEMS.filter((i) => !isPlanned(i) && (!i.perm || roleCan(role, ov, i.perm))).map((i) => i.label);
    expect(visible("employee")).not.toEqual(expect.arrayContaining(["Facturas"]));
    expect(visible("employee")).not.toEqual(expect.arrayContaining(["Equipo"]));
    expect(visible("employee")).not.toEqual(expect.arrayContaining(["Importaciones"]));
    expect(visible("read_only")).toEqual(expect.arrayContaining(["Facturas", "Gastos", "Cobros"]));
    expect(visible("read_only")).not.toEqual(expect.arrayContaining(["Caja", "Equipo", "Importaciones"]));
    expect(visible("manager")).not.toEqual(expect.arrayContaining(["Equipo", "Centros"]));
    expect(visible("manager", { grant: ["team.manage"], revoke: [] })).toEqual(expect.arrayContaining(["Equipo"]));
    expect(visible("accountant")).toEqual(expect.arrayContaining(["Facturas", "Informes"]));
    expect(visible("accountant")).not.toEqual(expect.arrayContaining(["Caja", "Equipo"]));
    expect(visible("owner")).toEqual(expect.arrayContaining(["Equipo", "Centros", "Importaciones"]));
    // Empresa → Equipo y Centros: el grupo solo aparece con permiso
    const empresa = NAV.find((g) => g.label === "Empresa")!;
    expect(empresa.items.every((i) => i.perm === "team.manage" || i.perm === "settings.manage")).toBe(true);
  });

  it("las pestañas de Ajustes por URL (?tab=) se limitan a las permitidas", () => {
    const src = readFileSync(new URL("../features/settings/SettingsPage.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const tab: Tab = wanted && allowed\.has\(wanted\) \? wanted : fallback;/);
    for (const [tab, perm] of [["team", "team.manage"], ["audit", "audit.view"]] as [string, string][]) expect(src).toContain(`can("${perm}") ? [{ value: "${tab}" as Tab`);
  });
});

describe("⌘K: búsqueda global y acciones respetan permisos", () => {
  let owner: Ctx;
  let locA: string;
  let locB: string;

  beforeEach(async () => {
    const store = new Store(createMemoryKV());
    await store.init();
    const w = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro Norte" });
    await store.createWorkspace(w);
    await store.openWorkspace(w.organization.id);
    owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
    locA = w.locations[0]!.id;
    addLocation(owner, "Centro Sur");
    locB = store.requireWorkspace().locations.find((l) => l.name === "Centro Sur")!.id;
    const c = createCustomer(owner, { firstName: "Zulema", lastName: "Quintana", status: "active", taxId: "12345678Z", email: "zulema@x.test", phone: "600111222", address: "Calle Secreta 7" });
    createSupplier(owner, { name: "Proveedor Quimera", taxId: "B11111111" });
    createExpense(owner, { description: "Gasto Quimera", issueDate: "2026-10-01", amount: 1000, includesTax: true, taxRateBp: 2100, paid: false });
    const p = createProduct(owner, { name: "Bono Especial", categoryId: null, kind: "pack", price: 12100, taxRateBp: 2100, trackStock: false, posVisible: true });
    openCashSession(owner, locB, 0);
    createSale(owner, { locationId: locB, lines: [{ productId: p.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 12100 }] });
    const f = saveInvoiceDraft(owner, { customerId: c.id, issueDate: "2026-10-01", dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 1000, taxRateBp: 2100 }] } as never);
    issueInvoice(owner, f.id);
  });

  const search = (role: RoleKey, q: string, ov?: PermissionOverrides, scope: string[] | null = null) => {
    const can = (p: Permission) => roleCan(role, ov, p);
    const ws = workspaceFor(owner.store.requireWorkspace(), can("customers.sensitive"));
    return searchEntries(ws, can, buildEntries(ws, can, []), q, scope);
  };
  const groups = (r: ReturnType<typeof search>) => [...new Set(r.map((e) => e.group))];

  it("el NIF no busca ni se muestra sin customers.sensitive (ni aunque el espacio de trabajo llegara completo)", () => {
    expect(search("accountant", "12345678Z").map((e) => e.label)).toContain("Zulema Quintana");
    for (const role of ["employee", "manager", "read_only"] as RoleKey[]) {
      expect(search(role, "12345678Z").filter((e) => e.group === "Clientes"), role).toHaveLength(0);
      expect(JSON.stringify(search(role, "zulema")), role).not.toContain("12345678Z");
    }
    // defensa en profundidad: la búsqueda no usa el NIF aunque el workspace sin filtrar le llegue
    const raw = owner.store.requireWorkspace();
    const can = (p: Permission) => roleCan("employee", undefined, p);
    expect(searchEntries(raw, can, buildEntries(raw, can, []), "12345678Z").filter((e) => e.group === "Clientes")).toHaveLength(0);
    expect(searchEntries(raw, can, buildEntries(raw, can, []), "zulema").map((e) => e.hint).join()).not.toContain("12345678Z");
  });

  it("no aparecen resultados de áreas sin acceso: gastos, proveedores, facturas, equipo y ajustes", () => {
    expect(groups(search("employee", "quimera"))).not.toEqual(expect.arrayContaining(["Gastos"]));
    expect(groups(search("employee", "quimera"))).not.toEqual(expect.arrayContaining(["Proveedores"]));
    expect(groups(search("employee", "factura"))).not.toContain("Facturas");
    expect(search("employee", "equipo").map((e) => e.to)).not.toContain("/ajustes?tab=equipo");
    expect(search("manager", "equipo").map((e) => e.to)).not.toContain("/ajustes?tab=equipo");
    expect(search("manager", "equipo", { grant: ["team.manage"], revoke: [] }).map((e) => e.to)).toContain("/ajustes?tab=equipo");
    // «Ajustes» es común (cada pestaña interna tiene su permiso); no hay atajos a Equipo/Centros/Auditoría sin permiso
    for (const role of ["employee", "read_only"] as RoleKey[]) expect(search(role, "auditoria").every((e) => e.to === "/ajustes"), role).toBe(true);
    expect(search("employee", "centros").map((e) => e.to)).not.toContain("/ajustes?tab=centros");
    expect(groups(search("read_only", "quimera"))).toEqual(expect.arrayContaining(["Gastos", "Proveedores"]));
    expect(groups(search("accountant", "quimera"))).toEqual(expect.arrayContaining(["Gastos"]));
  });

  it("las acciones rápidas siguen al permiso (también con excepciones)", () => {
    const actions = (role: RoleKey, ov?: PermissionOverrides) => search(role, "", ov).filter((e) => e.group === "Acciones").map((e) => e.label);
    expect(actions("read_only")).not.toEqual(expect.arrayContaining(["Nueva venta", "Nueva factura", "Nuevo cliente", "Registrar gasto", "Importar datos (Excel / CSV)"]));
    expect(actions("employee")).toEqual(expect.arrayContaining(["Nueva venta", "Nuevo cliente"]));
    expect(actions("employee")).not.toEqual(expect.arrayContaining(["Nueva factura", "Registrar gasto"]));
    expect(actions("manager")).not.toContain("Nueva factura");
    expect(actions("manager", { grant: ["invoices.manage"], revoke: [] })).toContain("Nueva factura");
    expect(actions("owner", { grant: [], revoke: ["pos.sell"] })).not.toContain("Nueva venta");
  });

  it("un usuario de un solo centro no encuentra ventas de otro centro", () => {
    const num = String(owner.store.requireWorkspace().sales[0]!.number);
    expect(search("owner", `#${num}`).filter((e) => e.group === "Ventas")).toHaveLength(1);
    expect(search("manager", `#${num}`, undefined, [locA]).filter((e) => e.group === "Ventas")).toHaveLength(0);
    expect(search("manager", `#${num}`, undefined, [locB]).filter((e) => e.group === "Ventas")).toHaveLength(1);
  });
});
