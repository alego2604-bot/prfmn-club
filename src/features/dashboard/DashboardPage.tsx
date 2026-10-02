import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Package, Plus, Receipt, Rocket, ScrollText, Store, Upload, Wallet } from "lucide-react";
import { useOnboardingProgress } from "@/features/onboarding/OnboardingWizard";
import { useLocationScope, useSession, useWorkspace } from "@/app/session";
import {
  Badge, Button, Card, CardHeader, DeltaChip, HeroMetric, InsightList, Page, ProgressBar, RangeSelector, Segmented, StatStrip, type StatItem,
} from "@/design-system/components";
import { BarList, ColumnChart, CountTrend, FlowChart, Legend, StackedColumnChart, TrendChart, type TrendPoint } from "@/design-system/components/charts";
import { profitAndLoss, resultSeries } from "@/domain/finance";
import { hasComparableHistory } from "@/domain/expenses";
import { membershipEvolution, membershipSummary } from "@/domain/memberships";
import {
  computeKpis, customerGrowth, customerStats, locationBreakdown, percentChange, recurringSeries, revenueSeries, todayComparison, type Dataset, type Granularity,
} from "@/domain/analytics";
import { buildInsights } from "@/domain/insights";
import { computeAlerts } from "@/domain/alerts";
import { sessionSummary } from "@/data/repos/cash";
import { openSessionFor } from "@/data/repos/sales";
import {
  addDays, addMonths, capitalize, formatDate, formatDateLong, makePeriod, monthName, monthShort, previousPeriod, startOfMonth, toISODate, type Period, type PeriodPreset,
} from "@/lib/dates";
import { formatMoney, NUM } from "@/lib/money";
import { cn } from "@/lib/cn";

type Range = "7d" | "30d" | "90d" | "ytd" | "1y" | "custom";
const RANGES: { value: Exclude<Range, "custom">; label: string; long: string }[] = [
  { value: "7d", label: "7D", long: "Últimos 7 días" },
  { value: "30d", label: "30D", long: "Últimos 30 días" },
  { value: "90d", label: "90D", long: "Últimos 90 días" },
  { value: "ytd", label: "YTD", long: "Año en curso hasta hoy" },
  { value: "1y", label: "1A", long: "Últimos 12 meses" },
];

function defaultGranularity(p: Period): Granularity {
  const days = (p.end.getTime() - p.start.getTime()) / 86_400_000;
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

function pointLabel(d: Date, g: Granularity, short: boolean): string {
  if (g === "month") return capitalize(monthShort(d.getMonth()));
  if (g === "week") return `${d.getDate()} ${monthShort(d.getMonth())}`;
  return short ? capitalize(d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "")) : String(d.getDate());
}
function pointTitle(d: Date, g: Granularity): string {
  if (g === "month") return capitalize(`${monthName(d.getMonth())} ${d.getFullYear()}`);
  if (g === "week") return `Semana del ${d.getDate()} de ${monthName(d.getMonth())}`;
  return capitalize(formatDateLong(d));
}

