import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ban, CheckCircle2, Info, Receipt, Upload } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, Callout, DataTable, DescriptionList, Drawer, Field, Kpi, KpiStrip, Modal, Mono, Page, PageHeader, ReasonDialog, Select, useToast, type Column } from "@/design-system/components";
import { markInvoicePaid, voidInvoice } from "@/data/repos/invoices";
import type { Invoice } from "@/domain/types";
import { formatDate, formatDateTime, inPeriod, makePeriod } from "@/lib/dates";
import { formatMoney, formatRate, NUM } from "@/lib/money";
import { usePeriodFilter } from "../shared/PeriodPicker";
import { INVOICE_STATUS } from "./status";


const iso = (d?: string) => (d ? new Date(`${d}T00:00`).toISOString() : "");

export default function InvoicesPage() {
  const ws = useWorkspace();
  const { filterId } = useLocationScope();
  const [params, setParams] = useSearchParams();
  const { filter, control } = usePeriodFilter("all");
  const [status, setStatus] = useState<string>(params.get("estado") === "pendiente" ? "pending" : "all");
  const [method, setMethod] = useState("all");
  const [series, setSeries] = useState("all");
  const methodName = new Map(ws.paymentMethods.map((m) => [m.id, m.name]));
  const allSeries = [...new Set(ws.invoices.map((i) => i.series).filter(Boolean))] as string[];
  const scoped = ws.invoices.filter((i) => !filterId || !i.locationId || i.locationId === filterId);

  const rows = useMemo(
    () =>
      scoped
        .filter((i) => filter.test(i.issueDate) && (status === "all" || (status === "pending" ? i.status === "issued" || i.status === "partially_paid" : i.status === status)) && (method === "all" || i.paymentMethodId === method) && (series === "all" || i.series === series))
        .sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? "") || (b.number ?? b.externalNumber ?? "").localeCompare(a.number ?? a.externalNumber ?? "")),
    [scoped, filter, status, method, series],  
  );

  const now = new Date();
  const sumIn = (preset: "month" | "quarter" | "year") => {
    const p = makePeriod(preset, now);
    return scoped.filter((i) => i.status !== "void" && i.status !== "draft" && i.issueDate && inPeriod(iso(i.issueDate), p)).reduce((s, i) => s + i.total, 0);
  };
  const valid = rows.filter((i) => i.status !== "void" && i.status !== "draft");
  const pending = scoped.filter((i) => i.status === "issued" || i.status === "partially_paid");

  const columns: Column<Invoice>[] = [
    { id: "number", header: "Nº factura", hideable: false, sortValue: (i) => i.number ?? i.externalNumber ?? "", exportValue: (i) => i.number ?? i.externalNumber ?? "", cell: (i) => <Mono>{i.number ?? i.externalNumber}</Mono> },
    { id: "series", header: "Serie", cell: (i) => i.series ?? "—", exportValue: (i) => i.series ?? "", defaultHidden: true },
    { id: "date", header: "Emisión", sortValue: (i) => i.issueDate ?? "", exportValue: (i) => (i.issueDate ? new Date(`${i.issueDate}T00:00`) : null), exportFormat: "date", cell: (i) => (i.issueDate ? formatDate(`${i.issueDate}T00:00`) : "—") },
    { id: "customer", header: "Cliente", sortValue: (i) => i.customerName ?? "", exportValue: (i) => i.customerName ?? "", cell: (i) => (i.customerId ? <Link to={`/clientes/${i.customerId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{i.customerName}</Link> : i.customerName) },
    { id: "tax", header: "NIF", exportValue: (i) => i.customerTaxId ?? "", cell: (i) => <span className="font-mono text-xs text-fg-2">{i.customerTaxId ?? "—"}</span>, defaultHidden: true },
    { id: "concept", header: "Concepto", priority: "medium", exportValue: (i) => i.concept ?? "", cell: (i) => <span className="line-clamp-1 max-w-[220px] text-fg-2">{i.concept}</span> },
    { id: "period", header: "Periodo", priority: "low", exportValue: (i) => (i.servicePeriodStart ? `${i.servicePeriodStart} / ${i.servicePeriodEnd}` : ""), cell: (i) => (i.servicePeriodStart ? <span className="text-fg-2">{new Date(`${i.servicePeriodStart}T00:00`).toLocaleDateString("es-ES", { month: "short", year: "numeric" })}</span> : <span className="text-fg-3">—</span>) },
    { id: "base", header: "Base", align: "right", sortValue: (i) => i.subtotal, exportValue: (i) => i.subtotal / 100, exportFormat: "money", cell: (i) => formatMoney(i.subtotal), defaultHidden: true },
    { id: "vat", header: "IVA", align: "right", sortValue: (i) => i.taxTotal, exportValue: (i) => i.taxTotal / 100, exportFormat: "money", cell: (i) => formatMoney(i.taxTotal), defaultHidden: true },
    { id: "total", header: "Total", align: "right", sortValue: (i) => i.total, exportValue: (i) => i.total / 100, exportFormat: "money", cell: (i) => <span className={i.status === "void" ? "text-fg-3 line-through" : "font-medium"}>{formatMoney(i.total)}</span> },
    { id: "method", header: "Método", priority: "low", exportValue: (i) => methodName.get(i.paymentMethodId ?? "") ?? "", cell: (i) => <span className="text-fg-2">{methodName.get(i.paymentMethodId ?? "") ?? "—"}</span> },
    { id: "status", header: "Estado", sortValue: (i) => i.status, exportValue: (i) => INVOICE_STATUS[i.status].label, cell: (i) => <Badge tone={INVOICE_STATUS[i.status].tone} dot>{INVOICE_STATUS[i.status].label}</Badge> },
    { id: "paid", header: "Fecha cobro", exportValue: (i) => (i.paidAt ? new Date(i.paidAt) : null), exportFormat: "date", cell: (i) => (i.paidAt ? formatDate(i.paidAt) : "—"), defaultHidden: true },
  ];

  const selected = ws.invoices.find((i) => i.id === params.get("factura"));
  return (
    <Page wide>
      <PageHeader
        title="Facturas emitidas"
        description="Por fecha de emisión (criterio del IVA). El periodo de servicio se guarda aparte."
        actions={<Link to="/importaciones/nueva"><Button icon={Upload}>Importar facturas</Button></Link>}
      />
      <KpiStrip className="mb-5">
        <Kpi label="Facturación del mes" value={formatMoney(sumIn("month"))} hint={`Trimestre ${formatMoney(sumIn("quarter"))} · año ${formatMoney(sumIn("year"))}`} />
        <Kpi label="Pendiente de cobro" value={formatMoney(pending.reduce((s, i) => s + i.total - i.amountPaid, 0))} hint={pending.length === 1 ? "1 factura" : `${pending.length} facturas`} />
        <Kpi label="IVA repercutido" value={formatMoney(valid.reduce((s, i) => s + i.taxTotal, 0))} hint={filter.period?.label ?? "Selección actual"} />
        <Kpi label="Facturas" value={valid.length.toLocaleString("es-ES", NUM)} hint={valid.length ? `Importe medio ${formatMoney(Math.round(valid.reduce((s, i) => s + i.total, 0) / valid.length))}` : undefined} />
      </KpiStrip>
      <Callout className="mb-4" icon={Info}>
        La <strong>emisión de facturas propias</strong> (series y numeración legal, rectificativas, Verifactu) se activará tras validarla con tu gestoría. Hoy puedes importar, consultar, registrar cobros y anular.
      </Callout>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(i) => i.id}
        onRowClick={(i) => setParams({ factura: i.id })}
        searchText={(i) => `${i.number ?? ""} ${i.externalNumber ?? ""} ${i.customerName ?? ""} ${i.customerTaxId ?? ""} ${i.concept ?? ""}`}
        searchPlaceholder="Nº, cliente, NIF o concepto…"
        exportName="Facturas_emitidas"
        exportCompany={ws.organization.name}
        storageKey="invoices"
        rowClassName={(i) => (i.status === "void" ? "opacity-60" : undefined)}
        mobile={{
          title: (i) => i.customerName ?? "Sin cliente",
          value: (i) => <span className={i.status === "void" ? "text-fg-3 line-through" : undefined}>{formatMoney(i.total)}</span>,
          subtitle: (i) => <><span className="font-mono text-[12px]">{i.number ?? i.externalNumber ?? "—"}</span>{i.issueDate ? ` · ${formatDate(i.issueDate)}` : ""}{i.concept ? ` · ${i.concept}` : ""}</>,
          status: (i) => (i.status === "paid" ? null : <Badge tone={INVOICE_STATUS[i.status].tone} dot>{INVOICE_STATUS[i.status].label}</Badge>),
        }}
        toolbar={
          <>
            {control}
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[170px]">
              <option value="all">Todos los estados</option>
              <option value="paid">Cobradas</option>
              <option value="pending">Pendientes</option>
              <option value="void">Anuladas</option>
            </Select>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-[160px]">
              <option value="all">Todo método</option>
              {ws.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            {allSeries.length > 1 && (
              <Select value={series} onChange={(e) => setSeries(e.target.value)} className="w-[120px]">
                <option value="all">Toda serie</option>
                {allSeries.map((s) => <option key={s} value={s}>Serie {s}</option>)}
              </Select>
            )}
          </>
        }
        empty={{ icon: Receipt, title: "Aún no hay facturas", description: "Importa tu listado trimestral (XLSX/CSV): se crean facturas, clientes y cobros sin duplicados.", action: <Link to="/importaciones/nueva"><Button variant="primary" icon={Upload}>Importar facturas</Button></Link> }}
      />
      {selected && <InvoiceDrawer invoice={selected} onClose={() => setParams({})} />}
    </Page>
  );
}

function InvoiceDrawer({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [methodKey, setMethodKey] = useState("card");
  const items = ws.invoiceItems.filter((i) => i.invoiceId === invoice.id);
  const payments = ws.payments.filter((p) => p.invoiceId === invoice.id);
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
  const imp = invoice.importId ? ws.imports.find((i) => i.id === invoice.importId) : undefined;
  const rec = invoice.importId ? ws.importRecords.find((r) => r.entityId === invoice.id) : undefined;
  const pending = invoice.status === "issued" || invoice.status === "partially_paid";
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={invoice.number ?? invoice.externalNumber ?? "Factura"}
        subtitle={<span className="flex items-center gap-2">{invoice.issueDate ? formatDate(`${invoice.issueDate}T00:00`) : ""}<Badge tone={INVOICE_STATUS[invoice.status].tone} dot>{INVOICE_STATUS[invoice.status].label}</Badge></span>}
        footer={
          <>
            {invoice.status !== "void" && can("invoices.manage") && <Button variant="ghost" className="mr-auto text-danger-fg" icon={Ban} onClick={() => setVoiding(true)}>Anular</Button>}
            {pending && can("payments.manage") && <Button variant="primary" icon={CheckCircle2} onClick={() => setPaying(true)}>Registrar cobro</Button>}
          </>
        }
      >
        {invoice.status === "void" && <Callout tone="danger" className="mb-5" title="Factura anulada">{invoice.voidReason}</Callout>}
        <div className="mb-5 rounded-lg border border-line p-4">
          <p className="text-xs text-fg-3">Cliente</p>
          <p className="text-md font-semibold">{invoice.customerId ? <Link className="hover:underline" to={`/clientes/${invoice.customerId}`}>{invoice.customerName}</Link> : invoice.customerName}</p>
          <p className="font-mono text-xs text-fg-3">{invoice.customerTaxId ?? "Sin NIF"}</p>
        </div>
        <div className="rounded-lg border border-line">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between gap-3 border-b border-line px-4 py-3 text-sm last:border-0">
              <span><span className="font-medium">{it.description}</span><span className="block text-xs text-fg-3">IVA {formatRate(it.taxRateBp)}</span></span>
              <span className="font-medium num">{formatMoney(it.total)}</span>
            </div>
          ))}
          <div className="bg-surface-2 px-4 py-3 text-sm num">
            <div className="flex justify-between text-fg-3"><span>Base imponible</span><span>{formatMoney(invoice.subtotal)}</span></div>
            <div className="flex justify-between text-fg-3"><span>IVA</span><span>{formatMoney(invoice.taxTotal)}</span></div>
            <div className="mt-1 flex justify-between text-md font-semibold"><span>Total</span><span>{formatMoney(invoice.total)}</span></div>
          </div>
        </div>
        <DescriptionList
          className="mt-5"
          items={[
            { label: "Periodo de servicio", value: invoice.servicePeriodStart ? `${formatDate(`${invoice.servicePeriodStart}T00:00`)} – ${formatDate(`${invoice.servicePeriodEnd}T00:00`)}` : "—" },
            { label: "Serie", value: invoice.series ?? "—" },
            { label: "Cobrado", value: `${formatMoney(invoice.amountPaid)}${invoice.paidAt ? ` · ${formatDate(invoice.paidAt)}` : ""}` },
            ...(invoice.notes ? [{ label: "Descripción", value: invoice.notes }] : []),
            ...(imp ? [{ label: "Origen", value: <Link className="text-accent-fg hover:underline" to={`/importaciones/${imp.id}`}>{imp.fileName}{rec ? ` · ${rec.sheet} fila ${rec.rowNumber}` : ""}</Link> }] : []),
          ]}
        />
        {payments.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 text-sm font-semibold">Pagos</h3>
            {payments.map((p) => (
              <div key={p.id} className="mb-1.5 flex justify-between rounded-md border border-line px-3 py-2 text-sm">
                <span>{p.kind === "refund" ? "Devolución · " : ""}{methodName.get(p.methodKey)}<span className="ml-2 text-xs text-fg-3">{formatDateTime(p.paidAt)}</span></span>
                <span className="font-medium num">{p.kind === "refund" ? "−" : ""}{formatMoney(p.amount)}</span>
              </div>
            ))}
          </>
        )}
      </Drawer>
      {paying && (
        <Modal
          open
          onClose={() => setPaying(false)}
          size="sm"
          title="Registrar cobro"
          description={`${formatMoney(invoice.total - invoice.amountPaid)} de ${invoice.customerName}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPaying(false)}>Cancelar</Button>
              <Button variant="primary" onClick={() => { try { markInvoicePaid(ctx, invoice.id, methodKey); toast.success("Cobro registrado"); setPaying(false); } catch (e) { toast.fromError(e); } }}>Confirmar cobro</Button>
            </>
          }
        >
          <Field label="Método de pago">
            <Select value={methodKey} onChange={(e) => setMethodKey(e.target.value)}>
              {ws.paymentMethods.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.key}>{m.name}</option>)}
            </Select>
          </Field>
        </Modal>
      )}
      <ReasonDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        danger
        title="Anular factura"
        description="La factura no se borra: queda marcada como anulada con tu motivo. Si debe corregirse, la gestoría emitirá una rectificativa."
        confirmLabel="Anular factura"
        onConfirm={(r) => { try { voidInvoice(ctx, invoice.id, r); toast.success("Factura anulada"); setVoiding(false); } catch (e) { toast.fromError(e); } }}
      />
    </>
  );
}
