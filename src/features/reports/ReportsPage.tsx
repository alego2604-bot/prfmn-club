import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Download, FileSpreadsheet, FileText, Sheet } from "lucide-react";
import { useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, Card, Checkbox, Field, Page, PageHeader, Segmented, Select, useToast, DateInput } from "@/design-system/components";
import { cn } from "@/lib/cn";
import { addDays, makePeriod, quarterPeriod, toISODate, type Period } from "@/lib/dates";
import { downloadCsv, downloadXlsx, triggerDownload } from "@/lib/export";
import { formatMoney, NUM } from "@/lib/money";
import { buildGestoriaReport } from "./gestoria";
import { buildGestoriaPdf } from "./pdf";

type Mode = "quarter" | "month" | "year" | "custom";

export default function ReportsPage() {
  const ws = useWorkspace();
  const { can } = useSession();
  const toast = useToast();
  const { locations, current } = useLocationScope();
  const now = new Date();
  const lastQ = Math.floor(now.getMonth() / 3) || 4;
  const [mode, setMode] = useState<Mode>("quarter");
  const [year, setYear] = useState(lastQ === 4 && now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear());
  const [q, setQ] = useState(lastQ);
  const [month, setMonth] = useState(now.getMonth() === 0 ? 11 : now.getMonth() - 1);
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -30)), end: toISODate(now) });
  const [locationId, setLocationId] = useState<string>(current?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const years = useMemo(() => {
    const ys = new Set<number>([now.getFullYear()]);
    for (const s of ws.sales) ys.add(new Date(s.occurredAt).getFullYear());
    for (const i of ws.invoices) if (i.issueDate) ys.add(Number(i.issueDate.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }, [ws.sales, ws.invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const period: Period = useMemo(() => {
    if (mode === "quarter") return quarterPeriod(year, q);
    if (mode === "year") return { preset: "custom", start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `Año ${year}` };
    if (mode === "month") {
      const s = new Date(year, month, 1);
      return { preset: "custom", start: s, end: new Date(year, month + 1, 1), label: s.toLocaleDateString("es-ES", { month: "long", year: "numeric" }) };
    }
    return makePeriod("custom", now, { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) });
  }, [mode, year, q, month, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = useMemo(() => buildGestoriaReport(ws, period, locationId || undefined, { canSensitive: can("customers.sensitive") }), [ws, period, locationId, can]);
  const empty = report.kpis[0]!.value === 0;
  const companyMeta = { company: ws.organization.name };
  const [include, setInclude] = useState<Record<SectionKey, boolean>>({ sales: true, invoices: true, expenses: true, tax: true, cash: true, customers: true });
  const [format, setFormat] = useState<"xlsx" | "pdf" | "csv">("xlsx");
  const sheetNames = new Set(["Resumen", ...SECTIONS.filter((x) => include[x.key]).flatMap((x) => x.sheets)]);
  const sheets = report.sheets.filter((x) => sheetNames.has(x.name));
  const rowsOf = (names: string[]) => report.sheets.filter((x) => names.includes(x.name)).reduce((n, x) => n + x.rows.length, 0);

  const generate = async () => {
    setBusy(format);
    try {
      if (format === "xlsx") await downloadXlsx(`${report.fileBase}.xlsx`, sheets, companyMeta);
      else if (format === "pdf") triggerDownload(await buildGestoriaPdf(report, ws.organization), `${report.fileBase}.pdf`);
      else for (const sh of sheets) downloadCsv(`${report.fileBase}_${sh.name.replace(/\s+/g, "_")}.csv`, sh);
      toast.success("Informe generado", format === "csv" ? `${sheets.length} archivos CSV en tu carpeta de descargas.` : "Revisa tu carpeta de descargas.");
    } catch (e) {
      toast.fromError(e, "No se pudo generar el informe");
    } finally {
      setBusy(null);
    }
  };

  const kpi = (label: string) => report.kpis.find((k) => k.label.toLowerCase().startsWith(label))?.value ?? 0;
  const vatTotal = report.vat.reduce((x, v) => x + v.tax, 0);

  return (
    <Page wide>
      <Link to="/informes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Informes</Link>
      <PageHeader title="Paquete para la gestoría" description="A partir de los registros: ventas, facturas emitidas, gastos, IVA repercutido y soportado, caja y clientes. Cualquier periodo, en Excel, PDF o CSV." />
      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <Card>
            <StepTitle n={1} title="Periodo" />
            <div className="flex flex-wrap items-end gap-3">
              <Segmented value={mode} onChange={setMode} items={[{ value: "quarter", label: "Trimestre" }, { value: "month", label: "Mes" }, { value: "year", label: "Año" }, { value: "custom", label: "Personalizado" }]} />
              {mode !== "custom" && (
                <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="Año">{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
              )}
              {mode === "quarter" && <Segmented value={String(q)} onChange={(v) => setQ(Number(v))} items={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Q${n}` }))} />}
              {mode === "month" && (
                <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-40" aria-label="Mes">
                  {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{new Date(2000, m, 1).toLocaleDateString("es-ES", { month: "long" })}</option>)}
                </Select>
              )}
              {mode === "custom" && (
                <>
                  <Field label="Desde"><DateInput value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} /></Field>
                  <Field label="Hasta"><DateInput value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} /></Field>
                </>
              )}
              {locations.length > 1 && (
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-44" aria-label="Centro">
                  <option value="">Todos (consolidado)</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              )}
            </div>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-2"><StepTitle n={2} title="Qué incluir" /></div>
            <ul>
              <li className="flex items-center gap-3 border-t border-line px-5 py-3">
                <Checkbox checked onChange={() => undefined} label="Resumen" />
                <span className="flex-1"><span className="block text-sm font-medium">Resumen</span><span className="block text-xs text-fg-3">Cifras clave del periodo · siempre incluido</span></span>
              </li>
              {SECTIONS.map((sec) => (
                <li key={sec.key} className="border-t border-line">
                  <label className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                    <Checkbox checked={include[sec.key]} onChange={(v) => setInclude({ ...include, [sec.key]: v })} label={sec.label} />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{sec.label}</span><span className="block truncate text-xs text-fg-3">{sec.description}</span></span>
                    <span className="text-xs text-fg-3 num">{rowsOf(sec.sheets).toLocaleString("es-ES", NUM)} filas</span>
                  </label>
                </li>
              ))}
              <li className="flex items-center gap-3 border-t border-line px-5 py-3 opacity-60">
                <Checkbox checked={false} onChange={() => undefined} label="Gastos" />
                <span className="flex-1"><span className="block text-sm font-medium">Gastos y facturas recibidas</span><span className="block text-xs text-fg-3">Disponible cuando se active el módulo de Gastos</span></span>
                <Badge>Próximamente</Badge>
              </li>
            </ul>
          </Card>

          <Card>
            <StepTitle n={3} title="Formato" />
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato">
              {([
                ["xlsx", FileSpreadsheet, "Excel", "Un libro con una hoja por sección"],
                ["pdf", FileText, "PDF", "Resumen ejecutivo para enviar o imprimir"],
                ["csv", Sheet, "CSV", "Un archivo por sección (separador ;)"],
              ] as const).map(([v, Icon, label, desc]) => (
                <button type="button"
                  key={v}
                  role="radio"
                  aria-checked={format === v}
                  onClick={() => setFormat(v)}
                  className={cn("flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all", format === v ? "border-ink bg-surface shadow-sm ring-1 ring-ink" : "border-line hover:border-line-strong hover:bg-surface-2")}
                >
                  <Icon className={cn("h-5 w-5", format === v ? "text-fg" : "text-fg-3")} strokeWidth={1.75} />
                  <span><span className="block text-sm font-semibold">{label}</span><span className="mt-0.5 block text-xs text-fg-3">{desc}</span></span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-line bg-surface-2 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-3">Vista previa</p>
              <p className="mt-1 text-lg font-semibold tracking-[-0.02em]">Paquete gestoría · {report.periodLabel}</p>
              <p className="text-sm text-fg-3">{ws.organization.name}{locationId ? ` · ${locations.find((l) => l.id === locationId)?.name}` : ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line">
              {[
                ["Ingresos (IVA incl.)", formatMoney(kpi("ingresos"))],
                ["IVA repercutido", formatMoney(vatTotal)],
                ["Ventas de caja", formatMoney(kpi("ventas de caja"))],
                ["Facturas emitidas", formatMoney(kpi("facturas emitidas"))],
              ].map(([l, v]) => (
                <div key={l} className="bg-surface px-5 py-4">
                  <p className="text-xs text-fg-3">{l}</p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.02em] num">{v}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-5 py-4">
              <p className="mb-2 text-xs font-medium text-fg-3">{format === "pdf" ? "El PDF incluye el resumen ejecutivo y el IVA por tipo" : `${sheets.length} ${format === "csv" ? "archivos" : "hojas"}`}</p>
              {format !== "pdf" && (
                <div className="flex flex-wrap gap-1.5">
                  {sheets.map((x) => <span key={x.name} className="rounded-md bg-surface-sunken px-2 py-1 text-xs text-fg-2">{x.name} <span className="text-fg-3 num">{x.rows.length.toLocaleString("es-ES", NUM)}</span></span>)}
                </div>
              )}
            </div>
            {report.warnings.length > 0 && (
              <div className="border-t border-line px-5 py-4">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning-fg"><AlertTriangle className="h-3.5 w-3.5" />Notas para la gestoría</p>
                <ul className="list-disc pl-4 text-xs text-fg-2">{report.warnings.map((w) => <li key={w} className="py-0.5">{w}</li>)}</ul>
              </div>
            )}
            <div className="border-t border-line p-5">
              <Button variant="primary" size="lg" className="w-full" icon={Download} disabled={!can("reports.export") || empty || (format !== "pdf" && !sheets.length)} loading={!!busy} onClick={generate}>
                Generar {format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "CSV"}
              </Button>
              <p className="mt-2.5 truncate text-center font-mono text-xs text-fg-3">{report.fileBase}.{format}</p>
              {empty && <p className="mt-2 text-center text-xs text-fg-3">No hay operaciones en este periodo.</p>}
              {!can("reports.export") && <p className="mt-2 text-center text-xs text-fg-3">Tu rol no permite exportar informes.</p>}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

type SectionKey = "sales" | "invoices" | "expenses" | "tax" | "cash" | "customers";
const SECTIONS: { key: SectionKey; label: string; description: string; sheets: string[] }[] = [
  { key: "sales", label: "Ventas", description: "Caja diaria, líneas de venta, categorías, productos y métodos de pago", sheets: ["Caja diaria", "Ventas", "Categorías", "Productos", "Métodos de pago"] },
  { key: "invoices", label: "Facturas", description: "Facturas emitidas por fecha de emisión", sheets: ["Facturación"] },
  { key: "expenses", label: "Gastos", description: "Facturas recibidas con proveedor, NIF, base e IVA soportado", sheets: ["Gastos"] },
  { key: "tax", label: "Impuestos", description: "IVA repercutido y soportado por tipo", sheets: ["IVA", "IVA soportado"] },
  { key: "cash", label: "Caja", description: "Cierres de caja con arqueo y descuadres", sheets: ["Cierres"] },
  { key: "customers", label: "Clientes", description: "Clientes facturados con base, IVA y total", sheets: ["Clientes"] },
];

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-fg-inverse num">{n}</span>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
    </div>
  );
}