export default function DashboardPage() {
  const ws = useWorkspace();
  const { user, can } = useSession();
  const { filterId, current } = useLocationScope();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<Range>("30d");
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -29)), end: toISODate(now) });
  const ds: Dataset = ws;

  const period = useMemo(
    () => makePeriod(range as PeriodPreset, now, range === "custom" ? { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) } : undefined),
    [range, now, custom],
  );
  const prev = useMemo(() => previousPeriod(period), [period]);
  const [granOverride, setGranOverride] = useState<Granularity | null>(null);
  const granularity = granOverride ?? defaultGranularity(period);
  const granOptions = useMemo(() => {
    const days = (period.end.getTime() - period.start.getTime()) / 86_400_000;
    return ([["day", "Día"], ["week", "Semana"], ["month", "Mes"]] as const).filter(([g]) => (g === "day" ? days <= 120 : g === "week" ? days >= 14 : days >= 60));
  }, [period]);

  const k = useMemo(() => computeKpis(ds, period, filterId), [ds, period, filterId]);
  const kPrev = useMemo(() => computeKpis(ds, prev, filterId), [ds, prev, filterId]);
  const cust = useMemo(() => customerStats(ds, ws.customers, period, prev, filterId), [ds, ws.customers, period, prev, filterId]);
  const custPrev = useMemo(() => customerStats(ds, ws.customers, prev, previousPeriod(prev), filterId), [ds, ws.customers, prev, filterId]);
  const alerts = useMemo(() => computeAlerts(ws, now, filterId).filter((a) => a.id !== "cash-closed"), [ws, now, filterId]);

  const series = useMemo(() => revenueSeries(ds, period, granularity, filterId), [ds, period, granularity, filterId]);
  const prevSeries = useMemo(() => revenueSeries(ds, prev, granularity, filterId), [ds, prev, granularity, filterId]);
  const daily = useMemo(() => revenueSeries(ds, period, "day", filterId), [ds, period, filterId]);
  const trend: TrendPoint[] = series.map((p, i) => ({
    key: p.key,
    label: pointLabel(p.date, granularity, series.length <= 8),
    tooltipLabel: pointTitle(p.date, granularity),
    current: p.date > now ? null : p.total,
    previous: prevSeries[i]?.total ?? null,
    previousLabel: prevSeries[i] ? pointTitle(prevSeries[i]!.date, granularity).toLowerCase() : undefined,
  }));
  
  const insights = useMemo(() => buildInsights({ k, prev: kPrev, daily, customers: cust, prevLabel: prev.label === "Periodo anterior" ? undefined : prev.label }).slice(0, 4), [k, kPrev, daily, cust, prev.label]);
  const growth = useMemo(() => customerGrowth(ws.customers, now), [ws.customers, now]);
  const recurring = useMemo(() => recurringSeries(ds, now), [ds, now]);
  const recurringNow = recurring.at(-1)?.amount ?? 0;
  const recurringPrev = recurring.at(-2)?.amount ?? 0;
  const hasRecurring = recurring.some((r) => r.amount > 0);

  const yearMonths = useMemo(() => {
    const y = makePeriod("year", now);
    const cur = revenueSeries(ds, y, "month", filterId);
    const before = revenueSeries(ds, previousPeriod(y), "month", filterId);
    return cur.map((m, i) => ({
      key: m.key,
      label: capitalize(monthShort(m.date.getMonth())),
      tooltipLabel: capitalize(`${monthName(m.date.getMonth())} ${m.date.getFullYear()}`),
      current: m.date > now ? 0 : m.total,
      previous: before[i]?.total ?? 0,
      previousLabel: capitalize(`${monthName(m.date.getMonth())} ${m.date.getFullYear() - 1}`),
    }));
  }, [ds, now, filterId]);

  const session = current ? openSessionFor(ws, current.id) : ws.cashSessions.find((s) => s.status === "open" && (!filterId || s.locationId === filterId));
  const cash = session ? sessionSummary(ws, session) : null;
  const empty = ws.sales.length === 0 && ws.invoices.length === 0;
  const prevRange = `${formatDate(prev.start)} – ${formatDate(addDays(prev.end, -1))}`;
  const productPrev = new Map(kPrev.byProduct.map((p) => [p.key, p.amount]));
  const todayCmp = useMemo(() => todayComparison(ds, now, filterId), [ds, now, filterId]);
  const pl = useMemo(() => profitAndLoss(ds, ws.expenses, period, filterId), [ds, ws.expenses, period, filterId]);
  const results12 = useMemo(() => resultSeries(ds, ws.expenses, now, 12, filterId), [ds, ws.expenses, now, filterId]);
  const memSum = useMemo(() => membershipSummary(ws.customerMemberships, { plans: ws.membershipPlans, versions: ws.planVersions, charges: ws.membershipCharges }, { start: toISODate(startOfMonth(now)), end: toISODate(addMonths(startOfMonth(now), 1)) }, toISODate(now), 7, filterId), [ws, now, filterId]);
  const memEvo = useMemo(() => membershipEvolution(ws.customerMemberships, now, 12, filterId), [ws.customerMemberships, now, filterId]);
  const hasMemberships = ws.customerMemberships.length > 0;
  const payable = useMemo(() => { const list = ws.expenses.filter((e) => e.status === "pending" && (!filterId || e.locationId === filterId)); return { count: list.length, amount: list.reduce((t, e) => t + e.total, 0) }; }, [ws.expenses, filterId]);
  const scopeLocations = filterId ? 1 : ws.locations.filter((l) => l.status === "active").length;
  const openSessions = ws.cashSessions.filter((x) => x.status === "open" && (!filterId || x.locationId === filterId)).length;
  const expComparable = hasComparableHistory(ws.expenses, prev.start);
  const byLocation = useMemo(() => (!filterId && ws.locations.length > 1 ? locationBreakdown(ds, ws.locations, period) : []), [ds, ws.locations, period, filterId]);
  // Recurrente (cuotas, por emisión) frente a puntual (caja), 12 meses: IVA incluido, como la facturación
  const split12 = useMemo(() => {
    const p12 = makePeriod("custom", now, { start: addMonths(startOfMonth(now), -11), end: now });
    return revenueSeries(ds, p12, "month", filterId).map((m) => ({
      key: m.key, label: capitalize(monthShort(m.date.getMonth())), tooltipLabel: capitalize(`${monthName(m.date.getMonth())} ${m.date.getFullYear()}`), a: m.invoices, b: m.sales,
    }));
  }, [ds, now, filterId]);
  const split12Total = split12.reduce((t, m) => t + m.a + m.b, 0);
  const recurringShare = split12Total ? Math.round((split12.reduce((t, m) => t + m.a, 0) / split12Total) * 100) : null;

  // Tendencia: por días, la caja (las cuotas se emiten en lote el día 1 y aplastarían la escala). «Todo» siempre disponible.
  const [mode, setMode] = useState<"auto" | "caja" | "todo">("auto");
  const trendMode = mode === "auto" ? (granularity === "day" && k.invoiceRevenue > 0 ? "caja" : "todo") : mode;
  const trendData: TrendPoint[] = trendMode === "caja"
    ? series.map((p, i) => ({ ...trend[i]!, current: p.date > now ? null : p.sales, previous: prevSeries[i]?.sales ?? null }))
    : trend;
  const trendHasData = trendData.some((t) => (t.current ?? 0) > 0 || (t.previous ?? 0) > 0);

  const onboarding = useOnboardingProgress();
  const stats: StatItem[] = [
    { key: "tx", label: "Transacciones", value: k.operations.toLocaleString("es-ES", NUM), delta: percentChange(k.operations, kPrev.operations), spark: weekly(series, now, (p) => p.operations), tooltip: "Ventas individuales de caja. Los resúmenes mensuales importados no cuentan.", onClick: () => navigate("/ventas") },
    { key: "ticket", label: "Ticket medio", value: k.avgTicket !== null ? formatMoney(k.avgTicket) : "—", delta: k.avgTicket !== null && kPrev.avgTicket !== null ? percentChange(k.avgTicket, kPrev.avgTicket) : null, tooltip: "Media de las ventas individuales de caja del periodo." },
    { key: "customers", label: "Clientes activos", value: cust.active.toLocaleString("es-ES", NUM), delta: percentChange(cust.active, custPrev.active), hint: cust.active ? `${cust.firstTimeBuyers.toLocaleString("es-ES", NUM)} nuevos · ${cust.returningBuyers.toLocaleString("es-ES", NUM)} recurrentes` : undefined, tooltip: "Clientes distintos con una venta o factura en el periodo. Nuevos: su primera actividad es de este periodo.", onClick: () => navigate("/clientes") },
    hasMemberships
      ? { key: "members", label: "Membresías activas", value: (memSum.active + memSum.pastDue).toLocaleString("es-ES", NUM), hint: memSum.pastDue ? `${memSum.pastDue} con cuota vencida` : `+${memSum.newInPeriod} / −${memSum.cancelledInPeriod} este mes`, spark: memEvo.map((e) => e.active), onClick: () => navigate("/membresias") }
      : { key: "units", label: "Unidades vendidas", value: k.units.toLocaleString("es-ES", NUM), delta: percentChange(k.units, kPrev.units) },
    hasMemberships
      ? { key: "mrr", label: "MRR", value: formatMoney(memSum.mrr), hint: "mensual · sin IVA", tooltip: "Suma mensualizada (sin IVA) de las cuotas de las membresías vivas.", onClick: () => navigate("/membresias") }
      : hasRecurring
        ? { key: "mrr", label: "Ingresos recurrentes", value: formatMoney(recurringNow), delta: percentChange(recurringNow, recurringPrev), hint: "este mes · sin IVA", spark: recurring.map((r) => r.amount), tooltip: "Base imponible de las cuotas cuyo periodo de servicio cae en el mes en curso (MRR)." }
        : { key: "margin", label: "Resultado", value: formatMoney(pl.result), hint: "sin IVA" },
  ];

  // Empresa recién creada: se abre la puesta en marcha (una vez por pestaña)
  useEffect(() => {
    try {
      if (sessionStorage.getItem("bos.welcome") === ws.organization.id) {
        sessionStorage.removeItem("bos.welcome");
        if (can("settings.manage")) navigate("/bienvenida", { replace: true });
      }
    } catch { /* sin sessionStorage */ }
  }, [ws.organization.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page wide>
      {/* Cabecera */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-fg-3">{capitalize(formatDateLong(now))} · {current ? current.name : ws.locations.length > 1 ? "Todos los centros" : ws.organization.name}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">Hola, {user?.fullName.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeSelector value={range} onChange={(r) => { setRange(r); setGranOverride(null); }} options={RANGES} custom="custom" customValue={custom} onCustomChange={setCustom} />
          {can("pos.sell") && <Link to="/caja"><Button variant="primary" icon={Plus}>Nueva venta</Button></Link>}
        </div>
      </div>

      {!ws.organization.isDemo && can("settings.manage") && !onboarding.finished && !onboarding.dismissed ? <SetupCard {...onboarding} /> : empty && <Onboarding />}

      <div className="stagger grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
        {/* PRINCIPAL · Facturación + tendencia */}
        <Card className="md:col-span-12 xl:col-span-8" padded={false}>
          <div className="flex flex-col gap-5 p-5 pb-2 sm:p-6 sm:pb-2 lg:flex-row lg:items-start lg:justify-between">
            <HeroMetric
              label="Facturación"
              tooltip="Ventas de caja no anuladas + facturas no ligadas a una venta (por fecha de emisión). IVA incluido."
              value={formatMoney(k.revenue)}
              delta={<DeltaChip size="md" value={percentChange(k.revenue, kPrev.revenue)} label={<span title={prevRange}>vs {prev.label === "Periodo anterior" ? "periodo anterior" : prev.label.toLowerCase()}</span>} />}
              sub={<span className="text-sm text-fg-3">{period.label}</span>}
            />
            <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-8 gap-y-1.5 text-sm lg:text-right">
              <dt className="text-fg-3">Caja / TPV</dt><dd className="text-right font-medium num">{formatMoney(k.salesRevenue)}</dd>
              <dt className="text-fg-3">Cuotas y facturas</dt><dd className="text-right font-medium num">{formatMoney(k.invoiceRevenue)}</dd>
              <dt className="text-fg-3">Gastos</dt><dd className="text-right font-medium num">{pl.hasExpenses ? `−${formatMoney(pl.expensesGross)}` : <Link to="/gastos" className="text-accent-fg hover:underline">Registrar</Link>}</dd>
              <dt className="border-t border-line pt-1.5 font-medium text-fg-2">Resultado <span className="font-normal text-fg-3">sin IVA</span></dt>
              <dd className={cn("border-t border-line pt-1.5 text-right font-semibold num", pl.result < 0 && "text-danger-fg")}>{formatMoney(pl.result)}{pl.margin !== null && pl.hasExpenses ? <span className="ml-1.5 text-xs font-normal text-fg-3">{Math.round(pl.margin * 100)} %</span> : null}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3 sm:px-6">
            <Legend items={[{ label: trendMode === "caja" ? `Caja · ${period.label.toLowerCase()}` : period.label, color: "var(--chart-1)" }, { label: prev.label === "Periodo anterior" ? "Periodo anterior" : prev.label, color: "var(--chart-2)", dashed: true }]} />
            <div className="flex flex-wrap items-center gap-2">
              {k.invoiceRevenue > 0 && (
                <Segmented size="sm" value={trendMode} onChange={(m) => setMode(m)} items={[{ value: "caja", label: "Caja" }, { value: "todo", label: "Todo" }]} />
              )}
              {granOptions.length > 1 && (
                <Segmented size="sm" value={granularity} onChange={(g) => setGranOverride(g)} items={granOptions.map(([value, label]) => ({ value, label }))} />
              )}
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 sm:px-4">
            {trendHasData ? (
              <TrendChart data={trendData} currentLabel={period.label} previousLabel={prev.label} height={320} />
            ) : (
              <div className="flex h-[260px] flex-col items-center justify-center text-center">
                <p className="text-sm font-medium">Sin facturación en este periodo</p>
                <p className="mt-1 text-sm text-fg-3">Elige un periodo más amplio o registra tu primera venta.</p>
              </div>
            )}
            {trendMode === "caja" && (
              <p className="px-2 pb-1 text-xs text-fg-3">Ventas de caja. Las cuotas se emiten en lote a principio de mes: míralas en «Todo» o en «Recurrente frente a puntual».</p>
            )}
          </div>
        </Card>

        {/* OPERATIVA · Hoy + atención */}
        <div className="grid gap-4 md:col-span-12 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1 [&>*]:min-w-0">
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-fg-2">Caja de hoy</p>
              {session ? <Badge tone="success" dot>Caja abierta</Badge> : <Badge dot>Caja cerrada</Badge>}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="figure text-4xl leading-none">{formatMoney(todayCmp.today)}</p>
                <div className="mt-2.5 text-xs">
                  {todayCmp.reference !== null
                    ? <DeltaChip value={percentChange(todayCmp.today, todayCmp.reference)} label={`vs ${todayCmp.referenceLabel} (${formatMoney(todayCmp.reference)})`} />
                    : <span className="text-fg-3">Sin referencia comparable ({todayCmp.referenceLabel} no hubo ventas)</span>}
                </div>
              </div>
              <div className="shrink-0 text-right text-sm">
                <p className="font-semibold num">{todayCmp.operations.toLocaleString("es-ES", NUM)}</p>
                <p className="text-xs text-fg-3">ventas</p>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-line rounded-lg bg-surface-sunken/70 px-3.5 text-sm">
              <div className="flex items-center justify-between py-2.5"><dt className="flex items-center gap-2 text-fg-2"><Wallet className="h-4 w-4 text-fg-3" />Efectivo en caja</dt><dd className="font-semibold num">{cash ? formatMoney(cash.expectedCash) : "—"}</dd></div>
              <button type="button" onClick={() => navigate("/facturas?estado=pendiente")} className="flex w-full items-center justify-between py-2.5 text-left"><dt className="flex items-center gap-2 text-fg-2"><Receipt className="h-4 w-4 text-fg-3" />Pendiente de cobro</dt><dd className="font-semibold num">{formatMoney(k.pendingInvoices.amount)}{k.pendingInvoices.count ? <span className="ml-1.5 text-xs font-normal text-fg-3">{k.pendingInvoices.count} fact.</span> : null}</dd></button>
              <button type="button" onClick={() => navigate("/gastos?estado=pending")} className="flex w-full items-center justify-between py-2.5 text-left"><dt className="flex items-center gap-2 text-fg-2"><ScrollText className="h-4 w-4 text-fg-3" />Pagos pendientes</dt><dd className="font-semibold num">{formatMoney(payable.amount)}{payable.count ? <span className="ml-1.5 text-xs font-normal text-fg-3">{payable.count} gastos</span> : null}</dd></button>
              <button type="button" onClick={() => navigate("/cierres")} className="flex w-full items-center justify-between py-2.5 text-left"><dt className="flex items-center gap-2 text-fg-2"><Store className="h-4 w-4 text-fg-3" />Cajas abiertas</dt><dd className="font-semibold num">{openSessions}<span className="ml-1.5 text-xs font-normal text-fg-3">de {scopeLocations}</span></dd></button>
            </dl>
            {can("pos.sell") && (
              <Link to="/caja" className="mt-3 flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-sm font-medium transition-colors hover:border-line-strong hover:bg-surface-2">
                <Store className="h-4 w-4" />{session ? "Ir a la caja" : "Abrir caja"}
              </Link>
            )}
          </Card>

          <Card className="xl:flex-1">
            <CardHeader className="mb-2" title="Requiere atención" action={alerts.length ? <span className="text-xs font-medium text-fg-3 num">{alerts.length}</span> : undefined} />
            {alerts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-success-soft px-3.5 py-3 text-sm text-success-fg"><CheckCircle2 className="h-4 w-4 shrink-0" />Todo en orden. Nada pendiente ahora mismo.</div>
            ) : (
              <ul className="-mx-2">
                {alerts.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => navigate(a.to)} className="group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-2">
                      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", a.severity === "danger" ? "bg-danger-soft text-danger-fg" : a.severity === "warning" ? "bg-warning-soft text-warning-fg" : "bg-surface-sunken text-fg-2")}>
                        {a.severity === "info" ? <CircleDot className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">{a.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-fg-3">{a.reason}</span>
                      </span>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-fg-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {alerts.length > 3 && <Link to="/seguimiento" className="mt-1 block text-sm font-medium text-fg-3 hover:text-fg">Ver los {alerts.length} avisos →</Link>}
          </Card>
        </div>

        {/* SECUNDARIOS */}
        <StatStrip className="md:col-span-12" items={stats} />

        {/* Ingresos frente a gastos + lectura */}
        <Card className="md:col-span-12 xl:col-span-8">
          <CardHeader
            title="Ingresos frente a gastos"
            description={pl.hasExpenses ? `Por mes · sin IVA · últimos 12 meses${expComparable ? "" : " · los gastos empiezan a registrarse en esta serie"}` : "Por mes · sin IVA · registra tus gastos para ver el resultado real"}
            action={<Legend items={[{ label: "Ingresos", color: "var(--chart-1)", shape: "bar" }, { label: "Gastos", color: "var(--chart-out)", shape: "bar" }, { label: "Resultado", color: "var(--text)" }]} />}
          />
          <FlowChart partialLast height={240} inLabel="Ingresos" outLabel="Gastos" netLabel="Resultado" data={results12.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), inflow: r.revenue, outflow: r.expenses, net: r.result }))} />
        </Card>
        <Card className="md:col-span-12 xl:col-span-4">
          <CardHeader title="Lo que dicen tus datos" description={`${period.label} frente a ${prev.label === "Periodo anterior" ? "el periodo anterior" : prev.label.toLowerCase()}`} />
          <InsightList items={insights} />
        </Card>

        {/* Recurrente frente a puntual + membresías */}
        <Card className={cn("md:col-span-12", hasMemberships && "xl:col-span-7")}>
          <CardHeader
            title="Recurrente frente a puntual"
            description={`Cuotas y facturas frente a caja · IVA incluido · 12 meses${recurringShare !== null ? ` · ${recurringShare} % recurrente` : ""}`}
            action={<Legend items={[{ label: "Cuotas y facturas", color: "var(--chart-1)", shape: "bar" }, { label: "Caja", color: "var(--chart-1-mid)", shape: "bar" }]} />}
          />
          {split12Total ? <StackedColumnChart data={split12} aLabel="Cuotas y facturas" bLabel="Caja" height={220} partialLast /> : <p className="py-16 text-center text-sm text-fg-3">Sin facturación en los últimos 12 meses</p>}
        </Card>
        {hasMemberships && (
          <Card className="md:col-span-12 xl:col-span-5">
            <CardHeader title="Membresías" description="Activas al cierre de cada mes · 12 meses" action={<Link to="/membresias" className="text-sm font-medium text-fg-3 hover:text-fg">Ver →</Link>} />
            <div className="mb-3 flex items-baseline gap-4">
              <p className="figure text-3xl leading-none">{(memSum.active + memSum.pastDue).toLocaleString("es-ES", NUM)}</p>
              <p className="text-xs text-fg-3">MRR {formatMoney(memSum.mrr)} · {memSum.paused} en pausa</p>
            </div>
            <CountTrend label="activas" height={170} data={memEvo.map((e) => ({ key: toISODate(e.date), label: capitalize(monthShort(e.date.getMonth())), tooltipLabel: capitalize(`${monthName(e.date.getMonth())} ${e.date.getFullYear()}`), value: e.active, sub: `+${e.added} altas · −${e.cancelled} bajas` }))} />
          </Card>
        )}

        {/* Mix */}
        <Card className="md:col-span-6 xl:col-span-4">
          <CardHeader title="Ingresos por categoría" description="Ventas de caja del periodo" />
          <BarList rows={k.byCategory.filter((c) => c.id !== "invoices").map((c) => ({ key: c.id, label: c.name, value: c.amount }))} max={6} emptyText="Sin ventas de caja en este periodo" />
        </Card>
        <Card className="md:col-span-6 xl:col-span-4">
          <CardHeader title="Métodos de pago" description="Cobrado en el periodo" />
          <BarList rows={k.byMethod.filter((m) => m.amount > 0).map((m) => ({ key: m.key, label: m.name, value: m.amount }))} max={5} emptyText="Sin cobros en este periodo" />
          {k.uncollected > 0 && (
            <button type="button" onClick={() => navigate("/facturas?estado=pendiente")} className="mt-4 flex w-full items-center justify-between rounded-lg border border-dashed border-line-strong px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2">
              <span className="text-fg-2">Aún sin cobrar del periodo</span>
              <span className="font-semibold num">{formatMoney(k.uncollected)}</span>
            </button>
          )}
        </Card>
        <Card className="md:col-span-12 xl:col-span-4">
          <CardHeader title="Clientes" description="Altas por mes · últimos 12 meses" />
          <div className="grid grid-cols-3 gap-3">
            <div><p className="figure text-2xl leading-none">{(growth.at(-1)?.total ?? 0).toLocaleString("es-ES", NUM)}</p><p className="mt-1.5 text-xs text-fg-3">en total</p></div>
            <div><p className="text-xl font-semibold leading-none num">{cust.firstTimeBuyers.toLocaleString("es-ES", NUM)}</p><p className="mt-1.5 text-xs text-fg-3">nuevos activos</p></div>
            <div><p className="text-xl font-semibold leading-none num">{cust.returningBuyers.toLocaleString("es-ES", NUM)}</p><p className="mt-1.5 text-xs text-fg-3">recurrentes</p></div>
          </div>
          <div className="mt-4">
            <ColumnChart
              height={140}
              partialLast
              currentLabel="Altas"
              format={(v) => `${v.toLocaleString("es-ES", NUM)} altas`}
              axisFormat={(v) => String(v)}
              data={growth.map((g) => ({ key: toISODate(g.date), label: capitalize(monthShort(g.date.getMonth())).slice(0, 1), tooltipLabel: capitalize(`${monthName(g.date.getMonth())} ${g.date.getFullYear()}`), current: g.added }))}
            />
          </div>
        </Card>

        {/* Productos + centros / año */}
        <Card className="md:col-span-12 xl:col-span-8" padded={false}>
          <div className="flex items-start justify-between gap-3 p-5 pb-3">
            <CardHeader className="mb-0" title="Rendimiento de productos" description="Por facturación en el periodo, con variación frente al anterior" />
            <Link to="/catalogo" className="shrink-0 text-sm font-medium text-fg-3 hover:text-fg">Catálogo →</Link>
          </div>
          {k.byProduct.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line text-xs text-fg-3">
                    <th className="px-5 py-2 text-left font-medium">Producto</th>
                    <th className="px-3 py-2 text-right font-medium">Uds</th>
                    <th className="hidden w-[30%] px-3 py-2 text-left font-medium sm:table-cell">Peso</th>
                    <th className="px-3 py-2 text-right font-medium">Variación</th>
                    <th className="px-5 py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {k.byProduct.slice(0, 6).map((p) => {
                    const share = k.salesRevenue ? p.amount / k.salesRevenue : 0;
                    const before = productPrev.get(p.key);
                    return (
                      <tr key={p.key} className="border-b border-line transition-colors last:border-0 hover:bg-surface-2">
                        <td className="max-w-[140px] truncate px-5 py-3 font-medium sm:max-w-[220px]">{p.name}</td>
                        <td className="px-3 py-3 text-right text-fg-2 num">{p.units.toLocaleString("es-ES", NUM)}</td>
                        <td className="hidden px-3 py-3 sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(2, share * 100)}%` }} /></div>
                            <span className="w-9 text-right text-xs text-fg-3 num">{Math.round(share * 100)} %</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">{before ? <DeltaChip value={percentChange(p.amount, before)} /> : <span className="text-xs text-fg-3">Nuevo</span>}</td>
                        <td className="px-5 py-3 text-right font-semibold num">{formatMoney(p.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 pb-8 pt-4 text-center">
              <p className="text-sm font-medium">Sin ventas de productos en este periodo</p>
              <p className="mt-1 text-sm text-fg-3">Cuando vendas desde Caja verás aquí qué funciona y qué no.</p>
            </div>
          )}
        </Card>
        {byLocation.length > 1 ? (
          <Card className="md:col-span-12 xl:col-span-4">
            <CardHeader title="Comparativa de centros" description={`Facturación · ${period.label.toLowerCase()}`} />
            <BarList rows={byLocation.map((l) => ({ key: l.id, label: l.name, value: l.revenue, sub: `${l.operations} ventas` }))} />
            <p className="mt-4 text-xs text-fg-3">Elige un centro arriba para ver solo sus cifras.</p>
          </Card>
        ) : (
          <Card className="md:col-span-12 xl:col-span-4">
            <CardHeader
              title={`${now.getFullYear()} frente a ${now.getFullYear() - 1}`}
              description="Facturación mensual"
              action={<Legend items={[{ label: String(now.getFullYear()), color: "var(--chart-1)", shape: "bar" }, { label: String(now.getFullYear() - 1), color: "var(--chart-2-bar)", shape: "bar" }]} />}
            />
            <ColumnChart data={yearMonths} currentLabel={String(now.getFullYear())} previousLabel={String(now.getFullYear() - 1)} height={200} />
          </Card>
        )}
      </div>
    </Page>
  );
}

function SetupCard({ doneCount, total }: { doneCount: number; total: number }) {
  return (
    <Card className="mb-6 overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><Rocket className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Termina de preparar tu empresa</p>
          <p className="mt-0.5 text-sm text-fg-3">{doneCount} de {total} pasos: datos fiscales, centros, equipo, cobros, productos, tarifas e importación.</p>
          <ProgressBar className="mt-3 max-w-md" value={doneCount} max={total} label="Puesta en marcha" />
        </div>
        <Link to="/bienvenida"><Button variant="primary" iconRight={ArrowRight}>Continuar</Button></Link>
      </div>
    </Card>
  );
}

/** Miniatura semanal (la diaria es ruido a ese tamaño). */
function weekly(series: { date: Date; operations: number; total: number }[], now: Date, pick: (p: { operations: number; total: number }) => number): number[] {
  const past = series.filter((p) => p.date <= now);
  if (past.length <= 14) return past.map(pick);
  const out: number[] = [];
  for (let i = 0; i < past.length; i += 7) out.push(past.slice(i, i + 7).reduce((t, p) => t + pick(p), 0));
  return out;
}

function Onboarding() {
  return (
    <Card className="mb-6 overflow-hidden p-0">
      <div className="grid md:grid-cols-[1.3fr_1fr]">
        <div className="p-6 sm:p-8">
          <Badge tone="accent">Primeros pasos</Badge>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">Trae tu negocio a Business OS</h2>
          <p className="mt-1.5 max-w-lg text-sm text-fg-3">Importa tus Excel actuales o empieza desde cero. El sistema detecta hojas, columnas, duplicados y errores, y te enseña todo antes de guardar.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/importaciones/nueva"><Button variant="primary" icon={Upload}>Importar Excel o CSV</Button></Link>
            <Link to="/catalogo?nuevo=1"><Button icon={Package}>Crear producto</Button></Link>
          </div>
        </div>
        <ol className="hidden border-l border-line bg-surface-2 p-6 md:block">
          {[
            ["Catálogo y precios", Package],
            ["Primera venta en Caja", Store],
            ["Facturas, clientes e IVA", Receipt],
            ["Informe para la gestoría", Upload],
          ].map(([t], i) => (
            <li key={String(t)} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold num">{i + 1}</span>
              {String(t)}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
