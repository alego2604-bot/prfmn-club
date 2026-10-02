/**
 * Gastos: cálculos puros. Importes en céntimos; el IVA soportado es `taxTotal`.
 * Criterio de periodo: fecha de la factura del proveedor (issueDate), igual que el IVA soportado.
 * Centros: un gasto sin centro es un gasto general; solo cuenta en la vista consolidada (todos los centros).
 */
import { splitGross, type BasisPoints, type Cents } from "@/lib/money";
import { addMonths, startOfMonth, toISODate, type Period } from "@/lib/dates";
import type { Expense, ExpenseCategory, Location, Supplier } from "./types";

export type ExpenseView = "pending" | "overdue" | "paid" | "void";

/** Estado visible: un pendiente con vencimiento pasado es «Vencido». */
export function expenseView(e: Pick<Expense, "status" | "dueDate">, today = toISODate(new Date())): ExpenseView {
  if (e.status === "void") return "void";
  if (e.status === "paid") return "paid";
  return e.dueDate && e.dueDate < today ? "overdue" : "pending";
}

export const EXPENSE_VIEW: Record<ExpenseView, { label: string; tone: "warning" | "danger" | "success" | "neutral" }> = {
  pending: { label: "Pendiente", tone: "warning" },
  overdue: { label: "Vencido", tone: "danger" },
  paid: { label: "Pagado", tone: "success" },
  void: { label: "Anulado", tone: "neutral" },
};

/**
 * Importes de un gasto a partir de lo que tiene el usuario delante: el total de la factura (IVA incluido, lo habitual)
 * o la base imponible. Siempre base + IVA = total.
 */
export function expenseAmounts(input: { amount: Cents; taxRateBp: BasisPoints; includesTax: boolean }): { subtotal: Cents; taxTotal: Cents; total: Cents } {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("El importe debe ser mayor que 0");
  if (input.includesTax) {
    const { base, tax } = splitGross(input.amount, input.taxRateBp);
    return { subtotal: base, taxTotal: tax, total: input.amount };
  }
  const tax = Math.round((input.amount * input.taxRateBp) / 10000);
  return { subtotal: input.amount, taxTotal: tax, total: input.amount + tax };
}

const dayIso = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const inPeriod = (iso: string, p: Period) => dayIso(iso) >= p.start.getTime() && dayIso(iso) < p.end.getTime();

/** Gastos que cuentan en un periodo (no anulados) y, opcionalmente, en un centro. */
export function periodExpenses(expenses: Expense[], p: Period, locationId?: string): Expense[] {
  return expenses.filter((e) => e.status !== "void" && inPeriod(e.issueDate, p) && (!locationId || e.locationId === locationId));
}

export interface ExpenseKpis {
  total: Cents;
  base: Cents;
  vat: Cents;
  count: number;
  paid: Cents;
  pending: { count: number; amount: Cents };
  overdue: { count: number; amount: Cents };
  byCategory: { id: string; name: string; amount: Cents; count: number }[];
  bySupplier: { id: string; name: string; amount: Cents; count: number }[];
  byLocation: { id: string; name: string; amount: Cents }[];
}

export function expenseKpis(
  expenses: Expense[],
  refs: { categories: ExpenseCategory[]; suppliers: Supplier[]; locations: Location[] },
  p: Period,
  locationId?: string,
  today = toISODate(new Date()),
): ExpenseKpis {
  const list = periodExpenses(expenses, p, locationId);
  const cat = new Map(refs.categories.map((c) => [c.id, c.name]));
  const sup = new Map(refs.suppliers.map((s) => [s.id, s.name]));
  const loc = new Map(refs.locations.map((l) => [l.id, l.name]));
  const group = (key: (e: Expense) => string, name: (k: string) => string) => {
    const m = new Map<string, { id: string; name: string; amount: number; count: number }>();
    for (const e of list) {
      const k = key(e);
      const r = m.get(k) ?? { id: k, name: name(k), amount: 0, count: 0 };
      r.amount += e.total;
      r.count += 1;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  // Pendientes y vencidos: todo lo que se debe (de cualquier fecha), no solo lo del periodo
  const open = expenses.filter((e) => e.status === "pending" && (!locationId || e.locationId === locationId));
  const overdue = open.filter((e) => expenseView(e, today) === "overdue");
  return {
    total: list.reduce((s, e) => s + e.total, 0),
    base: list.reduce((s, e) => s + e.subtotal, 0),
    vat: list.reduce((s, e) => s + e.taxTotal, 0),
    count: list.length,
    paid: list.filter((e) => e.status === "paid").reduce((s, e) => s + e.total, 0),
    pending: { count: open.length, amount: open.reduce((s, e) => s + e.total, 0) },
    overdue: { count: overdue.length, amount: overdue.reduce((s, e) => s + e.total, 0) },
    byCategory: group((e) => e.categoryId ?? "none", (k) => cat.get(k) ?? "Sin categoría"),
    bySupplier: group((e) => e.supplierId ?? "none", (k) => sup.get(k) ?? "Sin proveedor"),
    byLocation: group((e) => e.locationId ?? "none", (k) => loc.get(k) ?? "Gastos generales").map(({ id, name, amount }) => ({ id, name, amount })),
  };
}

/** Gasto mensual (IVA incluido y base) de los últimos `months` meses hasta `end` (incluido el mes en curso). */
export function expenseSeries(expenses: Expense[], end: Date, months = 12, locationId?: string): { date: Date; total: Cents; base: Cents }[] {
  const first = startOfMonth(addMonths(end, -(months - 1)));
  const out = Array.from({ length: months }, (_, i) => ({ date: addMonths(first, i), total: 0, base: 0 }));
  for (const e of expenses) {
    if (e.status === "void" || (locationId && e.locationId !== locationId)) continue;
    const d = new Date(`${e.issueDate}T00:00:00`);
    const idx = (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
    if (idx < 0 || idx >= months) continue;
    out[idx]!.total += e.total;
    out[idx]!.base += e.subtotal;
  }
  return out;
}

/** ¿Hay otro gasto vivo con el mismo nº de factura del mismo proveedor? (la base de datos también lo impide) */
export function duplicateSupplierInvoice(expenses: Expense[], e: Pick<Expense, "id" | "supplierId" | "supplierInvoiceNumber">): Expense | undefined {
  const n = e.supplierInvoiceNumber?.trim().toUpperCase();
  if (!n || !e.supplierId) return undefined;
  return expenses.find((x) => x.id !== e.id && x.status !== "void" && x.supplierId === e.supplierId && x.supplierInvoiceNumber?.trim().toUpperCase() === n);
}

/** ¿Hay histórico de gastos que cubra todo el periodo de comparación? Si no, comparar engaña (p. ej. +1.500 %). */
export function hasComparableHistory(expenses: Pick<Expense, "issueDate" | "status">[], prevStart: Date): boolean {
  const first = expenses.filter((e) => e.status !== "void").reduce<string | null>((m, e) => (!m || e.issueDate < m ? e.issueDate : m), null);
  return !!first && new Date(`${first}T00:00:00`).getTime() <= prevStart.getTime();
}
