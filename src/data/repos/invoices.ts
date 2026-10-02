import type { AuditLog, Invoice, Payment } from "@/domain/types";
import { addDaysISO, draftTotals, formatSeriesNumber, invoiceSeriesFor, isCompleteLine, toInvoiceItems, type DraftLine } from "@/domain/invoicing";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";
import { assertCan, assertLocation, auditEntry, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";
import { customerName } from "./customers";

export const invoiceLabel = (inv: Pick<Invoice, "number" | "externalNumber" | "status">) =>
  inv.number ?? inv.externalNumber ?? (inv.status === "draft" ? "Borrador" : "Asignando número…");

// ---------------------------------------------------------------------------------------------------------------------
// Borradores
// ---------------------------------------------------------------------------------------------------------------------
export interface InvoiceDraftInput {
  customerId?: string;
  /** Datos fiscales del destinatario si no es un cliente de la ficha (o para corregirlos en esta factura) */
  customerName?: string;
  customerTaxId?: string;
  customerAddress?: string;
  locationId?: string;
  issueDate: string;
  /** Días hasta el vencimiento (0 = al contado) */
  dueDays: number;
  concept?: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  notes?: string;
  lines: DraftLine[];
}

function snapshot(ws: Workspace, input: InvoiceDraftInput) {
  const c = input.customerId ? ws.customers.find((x) => x.id === input.customerId) : undefined;
  if (input.customerId && !c) throw new ValidationError("Cliente no encontrado");
  const address = c ? [c.address, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : undefined;
  return {
    customerId: c?.id,
    customerName: input.customerName?.trim() || (c ? c.companyName || customerName(c) : undefined),
    customerTaxId: input.customerTaxId?.trim() || c?.taxId || undefined,
    customerAddress: input.customerAddress?.trim() || address || undefined,
  };
}

function draftFields(ws: Workspace, ctx: Ctx, input: InvoiceDraftInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) throw new ValidationError("Fecha de emisión no válida");
  if (input.locationId && !ws.locations.some((l) => l.id === input.locationId)) throw new ValidationError("Centro no válido");
  assertLocation(ctx, input.locationId);
  if (input.servicePeriodStart && input.servicePeriodEnd && input.servicePeriodEnd < input.servicePeriodStart) throw new ValidationError("El periodo de servicio termina antes de empezar");
  const t = draftTotals(input.lines);
  return {
    ...snapshot(ws, input),
    locationId: input.locationId || undefined,
    issueDate: input.issueDate,
    dueDate: addDaysISO(input.issueDate, Math.max(0, Math.round(input.dueDays))),
    concept: input.concept?.trim() || input.lines.find(isCompleteLine)?.description.trim() || undefined,
    servicePeriodStart: input.servicePeriodStart || undefined,
    servicePeriodEnd: input.servicePeriodEnd || undefined,
    notes: input.notes?.trim() || undefined,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    discountTotal: t.discountTotal,
    total: t.total,
  };
}

/** Crea o actualiza un borrador (líneas incluidas). Un borrador no tiene número ni valor fiscal. */
export function saveInvoiceDraft(ctx: Ctx, input: InvoiceDraftInput, id?: string): Invoice {
  assertCan(ctx, "invoices.manage");
  let saved!: Invoice;
  ctx.store.update((ws) => {
    const fields = draftFields(ws, ctx, input);
    const now = nowISO();
    const before = id ? ws.invoices.find((i) => i.id === id) : undefined;
    if (id && !before) throw new ValidationError("Factura no encontrada");
    if (before && before.status !== "draft") throw new ValidationError("Una factura emitida no se edita; anúlala o duplícala");
    const series = invoiceSeriesFor(ws.documentSeries, input.issueDate);
    saved = before
      ? { ...before, ...fields, seriesId: series?.id ?? before.seriesId }
      : { id: uid(), organizationId: ws.organization.id, status: "draft", amountPaid: 0, source: "manual", seriesId: series?.id, createdAt: now, ...fields };
    const items = toInvoiceItems(input.lines, { organizationId: ws.organization.id, invoiceId: saved.id }, uid);
    // Líneas: se sustituyen las del borrador (las que siguen igual conservan su id)
    const others = ws.invoiceItems.filter((it) => it.invoiceId !== saved.id);
    return {
      ...ws,
      invoices: before ? ws.invoices.map((i) => (i.id === saved.id ? saved : i)) : [...ws.invoices, saved],
      invoiceItems: [...others, ...items],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: before ? "update" : "insert", entityType: "invoices", entityId: saved.id, entityLabel: `Borrador · ${saved.customerName ?? "sin cliente"} · ${formatMoney(saved.total)}` })],
    };
  });
  return saved;
}

