/**
 * KPIs calculados SIEMPRE desde los registros (nunca guardados). Cualquier periodo es un filtro.
 *
 * Ingresos = ventas (caja/TPV, no anuladas, por fecha de la operación)
 *          + facturas no ligadas a una venta (cuotas, por fecha de emisión), para no contar dos veces.
 */
import type { Cents } from "@/lib/money";
import { addDays, addMonths, startOfDay, startOfMonth, toISODate, type Period } from "@/lib/dates";
import type { Invoice, Payment, PaymentMethod, ProductCategory, Sale, SaleItem } from "./types";

export interface Dataset {
  sales: Sale[];
  saleItems: SaleItem[];
  payments: Payment[];
  invoices: Invoice[];
  categories: ProductCategory[];
  paymentMethods: PaymentMethod[];
}

const t = (iso: string) => new Date(iso).getTime();
const within = (iso: string | undefined, p: Period) => !!iso && t(iso) >= p.start.getTime() && t(iso) < p.end.getTime();
/** Las fechas de factura son yyyy-mm-dd: se interpretan como hora local 00:00 */
const invoiceDate = (inv: Invoice) => (inv.issueDate ? new Date(`${inv.issueDate}T00:00:00`).toISOString() : undefined);

export function activeSales(ds: Dataset, p: Period, locationId?: string): Sale[] {
  return ds.sales.filter((s) => s.status !== "voided" && within(s.occurredAt, p) && (!locationId || s.locationId === locationId));
}

export function revenueInvoices(ds: Dataset, p: Period, locationId?: string): Invoice[] {
  return ds.invoices.filter(
    (i) => i.status !== "void" && i.status !== "draft" && !i.saleId && within(invoiceDate(i), p) && (!locationId || !i.locationId || i.locationId === locationId),
  );
}

export interface PeriodKpis {
  revenue: Cents; // ventas + facturas de cuotas
  salesRevenue: Cents;
  invoiceRevenue: Cents;
  operations: number; // solo ventas "transaction"
  avgTicket: Cents | null; // null si no hay operaciones individuales
  units: number;
  byMethod: { key: string; name: string; amount: Cents }[];
  byCategory: { id: string; name: string; color: string; amount: Cents; units: number }[];
  byProduct: { key: string; name: string; amount: Cents; units: number }[];
  dropIns: { units: number; amount: Cents };
  vatCollected: Cents;
  pendingInvoices: { count: number; amount: Cents };
  hasAggregates: boolean;
  hasUnknownTime: boolean;
}

