/**
 * Finanzas: resultado, flujo de caja e IVA. Siempre desde los registros, nunca estimado.
 *
 *  - Resultado (aprox., antes de impuestos sobre beneficios) = ingresos SIN IVA − gastos SIN IVA. El IVA no es ingreso
 *    ni gasto: se repercute y se soporta por cuenta de Hacienda.
 *  - Flujo de caja = dinero que entra (cobros) − dinero que sale (gastos pagados), por fecha de cobro/pago.
 *  - Posición de IVA estimada = repercutido − soportado. Orientativa: no sustituye a la gestoría ni al modelo oficial.
 */
import type { Cents } from "@/lib/money";
import { addMonths, startOfMonth, toISODate, type Period } from "@/lib/dates";
import { activeSales, revenueInvoices, type Dataset } from "./analytics";
import { periodExpenses } from "./expenses";
import type { Expense, InvoiceItem } from "./types";

const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime();
const inP = (iso: string | undefined, p: Period) => !!iso && at(iso) >= p.start.getTime() && at(iso) < p.end.getTime();

export interface ProfitAndLoss {
  revenueGross: Cents;
  revenueBase: Cents;
  expensesGross: Cents;
  expensesBase: Cents;
  /** Ingresos − gastos, sin IVA */
  result: Cents;
  /** Margen sobre ingresos sin IVA (null sin ingresos) */
  margin: number | null;
  hasExpenses: boolean;
}

export function profitAndLoss(ds: Dataset, expenses: Expense[], p: Period, locationId?: string): ProfitAndLoss {
  const sales = activeSales(ds, p, locationId);
  const invoices = revenueInvoices(ds, p, locationId);
  const revenueGross = sales.reduce((s, x) => s + x.total, 0) + invoices.reduce((s, x) => s + x.total, 0);
  const revenueBase = sales.reduce((s, x) => s + x.subtotal, 0) + invoices.reduce((s, x) => s + x.subtotal, 0);
  const ex = periodExpenses(expenses, p, locationId);
  const expensesBase = ex.reduce((s, e) => s + e.subtotal, 0);
  const result = revenueBase - expensesBase;
  return {
    revenueGross, revenueBase, expensesGross: ex.reduce((s, e) => s + e.total, 0), expensesBase, result,
    margin: revenueBase > 0 ? result / revenueBase : null, hasExpenses: expenses.some((e) => e.status !== "void"),
  };
}

export interface CashflowMonth {
  date: Date;
  inflow: Cents;
  outflow: Cents;
  net: Cents;
  /** Acumulado desde el primer mes de la serie */
  cumulative: Cents;
}

/** Cobros (pagos correctos − devoluciones) y pagos de gastos por mes. */
export function cashflowSeries(ds: Dataset, expenses: Expense[], end: Date, months = 12, locationId?: string): CashflowMonth[] {
  const first = startOfMonth(addMonths(end, -(months - 1)));
  const rows = Array.from({ length: months }, (_, i) => ({ date: addMonths(first, i), inflow: 0, outflow: 0, net: 0, cumulative: 0 }));
  const idx = (iso: string) => {
    const d = new Date(at(iso));
    return (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
  };
  for (const pay of ds.payments) {
    if (pay.status !== "succeeded" || (locationId && pay.locationId && pay.locationId !== locationId)) continue;
    const i = idx(pay.paidAt);
    if (i < 0 || i >= months) continue;
    rows[i]!.inflow += pay.kind === "refund" ? -pay.amount : pay.amount;
  }
  for (const e of expenses) {
    if (e.status !== "paid" || (locationId && e.locationId !== locationId)) continue;
    const i = idx(e.paidAt ?? e.issueDate);
    if (i < 0 || i >= months) continue;
    rows[i]!.outflow += e.total;
  }
  let acc = 0;
  for (const r of rows) {
    r.net = r.inflow - r.outflow;
    acc += r.net;
    r.cumulative = acc;
  }
  return rows;
}

export interface CashflowSummary {
  inflow: Cents;
  outflow: Cents;
  net: Cents;
  receivable: { count: number; amount: Cents };
  payable: { count: number; amount: Cents };
}

export function cashflowSummary(ds: Dataset, expenses: Expense[], p: Period, locationId?: string): CashflowSummary {
  let inflow = 0;
  for (const pay of ds.payments) {
    if (pay.status !== "succeeded" || !inP(pay.paidAt, p) || (locationId && pay.locationId && pay.locationId !== locationId)) continue;
    inflow += pay.kind === "refund" ? -pay.amount : pay.amount;
  }
  const outflow = expenses.filter((e) => e.status === "paid" && inP(e.paidAt ?? e.issueDate, p) && (!locationId || e.locationId === locationId)).reduce((s, e) => s + e.total, 0);
  const recv = ds.invoices.filter((i) => (i.status === "issued" || i.status === "partially_paid") && (!locationId || !i.locationId || i.locationId === locationId));
  const pay = expenses.filter((e) => e.status === "pending" && (!locationId || e.locationId === locationId));
  return {
    inflow, outflow, net: inflow - outflow,
    receivable: { count: recv.length, amount: recv.reduce((s, i) => s + i.total - i.amountPaid, 0) },
    payable: { count: pay.length, amount: pay.reduce((s, e) => s + e.total, 0) },
  };
}

export interface VatLine { rateBp: number; base: Cents; tax: Cents }
export interface VatSummary {
  output: VatLine[];
  input: VatLine[];
  outputTax: Cents;
  inputTax: Cents;
  /** Repercutido − soportado (positivo: a ingresar; negativo: a compensar/devolver). Estimación orientativa. */
  position: Cents;
}

const legalRate = (base: number, tax: number) => {
  if (base <= 0) return 0;
  const r = (tax / base) * 10000;
  return [0, 400, 500, 1000, 2100].reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 0);
};

