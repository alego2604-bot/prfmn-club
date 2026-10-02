import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BarChart3, BriefcaseBusiness, CalendarRange, Contact, CreditCard, Download, FileSpreadsheet, FileText, Package, Receipt, ScrollText, ShoppingBag,
  Store, TrendingUp, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Button, Card, CardHeader, DeltaChip, EmptyState, FilterBar, FilterSelect, Input, Menu, MenuItem, Page, PageHeader, Segmented } from "@/design-system/components";
import { ColumnChart, compactMoney } from "@/design-system/components/charts";
import { buildReport, comparableOf, kpiDelta, REPORTS, reportPeriod, toDate, type ReportKey } from "@/domain/reports";
import { addDays, toISODate, type Period } from "@/lib/dates";
import { downloadCsv, downloadXlsx, euros, triggerDownload, type ExportSheet } from "@/lib/export";
import { cn } from "@/lib/cn";
import { buildReportPdf, fmtValue } from "./reportPdf";

const ICON: Record<ReportKey, LucideIcon> = {
  sales: ShoppingBag, revenue: TrendingUp, products: Package, expenses: ScrollText, payments: CreditCard, invoices: Receipt,
  customers: Users, memberships: Contact, cash: Wallet, locations: Store,
};
type Preset = "today" | "week" | "month" | "prev_month" | "quarter" | "prev_quarter" | "year" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Hoy" }, { value: "week", label: "Esta semana" }, { value: "month", label: "Este mes" }, { value: "prev_month", label: "Mes anterior" },
  { value: "quarter", label: "Este trimestre" }, { value: "prev_quarter", label: "Trimestre anterior" }, { value: "year", label: "Este año" }, { value: "custom", label: "Personalizado…" },
];

/** Informes: catálogo por área + paquete para la gestoría. */
export default function ReportsHubPage() {
  const { key } = useParams();
  if (key && REPORTS.some((r) => r.key === key)) return <ReportView reportKey={key as ReportKey} />;
  return <ReportsIndex />;
}

