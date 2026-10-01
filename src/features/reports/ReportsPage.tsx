import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, FileText, Package, Sheet } from "lucide-react";
import { useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Button, Callout, Card, CardHeader, Field, Input, Kpi, Page, PageHeader, Segmented, Select, useToast } from "@/design-system/components";
import { addDays, makePeriod, quarterPeriod, toISODate, type Period } from "@/lib/dates";
import { downloadCsv, downloadXlsx, triggerDownload } from "@/lib/export";
import { formatMoney, formatRate } from "@/lib/money";
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
  const [csvSheet, setCsvSheet] = useState("Facturación");

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

  const report = useMemo(() => buildGestoriaReport(ws, period, locationId || undefined), [ws, period, locationId]);
  const empty = report.kpis[0]!.value === 0;
  const companyMeta = { company: ws.organization.name };

  const run = async (kind: string, fn: () => Promise<void> | void) => {
    setBusy(kind);
    try {
      await fn();
      toast.success("Archivo generado", "Revisa tu carpeta de descargas.");
    } catch (e) {
      toast.fromError(e, "No se pudo generar el archivo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page>
      <PageHeader title="Informes" description="El paquete para la gestoría en un clic: Excel completo, PDF ejecutivo y CSV. Siempre a partir de los registros, para cualquier periodo." />
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Periodo">
            <Segmented value={mode} onChange={setMode} items={[{ value: "quarter", label: "Trimestre" }, { value: "month", label: "Mes" }, { value: "year", label: "Año" }, { value: "custom", label: "Personalizado" }]} />
          </Field>
          {mode !== "custom" && (
            <Field label="Año">
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
            </Field>
          )}
          {mode === "quarter" && (
            <Field label="Trimestre">
              <Segmented value={String(q)} onChange={(v) => setQ(Number(v))} items={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Q${n}` }))} />
            </Field>
          )}
          {mode === "month" && (
            <Field label="Mes">
              <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-40">
                {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{new Date(2000, m, 1).toLocaleDateString("es-ES", { month: "long" })}</option>)}
              </Select>
            </Field>
          )}
          {mode === "custom" && (
            <>
              <Field label="Desde"><Input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} /></Field>
              <Field label="Hasta"><Input type="date" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} /></Field>
            </>
          )}
          {locations.length > 1 && (
            <Field label="Centro">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-44">
                <option value="">Todos (consolidado)</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {report.kpis.slice(0, 6).map((k) => (
              <Kpi key={k.label} label={k.label} value={k.format === "money" ? formatMoney(k.value) : k.value.toLocaleString("es-ES")} />
            ))}
          </div>
          <Card padded={false}>
            <div className="p-5 pb-3"><CardHeader className="mb-0" title="IVA repercutido por tipo" description="Facturas por fecha de emisión · ventas de caja por fecha de operación" /></div>
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line bg-surface-2 text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Origen</th><th className="px-3 py-2 text-right font-medium">Tipo</th><th className="px-3 py-2 text-right font-medium">Base</th><th className="px-3 py-2 text-right font-medium">Cuota</th><th className="px-5 py-2 text-right font-medium">Total</th></tr></thead>
              <tbody>
                {report.vat.map((v) => (
                  <tr key={`${v.source}${v.rateBp}`} className="border-b border-line">
                    <td className="px-5 py-2.5">{v.source}</td><td className="px-3 py-2.5 text-right num">{formatRate(v.rateBp)}</td><td className="px-3 py-2.5 text-right num">{formatMoney(v.base)}</td><td className="px-3 py-2.5 text-right font-medium num">{formatMoney(v.tax)}</td><td className="px-5 py-2.5 text-right num">{formatMoney(v.total)}</td>
                  </tr>
                ))}
                {!report.vat.length && <tr><td colSpan={5} className="px-5 py-6 text-center text-fg-3">Sin operaciones en el periodo.</td></tr>}
              </tbody>
              {report.vat.length > 0 && (
                <tfoot><tr className="bg-surface-2 font-semibold"><td className="px-5 py-2.5">Total</td><td /><td className="px-3 py-2.5 text-right num">{formatMoney(report.vat.reduce((s, v) => s + v.base, 0))}</td><td className="px-3 py-2.5 text-right num">{formatMoney(report.vat.reduce((s, v) => s + v.tax, 0))}</td><td className="px-5 py-2.5 text-right num">{formatMoney(report.vat.reduce((s, v) => s + v.total, 0))}</td></tr></tfoot>
              )}
            </table>
          </Card>
          {report.warnings.length > 0 && (
            <Callout tone="warning" icon={AlertTriangle} title="Notas que acompañan al informe">
              <ul className="mt-1 list-disc pl-4">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Callout>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft"><Package className="h-5 w-5 text-accent-fg" /></div>
              <div>
                <p className="font-semibold">Paquete gestoría · {report.periodLabel}</p>
                <p className="text-xs text-fg-3">{report.sheets.length} hojas: {report.sheets.map((s) => s.name).join(", ")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="primary" size="lg" icon={FileSpreadsheet} disabled={!can("reports.export") || empty} loading={busy === "xlsx"} onClick={() => run("xlsx", () => downloadXlsx(`${report.fileBase}.xlsx`, report.sheets, companyMeta))}>
                Descargar Excel
              </Button>
              <Button size="lg" icon={FileText} disabled={!can("reports.export") || empty} loading={busy === "pdf"} onClick={() => run("pdf", async () => triggerDownload(await buildGestoriaPdf(report, ws.organization), `${report.fileBase}.pdf`))}>
                Descargar PDF
              </Button>
              <div className="flex gap-2">
                <Select value={csvSheet} onChange={(e) => setCsvSheet(e.target.value)} className="flex-1">{report.sheets.map((s) => <option key={s.name}>{s.name}</option>)}</Select>
                <Button icon={Download} disabled={!can("reports.export") || empty} onClick={() => run("csv", () => downloadCsv(`${report.fileBase}_${csvSheet.replace(/\s+/g, "_")}.csv`, report.sheets.find((s) => s.name === csvSheet)!))}>CSV</Button>
              </div>
            </div>
            <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-fg-3">{report.fileBase}.xlsx</p>
            {!can("reports.export") && <p className="mt-3 text-xs text-fg-3">Tu rol no permite exportar informes.</p>}
          </Card>
          <Card>
            <CardHeader title="Qué contiene" />
            <ul className="flex flex-col gap-2 text-sm text-fg-2">
              {report.sheets.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2"><Sheet className="h-3.5 w-3.5 text-fg-3" />{s.name}</span>
                  <span className="text-xs text-fg-3 num">{s.rows.length.toLocaleString("es-ES")} filas</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
