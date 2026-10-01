import type { RoleKey } from "./types";

/** Debe mantenerse alineado con public.permissions y los roles de sistema en 20261001000100_foundation.sql */
export type Permission =
  | "dashboard.view" | "analytics.view" | "reports.export"
  | "pos.sell" | "sales.view" | "sales.void" | "cash.operate" | "cash.reopen"
  | "catalog.view" | "catalog.manage" | "catalog.prices"
  | "customers.view" | "customers.manage" | "customers.sensitive" | "memberships.manage" | "attendance.manage"
  | "communications.send" | "templates.manage"
  | "finance.view" | "invoices.manage" | "expenses.manage" | "payments.manage"
  | "imports.run" | "imports.revert" | "documents.manage"
  | "settings.manage" | "team.manage" | "audit.view";

const ROLE_PERMISSIONS: Record<RoleKey, Permission[] | "*"> = {
  owner: "*",
  admin: "*",
  manager: [
    "dashboard.view", "analytics.view", "pos.sell", "sales.view", "sales.void", "cash.operate", "cash.reopen",
    "catalog.view", "catalog.manage", "customers.view", "customers.manage", "memberships.manage",
    "attendance.manage", "communications.send", "templates.manage", "finance.view", "imports.run", "documents.manage",
  ],
  employee: [
    "dashboard.view", "pos.sell", "sales.view", "cash.operate", "catalog.view", "customers.view",
    "customers.manage", "attendance.manage", "communications.send",
  ],
  accountant: [
    "dashboard.view", "analytics.view", "reports.export", "sales.view", "catalog.view", "customers.view",
    "customers.sensitive", "finance.view", "invoices.manage", "expenses.manage", "payments.manage",
    "documents.manage", "audit.view",
  ],
  read_only: ["dashboard.view", "analytics.view", "sales.view", "catalog.view", "customers.view", "finance.view"],
};

export const ROLE_LABELS: Record<RoleKey, { name: string; description: string }> = {
  owner: { name: "Owner", description: "Control total" },
  admin: { name: "Admin", description: "Gestión completa del negocio" },
  manager: { name: "Manager", description: "Operativa diaria, clientes y caja" },
  employee: { name: "Employee", description: "Caja, ventas y clientes básicos" },
  accountant: { name: "Accountant", description: "Finanzas y exportaciones" },
  read_only: { name: "Read only", description: "Solo consulta" },
};

export function roleCan(role: RoleKey, perm: Permission): boolean {
  const p = ROLE_PERMISSIONS[role];
  return p === "*" || p.includes(perm);
}