function ReportsIndex() {
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <Page wide>
      <PageHeader title="Informes" description="Cada informe con filtros de periodo, centro y comparativa honesta. Exporta en Excel, CSV o PDF." />
      <Link to="/informes/gestoria" className="group mb-8 block">
        <Card className="flex flex-col gap-4 overflow-hidden transition-shadow group-hover:shadow-md sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ink text-fg-inverse"><BriefcaseBusiness className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Paquete para la gestoría</p>
            <p className="mt-0.5 text-sm text-fg-3">Trimestre o mes en un clic: ventas, facturas, IVA por tipo, caja diaria y clientes. Excel con varias hojas, PDF ejecutivo o CSV.</p>
          </div>
          <span className="text-sm font-medium text-accent-fg group-hover:underline">Preparar paquete →</span>
        </Card>
      </Link>
      <div className="flex flex-col gap-8">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {REPORTS.filter((r) => r.group === g).map((r) => {
                const Icon = ICON[r.key];
                return (
                  <Link key={r.key} to={`/informes/${r.key}`} className="group surface-card flex flex-col rounded-xl p-5 transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-md">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-fg"><Icon className="h-4 w-4" /></span>
                    <p className="mt-4 text-[15px] font-semibold">{r.title}</p>
                    <p className="mt-1 text-sm text-fg-3">{r.description}</p>
                    <span className="mt-4 text-sm font-medium text-fg-2 group-hover:text-fg">Abrir informe →</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

function ReportView({ reportKey }: { reportKey: ReportKey }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { current, locations, canSeeAll } = useLocationScope();
  const now = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<Preset>(reportKey === "cash" ? "month" : "quarter");
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -29)), end: toISODate(now) });
  const [compare, setCompare] = useState<"previous" | "year" | "none">(reportKey === "memberships" || reportKey === "cash" ? "none" : "previous");
  const [loc, setLoc] = useState<string>(current?.id ?? "");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState("");
  const period: Period = useMemo(() => preset === "custom"
    ? { preset: "custom", start: new Date(`${custom.start}T00:00`), end: addDays(new Date(`${custom.end}T00:00`), 1), label: `${custom.start.split("-").reverse().join("/")} – ${custom.end.split("-").reverse().join("/")}` }
    : reportPeriod(preset, now), [preset, custom, now]);
  // Periodo en curso: hasta hoy, y la comparación con los mismos días (nunca un periodo completo contra uno a medias)
  const { period: effective } = useMemo(() => toDate(period, now), [period, now]);
  const cmpPeriod = compare === "none" ? null : comparableOf(period, effective, compare);
  const report = useMemo(() => buildReport(ws, reportKey, { period: effective, compare: cmpPeriod, locationId: loc || undefined, categoryId: category || undefined, methodKey: method || undefined }), [ws, reportKey, effective, cmpPeriod?.start.getTime(), cmpPeriod?.end.getTime(), loc, category, method]); // eslint-disable-line react-hooks/exhaustive-deps
  const scope = loc ? locations.find((l) => l.id === loc)?.name ?? "" : canSeeAll ? "Todos los centros (consolidado)" : current?.name ?? "";
  const fileBase = `Informe_${report.meta.title}_${period.label}`.replace(/[^\p{L}\p{N}]+/gu, "_");
  const sheet = (): ExportSheet => ({
    name: report.meta.title,
    title: `${report.meta.title} · ${period.label}`,
    subtitle: `${ws.organization.name} · ${scope}`,
    columns: report.table.columns.map((c) => ({ header: c.header, format: c.format === "money" ? "money" : c.format === "percent" ? "percent" : c.format === "int" ? "integer" : "text" })),
    rows: report.table.rows.map((r) => r.map((v, i) => (report.table.columns[i]!.format === "money" && typeof v === "number" ? euros(v) : v))),
    totals: report.table.totals?.map((v, i) => (report.table.columns[i]!.format === "money" && typeof v === "number" ? euros(v) : v)),
  });
  const Icon = ICON[reportKey];
  const cmpLabel = compare === "year" ? "año anterior" : "periodo anterior";
  const sameDays = cmpPeriod?.label.includes("mismos días");

  return (
    <Page wide>
      <Link to="/informes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Informes</Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><Icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-sm text-fg-3">{effective.label} · {scope}{sameDays ? " · comparado con los mismos días" : ""}</p>
            <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.03em]">{report.meta.title}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={compare} onChange={setCompare} items={[{ value: "previous", label: "vs anterior" }, { value: "year", label: "vs año anterior" }, { value: "none", label: "Sin comparar" }]} />
          <Menu trigger={(_, t) => <Button variant="primary" icon={Download} onClick={t}>Exportar</Button>}>
            {(close) => (
              <>
                <MenuItem icon={FileSpreadsheet} onClick={() => { close(); void downloadXlsx(`${fileBase}.xlsx`, [sheet()], { company: ws.organization.name }); }}>Excel (.xlsx)</MenuItem>
                <MenuItem icon={FileText} onClick={() => { close(); void buildReportPdf(report, { company: ws.organization.name, periodLabel: period.label, scope }).then((b) => triggerDownload(b, `${fileBase}.pdf`)); }}>PDF</MenuItem>
                <MenuItem icon={Download} onClick={() => { close(); downloadCsv(fileBase, sheet()); }}>CSV (;)</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      <FilterBar>
        <FilterSelect label="Periodo" icon={CalendarRange} allLabel="Este trimestre" value={preset === "quarter" ? "" : preset} onChange={(v) => setPreset((v || "quarter") as Preset)} options={PRESETS.filter((p) => p.value !== "quarter")} />
        {preset === "custom" && (
          <span className="flex items-center gap-1.5">
            <Input type="date" aria-label="Desde" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="h-8 w-[140px]" />
            <Input type="date" aria-label="Hasta" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="h-8 w-[140px]" />
          </span>
        )}
        {canSeeAll && reportKey !== "locations" && <FilterSelect label="Centro" icon={Store} allLabel="Todos (consolidado)" value={loc} onChange={setLoc} options={locations.map((l) => ({ value: l.id, label: l.name }))} />}
        {(reportKey === "sales" || reportKey === "products") && <FilterSelect label="Categoría" value={category} onChange={setCategory} options={ws.categories.filter((c) => c.status === "active").map((c) => ({ value: c.id, label: c.name }))} />}
        {reportKey === "payments" && <FilterSelect label="Método" value={method} onChange={setMethod} options={ws.paymentMethods.filter((m) => m.status !== "archived").map((m) => ({ value: m.key, label: m.name }))} />}
        <span className="flex items-center gap-1.5 text-xs text-fg-3">Empresa: <span className="font-medium text-fg-2">{ws.organization.name}</span></span>
      </FilterBar>

      <div className="surface-card mb-5 grid grid-cols-2 overflow-hidden rounded-xl md:grid-cols-4">
        {report.kpis.map((k) => (
          <div key={k.label} className="-ml-px -mt-px border-l border-t border-line p-4 sm:p-5">
            <p className="truncate text-xs font-medium text-fg-3">{k.label}</p>
            <p className="mt-1.5 truncate text-xl font-semibold tracking-[-0.025em] num sm:text-2xl">{fmtValue(k.value, k.format)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
              {compare !== "none" && k.format !== "percent" && <DeltaChip value={kpiDelta(k)} invert={k.invert} label={k.previous === null ? undefined : `vs ${cmpLabel}`} />}
              {k.hint && <span className="truncate">{k.hint}</span>}
            </div>
          </div>
        ))}
      </div>

      {report.series && report.series.points.length > 1 && (
        <Card className="mb-5">
          <CardHeader title={report.series.label} description={compare === "none" ? effective.label : `${effective.label} frente a ${cmpPeriod?.label}`} action={<BarChart3 className="h-4 w-4 text-fg-3" />} />
          <ColumnChart
            height={240}
            currentLabel={effective.label}
            previousLabel={compare === "none" ? undefined : cmpLabel}
            axisFormat={report.series.format === "money" ? compactMoney : (v) => String(v)}
            data={report.series.points.map((p) => ({ key: p.key, label: p.label.replace(/^Semana del /, ""), tooltipLabel: p.label, current: p.current, previous: compare === "none" ? undefined : p.previous }))}
          />
        </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        {report.table.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs text-fg-3">
                  {report.table.columns.map((c, i) => <th key={c.header} className={cn("whitespace-nowrap px-4 py-2.5 font-medium first:pl-5 last:pr-5", c.align === "right" ? "text-right" : "text-left", compare === "none" && c.header === "Comparación" && "hidden")}>{c.header}{i > 0 && c.header === "Comparación" ? ` (${cmpLabel})` : ""}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.table.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-line last:border-0 hover:bg-surface-2">
                    {r.map((v, i) => {
                      const c = report.table.columns[i]!;
                      return <td key={i} className={cn("whitespace-nowrap px-4 py-2.5 first:pl-5 last:pr-5", c.align === "right" ? "text-right num" : "", i === 0 && "font-medium", c.header === "Comparación" && "text-fg-3", compare === "none" && c.header === "Comparación" && "hidden", c.header === "Diferencia" && typeof v === "number" && v !== 0 && (v < 0 ? "text-danger-fg" : "text-warning-fg"))}>{fmtValue(v, c.format)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              {report.table.totals && (
                <tfoot>
                  <tr className="border-t border-line-strong bg-surface-2 font-semibold">
                    {report.table.totals.map((v, i) => { const c = report.table.columns[i]!; return <td key={i} className={cn("whitespace-nowrap px-4 py-3 first:pl-5 last:pr-5", c.align === "right" ? "text-right num" : "", compare === "none" && c.header === "Comparación" && "hidden")}>{v === null || v === "" ? "" : fmtValue(v, c.format)}</td>; })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <EmptyState compact icon={Icon} title="Sin datos en este periodo" description="Prueba con un periodo más amplio o con otro centro." action={<Button onClick={() => setPreset("year")}>Ver este año</Button>} />
        )}
      </Card>
      {report.notes.length > 0 && <p className="mt-3 text-xs text-fg-3">{report.notes.join(" ")}</p>}
      <p className="mt-6 text-sm text-fg-3">Otros informes: {REPORTS.filter((r) => r.key !== reportKey).map((r, i) => <span key={r.key}>{i ? " · " : ""}<button type="button" className="font-medium text-fg-2 hover:text-fg hover:underline" onClick={() => navigate(`/informes/${r.key}`)}>{r.title}</button></span>)}</p>
    </Page>
  );
}
