import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleDashed, Copy, FileSpreadsheet, FileText, Info, Lightbulb, Loader2, ScanSearch,
  Sheet, Upload, XCircle,
} from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, Callout, Card, CardHeader, Field, Kpi, Page, PageHeader, Segmented, Select, useToast } from "@/design-system/components";
import { analyzeWorkbook } from "./engine/analyze";
import { readFile } from "./engine/read";
import { buildSalesPlan } from "./engine/salesPlan";
import { buildInvoicesPlan } from "./engine/invoicesPlan";
import { commitPlan, isImportable, summarizePlan } from "./engine/commit";
import { fieldsFor } from "./engine/fields";
import type { FileAnalysis, ImportPlan, InvoiceRow, PlanOptions, SalesRow, TargetKind, WorkbookData } from "./engine/types";
import { sha256Hex } from "@/lib/hash";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { plural } from "@/lib/text";
import { cn } from "@/lib/cn";

const STEPS = ["Subir", "Analizar", "Mapear", "Previsualizar", "Validar", "Importar"] as const;
type Override = { decision?: "import" | "ignore"; product?: SalesRow["product"] };

const ROLE_LABEL: Record<string, { label: string; tone: "accent" | "success" | "neutral" | "warning" | "info" }> = {
  sales: { label: "Ventas", tone: "accent" },
  invoices: { label: "Facturas", tone: "accent" },
  catalog: { label: "Catálogo", tone: "success" },
  summary: { label: "Resumen calculado", tone: "neutral" },
  empty: { label: "Vacía", tone: "neutral" },
  unknown: { label: "No reconocida", tone: "warning" },
};

function applyOverrides(plan: ImportPlan, overrides: Record<string, Override>): ImportPlan {
  return {
    ...plan,
    rows: plan.rows.map((r) => {
      const o = overrides[r.key];
      if (!o) return r;
      if (r.type === "sale") {
        const product = o.product ?? r.product;
        const resolved = o.product && r.product.kind === "none";
        return { ...r, product, decision: o.decision ?? (resolved ? "import" : r.decision), confidence: resolved ? "medium" : r.confidence };
      }
      return { ...r, decision: o.decision ?? r.decision };
    }),
  };
}

