import type { RoleKey } from "./types";

/** Debe mantenerse alineado con public.permissions y los roles de sistema en 20261001000100_foundation.sql (+ 0920). */
export type Permission =
  | "dashboard.view" | "analytics.view" | "reports.export"
  | "pos.sell" | "sales.view" | "sales.void" | "cash.operate" | "cash.reopen"
  | "catalog.view" | "catalog.manage" | "catalog.prices"
  | "customers.view" | "customers.manage" | "customers.sensitive" | "memberships.manage" | "attendance.manage"
  | "communications.send" | "templates.manage"
  | "finance.view" | "invoices.manage" | "expenses.manage" | "payments.manage"
  | "imports.run" | "imports.revert" | "documents.manage"
  | "settings.manage" | "team.manage" | "audit.view";

/** Todos los permisos del catálogo (public.permissions). Un test comprueba que coincide con el servidor. */
export const ALL_PERMISSIONS: readonly Permission[] = [
  "dashboard.view", "analytics.view", "reports.export",
  "pos.sell", "sales.view", "sales.void", "cash.operate", "cash.reopen",
  "catalog.view", "catalog.manage", "catalog.prices",
  "customers.view", "customers.manage", "customers.sensitive", "memberships.manage", "attendance.manage",
  "communications.send", "templates.manage",
  "finance.view", "invoices.manage", "expenses.manage", "payments.manage",
  "imports.run", "imports.revert", "documents.manage",
  "settings.manage", "team.manage", "audit.view",
];

/** Exportado para comprobar en tests que coincide con lo sembrado en el servidor (role_permissions). */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[] | "*"> = {
  owner: "*",
  admin: "*",
  // Encargado: registra y cobra cuotas y ventas (payments.manage). Emitir/anular facturas libres, gastos y equipo siguen fuera.
  manager: [
    "dashboard.view", "analytics.view", "pos.sell", "sales.view", "sales.void", "cash.operate", "cash.reopen",
    "catalog.view", "catalog.manage", "customers.view", "customers.manage", "memberships.manage",
    "attendance.manage", "communications.send", "templates.manage", "finance.view", "payments.manage", "imports.run", "documents.manage",
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
  owner: { name: "Propietario", description: "Control total" },
  admin: { name: "Administrador", description: "Gestión completa del negocio" },
  manager: { name: "Encargado", description: "Operativa diaria, clientes, caja y cobro de cuotas" },
  employee: { name: "Empleado", description: "Caja, ventas y clientes básicos" },
  accountant: { name: "Contable", description: "Finanzas y exportaciones" },
  read_only: { name: "Solo lectura", description: "Solo consulta" },
};

export function roleCan(role: RoleKey, perm: Permission): boolean {
  const p = ROLE_PERMISSIONS[role];
  return p === "*" || p.includes(perm);
}

// ---------------------------------------------------------------------------------------------------------------------
// Excepciones individuales sobre el rol (organization_members.permission_overrides)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Modelo del servidor (app.has_permission): permiso efectivo = (permisos del rol ∪ grant) \ revoke.
 * Denegar siempre gana, incluso sobre el comodín «*» del propietario/administrador. Un permiso en ambas listas queda denegado.
 */
export interface PermissionOverrides {
  grant: Permission[];
  revoke: Permission[];
}

export const NO_OVERRIDES: PermissionOverrides = { grant: [], revoke: [] };

const KNOWN = new Set<string>(ALL_PERMISSIONS);

/** Normaliza lo que llega del servidor o del almacén local: solo claves conocidas, sin duplicados, nunca falla. */
export function normalizeOverrides(raw: unknown): PermissionOverrides {
  const list = (v: unknown): Permission[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is Permission => typeof x === "string" && KNOWN.has(x)))].sort() : []);
  const o = (raw && typeof raw === "object" ? raw : {}) as { grant?: unknown; revoke?: unknown };
  return { grant: list(o.grant), revoke: list(o.revoke) };
}

export const hasOverrides = (o?: PermissionOverrides | null): boolean => !!o && (o.grant.length > 0 || o.revoke.length > 0);

