/**
 * Progreso legible de una operación larga de sincronización (la demo): fase comprensible y porcentaje que nunca
 * retrocede. El número de trozos es un detalle interno: al usuario se le cuenta en qué está y cuánto falta.
 */
import type { SyncProgress } from "@/data/cloud/sync";

export const SETUP_PHASES = ["Configurando centros y catálogo", "Añadiendo clientes", "Generando ventas y caja", "Preparando finanzas", "Terminando"] as const;

const PHASE_OF: Record<string, number> = {
  locations: 0, tax_rates: 0, payment_methods: 0, document_series: 0, product_categories: 0, imports: 0, products: 0,
  membership_plans: 0, membership_plan_versions: 0, expense_categories: 0, suppliers: 0,
  customers: 1, customer_notes: 1, customer_memberships: 1, tasks: 1,
  cash_sessions: 2, cash_movements: 2, sales: 2, sale_items: 2,
  invoices: 3, invoice_items: 3, payments: 3, membership_charges: 3, expenses: 3,
};

/**
 * Fase según la primera tabla del próximo trozo (lo que se está guardando ahora). Con la última, el primer trozo
 * —centros, catálogo y clientes, que termina en las cajas— se anunciaba ya como «Generando ventas y caja · 0 %».
 */
export function setupPhase(p: Pick<SyncProgress, "tables">): number {
  const t = p.tables[0];
  return t !== undefined && t in PHASE_OF ? PHASE_OF[t]! : 4;
}

/** Porcentaje de envío (0–95): el 5 % final es la comprobación con el servidor. Nunca baja respecto a `prev`. */
export function setupPercent(p: Pick<SyncProgress, "done" | "total">, prev = 0): number {
  const raw = p.total > 0 ? Math.floor((p.done / p.total) * 95) : 0;
  return Math.max(prev, Math.min(95, raw));
}