export function computeKpis(ds: Dataset, p: Period, locationId?: string): PeriodKpis {
  const sales = activeSales(ds, p, locationId);
  const saleIds = new Set(sales.map((s) => s.id));
  const items = ds.saleItems.filter((i) => saleIds.has(i.saleId));
  const invoices = revenueInvoices(ds, p, locationId);

  const salesRevenue = sales.reduce((s, x) => s + x.total, 0);
  const invoiceRevenue = invoices.reduce((s, x) => s + x.total, 0);
  const tx = sales.filter((s) => s.granularity === "transaction");
  const txRevenue = tx.reduce((s, x) => s + x.total, 0);

  // Métodos de pago: pagos de las ventas del periodo + cobro de facturas
  const methodName = new Map(ds.paymentMethods.map((m) => [m.key, m.name]));
  const byMethodMap = new Map<string, number>();
  const paidSaleAmount = new Map<string, number>();
  for (const pay of ds.payments) {
    if (pay.status !== "succeeded" || !pay.saleId || !saleIds.has(pay.saleId)) continue;
    const v = pay.kind === "refund" ? -pay.amount : pay.amount;
    byMethodMap.set(pay.methodKey, (byMethodMap.get(pay.methodKey) ?? 0) + v);
    paidSaleAmount.set(pay.saleId, (paidSaleAmount.get(pay.saleId) ?? 0) + v);
  }
  for (const s of sales) {
    const gap = s.total - (paidSaleAmount.get(s.id) ?? 0);
    if (gap > 0) byMethodMap.set(s.status === "pending_payment" ? "pending" : "unknown", (byMethodMap.get(s.status === "pending_payment" ? "pending" : "unknown") ?? 0) + gap);
  }
  const methodIdToKey = new Map(ds.paymentMethods.map((m) => [m.id, m.key]));
  for (const inv of invoices) {
    const key = (inv.paymentMethodId && methodIdToKey.get(inv.paymentMethodId)) || "unknown";
    const k = inv.status === "issued" ? "pending" : key;
    byMethodMap.set(k, (byMethodMap.get(k) ?? 0) + inv.total);
  }
  const byMethod = [...byMethodMap.entries()]
    .filter(([, v]) => v !== 0)
    .map(([key, amount]) => ({ key, name: key === "pending" ? "Pendiente de cobro" : methodName.get(key) ?? "Desconocido", amount }))
    .sort((a, b) => b.amount - a.amount);

  const catColor = new Map(ds.categories.map((c) => [c.id, c.color]));
  const byCatMap = new Map<string, { id: string; name: string; color: string; amount: number; units: number }>();
  const byProdMap = new Map<string, { key: string; name: string; amount: number; units: number }>();
  let units = 0;
  const dropIns = { units: 0, amount: 0 };
  for (const it of items) {
    units += it.quantity;
    const cid = it.categoryId ?? `name:${it.categoryName ?? "Sin categoría"}`;
    const c = byCatMap.get(cid) ?? { id: cid, name: it.categoryName ?? "Sin categoría", color: catColor.get(it.categoryId ?? "") ?? "#94a3b8", amount: 0, units: 0 };
    c.amount += it.total;
    c.units += it.quantity;
    byCatMap.set(cid, c);
    const pk = it.productId ?? `name:${it.productName}`;
    const pr = byProdMap.get(pk) ?? { key: pk, name: it.productName, amount: 0, units: 0 };
    pr.amount += it.total;
    pr.units += it.quantity;
    byProdMap.set(pk, pr);
    if (it.productKind === "drop_in") {
      dropIns.units += it.quantity;
      dropIns.amount += it.total;
    }
  }
  if (invoiceRevenue > 0) {
    byCatMap.set("invoices", { id: "invoices", name: "Cuotas y bonos (facturas)", color: "#6366f1", amount: invoiceRevenue, units: invoices.length });
  }

  const pending = ds.invoices.filter((i) => (i.status === "issued" || i.status === "partially_paid") && within(invoiceDate(i), p));

  return {
    revenue: salesRevenue + invoiceRevenue,
    salesRevenue,
    invoiceRevenue,
    operations: tx.length,
    avgTicket: tx.length ? Math.round(txRevenue / tx.length) : null,
    units,
    byMethod,
    byCategory: [...byCatMap.values()].sort((a, b) => b.amount - a.amount),
    byProduct: [...byProdMap.values()].sort((a, b) => b.amount - a.amount),
    dropIns,
    vatCollected: sales.reduce((s, x) => s + x.taxTotal, 0) + invoices.reduce((s, x) => s + x.taxTotal, 0),
    pendingInvoices: { count: pending.length, amount: pending.reduce((s, i) => s + (i.total - i.amountPaid), 0) },
    hasAggregates: sales.some((s) => s.granularity === "aggregate"),
    hasUnknownTime: sales.some((s) => s.timePrecision !== "exact"),
  };
}

export interface SeriesPoint {
  key: string; // yyyy-mm-dd o yyyy-mm
  date: Date;
  sales: Cents;
  /** Solo ventas individuales (excluye resúmenes mensuales importados) */
  txSales: Cents;
  invoices: Cents;
  total: Cents;
  operations: number;
}

