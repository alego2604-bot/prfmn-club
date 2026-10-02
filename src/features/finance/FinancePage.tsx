import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, CircleDollarSign, Clock3, FileText, Plus, Receipt, ScrollText } from "lucide-react";
import { useLocationScope, useSession, useWorkspace } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Amount, Button, Card, CardHeader, DeltaChip, Ledger, Page, Section, Segmented } from "@/design-system/components";
import { BarList, FlowChart, Legend, StackedColumnChart } from "@/design-system/components/charts";
import { computeKpis, percentChange, revenueSeries } from "@/domain/analytics";
import { cashflowSummary, hasRevenueHistory, profitAndLoss, resultSeries, vatSummary } from "@/domain/finance";
import { expenseKpis, expenseView, hasComparableHistory } from "@/domain/expenses";
import { invoiceView } from "@/domain/invoicing";
import { addMonths, capitalize, formatDate, makePeriod, monthName, monthShort, startOfMonth, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { ExpenseDrawer } from "@/features/expenses/ExpenseDrawer";
import { FinanceHeader, periodSpan, useFinancePeriod } from "./shared";

/**
 * Finanzas · Resumen. Un extracto con una cifra protagonista (resultado) y, debajo, por qué: ingresos frente a gastos,
 * de dónde viene el dinero, a dónde va, qué está pendiente y la posición de IVA. Todo desde registros, nunca estimado.
 */
export default function FinancePage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { can } = useSession();
  const ready = useServerReady();
  const { filterId, current, canSeeAll } = useLocationScope();
  const { now, period, prev, control } = useFinancePeriod();
  const [newExpense, setNewExpense] = useState(false);
  const [flow, setFlow] = useState<"result" | "split">("result");
  const today = toISODate(now);

  const k = useMemo(() => computeKpis(ws, period, filterId), [ws, period, filterId]);
  const pl = useMemo(() => profitAndLoss(ws, ws.expenses, period, filterId), [ws, period, filterId]);
  const plPrev = useMemo(() => profitAndLoss(ws, ws.expenses, prev, filterId), [ws, prev, filterId]);
  const cf = useMemo(() => cashflowSummary(ws, ws.expenses, period, filterId), [ws, period, filterId]);
  const vat = useMemo(() => vatSummary(ws, ws.expenses, period, filterId), [ws, period, filterId]);
  const ex = useMemo(() => expenseKpis(ws.expenses, { categories: ws.expenseCategories, suppliers: ws.suppliers, locations: ws.locations }, period, filterId, today), [ws, period, filterId, today]);
  const results = useMemo(() => resultSeries(ws, ws.expenses, now, 12, filterId), [ws, now, filterId]);
  const split12 = useMemo(() => {
    const p12 = makePeriod("custom", now, { start: addMonths(startOfMonth(now), -11), end: now });
    return revenueSeries(ws, p12, "month", filterId).map((m) => ({ key: m.key, label: capitalize(monthShort(m.date.getMonth())), tooltipLabel: capitalize(`${monthName(m.date.getMonth())} ${m.date.getFullYear()}`), a: m.invoices, b: m.sales }));
  }, [ws, now, filterId]);

  const receivable = ws.invoices
    .filter((i) => (i.status === "issued" || i.status === "partially_paid") && (!filterId || !i.locationId || i.locationId === filterId))
    .sort((a, b) => (a.dueDate ?? a.issueDate ?? "").localeCompare(b.dueDate ?? b.issueDate ?? ""));
  const payable = ws.expenses.filter((e) => e.status === "pending" && (!filterId || e.locationId === filterId)).sort((a, b) => (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate));
  const noExpenses = !pl.hasExpenses;
  // El resultado y los gastos solo se comparan si hay gastos registrados durante todo el periodo anterior
  const expComparable = hasComparableHistory(ws.expenses, prev.start);
  const revComparable = hasRevenueHistory(ws, prev.start);
  const scopeLabel = current ? current.name : canSeeAll ? "Todos los centros" : "";

  return (
    <Page wide>
      <FinanceHeader
        title="Finanzas"
        eyebrow={<>{period.label} · {periodSpan(period)}{scopeLabel ? ` · ${scopeLabel}` : ""}</>}
        control={control}
        actions={
          <>
            <Link to="/informes" className="hidden sm:block"><Button icon={FileText}>Informes</Button></Link>
            {can("expenses.manage") && <Button icon={Plus} disabled={!ready} onClick={() => setNewExpense(true)}>Gasto</Button>}
            {can("invoices.manage") && <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => navigate("/facturas/nueva")}>Factura</Button>}
          </>
        }
      />

      {/* Extracto: resultado protagonista + cuenta de resultados y tesorería como líneas */}
      <Card className="mb-8 overflow-hidden" padded={false}>
        <div className="grid xl:grid-cols-[1.1fr_1fr]">
          <div className="relative p-6 sm:p-8">
            <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] opacity-70" aria-hidden />
            <p className="relative text-sm font-medium text-fg-2">Resultado del periodo</p>
            <p className={cn("relative mt-2 text-5xl leading-none sm:text-6xl", pl.result < 0 && "text-danger-fg")}><Amount cents={pl.result} size="hero" /></p>
            <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
              {expComparable && revComparable ? <DeltaChip size="md" value={percentChange(pl.result, plPrev.result)} label={`vs ${prev.label.toLowerCase()}`} /> : <span>Sin histórico de gastos para comparar con {prev.label.toLowerCase()}</span>}
              {pl.margin !== null && <span>Margen {Math.round(pl.margin * 100)} % · sin IVA</span>}
            </div>
            <div className="relative mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
              <div className="bg-surface p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-fg-3"><span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" />Ingresos</p>
                <p className="mt-1 text-xl font-semibold tracking-tight num">{formatMoney(pl.revenueBase)}</p>
                <p className="mt-0.5 text-xs text-fg-3">{revComparable && <DeltaChip value={percentChange(pl.revenueBase, plPrev.revenueBase)} />} <span className="ml-1">sin IVA</span></p>
              </div>
              <div className="bg-surface p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-fg-3"><span className="h-2 w-2 rounded-full bg-[var(--chart-out)]" />Gastos</p>
                <p className="mt-1 text-xl font-semibold tracking-tight num">{formatMoney(pl.expensesBase)}</p>
                <p className="mt-0.5 text-xs text-fg-3">{noExpenses ? <Link to="/gastos" className="text-accent-fg hover:underline">Registrar gastos →</Link> : <>{expComparable && <DeltaChip value={percentChange(pl.expensesBase, plPrev.expensesBase)} invert />} <span className="ml-1">sin IVA</span></>}</p>
              </div>
            </div>
            {noExpenses && <p className="relative mt-3 text-xs text-fg-3">Aún no hay gastos registrados: el resultado coincide con los ingresos. En cuanto añadas gastos verás el resultado real.</p>}
          </div>
          <div className="border-t border-line px-6 py-4 sm:px-8 xl:border-l xl:border-t-0">
            <p className="mb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">Tesorería del periodo</p>
            <Ledger rows={[
              { label: "Cobrado", value: formatMoney(cf.inflow), hint: revComparable ? <DeltaChip value={percentChange(cf.inflow, cashflowSummary(ws, ws.expenses, prev, filterId).inflow)} /> : undefined },
              { label: "Pagado", value: formatMoney(cf.outflow), hint: <span className="text-fg-3">gastos pagados</span> },
              { label: "Flujo neto", value: <Amount cents={cf.net} sign muted={false} />, strong: true, tone: cf.net < 0 ? "negative" : undefined },
            ]} />
            <p className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">Pendiente</p>
            <Ledger rows={[
              { label: <Link to="/facturas?estado=pendiente" className="hover:text-fg">Por cobrar</Link>, value: formatMoney(cf.receivable.amount), hint: `${cf.receivable.count} fact.` },
              { label: <Link to="/gastos?estado=pending" className="hover:text-fg">Por pagar</Link>, value: formatMoney(cf.payable.amount), hint: `${cf.payable.count} gastos` },
              { label: <Link to="/impuestos" className="hover:text-fg">IVA estimado a ingresar</Link>, value: formatMoney(Math.max(0, vat.position)), hint: vat.position < 0 ? `a compensar ${formatMoney(-vat.position)}` : "orientativo" },
            ]} />
          </div>
        </div>
      </Card>

      <Section
        title="Ingresos frente a gastos"
        description="Por mes · sin IVA · últimos 12 meses"
        action={<Segmented size="sm" value={flow} onChange={setFlow} items={[{ value: "result", label: "Resultado" }, { value: "split", label: "Recurrente / puntual" }]} />}
      >
        <div className="grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
          <Card className="md:col-span-12 xl:col-span-8">
            {flow === "result" ? (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-fg-3">{noExpenses ? "Sin gastos registrados todavía: la línea de resultado coincide con los ingresos." : "Barras: ingresos y gastos. Línea: resultado."}</p>
                  <Legend items={[{ label: "Ingresos", color: "var(--chart-1)", shape: "bar" }, { label: "Gastos", color: "var(--chart-out)", shape: "bar" }, { label: "Resultado", color: "var(--text)" }]} />
                </div>
                <FlowChart partialLast height={260} inLabel="Ingresos" outLabel="Gastos" netLabel="Resultado" data={results.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), inflow: r.revenue, outflow: r.expenses, net: r.result }))} />
              </>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-fg-3">Por mes de emisión · IVA incluido</p>
                  <Legend items={[{ label: "Cuotas y facturas", color: "var(--chart-1)", shape: "bar" }, { label: "Caja", color: "var(--chart-1-mid)", shape: "bar" }]} />
                </div>
                <StackedColumnChart data={split12} aLabel="Cuotas y facturas" bLabel="Caja" height={260} partialLast />
              </>
            )}
          </Card>
          <Card className="md:col-span-12 xl:col-span-4">
            <CardHeader title="Composición" description={`${period.label} · IVA incluido`} />
            <p className="mb-2 text-xs font-medium text-fg-3">Ingresos</p>
            <BarList rows={[{ key: "inv", label: "Cuotas y facturas", value: k.invoiceRevenue }, { key: "pos", label: "Caja / TPV", value: k.salesRevenue }].filter((r) => r.value > 0)} emptyText="Sin ingresos en el periodo" />
            <p className="mb-2 mt-6 text-xs font-medium text-fg-3">Gastos por categoría</p>
            <BarList tone="out" max={4} rows={ex.byCategory.map((c) => ({ key: c.id, label: c.name, value: c.amount }))} emptyText="Sin gastos en el periodo" />
          </Card>
        </div>
      </Section>

      <Section title="Pendiente" description="Lo que te deben y lo que debes, de lo más antiguo a lo más reciente">
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <PendingList
            title="Por cobrar"
            icon={Receipt}
            empty="Todo cobrado. No hay facturas pendientes."
            to="/facturas?estado=pendiente"
            items={receivable.map((i) => {
              const v = invoiceView(i, today);
              return { id: i.id, title: i.customerName ?? "Sin cliente", sub: `${i.number ?? i.externalNumber ?? "Factura"} · ${i.dueDate ? `vence ${formatDate(i.dueDate)}` : i.issueDate ? formatDate(i.issueDate) : ""}`, amount: i.total - i.amountPaid, late: v === "overdue", to: `/facturas/${i.id}` };
            })}
          />
          <PendingList
            title="Por pagar"
            icon={ScrollText}
            empty={noExpenses ? "Registra tus gastos para controlar qué debes pagar y cuándo." : "Todo pagado. No hay gastos pendientes."}
            to="/gastos?estado=pending"
            items={payable.map((e) => ({ id: e.id, title: e.description, sub: `${ws.suppliers.find((s) => s.id === e.supplierId)?.name ?? "Sin proveedor"} · ${e.dueDate ? `vence ${formatDate(e.dueDate)}` : formatDate(e.issueDate)}`, amount: e.total, late: expenseView(e, today) === "overdue", to: "/gastos?estado=pending" }))}
          />
        </div>
      </Section>

      <Section title="Impuestos" description="IVA del periodo · estimación orientativa, no sustituye a tu asesoría" action={<Link to="/impuestos" className="text-sm font-medium text-fg-3 hover:text-fg">Detalle por tipo →</Link>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TaxTile label="IVA repercutido" value={vat.outputTax} sub="De ventas y facturas emitidas" />
          <TaxTile label="IVA soportado" value={vat.inputTax} sub={noExpenses ? "Sin gastos registrados" : "De gastos con factura"} />
          <TaxTile label={vat.position >= 0 ? "Posición estimada · a ingresar" : "Posición estimada · a compensar"} value={Math.abs(vat.position)} sub="Repercutido − soportado" strong />
        </div>
      </Section>

      <ExpenseDrawer open={newExpense} onClose={() => setNewExpense(false)} />
    </Page>
  );
}

