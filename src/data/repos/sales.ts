import { computeLine } from "@/domain/pricing";
import type { Payment, Sale, SaleItem } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { assertCan, assertLocation, auditEntry, nextCounter, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";

export interface SaleLineInput {
  productId: string;
  quantity: number;
  /** Sobrescribir precio (céntimos IVA incl.). Por defecto, el vigente. */
  unitPrice?: number;
  discount?: number;
}

export interface SalePaymentInput {
  methodKey: string;
  amount: number;
}

export interface CreateSaleInput {
  locationId: string;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  customerId?: string;
  notes?: string;
  /** Permitir guardar con pago pendiente (cliente a cuenta) */
  allowPending?: boolean;
}

export function openSessionFor(ws: Workspace, locationId: string) {
  return ws.cashSessions.find((s) => s.locationId === locationId && s.status === "open");
}

export function createSale(ctx: Ctx, input: CreateSaleInput): Sale {
  assertCan(ctx, "pos.sell");
  assertLocation(ctx, input.locationId);
  let created!: Sale;
  ctx.store.update((ws0) => {
    const ws = ws0;
    if (!ws.locations.some((l) => l.id === input.locationId && l.status === "active")) throw new ValidationError("Centro no válido");
    if (!input.lines.length) throw new ValidationError("El carrito está vacío");
    const session = openSessionFor(ws, input.locationId);
    if (ws.settings.requireCashSession && !session) throw new ValidationError("Abre la caja antes de vender");
    if (input.customerId && !ws.customers.some((c) => c.id === input.customerId && !c.deletedAt)) throw new ValidationError("Cliente no encontrado");

    const saleId = uid();
    const now = nowISO();
    const items: SaleItem[] = input.lines.map((l) => {
      const p = ws.products.find((x) => x.id === l.productId);
      if (!p) throw new ValidationError("Producto no encontrado");
      if (p.status !== "active") throw new ValidationError(`"${p.name}" no está activo`);
      const unitPrice = l.unitPrice ?? p.price;
      const a = computeLine({ unitPrice, quantity: l.quantity, discount: l.discount, taxRateBp: p.taxRateBp });
      const cat = ws.categories.find((c) => c.id === p.categoryId);
      return {
        id: uid(), organizationId: ws.organization.id, saleId, productId: p.id, productName: p.name, productKind: p.kind,
        categoryId: cat?.id, categoryName: cat?.name, quantity: l.quantity, unitPrice, discount: a.gross - a.total,
        taxRateBp: p.taxRateBp, baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total,
      };
    });
    const total = items.reduce((s, i) => s + i.total, 0);
    const subtotal = items.reduce((s, i) => s + i.baseAmount, 0);
    const taxTotal = items.reduce((s, i) => s + i.taxAmount, 0);

    const paymentsIn = input.payments.filter((p) => p.amount !== 0);
    for (const p of paymentsIn) {
      if (!Number.isInteger(p.amount) || p.amount < 0) throw new ValidationError("Importe de pago no válido");
    }
    const paid = paymentsIn.reduce((s, p) => s + p.amount, 0);
    if (paid > total) throw new ValidationError(`Los pagos (${formatMoney(paid)}) superan el total (${formatMoney(total)})`);
    if (paid < total && !input.allowPending) throw new ValidationError(`Faltan ${formatMoney(total - paid)} por cobrar`);
    if (paid < total && !input.customerId) throw new ValidationError("Una venta con pago pendiente necesita un cliente");

    const payments: Payment[] = paymentsIn.map((p) => {
      const m = ws.paymentMethods.find((x) => x.key === p.methodKey && x.status === "active");
      if (!m) throw new ValidationError("Método de pago no disponible");
      return {
        id: uid(), organizationId: ws.organization.id, locationId: input.locationId, kind: "charge", saleId, customerId: input.customerId,
        paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind, amount: p.amount, status: "succeeded", paidAt: now,
        cashSessionId: session?.id, source: "pos", createdAt: now,
      };
    });

    const { ws: ws1, value: number } = nextCounter(ws, "sale");
    created = {
      id: saleId, organizationId: ws.organization.id, locationId: input.locationId, number, occurredAt: now, timePrecision: "exact",
      granularity: "transaction", customerId: input.customerId, sellerId: ctx.user.id, cashSessionId: session?.id, subtotal, taxTotal,
      discountTotal: items.reduce((s, i) => s + i.discount, 0), total, status: paid < total ? "pending_payment" : "completed", source: "pos",
      notes: input.notes?.trim() || undefined, createdAt: now,
    };

    // Stock (solo productos que lo controlan)
    const stockDelta = new Map<string, number>();
    for (const it of items) if (it.productId) stockDelta.set(it.productId, (stockDelta.get(it.productId) ?? 0) + it.quantity);
    const products = ws1.products.map((p) => (p.trackStock && stockDelta.has(p.id) ? { ...p, stockQuantity: (p.stockQuantity ?? 0) - stockDelta.get(p.id)! } : p));

    return {
      ...ws1,
      products,
      sales: [...ws1.sales, created],
      saleItems: [...ws1.saleItems, ...items],
      payments: [...ws1.payments, ...payments],
      auditLogs: [
        ...ws1.auditLogs,
        auditEntry(ws1, ctx, { action: "insert", entityType: "sales", entityId: saleId, entityLabel: `Venta #${number} · ${formatMoney(total)}` }),
      ],
    };
  });
  return created;
}

/** Anular: la venta queda en el histórico con motivo, autor y fecha. Sus pagos se compensan con devoluciones. */
export function voidSale(ctx: Ctx, saleId: string, reason: string) {
  assertCan(ctx, "sales.void");
  if (!reason.trim()) throw new ValidationError("Indica el motivo de la anulación");
  ctx.store.update((ws) => {
    const sale = ws.sales.find((s) => s.id === saleId);
    if (!sale) throw new ValidationError("Venta no encontrada");
    assertLocation(ctx, sale.locationId);
    if (sale.status === "voided") throw new ValidationError("La venta ya está anulada");
    const closing = sale.cashSessionId && ws.cashSessions.find((s) => s.id === sale.cashSessionId && s.status === "closed");
    if (closing) throw new ValidationError("La venta pertenece a una caja cerrada. Reabre el cierre para anularla.");
    const now = nowISO();
    const refunds: Payment[] = ws.payments
      .filter((p) => p.saleId === saleId && p.kind === "charge" && p.status === "succeeded")
      .map((p) => ({ ...p, id: uid(), kind: "refund", refundOfPaymentId: p.id, paidAt: now, createdAt: now, reference: `Anulación venta #${sale.number}` }));
    const items = ws.saleItems.filter((i) => i.saleId === saleId);
    const products = ws.products.map((p) => {
      if (!p.trackStock) return p;
      const q = items.filter((i) => i.productId === p.id).reduce((s, i) => s + i.quantity, 0);
      return q ? { ...p, stockQuantity: (p.stockQuantity ?? 0) + q } : p;
    });
    return {
      ...ws,
      products,
      sales: ws.sales.map((s) => (s.id === saleId ? { ...s, status: "voided", voidedAt: now, voidedBy: ctx.user.id, voidReason: reason.trim() } : s)),
      payments: [...ws.payments, ...refunds],
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: "void", entityType: "sales", entityId: saleId, entityLabel: `Venta #${sale.number} · ${formatMoney(sale.total)}`, context: { reason: reason.trim() } }),
      ],
    };
  });
}
