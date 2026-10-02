/**
 * Facturación: estados visibles, líneas y series. Sin lógica fiscal irreversible: el número lo asigna el servidor
 * (trigger con bloqueo de fila, sin huecos) y la serie es un dato de la empresa (prefijo, año, relleno).
 * Retenciones y rectificativas: el modelo lo admite (rectifies_invoice_id, tipos de serie) y se activarán tras validarlo
 * con la gestoría.
 */
import type { Cents } from "@/lib/money";
import { toISODate } from "@/lib/dates";
import { computeLine, computeTotals, type LineInput } from "./pricing";
import type { DocumentSeries, Invoice, InvoiceItem } from "./types";

export type InvoiceView = "draft" | "pending" | "partial" | "overdue" | "paid" | "void";

/** Estado visible: vencida = emitida con vencimiento pasado y algo sin cobrar. */
export function invoiceView(inv: Pick<Invoice, "status" | "dueDate" | "total" | "amountPaid">, today = toISODate(new Date())): InvoiceView {
  if (inv.status === "draft") return "draft";
  if (inv.status === "void") return "void";
  if (inv.status === "paid") return "paid";
  if (inv.dueDate && inv.dueDate < today) return "overdue";
  return inv.status === "partially_paid" ? "partial" : "pending";
}

export const INVOICE_VIEW: Record<InvoiceView, { label: string; tone: "neutral" | "warning" | "danger" | "success" | "info" }> = {
  draft: { label: "Borrador", tone: "neutral" },
  pending: { label: "Pendiente", tone: "warning" },
  partial: { label: "Cobro parcial", tone: "info" },
  overdue: { label: "Vencida", tone: "danger" },
  paid: { label: "Cobrada", tone: "success" },
  void: { label: "Anulada", tone: "neutral" },
};

export interface DraftLine {
  id?: string;
  description: string;
  quantity: number;
  /** Precio unitario IVA incluido */
  unitPrice: Cents;
  /** Descuento de la línea en % (0–100), opcional */
  discountPct?: number;
  taxRateBp: number;
  productId?: string;
  planVersionId?: string;
}

export function lineDiscount(l: Pick<DraftLine, "unitPrice" | "quantity" | "discountPct">): Cents {
  const pct = Math.min(Math.max(l.discountPct ?? 0, 0), 100);
  return Math.round((l.unitPrice * l.quantity * pct) / 100);
}

const toInput = (l: DraftLine): LineInput => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: lineDiscount(l), taxRateBp: l.taxRateBp });

/** Totales de un borrador (las líneas vacías o con cantidad 0 se ignoran). */
export function draftTotals(lines: DraftLine[]) {
  return computeTotals(lines.filter(isCompleteLine).map(toInput));
}

export function isCompleteLine(l: DraftLine): boolean {
  return !!l.description.trim() && Number.isFinite(l.quantity) && l.quantity > 0 && l.unitPrice >= 0;
}

/** Líneas de factura listas para guardar. */
export function toInvoiceItems(lines: DraftLine[], base: { organizationId: string; invoiceId: string }, newId: () => string): InvoiceItem[] {
  return lines.filter(isCompleteLine).map((l, i) => {
    const a = computeLine(toInput(l));
    return {
      id: l.id ?? newId(), organizationId: base.organizationId, invoiceId: base.invoiceId, description: l.description.trim(),
      quantity: l.quantity, unitPrice: l.unitPrice, discount: a.gross - a.total, taxRateBp: l.taxRateBp,
      baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total, productId: l.productId, planVersionId: l.planVersionId, sortOrder: i,
    };
  });
}

export function itemsToDraft(items: InvoiceItem[]): DraftLine[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((it) => {
    const gross = Math.round(it.unitPrice * it.quantity);
    return {
      id: it.id, description: it.description, quantity: Number(it.quantity), unitPrice: it.unitPrice, taxRateBp: it.taxRateBp,
      discountPct: gross > 0 && it.discount ? Math.round(((it.discount ?? 0) / gross) * 10000) / 100 : 0, productId: it.productId, planVersionId: it.planVersionId,
    };
  });
}

/** Serie de facturas para una fecha: la del año de emisión; si no existe, la que no reinicia por año. */
export function invoiceSeriesFor(series: DocumentSeries[], issueDate: string, type: DocumentSeries["documentType"] = "invoice"): DocumentSeries | undefined {
  const year = Number(issueDate.slice(0, 4));
  const active = series.filter((s) => s.status === "active" && s.documentType === type);
  return active.find((s) => s.year === year) ?? active.find((s) => s.year === null || s.year === undefined);
}

/** Número con el formato de la serie (vista previa en local; en el servidor lo asigna el trigger al emitir). */
export function formatSeriesNumber(s: Pick<DocumentSeries, "prefix" | "padding">, n: number): string {
  return `${s.prefix}${String(n).padStart(s.padding, "0")}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
