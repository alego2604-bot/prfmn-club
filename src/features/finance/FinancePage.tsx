import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock3, FileText, Lock, Receipt } from "lucide-react";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Card, CardHeader, DeltaChip, Page, RangeSelector } from "@/design-system/components";
import { BarList, ColumnChart, Legend } from "@/design-system/components/charts";
import { computeKpis, percentChange } from "@/domain/analytics";
import { buildGestoriaReport } from "@/features/reports/gestoria";
import { addDays, addMonths, capitalize, formatDate, makePeriod, monthName, monthShort, previousPeriod, startOfMonth, toISODate, type PeriodPreset } from "@/lib/dates";
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
  const prev = useMemo(() => previousPeriod(period), [period]);
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
  const collected = k.byMethod.filter((m) => m.key !== "pending").reduce((s, m) => s + m.amount, 0);
  const collectedPrev = kp.byMethod.filter((m) => m.key !== "pending").reduce((s, m) => s + m.amount, 0);
  const pendingList = ws.invoices
    .filter((i) => (i.status === "issued" || i.status === "partially_paid") && (!filterId || !i.locationId || i.locationId === filterId))
    .sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
  const vatTotal = report.vat.reduce((s, v) => s + v.tax, 0);
  const vatByRate = [...report.vat.reduce((m, v) => m.set(v.rateBp, { base: (m.get(v.rateBp)?.base ?? 0) + v.base, tax: (m.get(v.rateBp)?.tax ?? 0) + v.tax }), new Map<number, { base: number; tax: number }>())].sort((a, b) => b[0] - a[0]);

  const figures = [
    { label: "Ingresos", value: formatMoney(k.revenue), delta: percentChange(k.revenue, kp.revenue), note: "IVA incluido" },
    { label: "Cobrado", value: formatMoney(collected), delta: percentChange(collected, collectedPrev), note: "por método de pago" },
    { label: "IVA repercutido", value: formatMoney(vatTotal), delta: null, note: `${report.vat.length ? vatByRate.length : 0} tipo${vatByRate.length === 1 ? "" : "s"} de IVA` },
    { label: "Pendiente de cobro", value: formatMoney(k.pendingInvoices.amount), delta: null, note: `${k.pendingInvoices.count} factura${k.pendingInvoices.count === 1 ? "" : "s"}` },
  ];

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

      <div className="stagger grid gap-4 xl:grid-cols-12 [&>*]:min-w-0">
        {/* Cifras principales: una sola pieza, estilo extracto */}
        <Card className="xl:col-span-12" padded={false}>
          <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            {figures.map((f, i) => (
              <div key={f.label} className={cn("p-6", i % 2 === 1 && "sm:border-l sm:border-line lg:border-l-0", i >= 2 && "sm:border-t sm:border-line lg:border-t-0")}>
                <p className="text-sm font-medium text-fg-2">{f.label}</p>
                <p className={cn("figure mt-2 leading-none", i === 0 ? "text-5xl" : "text-4xl")}>{f.value}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                  {f.delta !== null && <DeltaChip value={f.delta} label="vs anterior" />}
                  <span>{f.note}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-6 py-3 text-sm text-fg-3">
            <Lock className="h-3.5 w-3.5" />
            Gastos, resultado neto y previsión de caja aparecerán al activar el módulo de Gastos. Nunca se muestran cifras estimadas.
          </div>
        </Card>

        <Card className="xl:col-span-8">
          <CardHeader title="Entradas de dinero" description="Cobros por mes (cargos − devoluciones) · últimos 12 meses" action={<Legend items={[{ label: "Cobrado", color: "var(--chart-1)", shape: "bar" }]} />} />
          <ColumnChart
            height={260}
            highlightLast
            currentLabel="Cobrado"
            data={cashIn.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), current: Math.max(0, r.amount) }))}
          />
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Métodos de pago" description="Cobrado en el periodo" />
          <BarList rows={k.byMethod.filter((m) => m.amount > 0).map((m) => ({ key: m.key, label: m.key === "pending" ? "Pendiente de cobro" : m.name, value: m.amount }))} max={6} emptyText="Sin cobros en el periodo" />
        </Card>

        <Card className="xl:col-span-5" padded={false}>
          <div className="p-5 pb-3"><CardHeader className="mb-0" title="IVA repercutido" description="Por tipo · ventas por fecha de operación, facturas por fecha de emisión" /></div>
          {vatByRate.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Tipo</th><th className="px-3 py-2 text-right font-medium">Base imponible</th><th className="px-5 py-2 text-right font-medium">Cuota</th></tr></thead>
              <tbody>
                {vatByRate.map(([rate, v]) => (
                  <tr key={rate} className="border-b border-line last:border-0">
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
          ) : <p className="px-5 pb-8 pt-2 text-sm text-fg-3">Sin operaciones con IVA en el periodo.</p>}
        </Card>

        <Card className="xl:col-span-7" padded={false}>
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
                      <span className="block truncate text-xs text-fg-3">{i.number ?? i.externalNumber ?? "Factura"} · {i.issueDate ? formatDate(i.issueDate) : "—"} · hace {days} días</span>
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
      </div>
    </Page>
  );
}