/** Serie diaria (o mensual si granularity = 'month') del periodo. */
export function revenueSeries(ds: Dataset, p: Period, granularity: "day" | "month", locationId?: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const index = new Map<string, SeriesPoint>();
  const keyOf = (d: Date) => (granularity === "day" ? toISODate(d) : toISODate(d).slice(0, 7));
  for (let d = granularity === "day" ? startOfDay(p.start) : startOfMonth(p.start); d < p.end; d = granularity === "day" ? addDays(d, 1) : addMonths(d, 1)) {
    const pt: SeriesPoint = { key: keyOf(d), date: d, sales: 0, txSales: 0, invoices: 0, total: 0, operations: 0 };
    points.push(pt);
    index.set(pt.key, pt);
  }
  for (const s of activeSales(ds, p, locationId)) {
    const pt = index.get(keyOf(new Date(s.occurredAt)));
    if (!pt) continue;
    pt.sales += s.total;
    pt.total += s.total;
    if (s.granularity === "transaction") {
      pt.operations += 1;
      pt.txSales += s.total;
    }
  }
  for (const i of revenueInvoices(ds, p, locationId)) {
    const pt = index.get(keyOf(new Date(`${i.issueDate}T00:00:00`)));
    if (!pt) continue;
    pt.invoices += i.total;
    pt.total += i.total;
  }
  return points;
}

/** Ventas por hora del día (solo operaciones con hora real). */
export function hourlyDistribution(ds: Dataset, p: Period, locationId?: string): { hour: number; amount: Cents; operations: number }[] {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, operations: 0 }));
  for (const s of activeSales(ds, p, locationId)) {
    if (s.timePrecision !== "exact" || s.granularity !== "transaction") continue;
    const r = rows[new Date(s.occurredAt).getHours()]!;
    r.amount += s.total;
    r.operations += 1;
  }
  return rows;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

export function best<T>(rows: T[], value: (r: T) => number): T | null {
  let b: T | null = null;
  for (const r of rows) if (value(r) > 0 && (b === null || value(r) > value(b))) b = r;
  return b;
}

export interface MembershipStats {
  available: boolean;
  activeMembers: number;
  mrr: Cents; // base imponible (sin IVA) de las cuotas cuyo periodo de servicio cae en el mes
  newMembers: number;
  churned: number | null; // null si el mes no ha terminado
  avgFee: Cents | null;
}

/**
 * Métricas recurrentes a partir de las facturas con periodo de servicio (cuotas).
 * Activo en un mes = tiene una cuota cuyo periodo empieza en ese mes.
 */
export function membershipStats(ds: Dataset, monthStart: Date, now = new Date()): MembershipStats {
  const key = (d: string) => d.slice(0, 7);
  const fees = ds.invoices.filter((i) => i.status !== "void" && i.status !== "draft" && i.servicePeriodStart && i.customerId);
  if (!fees.length) return { available: false, activeMembers: 0, mrr: 0, newMembers: 0, churned: null, avgFee: null };
  const m = toISODate(monthStart).slice(0, 7);
  const prev = toISODate(addMonths(monthStart, -1)).slice(0, 7);
  const byMonth = new Map<string, Set<string>>();
  const firstMonth = new Map<string, string>();
  let mrr = 0;
  for (const i of fees) {
    const k = key(i.servicePeriodStart!);
    if (!byMonth.has(k)) byMonth.set(k, new Set());
    byMonth.get(k)!.add(i.customerId!);
    const f = firstMonth.get(i.customerId!);
    if (!f || k < f) firstMonth.set(i.customerId!, k);
    if (k === m) mrr += i.subtotal;
  }
  const active = byMonth.get(m) ?? new Set<string>();
  const before = byMonth.get(prev) ?? new Set<string>();
  const monthEnded = addMonths(monthStart, 1) <= now;
  const hasPrevData = [...byMonth.keys()].some((k) => k <= prev);
  return {
    available: true,
    activeMembers: active.size,
    mrr,
    newMembers: [...active].filter((c) => firstMonth.get(c) === m && hasPrevData).length,
    churned: monthEnded && hasPrevData ? [...before].filter((c) => !active.has(c)).length : null,
    avgFee: active.size ? Math.round(mrr / active.size) : null,
  };
}