/** ¿Puede este rol, con estas excepciones, ejercer el permiso? (misma regla que el servidor) */
export function can(role: RoleKey, overrides: PermissionOverrides | null | undefined, perm: Permission): boolean {
  if (overrides?.revoke.includes(perm)) return false;
  return roleCan(role, perm) || !!overrides?.grant.includes(perm);
}

export function effectivePermissions(role: RoleKey, overrides?: PermissionOverrides | null): Permission[] {
  return ALL_PERMISSIONS.filter((p) => can(role, overrides, p));
}

/** Estado de un permiso respecto al rol, para la pantalla de equipo. */
export type OverrideState = "inherit" | "allow" | "deny";
export function overrideState(o: PermissionOverrides | null | undefined, perm: Permission): OverrideState {
  if (o?.revoke.includes(perm)) return "deny";
  if (o?.grant.includes(perm)) return "allow";
  return "inherit";
}

/**
 * Construye las excepciones a partir de lo elegido por permiso. «allow» sobre algo que el rol ya da, o «deny» sobre algo que
 * el rol no da, no aportan nada: se descartan para guardar solo diferencias reales.
 */
export function buildOverrides(role: RoleKey, choice: Partial<Record<Permission, OverrideState>>): PermissionOverrides {
  const grant: Permission[] = [];
  const revoke: Permission[] = [];
  for (const p of ALL_PERMISSIONS) {
    const c = choice[p] ?? "inherit";
    if (c === "allow" && !roleCan(role, p)) grant.push(p);
    if (c === "deny" && roleCan(role, p)) revoke.push(p);
  }
  return { grant, revoke };
}

