import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, Info, Scale } from "lucide-react";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Amount, Button, Callout, Card, CardHeader, Ledger, Menu, MenuItem, Page, Section, Segmented, Select } from "@/design-system/components";
import { vatSummary, type VatLine } from "@/domain/finance";
import { quarterPeriod, type Period } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { downloadCsv, downloadXlsx, euros, type ExportSheet } from "@/lib/export";
import { cn } from "@/lib/cn";
import { FinanceHeader, periodSpan } from "./shared";

/**
 * Impuestos: IVA repercutido, soportado y posición estimada por trimestre. Orientativo: no presenta declaraciones ni
 * sustituye a la asesoría. Criterios: ventas por fecha de operación, facturas por emisión, gastos por fecha de factura.
 */
export default function TaxesPage() {
  const ws = useWorkspace();
  const { filterId, current } = useLocationScope();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [q, setQ] = useState<string>(String(Math.floor(now.getMonth() / 3) + 1));
  const years = useMemo(() => {
    const ys = new Set<number>([now.getFullYear()]);
    for (const s of ws.sales) ys.add(Number(s.occurredAt.slice(0, 4)));
    for (const i of ws.invoices) if (i.issueDate) ys.add(Number(i.issueDate.slice(0, 4)));
    for (const e of ws.expenses) ys.add(Number(e.issueDate.slice(0, 4)));
    return [...ys].filter((y) => y > 2000).sort((a, b) => b - a);
  }, [ws.sales, ws.invoices, ws.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const period: Period = useMemo(() => {
    if (q === "year") return { preset: "year", start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `Año ${year}` };
    return quarterPeriod(year, Number(q));
  }, [year, q]);
  const vat = useMemo(() => vatSummary(ws, ws.expenses, period, filterId), [ws, period, filterId]);
  const quarters = useMemo(() => [1, 2, 3, 4].map((n) => ({ n, v: vatSummary(ws, ws.expenses, quarterPeriod(year, n), filterId) })), [ws, year, filterId]);
  const noExpenses = !ws.expenses.some((e) => e.status !== "void");

  const exportSheets = (): ExportSheet[] => [
    { name: "IVA repercutido", columns: [{ header: "Tipo" }, { header: "Base imponible", format: "money" }, { header: "Cuota", format: "money" }], rows: vat.output.map((v) => [formatRate(v.rateBp), euros(v.base), euros(v.tax)]) },
    { name: "IVA soportado", columns: [{ header: "Tipo" }, { header: "Base imponible", format: "money" }, { header: "Cuota", format: "money" }], rows: vat.input.map((v) => [formatRate(v.rateBp), euros(v.base), euros(v.tax)]) },
    { name: "Posición", columns: [{ header: "Concepto" }, { header: "Importe", format: "money" }], rows: [["IVA repercutido", euros(vat.outputTax)], ["IVA soportado", euros(vat.inputTax)], ["Posición estimada", euros(vat.position)]] },
  ];
  const file = `IVA_${q === "year" ? year : `Q${q}_${year}`}`;

  return (
    <Page wide>
      <FinanceHeader
        title="Impuestos"
        eyebrow={<>{period.label} · {periodSpan(period)}{current ? ` · ${current.name}` : ""}</>}
        control={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={q} onChange={setQ} items={[{ value: "1", label: "T1" }, { value: "2", label: "T2" }, { value: "3", label: "T3" }, { value: "4", label: "T4" }, { value: "year", label: "Año" }]} />
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-[96px]" aria-label="Año">{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          </div>
        }
        actions={
          <Menu trigger={(_, t) => <Button icon={Download} onClick={t}>Exportar</Button>}>
            {(close) => (
              <>
                <MenuItem icon={FileText} onClick={() => { close(); void downloadXlsx(file, exportSheets(), { company: ws.organization.name }); }}>Excel (.xlsx)</MenuItem>
                <MenuItem icon={Download} onClick={() => { close(); downloadCsv(file, exportSheets()[2]!); }}>CSV (posición)</MenuItem>
              </>
            )}
          </Menu>
        }
      />
      <Callout icon={Info} className="mb-6">
        Estimación orientativa a partir de tus registros para preparar la conversación con tu asesoría. <strong>No sustituye a la asesoría fiscal</strong> ni presenta declaraciones oficiales (modelo 303, 390…).
      </Callout>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Tile label="IVA repercutido" value={vat.outputTax} sub={`Base ${formatMoney(vat.output.reduce((s, v) => s + v.base, 0))}`} />
        <Tile label="IVA soportado" value={vat.inputTax} sub={noExpenses ? <Link className="text-accent-fg hover:underline" to="/gastos">Registra tus gastos para deducirlo →</Link> : `Base ${formatMoney(vat.input.reduce((s, v) => s + v.base, 0))}`} />
        <Tile label={vat.position >= 0 ? "Posición estimada · a ingresar" : "Posición estimada · a compensar"} value={Math.abs(vat.position)} sub="Repercutido − soportado" strong />
      </div>

      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <RateTable title="IVA repercutido" description="Ventas de caja por fecha de operación y facturas emitidas por fecha de emisión" lines={vat.output} empty="Sin operaciones con IVA en el periodo" />
        <RateTable title="IVA soportado" description="Gastos no anulados por fecha de la factura del proveedor" lines={vat.input} empty={noExpenses ? "Aún no hay gastos registrados" : "Sin gastos en el periodo"} />
      </div>

      <Section title={`Trimestres de ${year}`} description="Comparativa de la posición estimada por trimestre">
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-xs text-fg-3"><th className="px-5 py-2.5 text-left font-medium">Trimestre</th><th className="px-3 py-2.5 text-right font-medium">Repercutido</th><th className="px-3 py-2.5 text-right font-medium">Soportado</th><th className="px-5 py-2.5 text-right font-medium">Posición</th></tr></thead>
              <tbody>
                {quarters.map(({ n, v }) => (
                  <tr key={n} className={cn("border-b border-line last:border-0", String(n) === q && "bg-accent-soft/40")}>
                    <td className="px-5 py-3 font-medium"><button type="button" className="hover:underline" onClick={() => setQ(String(n))}>T{n} {year}</button></td>
                    <td className="px-3 py-3 text-right num">{formatMoney(v.outputTax)}</td>
                    <td className="px-3 py-3 text-right text-fg-2 num">{formatMoney(v.inputTax)}</td>
                    <td className={cn("px-5 py-3 text-right font-semibold num", v.position < 0 && "text-success-fg")}><Amount cents={v.position} muted={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 flex items-center gap-2 text-xs text-fg-3"><Scale className="h-3.5 w-3.5" />Retenciones, prorrata, recargo de equivalencia y regímenes especiales no se calculan: consúltalos con tu asesoría.</p>
      </Section>
    </Page>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: number; sub: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-5", strong ? "border-transparent bg-surface-inverse text-fg-inverse" : "surface-card")}>
      <p className={cn("text-xs font-medium", strong ? "text-fg-inverse/70" : "text-fg-3")}>{label}</p>
      <p className="mt-1.5 text-[28px] font-semibold leading-9 tracking-tight"><Amount cents={value} /></p>
      <p className={cn("mt-1 text-xs", strong ? "text-fg-inverse/60" : "text-fg-3")}>{sub}</p>
    </div>
  );
}

function RateTable({ title, description, lines, empty }: { title: string; description: string; lines: VatLine[]; empty: string }) {
  const base = lines.reduce((s, v) => s + v.base, 0);
  const tax = lines.reduce((s, v) => s + v.tax, 0);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {lines.length ? (
        <Ledger rows={[
          ...lines.map((v) => ({ label: `IVA ${formatRate(v.rateBp)}`, hint: `base ${formatMoney(v.base)}`, value: formatMoney(v.tax) })),
          { label: "Total", hint: `base ${formatMoney(base)}`, value: formatMoney(tax), strong: true },
        ]} />
      ) : <p className="py-6 text-center text-sm text-fg-3">{empty}</p>}
    </Card>
  );
}
