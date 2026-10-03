import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Plus, Receipt, Upload } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import { Badge, Button, DataTable, Field, FilterBar, FilterSelect, Kpi, KpiStrip, Modal, Mono, Page, SearchField, Select, useToast, type Column } from "@/design-system/components";
import { invoiceLabel, markInvoicesPaid } from "@/data/repos/invoices";
import { INVOICE_VIEW, invoiceView, type InvoiceView } from "@/domain/invoicing";
import type { Invoice } from "@/domain/types";
import { formatDate, inPeriod, makePeriod, toISODate } from "@/lib/dates";
import { formatMoney, NUM } from "@/lib/money";
import { euros } from "@/lib/export";
import { normalizeKey } from "@/lib/text";
import { usePeriodFilter } from "../shared/PeriodPicker";
import { FinanceHeader } from "../finance/shared";

const iso = (d?: string) => (d ? new Date(`${d}T00:00`).toISOString() : "");
const STATUS_PARAM: Record<string, InvoiceView> = { pendiente: "pending", vencida: "overdue", borrador: "draft", cobrada: "paid", anulada: "void", parcial: "partial" };

export default function InvoicesPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useSession();
  const ready = useServerReady();
  const { filterId } = useLocationScope();
  const [params] = useSearchParams();
  const { filter, pill } = usePeriodFilter("all");
  const [q, setQ] = useState("");
  const initialStatus = STATUS_PARAM[params.get("estado") ?? ""];
  const [status, setStatus] = useState<InvoiceView | "open" | "">(params.get("estado") === "pendiente" ? "open" : initialStatus ?? "");
  const [method, setMethod] = useState("");
  const [series, setSeries] = useState("");
  const [source, setSource] = useState<"" | Invoice["source"]>("");
  const [bulkPay, setBulkPay] = useState<Invoice[] | null>(null);
  const today = toISODate(new Date());
  const methodName = useMemo(() => new Map(ws.paymentMethods.map((m) => [m.id, m.name])), [ws.paymentMethods]);
  const seriesOf = (i: Invoice) => i.series ?? ws.documentSeries.find((s) => s.id === i.seriesId)?.prefix;
  const allSeries = [...new Set(ws.invoices.map(seriesOf).filter(Boolean))] as string[];
  const scoped = useMemo(() => ws.invoices.filter((i) => !filterId || !i.locationId || i.locationId === filterId), [ws.invoices, filterId]);

  const nq = normalizeKey(q);
  const rows = useMemo(
    () =>
      scoped
        .filter((i) => i.status === "draft" || filter.test(i.issueDate))
        .filter((i) => {
          const v = invoiceView(i, today);
          return !status || (status === "open" ? v === "pending" || v === "partial" || v === "overdue" : v === status);
        })
        .filter((i) => !method || i.paymentMethodId === method)
        .filter((i) => !series || seriesOf(i) === series)
        .filter((i) => !source || i.source === source)
        .filter((i) => !nq || normalizeKey(`${i.number ?? ""} ${i.externalNumber ?? ""} ${i.customerName ?? ""} ${i.customerTaxId ?? ""} ${i.concept ?? ""}`).includes(nq))
        .sort((a, b) => Number(b.status === "draft") - Number(a.status === "draft") || (b.issueDate ?? "").localeCompare(a.issueDate ?? "") || (b.number ?? b.externalNumber ?? "").localeCompare(a.number ?? a.externalNumber ?? "")),
    [scoped, filter, status, method, series, source, nq, today], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const now = new Date();
  const sumIn = (preset: "month" | "quarter" | "year") => {
    const p = makePeriod(preset, now);
    return scoped.filter((i) => i.status !== "void" && i.status !== "draft" && i.issueDate && inPeriod(iso(i.issueDate), p)).reduce((s, i) => s + i.total, 0);
  };
  const open = scoped.filter((i) => i.status === "issued" || i.status === "partially_paid");
  const overdue = open.filter((i) => invoiceView(i, today) === "overdue");
  const drafts = scoped.filter((i) => i.status === "draft");
  const counts = useMemo(() => {
    const m = new Map<InvoiceView, number>();
    for (const i of scoped) m.set(invoiceView(i, today), (m.get(invoiceView(i, today)) ?? 0) + 1);
    return m;
  }, [scoped, today]);
  const active = [q, status, method, series, source, filter.preset !== "all" ? "p" : ""].filter(Boolean).length;
  const clear = () => { setQ(""); setStatus(""); setMethod(""); setSeries(""); setSource(""); };

  const columns: Column<Invoice>[] = [
    { id: "number", header: "Nº factura", hideable: false, sortValue: (i) => i.number ?? i.externalNumber ?? "", exportValue: (i) => invoiceLabel(i), cell: (i) => i.status === "draft" ? <span className="text-sm italic text-fg-3">Borrador</span> : <Mono>{invoiceLabel(i)}</Mono> },
    { id: "series", header: "Serie", cell: (i) => seriesOf(i) ?? "—", exportValue: (i) => seriesOf(i) ?? "", defaultHidden: true },
    { id: "date", header: "Emisión", sortValue: (i) => i.issueDate ?? "", exportValue: (i) => (i.issueDate ? new Date(`${i.issueDate}T00:00`) : null), exportFormat: "date", cell: (i) => <span className="text-fg-2 num">{i.issueDate ? formatDate(i.issueDate) : "—"}</span> },
    { id: "customer", header: "Cliente", sortValue: (i) => i.customerName ?? "", exportValue: (i) => i.customerName ?? "", cell: (i) => <span className="block max-w-[260px] truncate font-medium">{i.customerName ?? <span className="text-fg-3">Sin destinatario</span>}</span> },
    { id: "tax", header: "NIF", exportValue: (i) => i.customerTaxId ?? "", cell: (i) => <span className="font-mono text-xs text-fg-2">{i.customerTaxId ?? "—"}</span>, defaultHidden: true },
    { id: "concept", header: "Concepto", priority: "low", exportValue: (i) => i.concept ?? "", cell: (i) => <span className="line-clamp-1 max-w-[240px] text-fg-2">{i.concept}</span> },
    { id: "due", header: "Vence", priority: "medium", sortValue: (i) => i.dueDate ?? "", exportValue: (i) => i.dueDate ?? "", cell: (i) => { const v = invoiceView(i, today); return <span className={v === "overdue" ? "font-medium text-danger-fg num" : "text-fg-2 num"}>{i.dueDate && i.status !== "paid" && i.status !== "void" ? formatDate(i.dueDate) : "—"}</span>; } },
    { id: "base", header: "Base", align: "right", sortValue: (i) => i.subtotal, exportValue: (i) => euros(i.subtotal), exportFormat: "money", cell: (i) => formatMoney(i.subtotal), defaultHidden: true },
    { id: "vat", header: "IVA", align: "right", sortValue: (i) => i.taxTotal, exportValue: (i) => euros(i.taxTotal), exportFormat: "money", cell: (i) => formatMoney(i.taxTotal), defaultHidden: true },
    { id: "pending", header: "Pendiente", align: "right", priority: "low", sortValue: (i) => (i.status === "issued" || i.status === "partially_paid" ? i.total - i.amountPaid : 0), exportValue: (i) => euros(i.status === "issued" || i.status === "partially_paid" ? i.total - i.amountPaid : 0), exportFormat: "money", cell: (i) => (i.status === "issued" || i.status === "partially_paid" ? <span className="text-warning-fg">{formatMoney(i.total - i.amountPaid)}</span> : <span className="text-fg-3">—</span>) },
    { id: "total", header: "Total", align: "right", sortValue: (i) => i.total, exportValue: (i) => euros(i.total), exportFormat: "money", cell: (i) => <span className={i.status === "void" ? "text-fg-3 line-through" : "font-semibold"}>{formatMoney(i.total)}</span> },
    { id: "method", header: "Método", priority: "low", exportValue: (i) => methodName.get(i.paymentMethodId ?? "") ?? "", cell: (i) => <span className="text-fg-2">{methodName.get(i.paymentMethodId ?? "") ?? "—"}</span>, defaultHidden: true },
    { id: "status", header: "Estado", sortValue: (i) => invoiceView(i, today), exportValue: (i) => INVOICE_VIEW[invoiceView(i, today)].label, cell: (i) => { const v = invoiceView(i, today); return <Badge tone={INVOICE_VIEW[v].tone} dot>{INVOICE_VIEW[v].label}</Badge>; } },
    { id: "paid", header: "Fecha cobro", exportValue: (i) => (i.paidAt ? new Date(i.paidAt) : null), exportFormat: "date", cell: (i) => (i.paidAt ? formatDate(i.paidAt) : "—"), defaultHidden: true },
  ];

  const createBtn = can("invoices.manage") && <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => navigate("/facturas/nueva")}>Nueva factura</Button>;
  return (
    <Page wide>
      <FinanceHeader
        title="Facturas"
        eyebrow="Emitidas, cobradas y pendientes · por fecha de emisión"
        actions={<>{can("imports.run") && <Link to="/importaciones/nueva"><Button icon={Upload}>Importar</Button></Link>}{createBtn}</>}
      />
      <ServerNotice what="La emisión de facturas" />
      <KpiStrip className="mb-5">
        <Kpi label="Facturado este mes" value={formatMoney(sumIn("month"))} hint={`Trimestre ${formatMoney(sumIn("quarter"))} · año ${formatMoney(sumIn("year"))}`} />
        <Kpi label="Pendiente de cobro" value={formatMoney(open.reduce((s, i) => s + i.total - i.amountPaid, 0))} hint={<button type="button" className="hover:underline" onClick={() => setStatus("open")}>{open.length === 1 ? "1 factura" : `${open.length.toLocaleString("es-ES", NUM)} facturas`}</button>} />
        <Kpi label="Vencidas" value={formatMoney(overdue.reduce((s, i) => s + i.total - i.amountPaid, 0))} hint={overdue.length ? <button type="button" className="text-danger-fg hover:underline" onClick={() => setStatus("overdue")}>{overdue.length} sin cobrar tras su vencimiento</button> : "Ninguna vencida"} />
        <Kpi label="Borradores" value={drafts.length.toLocaleString("es-ES", NUM)} hint={drafts.length ? <button type="button" className="hover:underline" onClick={() => setStatus("draft")}>Pendientes de emitir</button> : "Nada pendiente de emitir"} />
      </KpiStrip>

      <DataTable

        filters={<FilterBar className="mb-0" active={active} onClear={clear}>
          <SearchField value={q} onChange={setQ} placeholder="Nº, cliente, NIF o concepto…" />
          {pill}
          <FilterSelect
            label="Estado"
            value={status}
            onChange={setStatus}
            options={[
              { value: "open" as const, label: "Por cobrar (todas)", count: (counts.get("pending") ?? 0) + (counts.get("partial") ?? 0) + (counts.get("overdue") ?? 0) },
              ...(["draft", "pending", "partial", "overdue", "paid", "void"] as InvoiceView[]).map((v) => ({ value: v, label: INVOICE_VIEW[v].label, count: counts.get(v) ?? 0 })),
            ]}
          />
          <FilterSelect label="Origen" value={source} onChange={setSource} options={[{ value: "manual", label: "Emitidas aquí" }, { value: "membership", label: "Cuotas de membresía" }, { value: "import", label: "Importadas" }, { value: "sale", label: "Desde ventas" }]} />
          <FilterSelect label="Método" value={method} onChange={setMethod} options={ws.paymentMethods.filter((m) => m.status !== "archived").map((m) => ({ value: m.id, label: m.name }))} />
          {allSeries.length > 1 && <FilterSelect label="Serie" value={series} onChange={setSeries} options={allSeries.map((s) => ({ value: s, label: s }))} />}
        </FilterBar>}
        rows={rows}
        columns={columns}
        getRowId={(i) => i.id}
        onRowClick={(i) => navigate(i.status === "draft" && can("invoices.manage") ? `/facturas/${i.id}/editar` : `/facturas/${i.id}`)}
        exportName="Facturas"
        exportCompany={ws.organization.name}
        storageKey="invoices.v3"
        selectable={can("payments.manage") && ready}
        bulkActions={(sel, clearSel) => sel.some((i) => i.status === "issued" || i.status === "partially_paid") ? <Button size="sm" icon={CheckCircle2} onClick={() => { setBulkPay(sel); clearSel(); }}>Registrar cobro</Button> : null}
        rowClassName={(i) => (i.status === "void" ? "opacity-60" : undefined)}
        mobile={{
          title: (i) => i.customerName ?? "Sin cliente",
          value: (i) => <span className={i.status === "void" ? "text-fg-3 line-through" : undefined}>{formatMoney(i.total)}</span>,
          subtitle: (i) => <><span className="font-mono text-[12px]">{i.status === "draft" ? "Borrador" : invoiceLabel(i)}</span>{i.issueDate ? ` · ${formatDate(i.issueDate)}` : ""}</>,
          status: (i) => { const v = invoiceView(i, today); return v === "paid" ? null : <Badge tone={INVOICE_VIEW[v].tone} dot>{INVOICE_VIEW[v].label}</Badge>; },
        }}
        empty={{
          icon: Receipt,
          title: active ? "Ninguna factura con estos filtros" : "Aún no hay facturas",
          description: active ? "Prueba con otro periodo o quita filtros." : "Emite tu primera factura en menos de un minuto o importa tu histórico (XLSX/CSV) sin duplicados.",
          action: active ? <Button onClick={clear}>Quitar filtros</Button> : createBtn || undefined,
        }}
      />
      {bulkPay && <BulkPayModal invoices={bulkPay} onClose={() => setBulkPay(null)} onDone={(n) => toast.success(n === 1 ? "Cobro registrado" : `${n} cobros registrados`)} ctxPay={(ids, key) => markInvoicesPaid(ctx, ids, key)} />}
    </Page>
  );
}