/** IVA repercutido (ventas por fecha de operación, facturas por emisión) y soportado (gastos por fecha de factura). */
export function vatSummary(ds: Dataset & { invoiceItems?: InvoiceItem[] }, expenses: Expense[], p: Period, locationId?: string): VatSummary {
  const out = new Map<number, VatLine>();
  const add = (m: Map<number, VatLine>, rateBp: number, base: number, tax: number) => {
    const r = m.get(rateBp) ?? { rateBp, base: 0, tax: 0 };
    r.base += base;
    r.tax += tax;
    m.set(rateBp, r);
  };
  const sales = activeSales(ds, p, locationId);
  const ids = new Set(sales.map((s) => s.id));
  for (const it of ds.saleItems) if (ids.has(it.saleId)) add(out, it.taxRateBp, it.baseAmount, it.taxAmount);
  const invoices = revenueInvoices(ds, p, locationId);
  const items = new Map<string, InvoiceItem[]>();
  for (const it of ds.invoiceItems ?? []) items.set(it.invoiceId, [...(items.get(it.invoiceId) ?? []), it]);
  for (const inv of invoices) {
    const its = items.get(inv.id);
    if (its?.length) for (const it of its) add(out, it.taxRateBp, it.baseAmount, it.taxAmount);
    else add(out, legalRate(inv.subtotal, inv.taxTotal), inv.subtotal, inv.taxTotal);
  }
  const inp = new Map<number, VatLine>();
  for (const e of periodExpenses(expenses, p, locationId)) add(inp, e.taxRateBp ?? legalRate(e.subtotal, e.taxTotal), e.subtotal, e.taxTotal);
  const sort = (m: Map<number, VatLine>) => [...m.values()].filter((v) => v.base || v.tax).sort((a, b) => b.rateBp - a.rateBp);
  const output = sort(out);
  const input = sort(inp);
  const outputTax = output.reduce((s, v) => s + v.tax, 0);
  const inputTax = input.reduce((s, v) => s + v.tax, 0);
  return { output, input, outputTax, inputTax, position: outputTax - inputTax };
}

/** Ingresos vs gastos por mes (sin IVA), para la gráfica de resultado. */
export function resultSeries(ds: Dataset, expenses: Expense[], end: Date, months = 12, locationId?: string): { date: Date; revenue: Cents; expenses: Cents; result: Cents }[] {
  const first = startOfMonth(addMonths(end, -(months - 1)));
  return Array.from({ length: months }, (_, i) => {
    const start = addMonths(first, i);
    const p: Period = { preset: "custom", start, end: addMonths(first, i + 1), label: toISODate(start) };
    const pl = profitAndLoss(ds, expenses, p, locationId);
    return { date: start, revenue: pl.revenueBase, expenses: pl.expensesBase, result: pl.result };
  });
}
