import type { Payment } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { assertCan, auditEntry, ValidationError, type Ctx } from "../context";

/** Registrar el cobro de una factura pendiente (crea un pago; la factura no se edita en sus importes). */
export function markInvoicePaid(ctx: Ctx, invoiceId: string, methodKey: string) {
  assertCan(ctx, "payments.manage");
  ctx.store.update((ws) => {
    const inv = ws.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new ValidationError("Factura no encontrada");
    if (inv.status !== "issued" && inv.status !== "partially_paid") throw new ValidationError("La factura no está pendiente de cobro");
    const m = ws.paymentMethods.find((x) => x.key === methodKey);
    if (!m) throw new ValidationError("Método de pago no válido");
    const amount = inv.total - inv.amountPaid;
    const now = nowISO();
    const payment: Payment = {
      id: uid(), organizationId: ws.organization.id, locationId: inv.locationId, kind: "charge", invoiceId, customerId: inv.customerId,
      paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind, amount, status: "succeeded", paidAt: now, source: "manual", createdAt: now,
    };
    return {
      ...ws,
      invoices: ws.invoices.map((i) => (i.id === invoiceId ? { ...i, status: "paid", amountPaid: i.total, paidAt: now, paymentMethodId: m.id } : i)),
      payments: [...ws.payments, payment],
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: "payment", entityType: "invoices", entityId: invoiceId, entityLabel: `${inv.number ?? inv.externalNumber} · cobro ${formatMoney(amount)} (${m.name})` }),
      ],
    };
  });
}

export function voidInvoice(ctx: Ctx, invoiceId: string, reason: string) {
  assertCan(ctx, "invoices.manage");
  if (!reason.trim()) throw new ValidationError("Indica el motivo de la anulación");
  ctx.store.update((ws) => {
    const inv = ws.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new ValidationError("Factura no encontrada");
    if (inv.status === "void") throw new ValidationError("La factura ya está anulada");
    const now = nowISO();
    return {
      ...ws,
      invoices: ws.invoices.map((i) => (i.id === invoiceId ? { ...i, status: "void", voidedAt: now, voidReason: reason.trim() } : i)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "void", entityType: "invoices", entityId: invoiceId, entityLabel: inv.number ?? inv.externalNumber, context: { reason: reason.trim() } })],
    };
  });
}