/**
 * Emitir: asigna serie y número (en el servidor, sin huecos), congela importes, cliente y líneas.
 * En modo local el número se asigna aquí con la misma regla (prefijo + correlativo de la serie).
 */
export function issueInvoice(ctx: Ctx, id: string): Invoice {
  assertCan(ctx, "invoices.manage");
  let issued!: Invoice;
  ctx.store.update((ws) => {
    const inv = ws.invoices.find((i) => i.id === id);
    if (!inv) throw new ValidationError("Factura no encontrada");
    if (inv.status !== "draft") throw new ValidationError("La factura ya está emitida");
    const items = ws.invoiceItems.filter((it) => it.invoiceId === id);
    if (!items.length || inv.total <= 0) throw new ValidationError("Añade al menos una línea con importe");
    if (!inv.customerName) throw new ValidationError("Indica el cliente o el destinatario de la factura");
    const issueDate = inv.issueDate ?? toISODate(new Date());
    const series = (inv.seriesId && ws.documentSeries.find((s) => s.id === inv.seriesId)) || invoiceSeriesFor(ws.documentSeries, issueDate);
    if (!series) throw new ValidationError(`No hay una serie de facturas activa para ${issueDate.slice(0, 4)}. Créala en Ajustes → Facturación.`);
    const local = !ws.server; // en Supabase el número lo asigna el trigger al emitir
    issued = { ...inv, status: "issued", issueDate, seriesId: series.id, number: local ? formatSeriesNumber(series, series.nextNumber) : undefined };
    return {
      ...ws,
      invoices: ws.invoices.map((i) => (i.id === id ? issued : i)),
      documentSeries: local ? ws.documentSeries.map((s) => (s.id === series.id ? { ...s, nextNumber: s.nextNumber + 1 } : s)) : ws.documentSeries,
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "issue", entityType: "invoices", entityId: id, entityLabel: `${issued.customerName} · ${formatMoney(issued.total)}` })],
    };
  });
  return issued;
}

