import { splitGross, type BasisPoints, type Cents } from "@/lib/money";

export interface LineInput {
  unitPrice: Cents; // IVA incluido
  quantity: number;
  discount?: Cents; // importe total de descuento de la línea, IVA incluido
  taxRateBp: BasisPoints;
}

export interface LineAmounts {
  gross: Cents;
  baseAmount: Cents;
  taxAmount: Cents;
  total: Cents;
}

/** Calcula una línea. Mismo cálculo en caja, importación e informes. */
export function computeLine(l: LineInput): LineAmounts {
  if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new Error("La cantidad debe ser mayor que 0");
  if (l.unitPrice < 0) throw new Error("El precio no puede ser negativo");
  const gross = Math.round(l.unitPrice * l.quantity);
  const discount = Math.min(l.discount ?? 0, gross);
  const total = gross - discount;
  const { base, tax } = splitGross(total, l.taxRateBp);
  return { gross, baseAmount: base, taxAmount: tax, total };
}

export interface Totals {
  subtotal: Cents;
  taxTotal: Cents;
  discountTotal: Cents;
  total: Cents;
  byRate: { rateBp: BasisPoints; base: Cents; tax: Cents; total: Cents }[];
}

export function computeTotals(lines: LineInput[]): Totals {
  const byRate = new Map<number, { base: number; tax: number; total: number }>();
  let discountTotal = 0;
  for (const l of lines) {
    const a = computeLine(l);
    discountTotal += a.gross - a.total;
    const r = byRate.get(l.taxRateBp) ?? { base: 0, tax: 0, total: 0 };
    r.base += a.baseAmount;
    r.tax += a.taxAmount;
    r.total += a.total;
    byRate.set(l.taxRateBp, r);
  }
  const rows = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rateBp, v]) => ({ rateBp, ...v }));
  const subtotal = rows.reduce((s, r) => s + r.base, 0);
  const taxTotal = rows.reduce((s, r) => s + r.tax, 0);
  return { subtotal, taxTotal, discountTotal, total: subtotal + taxTotal, byRate: rows };
}

/** Margen bruto unitario a partir de precio con IVA y coste sin IVA. */
export function unitMargin(price: Cents, taxRateBp: BasisPoints, cost?: Cents): { margin: Cents; pct: number } | null {
  if (cost === undefined || cost === null) return null;
  const { base } = splitGross(price, taxRateBp);
  const margin = base - cost;
  return { margin, pct: base > 0 ? margin / base : 0 };
}