function BulkPayModal({ invoices, onClose, onDone, ctxPay }: { invoices: Invoice[]; onClose: () => void; onDone: (n: number) => void; ctxPay: (ids: string[], methodKey: string) => number }) {
  const ws = useWorkspace();
  const toast = useToast();
  const open = invoices.filter((i) => i.status === "issued" || i.status === "partially_paid");
  const methods = ws.paymentMethods.filter((m) => m.status === "active" && m.kind !== "unknown");
  const [key, setKey] = useState(methods.find((m) => m.key === "transfer")?.key ?? methods[0]?.key ?? "card");
  return (
    <Modal open onClose={onClose} size="sm" title={`Registrar cobro de ${open.length} ${open.length === 1 ? "factura" : "facturas"}`} description={`${formatMoney(open.reduce((s, i) => s + i.total - i.amountPaid, 0))} pendientes en total`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => { try { onDone(ctxPay(open.map((i) => i.id), key)); onClose(); } catch (e) { toast.fromError(e); } }}>Registrar cobros</Button></>}>
      <Field label="Cobradas con"><Select value={key} onChange={(e) => setKey(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.key}>{m.name}</option>)}</Select></Field>
      <p className="mt-3 text-xs text-fg-3">Se registra el importe pendiente completo de cada factura con fecha de hoy. Para cobros parciales, abre la factura.</p>
    </Modal>
  );
}
