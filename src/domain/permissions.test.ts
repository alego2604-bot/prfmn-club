import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS, AREA_PERMISSIONS, areaCan, buildOverrides, can, effectivePermissions, hasOverrides, normalizeOverrides, overrideState,
  PERMISSION_INFO, ROLE_PERMISSIONS, roleCan, type AreaAction, type Permission, type PermissionArea, type PermissionOverrides,
} from "./permissions";
import type { RoleKey } from "./types";

const ROLES: RoleKey[] = ["owner", "admin", "manager", "employee", "accountant", "read_only"];
const ALL: RoleKey[] = ROLES;

/**
 * MATRIZ DE PERMISOS (docs/PERMISSIONS.md). Es literal a propósito: cambiar un permiso de un rol obliga a cambiar esta tabla
 * (y la documentación) de forma consciente. Roles: OWNER, ADMIN, MANAGER (encargado), STAFF (employee), FINANCE (accountant), VIEWER (read_only).
 */
const MATRIX: Record<PermissionArea, Partial<Record<AreaAction, RoleKey[]>>> = {
  dashboard: { view: ALL },
  customers: { view: ALL, create: ["owner", "admin", "manager", "employee"], update: ["owner", "admin", "manager", "employee"], manage: ["owner", "admin", "manager", "employee"] },
  customers_sensitive: { view: ["owner", "admin", "accountant"], create: ["owner", "admin", "accountant"], update: ["owner", "admin", "accountant"], manage: ["owner", "admin", "accountant"] },
  sales: { view: ALL, create: ["owner", "admin", "manager", "employee"], void: ["owner", "admin", "manager"], manage: ["owner", "admin", "manager"] },
  cash: { view: ALL, create: ["owner", "admin", "manager", "employee"], update: ["owner", "admin", "manager", "employee"], void: ["owner", "admin", "manager"], manage: ["owner", "admin", "manager"] },
  payments: { view: ["owner", "admin", "manager", "accountant", "read_only"], create: ["owner", "admin", "manager", "accountant"], update: ["owner", "admin", "manager", "accountant"], void: ["owner", "admin", "manager", "accountant"], manage: ["owner", "admin", "manager", "accountant"] },
  invoices: { view: ["owner", "admin", "manager", "accountant", "read_only"], create: ["owner", "admin", "accountant"], update: ["owner", "admin", "accountant"], void: ["owner", "admin", "accountant"], manage: ["owner", "admin", "accountant"] },
  expenses: { view: ["owner", "admin", "manager", "accountant", "read_only"], create: ["owner", "admin", "accountant"], update: ["owner", "admin", "accountant"], void: ["owner", "admin", "accountant"], manage: ["owner", "admin", "accountant"] },
  memberships: { view: ALL, create: ["owner", "admin", "manager"], update: ["owner", "admin", "manager"], void: ["owner", "admin", "manager"], manage: ["owner", "admin", "manager"] },
  tasks: { view: ALL, create: ["owner", "admin", "manager", "employee"], update: ["owner", "admin", "manager", "employee"], manage: ["owner", "admin", "manager", "employee"] },
  imports: { view: ["owner", "admin", "manager"], create: ["owner", "admin", "manager"], void: ["owner", "admin"], manage: ["owner", "admin"] },
  reports: { view: ["owner", "admin", "manager", "accountant", "read_only"], create: ["owner", "admin", "accountant"], manage: ["owner", "admin", "accountant"] },
  team: { view: ["owner", "admin"], create: ["owner", "admin"], update: ["owner", "admin"], void: ["owner", "admin"], manage: ["owner", "admin"] },
  locations: { view: ALL, create: ["owner", "admin"], update: ["owner", "admin"], void: ["owner", "admin"], manage: ["owner", "admin"] },
  settings: { view: ALL, create: ["owner", "admin"], update: ["owner", "admin"], manage: ["owner", "admin"] },
  audit: { view: ["owner", "admin", "accountant"] },
};
const ACTIONS: AreaAction[] = ["view", "create", "update", "void", "manage"];

