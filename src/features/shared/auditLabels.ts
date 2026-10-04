/** Textos de la auditoría: una sola fuente para el historial de cada registro y para Ajustes → Auditoría. */
import { formatRate } from "@/lib/money";

/** Acción en pasado («Creó», «Anuló»…). Incluye las del servidor (insert/update/delete) y las de cada flujo. */
export const AUDIT_ACTION: Record<string, string> = {
  insert: "Creó", update: "Editó", delete: "Eliminó", void: "Anuló", archive: "Archivó", activate: "Activó", deactivate: "Desactivó",
  price_change: "Cambió precio", payment: "Registró cobro o pago", refund: "Devolvió", issue: "Emitió", duplicate: "Duplicó",
  pause: "Pausó", resume: "Reanudó", cancel: "Dio de baja", reactivate: "Reactivó", plan_change: "Cambió tarifa", charge: "Generó cuota",
  complete: "Completó", note: "Añadió nota", open: "Abrió caja", close: "Cerró caja", reopen: "Reabrió caja", cash_in: "Entrada de caja", cash_out: "Salida de caja",
  import: "Importó", revert: "Revirtió", importing: "Inició importación", completed: "Completó importación", partial: "Importación parcial",
  failed: "Importación fallida", cancelled: "Canceló importación", reverted: "Revirtió importación", analyzing: "Analizó archivo",
  invite: "Invitó al equipo", role_change: "Cambió rol", permission_change: "Cambió permisos",
};

export const AUDIT_ENTITY: Record<string, string> = {
  products: "Producto", product_categories: "Categoría", sales: "Venta", cash_sessions: "Caja", cash_closings: "Cierre", cash_movements: "Movimiento de caja",
  customers: "Cliente", customer_notes: "Nota de cliente", invoices: "Factura", payments: "Cobro", imports: "Importación", organizations: "Empresa",
  locations: "Centro", payment_methods: "Método de pago", tax_rates: "IVA", organization_settings: "Configuración", document_series: "Serie de facturación",
  expenses: "Gasto", suppliers: "Proveedor", expense_categories: "Categoría de gasto", membership_plans: "Tarifa", membership_plan_versions: "Precio de tarifa",
  customer_memberships: "Membresía", membership_charges: "Cuota", tasks: "Tarea", organization_members: "Equipo", documents: "Documento",
  message_templates: "Plantilla", communications: "Comunicación", integration_connections: "Integración",
};

/** Tono de la acción en la tabla de auditoría. */
export const auditTone = (action: string): "danger" | "warning" | "neutral" =>
  ["void", "revert", "reverted", "delete", "cancel", "failed"].includes(action) ? "danger" : ["price_change", "role_change", "permission_change", "reopen", "plan_change"].includes(action) ? "warning" : "neutral";

const MONEY_KEYS = new Set(["price", "cost", "total", "subtotal", "amount", "unit_price", "unitPrice", "opening_float", "openingFloat", "counted_cash", "countedCash", "expected_cash", "expectedCash", "tax_total", "taxTotal"]);
const RATE_KEYS = new Set(["taxRateBp", "tax_rate_bp", "defaultTaxRateBp", "default_tax_rate_bp", "rate_bp", "rateBp"]);

/** Valor de un cambio legible (importes en euros, IVA en %), sea la clave del cliente (camelCase) o del servidor (snake_case). */
export function formatAuditValue(v: unknown, key: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" && MONEY_KEYS.has(key)) return `${(v / 100).toFixed(2).replace(".", ",")} €`;
  if (typeof v === "number" && RATE_KEYS.has(key)) return formatRate(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v).slice(0, 60);
}
