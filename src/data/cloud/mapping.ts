/**
 * Mapeo entre el modelo de la app (camelCase, opcionales) y las tablas de Supabase (snake_case, null).
 * Las entidades ya reflejan las tablas 1:1 (domain/types.ts); aquí solo viven las excepciones.
 */
import type { AuditLog, Organization, OrganizationSettings, Payment, PaymentMethod } from "@/domain/types";
import type { Workspace } from "../store";

export type Row = Record<string, unknown>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function toRow(entity: object, overrides: Record<string, string> = {}): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(entity)) out[overrides[k] ?? snake(k)] = v === undefined ? null : v;
  return out;
}

export function fromRow<T>(row: Row, overrides: Record<string, string> = {}): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[overrides[k] ?? camel(k)] = v;
  return out as T;
}

/** Colecciones del workspace que son tablas con `id` + `organization_id`, en orden de dependencias (FK). */
export const COLLECTIONS = [
  ["locations", "locations"],
  ["taxRates", "tax_rates"],
  ["paymentMethods", "payment_methods"],
  ["categories", "product_categories"],
  ["imports", "imports"],
  ["products", "products"],
  ["membershipPlans", "membership_plans"],
  ["planVersions", "membership_plan_versions"],
  ["customers", "customers"],
  ["customerNotes", "customer_notes"],
  ["cashSessions", "cash_sessions"],
  ["cashMovements", "cash_movements"],
  ["sales", "sales"],
  ["saleItems", "sale_items"],
  ["invoices", "invoices"],
  ["invoiceItems", "invoice_items"],
  ["payments", "payments"],
  ["cashClosings", "cash_closings"],
  ["importRecords", "import_records"],
] as const satisfies readonly (readonly [keyof Workspace, string])[];

export type CollectionKey = (typeof COLLECTIONS)[number][0];

/** Campos que asigna el servidor y nunca se envían en una actualización. */
export const SERVER_OWNED: Partial<Record<CollectionKey, string[]>> = {
  sales: ["number"],
  invoices: ["number"],
};

const FIELD_OVERRIDES: Partial<Record<CollectionKey, Record<string, string>>> = {
  invoices: { series: "series_label" },
  // El estado del pipeline por lotes vive en la columna jsonb `options` (sin migración: compatible con staging)
  imports: { pipeline: "options" },
};
const COLUMN_OVERRIDES: Partial<Record<CollectionKey, Record<string, string>>> = {
  invoices: { series_label: "series" },
  imports: { options: "pipeline" },
};

export function entityToRow(key: CollectionKey, e: object): Row {
  const row = toRow(e, FIELD_OVERRIDES[key]);
  if (key === "sales") row.number = null; // nº de ticket: lo asigna la base de datos (correlativo sin colisiones entre dispositivos)
  if (key === "importRecords") row.raw = {};
  return row;
}

export function rowToEntity<T>(key: CollectionKey, row: Row): T {
  return fromRow<T>(row, COLUMN_OVERRIDES[key]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------------------------------------------------
export function organizationFromRow(row: Row, modules: { module_key: string; enabled: boolean }[]): Organization {
  const org = fromRow<Organization>(row);
  const fitness = modules.filter((m) => m.module_key.startsWith("fitness."));
  if (fitness.length) org.modules = fitness.some((m) => m.enabled) ? ["fitness"] : [];
  delete (org as Partial<Organization> & { createdBy?: string; updatedAt?: string; logoPath?: string }).createdBy;
  return org;
}

export function organizationPatch(before: Organization, after: Organization): { org: Row | null; modules: boolean | null } {
  const changed: Row = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof Organization>) {
    if (k === "modules" || k === "id" || k === "createdAt") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed[snake(k)] = after[k] ?? null;
  }
  const modulesChanged = JSON.stringify(before.modules) !== JSON.stringify(after.modules);
  return { org: Object.keys(changed).length ? changed : null, modules: modulesChanged ? (after.modules ?? []).includes("fitness") : null };
}

interface RuleRow { key: string; label: string; min_days?: number; max_days?: number; severity: string }

export function settingsFromRow(row: Row): OrganizationSettings {
  const rules = (row.activity_rules as RuleRow[] | null) ?? [];
  const pos = (row.pos_settings as { require_cash_session?: boolean } | null) ?? {};
  return {
    organizationId: String(row.organization_id),
    activityRules: rules.map((r) => ({
      key: r.key, label: r.label, minDays: r.min_days ?? undefined, maxDays: r.max_days ?? undefined, severity: r.severity as OrganizationSettings["activityRules"][number]["severity"],
    })),
    renewalNoticeDays: Number(row.renewal_notice_days ?? 7),
    requireCashSession: pos.require_cash_session ?? true,
  };
}

export function settingsToRow(s: OrganizationSettings): Row {
  return {
    activity_rules: s.activityRules.map((r) => ({ key: r.key, label: r.label, min_days: r.minDays, max_days: r.maxDays, severity: r.severity })),
    renewal_notice_days: s.renewalNoticeDays,
    pos_settings: { require_cash_session: s.requireCashSession, allow_negative_stock: true },
  };
}

/** Pagos: la clave del método no es columna (se deriva del método). */
export function paymentFromRow(row: Row, methods: PaymentMethod[]): Payment {
  const p = rowToEntity<Payment>("payments", row);
  const m = methods.find((x) => x.id === p.paymentMethodId);
  return { ...p, methodKey: m?.key ?? "unknown" };
}

export function auditFromRow(row: Row, names: Map<string, string>): AuditLog {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    actorId: (row.actor_id as string) ?? undefined,
    actorName: row.actor_id ? names.get(String(row.actor_id)) : "Sistema",
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: (row.entity_id as string) ?? undefined,
    entityLabel: (row.entity_label as string) ?? undefined,
    changes: (row.changes as AuditLog["changes"]) ?? undefined,
    context: (row.context as AuditLog["context"]) ?? undefined,
    createdAt: String(row.created_at),
  };
}