export default function ImportWizardPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const { locations, current } = useLocationScope();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number; sha256: string } | null>(null);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const [options, setOptions] = useState<PlanOptions>({ dateOutsideSheet: "sheet_month", locationId: current?.id ?? locations[0]?.id ?? "" });
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [error, setError] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<"attention" | "review" | "duplicate" | "error" | "all">("attention");
  const [jobId, setJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const previous = file ? ws.imports.find((i) => i.fileSha256 === file.sha256 && i.status === "completed") : undefined;

  const onFile = useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      const { data, buffer } = await readFile(f);
      const sha256 = await sha256Hex(buffer);
      setFile({ name: f.name, size: f.size, sha256 });
      setWb(data);
      setAnalysis(analyzeWorkbook(data));
      setOverrides({});
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const plan = useMemo(() => {
    if (!wb || !analysis?.kind || step < 3) return null;
    const p = analysis.kind === "sales" ? buildSalesPlan(wb, analysis, ws, options) : buildInvoicesPlan(wb, analysis, ws, options);
    return applyOverrides(p, overrides);
    // ws intencionadamente fuera: el plan se calcula contra el estado al validar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb, analysis, options, overrides, step >= 3]);
  const summary = plan ? summarizePlan(plan, ws) : null;

  const requiredMissing = useMemo(() => {
    if (!analysis?.kind) return [];
    const out: string[] = [];
    for (const s of analysis.sheets.filter((x) => x.include && (x.role === "sales" || x.role === "invoices"))) {
      const fields = fieldsFor(s.role as TargetKind);
      for (const f of fields.filter((x) => x.required)) {
        if (f.key === "product" && s.role === "sales") {
          if (!s.columns.some((c) => c.field === "product")) out.push(`${s.name}: ${f.label}`);
          continue;
        }
        if (f.key === "total" && s.role === "sales" && s.columns.some((c) => c.field === "unit_price")) continue;
        if (!s.columns.some((c) => c.field === f.key)) out.push(`${s.name}: ${f.label}`);
      }
    }
    return out;
  }, [analysis]);

  const doImport = async () => {
    if (!plan || !file) return;
    setBusy(true);
    try {
      const job = commitPlan(ctx, plan, file);
      await ctx.store.flush();
      setJobId(job.id);
      toast.success("Importación completada", `${Object.entries(job.summary.created).map(([k, v]) => `${v} ${k}`).join(" · ")}`);
    } catch (e) {
      toast.fromError(e, "La importación no se ha aplicado");
    } finally {
      setBusy(false);
    }
  };

  if (!can("imports.run")) return null;
  const job = jobId ? ws.imports.find((i) => i.id === jobId) : undefined;

  return (
    <Page>
      <Link to="/importaciones" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Importaciones</Link>
      <PageHeader title="Importar datos" description="Nada se guarda hasta el último paso. Verás cada registro, su nivel de confianza y el motivo de cada aviso." />

      {/* Stepper */}
      <ol className="no-scrollbar mb-8 flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-1">
            <span className={cn("flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium", i === step ? "bg-ink text-fg-inverse" : i < step || job ? "text-fg" : "text-fg-3")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-2xs num", i === step ? "bg-white/20" : i < step || job ? "bg-success text-white" : "border border-line")}>
                {i < step || job ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-line" />}
          </li>
        ))}
      </ol>

      {/* 1. Subir */}
      {step === 0 && (
        <div>
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
            className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-surface px-6 py-16 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-accent" /> : <Upload className="h-8 w-8 text-fg-3" />}
            <p className="mt-4 text-md font-semibold">{busy ? "Leyendo archivo…" : "Arrastra tu archivo o haz clic para elegirlo"}</p>
            <p className="mt-1 text-sm text-fg-3">XLSX o CSV · ventas/caja o facturas emitidas · se detecta automáticamente</p>
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv,.txt,.xls,.pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          {error && <Callout tone="danger" className="mt-4" icon={XCircle}>{error}</Callout>}
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {[
              { icon: FileSpreadsheet, t: "Caja / ventas", d: "Hojas por mes, catálogo y TPV en el mismo libro. Detecta resúmenes y duplicados entre hojas." },
              { icon: FileText, t: "Facturas emitidas", d: "Listados trimestrales (p. ej. BeMadBox). Crea clientes sin duplicar y cuadra con los totales del fichero." },
              { icon: ScanSearch, t: "PDF, tickets e imágenes", d: "Lectura inteligente con validación humana. Próxima fase (requiere servidor)." },
            ].map((x, i) => (
              <Card key={x.t} className={cn("p-4", i === 2 && "opacity-70")}>
                <x.icon className="h-5 w-5 text-fg-3" />
                <p className="mt-2 text-sm font-semibold">{x.t}{i === 2 && <Badge className="ml-2">Pronto</Badge>}</p>
                <p className="mt-1 text-sm text-fg-3">{x.d}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 2. Analizar */}
      {step === 1 && analysis && file && (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <FileSpreadsheet className="h-9 w-9 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{file.name}</p>
                <p className="text-sm text-fg-3">{(file.size / 1024).toFixed(0)} KB · {plural(wb!.sheets.length, "hoja", "hojas")} · SHA-256 <span className="font-mono text-xs">{file.sha256.slice(0, 12)}…</span></p>
              </div>
              <Field label="Tipo de datos">
                <Segmented
                  size="sm"
                  value={analysis.kind ?? "sales"}
                  onChange={(k) => setAnalysis(analyzeWorkbook(wb!, k))}
                  items={[{ value: "sales", label: "Ventas / caja" }, { value: "invoices", label: "Facturas emitidas" }]}
                />
              </Field>
              <Field label="Centro">
                <Select value={options.locationId} onChange={(e) => setOptions({ ...options, locationId: e.target.value })} className="w-44">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            </div>
          </Card>
          {previous && (
            <Callout tone="warning" icon={Copy} title="Este archivo ya se importó">
              El {formatDateTime(previous.createdAt)} ({previous.fileName}). Si continúas, los registros ya existentes se marcarán como duplicados y no se importarán.
            </Callout>
          )}
          {!analysis.kind && <Callout tone="danger">No se han encontrado columnas de ventas ni de facturas. Revisa que el archivo tenga una fila de cabecera (Fecha, Producto, Importe… o Factura, Cliente, Total…).</Callout>}
          <Card padded={false}>
            <div className="p-5 pb-3"><CardHeader className="mb-0" title="Hojas detectadas" description="Puedes excluir hojas. Las de resumen se omiten porque el sistema recalcula sus cifras." /></div>
            {analysis.sheets.map((s, i) => (
              <label key={s.name} className="flex cursor-pointer items-center gap-4 border-t border-line px-5 py-3 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={s.include}
                  disabled={!["sales", "invoices", "catalog"].includes(s.role)}
                  onChange={(e) => setAnalysis({ ...analysis, sheets: analysis.sheets.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) })}
                />
                <Sheet className="h-4 w-4 text-fg-3" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-fg-3">{s.reason || `Cabecera en fila ${s.headerRowIndex + 1} · ${s.columns.filter((c) => c.field).length} columnas reconocidas`}</span>
                </span>
                <span className="text-sm text-fg-3 num">{s.dataRowCount ? `${s.dataRowCount.toLocaleString("es-ES")} filas` : ""}</span>
                <Badge tone={ROLE_LABEL[s.role]!.tone}>{ROLE_LABEL[s.role]!.label}</Badge>
              </label>
            ))}
          </Card>
          {analysis.notes.map((n) => <Callout key={n} icon={Lightbulb}>{n}</Callout>)}
          <WizardNav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!analysis.kind || !analysis.sheets.some((s) => s.include && (s.role === "sales" || s.role === "invoices"))} />
        </div>
      )}

      {/* 3. Mapear */}
      {step === 2 && analysis?.kind && (
        <div className="flex flex-col gap-4">
          {analysis.sheets.filter((s) => s.include).map((s) => {
            const fields = fieldsFor(s.role === "catalog" ? "catalog" : (s.role as TargetKind));
            return (
              <Card key={s.name} padded={false}>
                <div className="flex items-center justify-between p-5 pb-3">
                  <CardHeader className="mb-0" title={s.name} description={`${ROLE_LABEL[s.role]!.label} · cabecera en fila ${s.headerRowIndex + 1}`} />
                </div>
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-y border-line bg-surface-2 text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Columna del archivo</th><th className="px-3 py-2 text-left font-medium">Campo del sistema</th><th className="px-3 py-2 text-left font-medium">Confianza</th><th className="px-5 py-2 text-left font-medium">Ejemplos</th></tr></thead>
                    <tbody>
                      {s.columns.map((c) => (
                        <tr key={c.index} className="border-b border-line last:border-0">
                          <td className="px-5 py-2 font-medium">«{c.header}»</td>
                          <td className="px-3 py-2">
                            <Select
                              value={c.field ?? ""}
                              className="w-48"
                              onChange={(e) =>
                                setAnalysis({
                                  ...analysis,
                                  sheets: analysis.sheets.map((x) => (x.name !== s.name ? x : { ...x, columns: x.columns.map((y) => (y.index === c.index ? { ...y, field: e.target.value || null, confidence: e.target.value ? "high" : "none" } : y.field === e.target.value && e.target.value ? { ...y, field: null, confidence: "none" } : y)) })),
                                })
                              }
                            >
                              <option value="">— Ignorar —</option>
                              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                            </Select>
                          </td>
                          <td className="px-3 py-2">{c.field ? <Badge tone={c.confidence === "high" ? "success" : "warning"}>{c.confidence === "high" ? "Alta" : "Media"}</Badge> : <span className="text-xs text-fg-3">—</span>}</td>
                          <td className="px-5 py-2 text-xs text-fg-3">{c.samples.join(" · ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          {requiredMissing.length > 0 && <Callout tone="danger" title="Faltan campos obligatorios">{requiredMissing.join(" · ")}</Callout>}
          <WizardNav onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={requiredMissing.length > 0} />
        </div>
      )}

      {/* 4. Previsualizar */}
      {step === 3 && plan && (
        <div className="flex flex-col gap-4">
          <Callout icon={Info}>Así se guardarán los registros. Primeras {Math.min(60, plan.rows.length)} de {plan.rows.length.toLocaleString("es-ES")} filas; en el siguiente paso las validarás todas.</Callout>
          {plan.catalog.length > 0 && (
            <Card padded={false}>
              <div className="p-5 pb-3"><CardHeader className="mb-0" title={`Catálogo · ${plan.catalog.length} productos`} description="IVA propuesto por categoría (a validar con la gestoría)." /></div>
              <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
                {plan.catalog.slice(0, 30).map((c) => (
                  <div key={c.key} className="flex items-center justify-between bg-surface px-4 py-2 text-sm">
                    <span className="min-w-0 truncate">{c.name}<span className="ml-2 text-xs text-fg-3">{c.categoryName}</span></span>
                    <span className="shrink-0 num">{c.price !== null ? formatMoney(c.price) : "—"} <span className="text-xs text-fg-3">· {c.taxRateBp / 100} %</span></span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card padded={false}><RowsTable plan={plan} rows={plan.rows.slice(0, 60)} /></Card>
          <WizardNav onBack={() => setStep(2)} onNext={() => setStep(4)} />
        </div>
      )}

      {/* 5. Validar */}
      {step === 4 && plan && summary && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Registros encontrados" value={summary.found.toLocaleString("es-ES")} hint={summary.nonData ? `${summary.nonData} filas no son datos` : undefined} />
            <Kpi label="Válidos" value={summary.valid.toLocaleString("es-ES")} hint={`${summary.highConfidence} alta · ${summary.mediumConfidence} media confianza`} />
            <Kpi label="Requieren revisión" value={summary.review.toLocaleString("es-ES")} />
            <Kpi label="Posibles duplicados" value={summary.duplicates.toLocaleString("es-ES")} />
            <Kpi label="Errores" value={summary.errors.toLocaleString("es-ES")} />
            <Kpi label="A importar" value={summary.toImport.toLocaleString("es-ES")} hint={formatMoney(summary.amountToImport)} />
          </div>

          {plan.controls.length > 0 && (
            <Card>
              <CardHeader title="Control de cuadre" description="Los totales que declara el propio archivo frente a la suma de sus filas." />
              <div className="grid gap-2 md:grid-cols-2">
                {plan.controls.map((c) => (
                  <div key={c.label} className={cn("flex items-center justify-between rounded-md px-3 py-2 text-sm", c.ok ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg")}>
                    <span className="flex items-center gap-2">{c.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{c.label}</span>
                    <span className="font-medium num">{c.unit === "count" ? `${c.actual} / ${c.expected}` : c.ok ? formatMoney(c.actual) : `${formatMoney(c.actual)} ≠ ${formatMoney(c.expected)}`}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {plan.insights.length > 0 && (
            <Card>
              <CardHeader title="Lo que hemos entendido del archivo" />
              <ul className="flex flex-col gap-2.5 text-sm">
                {plan.insights.map((i) => <li key={i} className="flex gap-2.5"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><span>{i}</span></li>)}
              </ul>
            </Card>
          )}

          {plan.rows.some((r) => r.issues.some((i) => i.code === "DATE_OUTSIDE_SHEET")) && (
            <Card>
              <CardHeader title="Fechas fuera del mes de su hoja" description={`${plan.rows.filter((r) => r.issues.some((i) => i.code === "DATE_OUTSIDE_SHEET")).length} filas. Decide una vez para todas.`} />
              <Segmented
                value={options.dateOutsideSheet}
                onChange={(v) => setOptions({ ...options, dateOutsideSheet: v })}
                items={[{ value: "sheet_month", label: "Usar el mes de la hoja (recomendado)" }, { value: "keep", label: "Mantener la fecha escrita" }]}
              />
            </Card>
          )}

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
              <CardHeader className="mb-0" title="Revisión fila a fila" description="Cambia la decisión de cualquier fila. Nada dudoso se importa a ciegas." />
              <Segmented
                size="sm"
                value={rowFilter}
                onChange={setRowFilter}
                items={[
                  { value: "attention", label: "Con avisos" },
                  { value: "review", label: `Revisar (${summary.review})` },
                  { value: "duplicate", label: `Duplicados (${summary.duplicates})` },
                  { value: "error", label: `Errores (${summary.errors})` },
                  { value: "all", label: "Todas" },
                ]}
              />
            </div>
            <RowsTable
              plan={plan}
              editable
              rows={plan.rows.filter((r) => (rowFilter === "all" ? true : rowFilter === "attention" ? r.issues.some((i) => i.severity !== "info") : r.status === rowFilter)).slice(0, 300)}
              onDecision={(key, decision) => setOverrides((o) => ({ ...o, [key]: { ...o[key], decision } }))}
              onProduct={(key, product) => setOverrides((o) => ({ ...o, [key]: { ...o[key], product } }))}
            />
          </Card>
          {plan.nonDataRows.length > 0 && (
            <details className="rounded-lg border border-line bg-surface px-5 py-3 text-sm">
              <summary className="cursor-pointer font-medium">{plural(plan.nonDataRows.length, "fila descartada porque no es un registro", "filas descartadas porque no son registros")} (pies, instrucciones…)</summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-3">{plan.nonDataRows.slice(0, 40).map((n) => <li key={`${n.sheet}${n.rowNumber}`}>{n.sheet} · fila {n.rowNumber}: {n.text}</li>)}</ul>
            </details>
          )}
          <WizardNav onBack={() => setStep(3)} onNext={() => setStep(5)} nextLabel="Revisar y confirmar" />
        </div>
      )}

      {/* 6. Importar */}
      {step === 5 && plan && summary && !job && (
        <Card className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft"><Upload className="h-6 w-6 text-accent-fg" /></div>
          <h2 className="text-xl font-semibold tracking-tight">Confirmar importación</h2>
          <p className="mt-2 text-sm text-fg-3">
            Se crearán <strong className="text-fg">{plural(summary.toImport, plan.kind === "sales" ? "venta" : "factura", plan.kind === "sales" ? "ventas" : "facturas")}</strong> por <strong className="text-fg">{formatMoney(summary.amountToImport)}</strong>
            {summary.newProducts ? <>, <strong className="text-fg">{plural(summary.newProducts, "producto", "productos")}</strong></> : null}
            {summary.newCustomers ? <> y <strong className="text-fg">{plural(summary.newCustomers, "cliente", "clientes")}</strong></> : null}
            {" "}en {locations.find((l) => l.id === options.locationId)?.name}. Se ignorarán {summary.ignored.toLocaleString("es-ES")} filas.
          </p>
          <p className="mt-3 text-xs text-fg-3">Todo en una sola operación: o se guarda todo o nada. Cada registro queda enlazado a su fila de origen y la importación se puede revertir mientras sea seguro.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => setStep(4)}>Volver</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!summary.toImport} onClick={doImport}>Importar ahora</Button>
          </div>
        </Card>
      )}
      {job && (
        <Card className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success text-white"><Check className="h-6 w-6" /></div>
          <h2 className="text-xl font-semibold tracking-tight">Importación completada</h2>
          <p className="mt-2 text-sm text-fg-3">{Object.entries(job.summary.created).map(([k, v]) => `${v.toLocaleString("es-ES")} ${k}`).join(" · ")} · {formatMoney(job.summary.totalAmount ?? 0)}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate(`/importaciones/${job.id}`)}>Ver detalle</Button>
            <Button onClick={() => navigate(job.kind === "sales" ? "/ventas" : "/facturas")}>Ver {job.kind === "sales" ? "ventas" : "facturas"}</Button>
            <Button variant="primary" onClick={() => navigate("/")}>Ir al dashboard</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}

function WizardNav({ onBack, onNext, nextDisabled, nextLabel = "Continuar" }: { onBack: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="sticky bottom-16 z-10 mt-2 flex justify-between rounded-lg border border-line bg-surface/95 p-3 shadow-md backdrop-blur lg:bottom-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Atrás</Button>
      <Button variant="primary" iconRight={ArrowRight} onClick={onNext} disabled={nextDisabled}>{nextLabel}</Button>
    </div>
  );
}

const STATUS_BADGE = {
  valid: { label: "Válida", tone: "success" as const },
  review: { label: "Revisar", tone: "warning" as const },
  duplicate: { label: "Duplicado", tone: "info" as const },
  error: { label: "Error", tone: "danger" as const },
};
const CONF = { high: "Alta", medium: "Media", review: "Revisión" };

function RowsTable({ plan, rows, editable, onDecision, onProduct }: {
  plan: ImportPlan;
  rows: (SalesRow | InvoiceRow)[];
  editable?: boolean;
  onDecision?: (key: string, d: "import" | "ignore") => void;
  onProduct?: (key: string, p: SalesRow["product"]) => void;
}) {
  const ws = useWorkspace();
  if (!rows.length) return <p className="border-t border-line px-5 py-8 text-center text-sm text-fg-3">No hay filas en esta vista.</p>;
  const productOptions = [
    ...ws.products.filter((p) => p.status !== "archived").map((p) => ({ value: `e:${p.id}`, label: p.name, product: { kind: "existing" as const, id: p.id, name: p.name } })),
    ...plan.catalog.filter((c) => c.status === "valid" && !c.existingProductId).map((c) => ({ value: `n:${c.name}`, label: `${c.name} (nuevo)`, product: { kind: "new" as const, name: c.name } })),
  ];
  return (
    <div className="scrollbar-thin overflow-x-auto border-t border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-xs text-fg-3">
            <th className="px-4 py-2 text-left font-medium">Origen</th>
            {plan.kind === "sales" ? (
              <>
                <th className="px-3 py-2 text-left font-medium">Fecha</th>
                <th className="px-3 py-2 text-left font-medium">Producto</th>
                <th className="px-3 py-2 text-right font-medium">Uds</th>
                <th className="px-3 py-2 text-right font-medium">Importe</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 text-left font-medium">Factura</th>
                <th className="px-3 py-2 text-left font-medium">Emisión</th>
                <th className="px-3 py-2 text-left font-medium">Cliente</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </>
            )}
            <th className="px-3 py-2 text-left font-medium">Estado</th>
            <th className="min-w-[260px] px-3 py-2 text-left font-medium">Motivo</th>
            {editable && <th className="px-4 py-2 text-left font-medium">Decisión</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-b border-line align-top last:border-0", !isImportable(r) && "bg-surface-2/60")}>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-fg-3">{r.sheet}<br />fila {r.rowNumber}</td>
              {r.type === "sale" ? (
                <>
                  <td className="whitespace-nowrap px-3 py-2.5">{r.occurredAt ? formatDate(r.occurredAt) : <span className="text-danger-fg">—</span>}{r.granularity === "aggregate" && <span className="block text-2xs text-fg-3">resumen mensual</span>}</td>
                  <td className="px-3 py-2.5">
                    {editable && r.product.kind === "none" ? (
                      <Select
                        value=""
                        className="w-52"
                        onChange={(e) => { const opt = productOptions.find((o) => o.value === e.target.value); if (opt) onProduct?.(r.key, opt.product); }}
                      >
                        <option value="">Elegir producto…</option>
                        {r.candidates.length > 0 && <optgroup label="Sugeridos">{r.candidates.map((c) => <option key={c.name} value={c.id ? `e:${c.id}` : `n:${c.name}`}>{c.name}</option>)}</optgroup>}
                        <optgroup label="Todos">{productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                      </Select>
                    ) : (
                      <>
                        {r.product.kind === "none" ? <span className="text-fg-3">—</span> : r.product.name}
                        {r.product.kind === "new" && <Badge tone="accent" className="ml-1.5">nuevo</Badge>}
                        {r.categoryName && <span className="block text-xs text-fg-3">{r.categoryName}</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right num">{r.quantity ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-medium num">{r.total !== null ? formatMoney(r.total) : "—"}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.number}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{r.issueDate ? formatDate(r.issueDate) : "—"}</td>
                  <td className="px-3 py-2.5">{r.customerName}<span className="block font-mono text-2xs text-fg-3">{r.taxId || "sin NIF"}{r.customer.kind === "new" ? " · nuevo" : " · existente"}</span></td>
                  <td className="px-3 py-2.5 text-right font-medium num">{r.total !== null ? formatMoney(r.total) : "—"}<span className="block text-2xs font-normal text-fg-3">{r.invoiceStatus === "paid" ? "cobrada" : r.invoiceStatus === "issued" ? "pendiente" : "anulada"}</span></td>
                </>
              )}
              <td className="px-3 py-2.5">
                <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
                <span className="mt-1 block text-2xs text-fg-3">Confianza {CONF[r.confidence].toLowerCase()}</span>
              </td>
              <td className="px-3 py-2.5 text-xs">
                {r.issues.length ? (
                  <ul className="flex flex-col gap-1">
                    {r.issues.map((i, k) => (
                      <li key={k} className={cn("flex gap-1.5", i.severity === "error" ? "text-danger-fg" : i.severity === "warning" ? "text-warning-fg" : "text-fg-3")}>
                        {i.severity === "info" ? <Info className="mt-px h-3 w-3 shrink-0" /> : i.severity === "error" ? <XCircle className="mt-px h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
                        {i.text}
                      </li>
                    ))}
                  </ul>
                ) : <span className="flex items-center gap-1.5 text-success-fg"><CheckCircle2 className="h-3 w-3" />Sin incidencias</span>}
              </td>
              {editable && (
                <td className="px-4 py-2.5">
                  {r.status === "error" ? (
                    <span className="flex items-center gap-1 text-xs text-fg-3"><CircleDashed className="h-3 w-3" />No importable</span>
                  ) : (
                    <Segmented
                      size="sm"
                      value={r.decision}
                      onChange={(d) => onDecision?.(r.key, d)}
                      items={[{ value: "import", label: "Importar" }, { value: "ignore", label: "Ignorar" }]}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