// ---------------------------------------------------------------------------------------------------------------------
// Etiquetas para la pantalla de permisos individuales (mismo texto que public.permissions.description)
// ---------------------------------------------------------------------------------------------------------------------
export const PERMISSION_INFO: Record<Permission, { group: string; label: string }> = {
  "dashboard.view": { group: "Resumen e informes", label: "Ver el resumen" },
  "analytics.view": { group: "Resumen e informes", label: "Ver analytics e informes" },
  "reports.export": { group: "Resumen e informes", label: "Exportar tablas e informes (CSV, Excel, PDF)" },
  "pos.sell": { group: "Caja y ventas", label: "Registrar ventas en caja" },
  "sales.view": { group: "Caja y ventas", label: "Ver ventas y cierres" },
  "sales.void": { group: "Caja y ventas", label: "Anular ventas" },
  "cash.operate": { group: "Caja y ventas", label: "Abrir y cerrar caja" },
  "cash.reopen": { group: "Caja y ventas", label: "Reabrir cierres de caja" },
  "catalog.view": { group: "Catálogo", label: "Ver catálogo" },
  "catalog.manage": { group: "Catálogo", label: "Crear y editar productos y tarifas" },
  "catalog.prices": { group: "Catálogo", label: "Cambiar precios" },
  "customers.view": { group: "Clientes", label: "Ver clientes" },
  "customers.manage": { group: "Clientes", label: "Crear y editar clientes, notas y tareas" },
  "customers.sensitive": { group: "Clientes", label: "Ver y editar datos fiscales y personales (NIF, dirección, nacimiento)" },
  "memberships.manage": { group: "Clientes", label: "Gestionar membresías y cobrar cuotas" },
  "attendance.manage": { group: "Clientes", label: "Registrar asistencia" },
  "communications.send": { group: "Comunicación", label: "Enviar comunicaciones" },
  "templates.manage": { group: "Comunicación", label: "Gestionar plantillas" },
  "finance.view": { group: "Finanzas", label: "Ver finanzas, facturas y gastos" },
  "invoices.manage": { group: "Finanzas", label: "Emitir y anular facturas" },
  "expenses.manage": { group: "Finanzas", label: "Gestionar gastos y proveedores" },
  "payments.manage": { group: "Finanzas", label: "Registrar cobros y devoluciones" },
  "imports.run": { group: "Datos", label: "Importar datos" },
  "imports.revert": { group: "Datos", label: "Revertir importaciones" },
  "documents.manage": { group: "Datos", label: "Gestionar documentos" },
  "settings.manage": { group: "Empresa", label: "Configuración de la empresa" },
  "team.manage": { group: "Empresa", label: "Gestionar equipo y roles" },
  "audit.view": { group: "Empresa", label: "Ver el registro de auditoría" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Datos sensibles de clientes (permiso customers.sensitive: «datos fiscales y de pago de clientes»)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Campos de la ficha de cliente que requieren customers.sensitive. Criterio: identificación fiscal y datos personales que
 * no hacen falta para operar en caja o atender al cliente (NIF/DNI, dirección postal, razón social, fecha de nacimiento).
 * Nombre, email y teléfono son datos de contacto operativos (avisos, cobros, seguimiento): no se ocultan.
 * No se añaden categorías nuevas: son columnas que ya existen en `customers`.
 */
export const CUSTOMER_SENSITIVE_FIELDS = ["taxId", "taxIdNormalized", "taxIdValid", "address", "postalCode", "city", "companyName", "birthDate"] as const;
export type CustomerSensitiveField = (typeof CUSTOMER_SENSITIVE_FIELDS)[number];
/** Mismas columnas en el servidor (customers). */
export const CUSTOMER_SENSITIVE_COLUMNS = ["tax_id", "tax_id_normalized", "tax_id_valid", "address", "postal_code", "city", "company_name", "birth_date"] as const;
/** Copia fiscal del cliente en la factura (también se oculta al que no tiene customers.sensitive). */
export const INVOICE_SENSITIVE_FIELDS = ["customerTaxId", "customerAddress"] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Matriz de permisos por área y acción (documentada en docs/PERMISSIONS.md y bloqueada por tests)
// ---------------------------------------------------------------------------------------------------------------------
export type AreaAction = "view" | "create" | "update" | "void" | "manage";
export type PermissionArea =
  | "dashboard" | "customers" | "customers_sensitive" | "sales" | "cash" | "payments" | "invoices" | "expenses" | "memberships"
  | "tasks" | "imports" | "reports" | "team" | "locations" | "settings" | "audit";

/** Permiso que exige cada acción de cada área (null = la acción no existe en esa área). */
export const AREA_PERMISSIONS: Record<PermissionArea, Record<AreaAction, Permission | null>> = {
  dashboard: { view: "dashboard.view", create: null, update: null, void: null, manage: null },
  customers: { view: "customers.view", create: "customers.manage", update: "customers.manage", void: null, manage: "customers.manage" },
  customers_sensitive: { view: "customers.sensitive", create: "customers.sensitive", update: "customers.sensitive", void: null, manage: "customers.sensitive" },
  sales: { view: "sales.view", create: "pos.sell", update: null, void: "sales.void", manage: "sales.void" },
  cash: { view: "sales.view", create: "cash.operate", update: "cash.operate", void: "cash.reopen", manage: "cash.reopen" },
  payments: { view: "finance.view", create: "payments.manage", update: "payments.manage", void: "payments.manage", manage: "payments.manage" },
  invoices: { view: "finance.view", create: "invoices.manage", update: "invoices.manage", void: "invoices.manage", manage: "invoices.manage" },
  expenses: { view: "finance.view", create: "expenses.manage", update: "expenses.manage", void: "expenses.manage", manage: "expenses.manage" },
  memberships: { view: "customers.view", create: "memberships.manage", update: "memberships.manage", void: "memberships.manage", manage: "memberships.manage" },
  tasks: { view: "customers.view", create: "customers.manage", update: "customers.manage", void: null, manage: "customers.manage" },
  imports: { view: "imports.run", create: "imports.run", update: null, void: "imports.revert", manage: "imports.revert" },
  reports: { view: "analytics.view", create: "reports.export", update: null, void: null, manage: "reports.export" },
  team: { view: "team.manage", create: "team.manage", update: "team.manage", void: "team.manage", manage: "team.manage" },
  locations: { view: "dashboard.view", create: "settings.manage", update: "settings.manage", void: "settings.manage", manage: "settings.manage" },
  settings: { view: "dashboard.view", create: "settings.manage", update: "settings.manage", void: null, manage: "settings.manage" },
  audit: { view: "audit.view", create: null, update: null, void: null, manage: null },
};

export function areaCan(role: RoleKey, overrides: PermissionOverrides | null | undefined, area: PermissionArea, action: AreaAction): boolean {
  const p = AREA_PERMISSIONS[area][action];
  return p !== null && can(role, overrides, p);
}
