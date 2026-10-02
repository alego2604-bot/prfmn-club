import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Amount, Card, CardHeader, Kpi, KpiStrip, Page, Section } from "@/design-system/components";
import { FlowChart, Legend } from "@/design-system/components/charts";
import { cashflowSeries, cashflowSummary } from "@/domain/finance";
import { invoiceView } from "@/domain/invoicing";
import { capitalize, daysBetween, monthName, monthShort, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { FinanceHeader, periodSpan, useFinancePeriod } from "./shared";

const BUCKETS = [
  { key: "current", label: "No vencido", test: (d: number) => d <= 0 },
  { key: "30", label: "1–30 días", test: (d: number) => d > 0 && d <= 30 },
  { key: "60", label: "31–60 días", test: (d: number) => d > 30 && d <= 60 },
  { key: "90", label: "61–90 días", test: (d: number) => d > 60 && d <= 90 },
  { key: "90+", label: "Más de 90", test: (d: number) => d > 90 },
] as const;

/** Flujo de caja: dinero que entra (cobros) y sale (gastos pagados) por mes, y antigüedad de lo pendiente. */
export default function CashflowPage() {
  const ws = useWorkspace();
  const { filterId, current, canSeeAll } = useLocationScope();
  const { now, period, control } = useFinancePeriod();
  const series = useMemo(() => cashflowSeries(ws, ws.expenses, now, 12, filterId), [ws, now, filterId]);
  const s = useMemo(() => cashflowSummary(ws, ws.expenses, period, filterId), [ws, period, filterId]);
  const today = toISODate(now);

  const aging = useMemo(() => {
    const age = (due?: string) => (due ? daysBetween(new Date(`${due}T00:00`), now) * (due < today ? 1 : -1) : 0);
    const recv = ws.invoices.filter((i) => (i.status === "issued" || i.status === "partially_paid") && (!filterId || !i.locationId || i.locationId === filterId));
    const pay = ws.expenses.filter((e) => e.status === "pending" && (!filterId || e.locationId === filterId));
    return BUCKETS.map((b) => ({
      ...b,
      recv: recv.filter((i) => b.test(age(i.dueDate ?? i.issueDate))).reduce((t, i) => t + i.total - i.amountPaid, 0),
      pay: pay.filter((e) => b.test(age(e.dueDate ?? e.issueDate))).reduce((t, e) => t + e.total, 0),
    }));
  }, [ws.invoices, ws.expenses, filterId, now, today]);
  const overdueRecv = ws.invoices.filter((i) => invoiceView(i, today) === "overdue" && (!filterId || !i.locationId || i.locationId === filterId));
  const maxAging = Math.max(1, ...aging.flatMap((a) => [a.recv, a.pay]));

  return (
    <Page wide>
      <FinanceHeader title="Flujo de caja" eyebrow={<>{period.label} · {periodSpan(period)}{current ? ` · ${current.name}` : canSeeAll ? " · Todos los centros" : ""}</>} control={control} />
      <KpiStrip className="mb-6">
        <Kpi label="Entradas (cobros)" value={formatMoney(s.inflow)} hint="Pagos recibidos − devoluciones" />
        <Kpi label="Salidas (pagos)" value={formatMoney(s.outflow)} hint="Gastos pagados en el periodo" />
        <Kpi label="Flujo neto" value={<Amount cents={s.net} sign muted={false} className={s.net < 0 ? "text-danger-fg" : undefined} />} hint={s.net >= 0 ? "Entra más de lo que sale" : "Sale más de lo que entra"} />
        <Kpi label="Por cobrar / por pagar" value={`${formatMoney(s.receivable.amount)}`} hint={`Por pagar ${formatMoney(s.payable.amount)}`} />
      </KpiStrip>

      <Card className="mb-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <CardHeader className="mb-0" title="Entradas y salidas por mes" description="Por fecha de cobro y de pago · IVA incluido · últimos 12 meses" />
          <Legend items={[{ label: "Entradas", color: "var(--chart-1)", shape: "bar" }, { label: "Salidas", color: "var(--chart-out)", shape: "bar" }, { label: "Neto", color: "var(--text)" }]} />
        </div>
        <FlowChart partialLast height={280} inLabel="Entradas" outLabel="Salidas" netLabel="Neto" data={series.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), inflow: r.inflow, outflow: r.outflow, net: r.net }))} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Section title="Mes a mes" description="Últimos 12 meses, del más reciente al más antiguo" className="mt-0">
          <Card padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-xs text-fg-3">
                    <th className="px-5 py-2.5 text-left font-medium">Mes</th>
                    <th className="px-3 py-2.5 text-right font-medium">Entradas</th>
                    <th className="px-3 py-2.5 text-right font-medium">Salidas</th>
                    <th className="px-3 py-2.5 text-right font-medium">Neto</th>
                    <th className="hidden px-5 py-2.5 text-right font-medium sm:table-cell">Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map((r) => (
                    <tr key={r.date.toISOString()} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 font-medium">{capitalize(monthName(r.date.getMonth()))} {r.date.getFullYear()}</td>
                      <td className="px-3 py-2.5 text-right num">{formatMoney(r.inflow)}</td>
                      <td className="px-3 py-2.5 text-right text-fg-2 num">{r.outflow ? `−${formatMoney(r.outflow)}` : "—"}</td>
                      <td className={cn("px-3 py-2.5 text-right font-semibold num", r.net < 0 && "text-danger-fg")}><Amount cents={r.net} sign muted={false} /></td>
                      <td className="hidden px-5 py-2.5 text-right text-fg-2 num sm:table-cell">{formatMoney(r.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        <Section title="Antigüedad de lo pendiente" description="Días desde el vencimiento (o la fecha, si no tiene)" className="mt-0">
          <Card>
            <div className="mb-4 flex items-center gap-4 text-xs text-fg-3">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--chart-1)]" />Por cobrar</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--chart-out)]" />Por pagar</span>
            </div>
            <div className="flex flex-col gap-4">
              {aging.map((a) => (
                <div key={a.key}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className={cn("text-fg-2", a.key !== "current" && (a.recv || a.pay) && "font-medium text-fg")}>{a.label}</span>
                    <span className="text-xs text-fg-3 num">{formatMoney(a.recv)} · {formatMoney(a.pay)}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(a.recv / maxAging) * 100}%` }} /></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[var(--chart-out)]" style={{ width: `${(a.pay / maxAging) * 100}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
            {overdueRecv.length > 0 && <Link to="/facturas?estado=vencida" className="mt-5 block rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger-fg hover:underline">{overdueRecv.length} {overdueRecv.length === 1 ? "factura vencida" : "facturas vencidas"} sin cobrar →</Link>}
          </Card>
        </Section>
      </div>
    </Page>
  );
}
