import type { Organization, PaymentMethod, TaxRate, Vertical } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { SCHEMA_VERSION, type Workspace } from "./store";

/** Espejo local de public.create_organization() (supabase/migrations/…0400). */
export function buildWorkspace(input: {
  name: string;
  vertical: Vertical;
  locationName: string;
  legalName?: string;
  taxId?: string;
  city?: string;
  isDemo?: boolean;
}): Workspace {
  const orgId = uid();
  const now = nowISO();
  const year = new Date().getFullYear();
  const organization: Organization = {
    id: orgId,
    name: input.name.trim(),
    legalName: input.legalName?.trim() || undefined,
    taxId: input.taxId?.trim() || undefined,
    city: input.city?.trim() || undefined,
    country: "ES",
    currency: "EUR",
    timezone: "Europe/Madrid",
    locale: "es-ES",
    vertical: input.vertical,
    fiscalYearStartMonth: 1,
    isDemo: !!input.isDemo,
    status: "active",
    createdAt: now,
  };
  const tax = (name: string, rateBp: number, isDefault = false): TaxRate => ({
    id: uid(), organizationId: orgId, name, rateBp, isDefault, status: "active",
  });
  const pm = (key: string, name: string, kind: PaymentMethod["kind"], sortOrder: number, affectsCashDrawer = false): PaymentMethod => ({
    id: uid(), organizationId: orgId, key, name, kind, affectsCashDrawer, status: "active", sortOrder,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    organization,
    settings: {
      organizationId: orgId,
      activityRules: [
        { key: "active", label: "Activo", maxDays: 7, severity: "ok" },
        { key: "low_activity", label: "Baja actividad", minDays: 7, maxDays: 14, severity: "info" },
        { key: "at_risk", label: "En riesgo", minDays: 14, maxDays: 21, severity: "warning" },
        { key: "inactive", label: "Inactivo", minDays: 30, severity: "danger" },
      ],
      renewalNoticeDays: 7,
      requireCashSession: true,
    },
    locations: [{ id: uid(), organizationId: orgId, name: input.locationName.trim() || "Principal", status: "active", createdAt: now }],
    taxRates: [tax("IVA general 21 %", 2100, true), tax("IVA reducido 10 %", 1000), tax("IVA superreducido 4 %", 400), tax("Exento 0 %", 0)],
    paymentMethods: [
      pm("cash", "Efectivo", "cash", 1, true),
      pm("card", "Tarjeta", "card", 2),
      pm("bizum", "Bizum", "bizum", 3),
      pm("online", "TPV online", "online", 4),
      pm("transfer", "Transferencia", "transfer", 5),
      pm("direct_debit", "Domiciliación", "direct_debit", 6),
      pm("other", "Otro", "other", 7),
      { ...pm("unknown", "Desconocido (importado)", "unknown", 99), status: "inactive" },
    ],
    documentSeries: [
      { id: uid(), organizationId: orgId, code: "F", documentType: "invoice", prefix: `F${year}-`, nextNumber: 1, padding: 5, year, status: "active" },
      { id: uid(), organizationId: orgId, code: "R", documentType: "credit_note", prefix: `R${year}-`, nextNumber: 1, padding: 5, year, status: "active" },
    ],
    categories: [],
    products: [],
    productPrices: [],
    membershipPlans: [],
    planVersions: [],
    customers: [],
    customerNotes: [],
    customerMemberships: [],
    membershipCharges: [],
    tasks: [],
    suppliers: [],
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ id: uid(), organizationId: orgId, name: c.name, defaultTaxRateBp: c.taxBp, status: "active" as const })),
    expenses: [],
    cashSessions: [],
    cashMovements: [],
    cashClosings: [],
    sales: [],
    saleItems: [],
    payments: [],
    invoices: [],
    invoiceItems: [],
    imports: [],
    importRecords: [],
    auditLogs: [],
    counters: {},
  };
}

export const CATEGORY_COLORS = ["#3b5bfd", "#12a150", "#f5a524", "#e5484d", "#8e4ec6", "#0ea5b7", "#d6409f", "#64748b"];

/**
 * Categorías de gasto iniciales (sector-neutrales). Son datos de la empresa: se pueden renombrar o archivar.
 * El IVA sugerido es solo un valor por defecto del formulario, siempre editable.
 */
export const DEFAULT_EXPENSE_CATEGORIES: { name: string; taxBp?: number }[] = [
  { name: "Alquiler", taxBp: 2100 },
  { name: "Suministros", taxBp: 2100 },
  { name: "Personal" },
  { name: "Material y equipamiento", taxBp: 2100 },
  { name: "Compras para venta", taxBp: 2100 },
  { name: "Marketing", taxBp: 2100 },
  { name: "Software y servicios", taxBp: 2100 },
  { name: "Asesoría y gestoría", taxBp: 2100 },
  { name: "Mantenimiento y limpieza", taxBp: 2100 },
  { name: "Seguros", taxBp: 0 },
  { name: "Impuestos y tasas", taxBp: 0 },
  { name: "Comisiones bancarias", taxBp: 0 },
  { name: "Otros", taxBp: 2100 },
];