describe("matriz de permisos por área, acción y rol", () => {
  for (const [area, actions] of Object.entries(MATRIX) as [PermissionArea, Partial<Record<AreaAction, RoleKey[]>>][]) {
    for (const action of ACTIONS) {
      const allowed = actions[action];
      it(`${area}.${action}: ${allowed ? allowed.join(", ") : "no existe"}`, () => {
        if (!allowed) return expect(AREA_PERMISSIONS[area][action]).toBeNull();
        expect(AREA_PERMISSIONS[area][action]).not.toBeNull();
        for (const role of ROLES) expect(areaCan(role, undefined, area, action), `${role} → ${area}.${action}`).toBe(allowed.includes(role));
      });
    }
  }

  it("toda área de la matriz usa permisos del catálogo y toda área está en la matriz", () => {
    expect(Object.keys(AREA_PERMISSIONS).sort()).toEqual(Object.keys(MATRIX).sort());
    for (const area of Object.values(AREA_PERMISSIONS)) for (const p of Object.values(area)) if (p) expect(ALL_PERMISSIONS).toContain(p);
  });

  it("cobro de cuotas y facturas: OWNER, ADMIN, MANAGER y FINANCE sí; STAFF y VIEWER no (por permiso, no por nombre de rol)", () => {
    for (const role of ROLES) expect(roleCan(role, "payments.manage")).toBe(["owner", "admin", "manager", "accountant"].includes(role));
    expect(roleCan("employee", "payments.manage")).toBe(false);
    expect(roleCan("read_only", "payments.manage")).toBe(false);
  });

  it("el encargado cobra pero no emite ni anula facturas libres, no gestiona gastos ni equipo", () => {
    expect(roleCan("manager", "memberships.manage")).toBe(true);
    expect(roleCan("manager", "invoices.manage")).toBe(false);
    expect(roleCan("manager", "expenses.manage")).toBe(false);
    expect(roleCan("manager", "team.manage")).toBe(false);
    expect(roleCan("manager", "customers.sensitive")).toBe(false);
  });

  it("todos los permisos tienen etiqueta para la pantalla de equipo", () => {
    expect(Object.keys(PERMISSION_INFO).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe("excepciones individuales (rol base + grant/revoke), como app.has_permission", () => {
  const ov = (grant: Permission[] = [], revoke: Permission[] = []): PermissionOverrides => ({ grant, revoke });

  it("sin excepciones, el permiso efectivo es el del rol", () => {
    for (const role of ROLES) expect(effectivePermissions(role)).toEqual(effectivePermissions(role, ov()));
    expect(effectivePermissions("owner")).toEqual([...ALL_PERMISSIONS]);
  });

  it("grant añade permisos que el rol no tiene; revoke quita los que tiene", () => {
    const o = ov(["expenses.manage", "invoices.manage"], ["sales.void"]);
    expect(can("manager", o, "expenses.manage")).toBe(true);     // el encargado ve y gestiona gastos
    expect(can("manager", o, "invoices.manage")).toBe(true);     // …y puede emitir facturas
    expect(can("manager", o, "sales.void")).toBe(false);         // pero no anular ventas
    expect(can("manager", o, "customers.manage")).toBe(true);    // lo no tocado sigue según el rol
    expect(can("manager", o, "team.manage")).toBe(false);        // y lo que ni el rol ni el grant dan, no
  });

  it("denegar gana siempre: sobre el rol, sobre un grant y sobre el comodín del propietario", () => {
    expect(can("accountant", ov([], ["payments.manage"]), "payments.manage")).toBe(false);
    expect(can("employee", ov(["payments.manage"], ["payments.manage"]), "payments.manage")).toBe(false);
    expect(can("admin", ov([], ["team.manage"]), "team.manage")).toBe(false);
    expect(can("admin", ov([], ["team.manage"]), "settings.manage")).toBe(true);
  });

  it("ejemplo del producto: MANAGER que ve gastos, no modifica equipo, emite facturas y no cambia configuración fiscal", () => {
    const o = ov(["expenses.manage", "invoices.manage"], ["team.manage", "settings.manage"]);
    expect(can("manager", o, "finance.view")).toBe(true);
    expect(can("manager", o, "expenses.manage")).toBe(true);
    expect(can("manager", o, "invoices.manage")).toBe(true);
    expect(can("manager", o, "team.manage")).toBe(false);
    expect(can("manager", o, "settings.manage")).toBe(false);
  });

  it("normalizeOverrides ignora basura (claves desconocidas, tipos raros) y no falla nunca", () => {
    expect(normalizeOverrides(null)).toEqual({ grant: [], revoke: [] });
    expect(normalizeOverrides("x")).toEqual({ grant: [], revoke: [] });
    expect(normalizeOverrides({ grant: ["audit.view", "audit.view", "no.existe", 3], revoke: "x" })).toEqual({ grant: ["audit.view"], revoke: [] });
    expect(normalizeOverrides({ grant: ["tasks.manage"] })).toEqual({ grant: [], revoke: [] });
  });

  it("buildOverrides solo guarda diferencias reales respecto al rol", () => {
    expect(buildOverrides("manager", { "sales.void": "deny", "customers.manage": "allow", "expenses.manage": "allow", "team.manage": "deny" }))
      .toEqual({ grant: ["expenses.manage"], revoke: ["sales.void"] });
    expect(hasOverrides(buildOverrides("manager", {}))).toBe(false);
  });

  it("overrideState refleja el estado para la pantalla de equipo", () => {
    const o = ov(["audit.view"], ["sales.void"]);
    expect(overrideState(o, "audit.view")).toBe("allow");
    expect(overrideState(o, "sales.void")).toBe("deny");
    expect(overrideState(o, "pos.sell")).toBe("inherit");
    expect(overrideState(undefined, "pos.sell")).toBe("inherit");
  });

  it("el cálculo del cliente coincide con el del servidor para cualquier combinación (misma regla de has_permission)", () => {
    // Regla del servidor: not (revoke ? perm) and (role_has(perm | '*') or grant ? perm)
    const server = (role: RoleKey, o: PermissionOverrides, p: Permission) => {
      const rp = ROLE_PERMISSIONS[role];
      return !o.revoke.includes(p) && (rp === "*" || rp.includes(p) || o.grant.includes(p));
    };
    const samples: PermissionOverrides[] = [ov(), ov(["audit.view"]), ov([], ["dashboard.view"]), ov(["finance.view", "payments.manage"], ["customers.view"]), ov(["team.manage"], ["team.manage"])];
    for (const role of ROLES) for (const o of samples) for (const p of ALL_PERMISSIONS) expect(can(role, o, p)).toBe(server(role, o, p));
  });
});