/** Duplicar: nuevo borrador con las mismas líneas y cliente, fecha de hoy. */
export function duplicateInvoice(ctx: Ctx, id: string): Invoice {
  const ws = ctx.store.requireWorkspace();
  const inv = ws.invoices.find((i) => i.id === id);
  if (!inv) throw new ValidationError("Factura no encontrada");
  const items = ws.invoiceItems.filter((it) => it.invoiceId === id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const today = toISODate(new Date());
  const due = inv.issueDate && inv.dueDate ? Math.max(0, Math.round((new Date(inv.dueDate).getTime() - new Date(inv.issueDate).getTime()) / 86_400_000)) : 0;
  const lines: DraftLine[] = items.length
    ? items.map((it) => {
        const gross = Math.round(it.unitPrice * it.quantity);
        return { description: it.description, quantity: Number(it.quantity), unitPrice: it.unitPrice, taxRateBp: it.taxRateBp, discountPct: gross && it.discount ? (it.discount / gross) * 100 : 0, productId: it.productId, planVersionId: it.planVersionId };
      })
    : [{ description: inv.concept ?? "Servicio", quantity: 1, unitPrice: inv.total, taxRateBp: inv.subtotal ? Math.round((inv.taxTotal / inv.subtotal) * 100) * 100 : 2100 }];
  return saveInvoiceDraft(ctx, {
    customerId: inv.customerId, customerName: inv.customerId ? undefined : inv.customerName, customerTaxId: inv.customerId ? undefined : inv.customerTaxId,
    customerAddress: inv.customerId ? undefined : inv.customerAddress, locationId: inv.locationId, issueDate: today, dueDays: due, concept: inv.concept, notes: inv.notes, lines,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Cobros y anulación
// ---------------------------------------------------------------------------------------------------------------------
/** Registra un cobro (total o parcial). La factura no se edita en sus importes: solo cambia lo cobrado y el estado. */
export function registerInvoicePayment(ctx: Ctx, invoiceId: string, input: { methodKey: string; amount?: number; paidAt?: string; reference?: string }): Payment {
  assertCan(ctx, "payments.manage");
  let payment!: Payment;
  ctx.store.update((ws) => {
    const inv = ws.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new ValidationError("Factura no encontrada");
    if (inv.status !== "issued" && inv.status !== "partially_paid") throw new ValidationError("La factura no está pendiente de cobro");
    const m = ws.paymentMethods.find((x) => x.key === input.methodKey);
    if (!m) throw new ValidationError("Método de pago no válido");
    const due = inv.total - inv.amountPaid;
    const amount = input.amount ?? due;
    if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("El importe debe ser mayor que 0");
    if (amount > due) throw new ValidationError(`El cobro supera lo pendiente (${formatMoney(due)})`);
    const paidAt = input.paidAt ? new Date(`${input.paidAt}T12:00:00`).toISOString() : nowISO();
    payment = {
      id: uid(), organizationId: ws.organization.id, locationId: inv.locationId, kind: "charge", invoiceId, customerId: inv.customerId,
      paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind, amount, status: "succeeded", paidAt, source: "manual",
      reference: input.reference?.trim() || undefined, createdAt: nowISO(),
    };
    const amountPaid = inv.amountPaid + amount;
    const full = amountPaid >= inv.total;
    return {
      ...ws,
      invoices: ws.invoices.map((i) => (i.id === invoiceId ? { ...i, amountPaid, status: full ? "paid" : "partially_paid", paidAt: full ? paidAt : i.paidAt, paymentMethodId: m.id } : i)),
      payments: [...ws.payments, payment],
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: "payment", entityType: "invoices", entityId: invoiceId, entityLabel: `${invoiceLabel(inv)} · cobro ${formatMoney(amount)} (${m.name})${full ? "" : " · parcial"}` }),
      ],
    };
  });
  return payment;
}

/** Cobro de lo pendiente completo (atajo usado en listados). */
export function markInvoicePaid(ctx: Ctx, invoiceId: string, methodKey: string) {
  registerInvoicePayment(ctx, invoiceId, { methodKey });
}

export function markInvoicesPaid(ctx: Ctx, ids: string[], methodKey: string): number {
  let n = 0;
  for (const id of ids) {
    const inv = ctx.store.requireWorkspace().invoices.find((i) => i.id === id);
    if (inv && (inv.status === "issued" || inv.status === "partially_paid")) {
      registerInvoicePayment(ctx, id, { methodKey });
      n++;
    }
  }
  return n;
}

export function voidInvoice(ctx: Ctx, invoiceId: string, reason: string) {
  assertCan(ctx, "invoices.manage");
  if (!reason.trim()) throw new ValidationError("Indica el motivo de la anulación");
  ctx.store.update((ws) => {
    const inv = ws.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new ValidationError("Factura no encontrada");
    if (inv.status === "void") throw new ValidationError("La factura ya está anulada");
    const now = nowISO();
    const logs: AuditLog[] = [auditEntry(ws, ctx, { action: "void", entityType: "invoices", entityId: invoiceId, entityLabel: invoiceLabel(inv), context: { reason: reason.trim() } })];
    return {
      ...ws,
      invoices: ws.invoices.map((i) => (i.id === invoiceId ? { ...i, status: "void", voidedAt: now, voidReason: reason.trim() } : i)),
      auditLogs: [...ws.auditLogs, ...logs],
    };
  });
}