function PendingList({ title, icon: Icon, items, empty, to }: { title: string; icon: typeof Receipt; items: { id: string; title: string; sub: string; amount: number; late: boolean; to: string }[]; empty: string; to: string }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const late = items.filter((i) => i.late);
  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold"><Icon className="h-4 w-4 text-fg-3" />{title}</p>
          <p className="mt-0.5 text-sm text-fg-3"><span className="font-medium text-fg num">{formatMoney(total)}</span> · {items.length} {items.length === 1 ? "documento" : "documentos"}{late.length ? <span className="text-danger-fg"> · {late.length} vencido{late.length === 1 ? "" : "s"}</span> : null}</p>
        </div>
        <Link to={to} className="shrink-0 text-sm font-medium text-fg-3 hover:text-fg">Ver todo →</Link>
      </div>
      {items.length ? (
        <ul>
          {items.slice(0, 5).map((i) => (
            <li key={i.id}>
              <Link to={i.to} className="flex items-center gap-3 border-t border-line px-5 py-3 text-sm transition-colors hover:bg-surface-2">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", i.late ? "bg-danger-soft text-danger-fg" : "bg-surface-sunken text-fg-3")}><Clock3 className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.title}</span>
                  <span className={cn("block truncate text-xs", i.late ? "text-danger-fg" : "text-fg-3")}>{i.sub}</span>
                </span>
                <span className="font-semibold num">{formatMoney(i.amount)}</span>
              </Link>
            </li>
          ))}
          {items.length > 5 && <li><Link to={to} className="flex items-center gap-1 border-t border-line px-5 py-3 text-sm font-medium text-fg-2 hover:text-fg">Y {items.length - 5} más <ArrowUpRight className="h-3.5 w-3.5" /></Link></li>}
        </ul>
      ) : (
        <p className="flex items-center gap-3 border-t border-line px-5 py-6 text-sm text-fg-3"><CircleDollarSign className="h-4 w-4" />{empty}</p>
      )}
    </Card>
  );
}

function TaxTile({ label, value, sub, strong }: { label: string; value: number; sub: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-5", strong ? "border-transparent bg-surface-inverse text-fg-inverse" : "surface-card")}>
      <p className={cn("text-xs font-medium", strong ? "text-fg-inverse/70" : "text-fg-3")}>{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight"><Amount cents={value} /></p>
      <p className={cn("mt-1 text-xs", strong ? "text-fg-inverse/60" : "text-fg-3")}>{sub}</p>
    </div>
  );
}
