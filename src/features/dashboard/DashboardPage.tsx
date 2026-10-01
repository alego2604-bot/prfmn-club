import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Banknote, CalendarRange, CreditCard, FileText, Info, Package, Plus, Receipt, ShoppingBag, Smartphone,
  Store, Ticket, Upload, Users, Wallet,
} from "lucide-react";
import { useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, Card, CardHeader, Delta, EmptyState, Input, Kpi, Page, Segmented, SectionTitle } from "@/design-system/components";
import { BarList, CompareArea, CompareBars, Legend } from "@/design-system/components/charts";
import { best, computeKpis, membershipStats, percentChange, revenueSeries, type Dataset } from "@/domain/analytics";
import { computeAlerts } from "@/domain/alerts";
import { sessionSummary } from "@/data/repos/cash";
import { openSessionFor } from "@/data/repos/sales";
import {
  addDays, capitalize, formatDate, formatDateLong, formatDateShort, makePeriod, monthName, monthShort, previousPeriod, toDateClamp, toISODate,
  yearAgoPeriod, type PeriodPreset,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "month", label: "Mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Año" },
  { value: "custom", label: "Personalizado" },
];

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export default function DashboardPage() {
  const ws = useWorkspace();
  const { user, can } = useSession();
  const { filterId, current } = useLocationScope();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -29)), end: toISODate(now) });

  const ds: Dataset = ws;
  const period = useMemo(
    () => makePeriod(preset, now, preset === "custom" ? { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) } : undefined),
    [preset, now, custom],
  );
  const prev = useMemo(() => {
    const p = previousPeriod(period);
    // Comparación justa en periodos en curso: mismos días transcurridos
    if (["month", "quarter", "year"].includes(preset) && period.end > now) {
      const elapsed = toDateClamp(period, now).end.getTime() - period.start.getTime();
      return { ...p, end: new Date(p.start.getTime() + elapsed) };
    }
    return p;
  }, [period, preset, now]);
  const yoy = useMemo(() => {
    const y = yearAgoPeriod(period);
    return period.end > now ? { ...y, end: yearAgoPeriod(toDateClamp(period, now)).end } : y;
  }, [period, now]);

  const today = useMemo(() => computeKpis(ds, makePeriod("today", now), filterId), [ds, now, filterId]);
  const yesterday = useMemo(() => computeKpis(ds, makePeriod("today", addDays(now, -1)), filterId), [ds, now, filterId]);
  const k = useMemo(() => computeKpis(ds, period, filterId), [ds, period, filterId]);
  const kPrev = useMemo(() => computeKpis(ds, prev, filterId), [ds, prev, filterId]);
  const kYoy = useMemo(() => computeKpis(ds, yoy, filterId), [ds, yoy, filterId]);
  const alerts = useMemo(() => computeAlerts(ws, now, filterId), [ws, now, filterId]);

  const dayGranularity = period.end.getTime() - period.start.getTime() <= 93 * 86_400_000;
  const series = useMemo(() => revenueSeries(ds, period, dayGranularity ? "day" : "month", filterId), [ds, period, dayGranularity, filterId]);
  const prevSeries = useMemo(() => revenueSeries(ds, previousPeriod(period), dayGranularity ? "day" : "month", filterId), [ds, period, dayGranularity, filterId]);
  const chartData = series.map((p, i) => ({
    label: dayGranularity ? (series.length <= 8 ? capitalize(p.date.toLocaleDateString("es-ES", { weekday: "short" })) : String(p.date.getDate())) : capitalize(monthShort(p.date.getMonth())),
    tooltipLabel: dayGranularity ? capitalize(formatDateLong(p.date)) : capitalize(`${monthName(p.date.getMonth())} ${p.date.getFullYear()}`),
    current: p.date > now ? (null as unknown as number) : p.total,
    previous: prevSeries[i]?.total ?? null,
  }));

  // Año natural del periodo
  const yearStart = new Date(period.start.getFullYear(), 0, 1);
  const yearP = useMemo(() => ({ preset: "year" as const, start: yearStart, end: new Date(yearStart.getFullYear() + 1, 0, 1), label: String(yearStart.getFullYear()) }), [yearStart.getFullYear()]); // eslint-disable-line react-hooks/exhaustive-deps
  const kYear = useMemo(() => computeKpis(ds, yearP, filterId), [ds, yearP, filterId]);
  const months = useMemo(() => revenueSeries(ds, yearP, "month", filterId), [ds, yearP, filterId]);
  const monthsPrev = useMemo(() => revenueSeries(ds, previousPeriod(yearP), "month", filterId), [ds, yearP, filterId]);
  const days = useMemo(() => revenueSeries(ds, yearP, "day", filterId), [ds, yearP, filterId]);
  const bestMonth = best(months, (m) => m.total);
  const bestDay = best(days, (d) => d.txSales);
  const ms = useMemo(() => membershipStats(ds, new Date(period.start.getFullYear(), period.start.getMonth(), 1), now), [ds, period, now]);

  const session = current ? openSessionFor(ws, current.id) : ws.cashSessions.find((s) => s.status === "open" && (!filterId || s.locationId === filterId));
  const cash = session ? sessionSummary(ws, session) : null;
  const empty = ws.sales.length === 0 && ws.invoices.length === 0;
  const method = (key: string) => today.byMethod.find((m) => m.key === key)?.amount ?? 0;
  const categoryAmount = (re: RegExp) => k.byCategory.filter((c) => re.test(c.name.toLowerCase())).reduce((s, c) => s + c.amount, 0);

  return (
    <Page>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-3">{capitalize(formatDateLong(now))}{current ? ` · ${current.name}` : ws.locations.length > 1 ? " · Todos los centros" : ""}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{greeting(now)}, {user?.fullName.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("imports.run") && <Link to="/importaciones/nueva"><Button icon={Upload}>Importar</Button></Link>}
          {can("analytics.view") && <Link to="/informes"><Button icon={FileText}>Informe</Button></Link>}
          {can("pos.sell") && <Link to="/caja"><Button variant="primary" icon={Plus}>Nueva venta</Button></Link>}
        </div>
      </div>

      {empty && (
        <Card className="mb-8 overflow-hidden p-0">
          <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
            <div className="p-6 sm:p-8">
              <Badge tone="accent">Primeros pasos</Badge>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">Trae tu negocio a PRFMN Club</h2>
              <p className="mt-1.5 text-sm text-fg-3">Importa tus Excel actuales (caja anual y facturas trimestrales). El sistema detecta hojas, columnas, duplicados y errores, y te enseña todo antes de guardar.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/importaciones/nueva"><Button variant="primary" icon={Upload}>Importar Excel o CSV</Button></Link>
                <Link to="/catalogo?nuevo=1"><Button icon={Package}>Crear producto</Button></Link>
              </div>
            </div>
            <div className="hidden border-l border-line bg-surface-2 p-6 md:block">
              {["Catálogo y precios", "Ventas por día (sin hojas por mes)", "Facturas, clientes e IVA", "Informe para la gestoría"].map((t, i) => (
                <div key={t} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold num">{i + 1}</span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- HOY */}
      <SectionTitle action={<span className="text-xs text-fg-3">vs ayer</span>}>Hoy</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          emphasis
          label="Facturación hoy"
          icon={Receipt}
          value={formatMoney(today.revenue)}
          delta={<Delta value={percentChange(today.revenue, yesterday.revenue)} label={`ayer ${formatMoney(yesterday.revenue, { compact: true })}`} />}
        />
        <Kpi label="Operaciones" icon={ShoppingBag} value={today.operations.toLocaleString("es-ES")} hint={`${today.units.toLocaleString("es-ES")} uds vendidas`} delta={<Delta value={percentChange(today.operations, yesterday.operations)} />} />
        <Kpi label="Ticket medio" icon={Ticket} value={today.avgTicket !== null ? formatMoney(today.avgTicket) : "—"} hint={today.dropIns.units ? `${today.dropIns.units} drop-ins` : "Sin drop-ins"} />
        <div className="flex flex-col rounded-lg border border-line bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between text-sm text-fg-3">
            <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />Caja</span>
            {session ? <Badge tone="success" dot>Abierta</Badge> : <Badge dot>Cerrada</Badge>}
          </div>
          {cash ? (
            <>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight num">{formatMoney(cash.expectedCash)}</p>
              <p className="mt-1.5 text-xs text-fg-3">efectivo esperado · {cash.salesCount} ventas en el turno</p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg-3">—</p>
              {can("pos.sell") && <Link to="/caja" className="mt-1.5 text-xs font-medium text-accent-fg hover:underline">Abrir caja →</Link>}
            </>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Tarjeta", icon: CreditCard, v: method("card") },
          { label: "Efectivo", icon: Banknote, v: method("cash") },
          { label: "Bizum", icon: Smartphone, v: method("bizum") },
          { label: "TPV online", icon: Store, v: method("online") },
        ].map((m) => (
          <div key={m.label} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
            <span className="flex items-center gap-2 text-sm text-fg-3"><m.icon className="h-4 w-4" />{m.label}</span>
            <span className="text-md font-semibold num">{formatMoney(m.v)}</span>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------- ATENCIÓN */}
      {alerts.filter((a) => a.id !== "cash-closed").length > 0 && (
        <div className="mt-8">
          <SectionTitle>Necesita tu atención</SectionTitle>
          <div className="grid gap-2 md:grid-cols-2">
            {alerts.filter((a) => a.id !== "cash-closed").slice(0, 4).map((a) => (
              <button key={a.id} onClick={() => navigate(a.to)} className="group flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-left shadow-xs transition-colors hover:border-line-strong">
                <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", a.severity === "danger" ? "bg-danger-soft text-danger-fg" : a.severity === "warning" ? "bg-warning-soft text-warning-fg" : "bg-accent-soft text-accent-fg")}>
                  {a.severity === "info" ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-fg-3">{a.reason}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- PERIODO */}
      <div className="mt-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{period.label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={preset} onChange={setPreset} items={PRESETS} size="sm" />
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="w-[150px]" />
              <span className="text-fg-3">–</span>
              <Input type="date" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="w-[150px]" />
            </div>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-fg-3">
        Comparado con {prev.label.toLowerCase()} ({formatDate(prev.start)} – {formatDate(addDays(prev.end, -1))}){period.end > now ? ", mismos días transcurridos" : ""} y con el mismo periodo del año anterior.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          emphasis
          className="col-span-2"
          label="Facturación"
          tooltip="Ventas de caja (no anuladas) + facturas de cuotas no ligadas a una venta, por fecha de emisión. IVA incluido."
          value={formatMoney(k.revenue)}
          delta={
            <>
              <Delta value={percentChange(k.revenue, kPrev.revenue)} label="vs anterior" />
              <Delta value={percentChange(k.revenue, kYoy.revenue)} label="vs año anterior" />
            </>
          }
          footer={
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-fg-3">Caja / TPV</p><p className="font-semibold num">{formatMoney(k.salesRevenue)}</p></div>
              <div><p className="text-xs text-fg-3">Cuotas y bonos (facturas)</p><p className="font-semibold num">{formatMoney(k.invoiceRevenue)}</p></div>
            </div>
          }
        />
        <Kpi label="Nº de ventas" value={k.operations.toLocaleString("es-ES")} delta={<Delta value={percentChange(k.operations, kPrev.operations)} />} tooltip="Operaciones individuales. Los resúmenes mensuales importados no cuentan." hint={k.hasAggregates ? "excluye resúmenes" : undefined} />
        <Kpi label="Ticket medio" value={k.avgTicket !== null ? formatMoney(k.avgTicket) : "—"} delta={<Delta value={k.avgTicket !== null && kPrev.avgTicket !== null ? percentChange(k.avgTicket, kPrev.avgTicket) : null} />} />
        <Kpi label="Drop-ins" value={k.dropIns.units.toLocaleString("es-ES")} hint={formatMoney(k.dropIns.amount)} delta={<Delta value={percentChange(k.dropIns.units, kPrev.dropIns.units)} />} />
        <Kpi label="Suplementación" value={formatMoney(categoryAmount(/suplement/))} delta={<Delta value={percentChange(categoryAmount(/suplement/), kPrev.byCategory.filter((c) => /suplement/.test(c.name.toLowerCase())).reduce((s, c) => s + c.amount, 0))} />} />
        <Kpi label="Retail / merchandising" value={formatMoney(categoryAmount(/merch|ropa|retail|textil/))} />
        <Kpi label="IVA repercutido" value={formatMoney(k.vatCollected)} tooltip="Cuota de IVA de ventas y facturas del periodo" />
      </div>

      {ms.available && ["month", "today", "7d", "30d"].includes(preset) && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Membresías activas" icon={Users} value={ms.activeMembers.toLocaleString("es-ES")} tooltip="Clientes con una cuota cuyo periodo de servicio empieza este mes" />
          <Kpi label="MRR (sin IVA)" value={formatMoney(ms.mrr)} hint={ms.avgFee ? `ARPU ${formatMoney(ms.avgFee)}` : undefined} tooltip="Suma de la base imponible de las cuotas del mes" />
          <Kpi label="Nuevas altas" value={ms.newMembers.toLocaleString("es-ES")} tooltip="Primera cuota registrada en este mes" />
          <Kpi label="Bajas" value={ms.churned === null ? "—" : ms.churned.toLocaleString("es-ES")} tooltip="Clientes con cuota el mes anterior y sin cuota este mes. Se calcula al terminar el mes." hint={ms.churned === null ? "al cerrar el mes" : undefined} />
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Evolución"
            description={dayGranularity ? "Facturación diaria" : "Facturación mensual"}
            action={<Legend items={[{ label: period.label, color: "var(--chart-1)" }, { label: "Periodo anterior", color: "var(--text-3)", dashed: true }]} />}
          />
          {k.revenue || kPrev.revenue ? <CompareArea data={chartData} currentLabel={period.label} previousLabel="Periodo anterior" /> : <EmptyState compact icon={CalendarRange} title="Sin actividad en este periodo" description="Elige otro periodo o importa tus datos históricos." />}
          {k.hasUnknownTime && <p className="mt-3 text-xs text-fg-3">Incluye ventas importadas sin hora real (solo fecha).</p>}
        </Card>
        <Card>
          <CardHeader title="Mix por categoría" description="Facturación del periodo" />
          <BarList rows={k.byCategory.map((c) => ({ key: c.id, label: c.name, value: c.amount }))} max={6} />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-3"><CardHeader className="mb-0" title="Productos más vendidos" description="Por facturación en el periodo" /></div>
          {k.byProduct.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line bg-surface-2 text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Producto</th><th className="px-3 py-2 text-right font-medium">Uds</th><th className="px-5 py-2 text-right font-medium">Importe</th></tr></thead>
              <tbody>
                {k.byProduct.slice(0, 7).map((p, i) => (
                  <tr key={p.key} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5"><span className="mr-2 inline-block w-4 text-xs text-fg-3 num">{i + 1}</span>{p.name}</td>
                    <td className="px-3 py-2.5 text-right text-fg-2 num">{p.units.toLocaleString("es-ES")}</td>
                    <td className="px-5 py-2.5 text-right font-medium num">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-5 pb-6 text-sm text-fg-3">Sin ventas en este periodo.</p>}
        </Card>
        <Card>
          <CardHeader title="Métodos de pago" description="Cobrado en el periodo" />
          <BarList rows={k.byMethod.map((m) => ({ key: m.key, label: m.name, value: m.amount }))} />
          {k.pendingInvoices.count > 0 && (
            <Link to="/facturas?estado=pendiente" className="mt-4 flex items-center justify-between rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">
              <span>{k.pendingInvoices.count} pendientes de cobro</span>
              <span className="font-semibold num">{formatMoney(k.pendingInvoices.amount)}</span>
            </Link>
          )}
        </Card>
      </div>

      {/* ---------------------------------------------------------- AÑO */}
      <div className="mt-10">
        <SectionTitle>Año {yearStart.getFullYear()}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Kpi className="col-span-2" label="Facturación acumulada" value={formatMoney(kYear.revenue)} hint={`Media ${formatMoney(Math.round(kYear.revenue / Math.max(1, months.filter((m) => m.total > 0).length)))}/mes activo`} />
          <Kpi label="Mejor mes" value={bestMonth ? capitalize(monthName(bestMonth.date.getMonth())) : "—"} hint={bestMonth ? formatMoney(bestMonth.total) : undefined} />
          <Kpi label="Mejor día (caja)" value={bestDay ? formatDateShort(bestDay.date) : "—"} hint={bestDay ? formatMoney(bestDay.txSales) : undefined} />
          <Kpi label="Top producto" value={<span className="text-lg">{kYear.byProduct[0]?.name ?? "—"}</span>} hint={kYear.byProduct[0] ? formatMoney(kYear.byProduct[0].amount) : undefined} />
          <Kpi label="Top categoría" value={<span className="text-lg">{kYear.byCategory[0]?.name ?? "—"}</span>} hint={kYear.byCategory[0] ? formatMoney(kYear.byCategory[0].amount) : undefined} />
        </div>
        <Card className="mt-3">
          <CardHeader
            title="Evolución mensual"
            description={`${yearStart.getFullYear()} frente a ${yearStart.getFullYear() - 1}`}
            action={<Legend items={[{ label: String(yearStart.getFullYear()), color: "var(--chart-1)" }, { label: String(yearStart.getFullYear() - 1), color: "var(--chart-2)" }]} />}
          />
          <CompareBars
            data={months.map((m, i) => ({ label: capitalize(monthShort(m.date.getMonth())), tooltipLabel: capitalize(monthName(m.date.getMonth())), current: m.total, previous: monthsPrev[i]?.total ?? 0 }))}
            currentLabel={String(yearStart.getFullYear())}
            previousLabel={String(yearStart.getFullYear() - 1)}
          />
        </Card>
      </div>
    </Page>
  );
}
