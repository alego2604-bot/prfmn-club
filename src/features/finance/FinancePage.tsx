import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock3, FileText, Lock, Receipt } from "lucide-react";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Card, CardHeader, DeltaChip, Page, RangeSelector, SectionTitle } from "@/design-system/components";
import { BarList, ColumnChart, Legend, StackedColumnChart } from "@/design-system/components/charts";
import { computeKpis, percentChange, revenueSeries } from "@/domain/analytics";
import { buildGestoriaReport } from "@/features/reports/gestoria";
import { addDays, addMonths, capitalize, formatDate, comparablePrevious, makePeriod, monthName, monthShort, startOfMonth, toISODate, type PeriodPreset } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { cn } from "@/lib/cn";

type Range = "month" | "quarter" | "ytd" | "1y" | "custom";
const RANGES: { value: Exclude<Range, "custom">; label: string; long: string }[] = [
  { value: "month", label: "Mes", long: "Mes en curso" },
  { value: "quarter", label: "Trim.", long: "Trimestre en curso" },
  { value: "ytd", label: "YTD", long: "Año en curso hasta hoy" },
  { value: "1y", label: "1A", long: "Últimos 12 meses" },
];

/** Finanzas: ingresos, cobros, IVA y pendientes. Gastos y resultado aparecen cuando exista el módulo de Gastos (nunca cifras inventadas). */
export default function FinancePage() {
  const ws = useWorkspace();
  const { filterId } = useLocationScope();
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<Range>("quarter");
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -89)), end: toISODate(now) });
  const period = useMemo(
    () => makePeriod(range as PeriodPreset, now, range === "custom" ? { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) } : undefined),
    [range, now, custom],
  );
  const prev = useMemo(() => comparablePrevious(period, now), [period, now]);
  const k = useMemo(() => computeKpis(ws, period, filterId), [ws, period, filterId]);
  const kp = useMemo(() => computeKpis(ws, prev, filterId), [ws, prev, filterId]);
  const report = useMemo(() => buildGestoriaReport(ws, period, filterId), [ws, period, filterId]);

  // Cobros (entradas de dinero) por mes, 12 meses: cargos − devoluciones
  const cashIn = useMemo(() => {
    const first = addMonths(startOfMonth(now), -11);
    const rows = Array.from({ length: 12 }, (_, i) => ({ date: addMonths(first, i), amount: 0 }));
    const idx = new Map(rows.map((r) => [toISODate(r.date).slice(0, 7), r]));
    for (const p of ws.payments) {
      if (p.status !== "succeeded" || (filterId && p.locationId && p.locationId !== filterId)) continue;
      const r = idx.get(toISODate(new Date(p.paidAt)).slice(0, 7));
      if (r) r.amount += p.kind === "refund" ? -p.amount : p.amount;
    }
    for (const i of ws.invoices) {
      // Facturas importadas cobradas sin pago registrado: el cobro consta en la propia factura
      if (i.status !== "paid" || ws.payments.some((p) => p.invoiceId === i.id) || !i.paidAt && !i.issueDate) continue;
      const r = idx.get((i.paidAt ?? i.issueDate!).slice(0, 7));
      if (r) r.amount += i.amountPaid;
    }
    return rows;
  }, [ws, filterId, now]);
  const collected = k.byMethod.reduce((s, m) => s + m.amount, 0);
  const collectedPrev = kp.byMethod.reduce((s, m) => s + m.amount, 0);
  const pendingList = ws.invoices
    .filter((i) => (i.status === "issued" || i.status === "partially_paid") && (!filterId || !i.locationId || i.locationId === filterId))
    .sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
  const vatTotal = report.vat.reduce((s, v) => s + v.tax, 0);
  const vatByRate = [...report.vat.reduce((m, v) => m.set(v.rateBp, { base: (m.get(v.rateBp)?.base ?? 0) + v.base, tax: (m.get(v.rateBp)?.tax ?? 0) + v.tax }), new Map<number, { base: number; tax: number }>())].sort((a, b) => b[0] - a[0]);
  const split12 = useMemo(() => {
    const p12 = makePeriod("custom", now, { start: addMonths(startOfMonth(now), -11), end: now });
    return revenueSeries(ws, p12, "month", filterId).map((m) => ({
      key: m.key, label: capitalize(monthShort(m.date.getMonth())), tooltipLabel: capitalize(`${monthName(m.date.getMonth())} ${m.date.getFullYear()}`), a: m.invoices, b: m.sales,
    }));
  }, [ws, now, filterId]);
  const periodInvoices = ws.invoices.filter((i) => i.status !== "void" && i.status !== "draft" && i.issueDate && (!filterId || !i.locationId || i.locationId === filterId) && new Date(`${i.issueDate}T00:00`) >= period.start && new Date(`${i.issueDate}T00:00`) < period.end);
  const paidShare = periodInvoices.length ? Math.round((periodInvoices.filter((i) => i.status === "paid").length / periodInvoices.length) * 100) : null;
  const prevLabel = <span title={`${formatDate(prev.start)} – ${formatDate(addDays(prev.end, -1))}`}>vs {prev.label.toLowerCase()}</span>;

  return (
    <Page wide>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-fg-3">{period.label} · {formatDate(period.start)} – {formatDate(addDays(period.end, -1))}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">Finanzas</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeSelector value={range} onChange={setRange} options={RANGES} custom="custom" customValue={custom} onCustomChange={setCustom} />
          <Link to="/informes" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-sm font-medium shadow-xs transition-colors hover:border-line-strong"><FileText className="h-4 w-4" />Informe gestoría</Link>
        </div>
      </div>

      {/* Extracto: una cifra protagonista y el resto como líneas de un estado de cuentas */}
      <Card className="mb-8" padded={false}>
        <div className="grid lg:grid-cols-[1.15fr_1fr]">
          <div className="p-6 sm:p-7">
            <p className="text-sm font-medium text-fg-2">Ingresos del periodo</p>
            <p className="figure mt-2 text-5xl leading-none sm:text-6xl">{formatMoney(k.revenue)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
              <DeltaChip size="md" value={percentChange(k.revenue, kp.revenue)} label={prevLabel} />
              <span>IVA incluido · caja {formatMoney(k.salesRevenue)} · cuotas y facturas {formatMoney(k.invoiceRevenue)}</span>
            </div>
          </div>
          <dl className="divide-y divide-line border-t border-line text-sm lg:border-l lg:border-t-0">
            <StatementRow label="Cobrado" value={formatMoney(collected)} extra={<DeltaChip value={percentChange(collected, collectedPrev)} />} />
            <StatementRow label="Pendiente de cobro" value={formatMoney(k.pendingInvoices.amount)} extra={<span className="text-xs text-fg-3">{k.pendingInvoices.count} factura{k.pendingInvoices.count === 1 ? "" : "s"}</span>} to="/facturas?estado=pendiente" />
            <StatementRow label="IVA repercutido" value={formatMoney(vatTotal)} extra={<span className="text-xs text-fg-3">{vatByRate.length} tipo{vatByRate.length === 1 ? "" : "s"}</span>} />
            <StatementRow label="Gastos" soon />
            <StatementRow label="Resultado neto" soon />
          </dl>
        </div>
      </Card>

      <div className="flex flex-col gap-8">
        <section>
          <SectionTitle>Ingresos</SectionTitle>
          <div className="grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
            <Card className="md:col-span-12 xl:col-span-8">
              <CardHeader title="Recurrente frente a puntual" description="Por mes de emisión · IVA incluido · últimos 12 meses" action={<Legend items={[{ label: "Cuotas y facturas", color: "var(--chart-1)", shape: "bar" }, { label: "Caja", color: "var(--chart-1-mid)", shape: "bar" }]} />} />
              <StackedColumnChart data={split12} aLabel="Cuotas y facturas" bLabel="Caja" height={240} partialLast />
            </Card>
            <Card className="md:col-span-12 xl:col-span-4">
              <CardHeader title="Composición del periodo" description={period.label} />
              <BarList rows={[{ key: "inv", label: "Cuotas y facturas", value: k.invoiceRevenue }, { key: "pos", label: "Caja / TPV", value: k.salesRevenue }].filter((r) => r.value > 0)} emptyText="Sin ingresos en el periodo" />
              {k.byCategory.filter((c) => c.id !== "invoices").length > 0 && (
                <>
                  <p className="mb-3 mt-6 text-xs font-medium text-fg-3">Caja por categoría</p>
                  <BarList rows={k.byCategory.filter((c) => c.id !== "invoices").map((c) => ({ key: c.id, label: c.name, value: c.amount }))} max={4} />
                </>
              )}
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle>Caja · entradas de dinero</SectionTitle>
          <div className="grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
            <Card className="md:col-span-12 xl:col-span-8">
              <CardHeader title="Cobrado por mes" description="Cargos − devoluciones · últimos 12 meses" />
              <ColumnChart
                height={240}
                partialLast
                currentLabel="Cobrado"
                data={cashIn.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), current: Math.max(0, r.amount) }))}
              />
            </Card>
            <Card className="md:col-span-12 xl:col-span-4">
              <CardHeader title="Métodos de pago" description="Cobrado en el periodo" />
              <BarList rows={k.byMethod.filter((m) => m.amount > 0).map((m) => ({ key: m.key, label: m.name, value: m.amount }))} max={6} emptyText="Sin cobros en el periodo" />
              {k.uncollected > 0 && <p className="mt-4 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-fg-2">Aún sin cobrar del periodo: <span className="font-semibold num">{formatMoney(k.uncollected)}</span></p>}
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle action={<Link to="/facturas" className="text-sm font-medium text-fg-3 hover:text-fg">Facturas →</Link>}>Facturación</SectionTitle>
          <div className="grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
            <Card className="md:col-span-12 xl:col-span-8" padded={false}>
              <div className="flex items-start justify-between p-5 pb-3">
                <CardHeader className="mb-0" title="Pendiente de cobro" description="Facturas emitidas sin cobrar, de la más antigua a la más reciente" />
                <Link to="/facturas?estado=pendiente" className="shrink-0 text-sm font-medium text-fg-3 hover:text-fg">Ver todas →</Link>
              </div>
              {pendingList.length ? (
                <ul>
                  {pendingList.slice(0, 6).map((i) => {
                    const days = i.issueDate ? Math.max(0, Math.round((now.getTime() - new Date(`${i.issueDate}T00:00`).getTime()) / 86_400_000)) : 0;
                    return (
                      <li key={i.id} className="flex items-center gap-4 border-t border-line px-5 py-3 text-sm">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", days > 30 ? "bg-danger-soft text-danger-fg" : "bg-warning-soft text-warning-fg")}><Clock3 className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{i.customerName ?? "Sin cliente"}</span>
                          <span className="block truncate text-xs text-fg-3">{i.number ?? i.externalNumber ?? "Factura"} · {i.issueDate ? formatDate(i.issueDate) : "—"} · {days === 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`}</span>
                        </span>
                        <span className="font-semibold num">{formatMoney(i.total - i.amountPaid)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex items-center gap-3 border-t border-line px-5 py-6 text-sm text-fg-3"><Receipt className="h-4 w-4" />Todo cobrado. No hay facturas pendientes.</div>
              )}
              {pendingList.length > 6 && <Link to="/facturas?estado=pendiente" className="flex items-center gap-1 border-t border-line px-5 py-3 text-sm font-medium text-fg-2 hover:text-fg">Y {pendingList.length - 6} más <ArrowUpRight className="h-3.5 w-3.5" /></Link>}
            </Card>
            <Card className="md:col-span-12 xl:col-span-4">
              <CardHeader title="Facturas del periodo" description={period.label} />
              <dl className="divide-y divide-line text-sm">
                <div className="flex justify-between py-2.5"><dt className="text-fg-3">Emitidas</dt><dd className="font-semibold num">{periodInvoices.length.toLocaleString("es-ES")}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-fg-3">Importe</dt><dd className="font-semibold num">{formatMoney(periodInvoices.reduce((t, i) => t + i.total, 0))}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-fg-3">Cobradas</dt><dd className="font-semibold num">{paidShare === null ? "—" : `${paidShare} %`}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-fg-3">Importe medio</dt><dd className="font-semibold num">{periodInvoices.length ? formatMoney(Math.round(periodInvoices.reduce((t, i) => t + i.total, 0) / periodInvoices.length)) : "—"}</dd></div>
              </dl>
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle action={<Link to="/informes" className="text-sm font-medium text-fg-3 hover:text-fg">Informe para la gestoría →</Link>}>Impuestos</SectionTitle>
          <Card padded={false}>
            <div className="p-5 pb-3"><CardHeader className="mb-0" title="IVA repercutido" description="Por tipo · ventas por fecha de operación, facturas por fecha de emisión" /></div>
            {vatByRate.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-y border-line text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Tipo</th><th className="px-3 py-2 text-right font-medium">Base imponible</th><th className="px-5 py-2 text-right font-medium">Cuota</th></tr></thead>
                  <tbody>
                    {vatByRate.map(([rate, v]) => (
                      <tr key={rate} className="border-b border-line">
                        <td className="px-5 py-3 font-medium">{formatRate(rate)}</td>
                        <td className="px-3 py-3 text-right text-fg-2 num">{formatMoney(v.base)}</td>
                        <td className="px-5 py-3 text-right font-semibold num">{formatMoney(v.tax)}</td>
                      </tr>
                    ))}
                    <tr className="bg-surface-2">
                      <td className="px-5 py-3 font-semibold">Total</td>
                      <td className="px-3 py-3 text-right font-semibold num">{formatMoney(vatByRate.reduce((s, [, v]) => s + v.base, 0))}</td>
                      <td className="px-5 py-3 text-right font-semibold num">{formatMoney(vatTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : <p className="px-5 pb-6 pt-2 text-sm text-fg-3">Sin operaciones con IVA en el periodo.</p>}
            <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-fg-3"><Lock className="h-3.5 w-3.5" />IVA soportado y liquidación (modelo 303) llegarán con el módulo de Gastos. Nunca se muestran cifras estimadas.</p>
          </Card>
        </section>
      </div>
    </Page>
  );
}

/** Línea del extracto: etiqueta, importe y contexto. `soon`: aún sin datos reales (módulo pendiente), nunca estimado. */
function StatementRow({ label, value, extra, soon, to }: { label: string; value?: string; extra?: React.ReactNode; soon?: boolean; to?: string }) {
  const body = (
    <>
      <dt className={cn("text-fg-2", soon && "text-fg-3")}>{label}</dt>
      <dd className="flex items-center gap-2.5">
        {soon ? <span className="inline-flex items-center gap-1.5 text-xs text-fg-3"><Lock className="h-3 w-3" />Con el módulo de Gastos</span> : <>{extra}<span className="text-base font-semibold num">{value}</span></>}
      </dd>
    </>
  );
  return to ? (
    <Link to={to} className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-surface-2">{body}</Link>
  ) : (
    <div className="flex items-center justify-between gap-4 px-6 py-3.5">{body}</div>
  );
}
