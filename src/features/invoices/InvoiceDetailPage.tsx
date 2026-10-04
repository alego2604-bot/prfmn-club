import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2, Copy, Download, FileCheck2, Link2, MoreHorizontal, Pencil, Printer, Receipt } from "lucide-react";
import { useCtx, useSession, useWorkspace } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Field, Input, Ledger, Menu, MenuItem, Modal, MoneyInput, Page, ProgressBar, ReasonDialog, Select, useToast, DateInput } from "@/design-system/components";
import { duplicateInvoice, invoiceLabel, issueInvoice, registerInvoicePayment, voidInvoice } from "@/data/repos/invoices";
import { INVOICE_VIEW, invoiceView } from "@/domain/invoicing";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AuditTrail } from "@/features/shared/AuditTrail";
import { InvoicePaper } from "./InvoicePaper";
import { downloadInvoicePdf, printInvoicePdf } from "./invoicePdf";
import { saleNo } from "@/lib/text";

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useSession();
  const ready = useServerReady();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const inv = ws.invoices.find((i) => i.id === id);
  if (!inv) {
    return <Page><EmptyState icon={Receipt} title="Factura no encontrada" description="Puede que pertenezca a otra empresa o que el enlace no sea correcto." action={<Button onClick={() => navigate("/facturas")}>Ver facturas</Button>} /></Page>;
  }
  const v = invoiceView(inv);
  const payments = ws.payments.filter((p) => p.invoiceId === inv.id).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
  const pending = inv.status === "issued" || inv.status === "partially_paid";
  const due = inv.total - inv.amountPaid;
  const imp = inv.importId ? ws.imports.find((i) => i.id === inv.importId) : undefined;
  const membership = inv.customerMembershipId ? ws.customerMemberships.find((m) => m.id === inv.customerMembershipId) : undefined;
  const plan = membership ? ws.membershipPlans.find((p) => p.id === membership.planId) : undefined;
  const sale = inv.saleId ? ws.sales.find((s) => s.id === inv.saleId) : undefined;
  const manage = can("invoices.manage") && ready;
  const legacyEditable = inv.status === "draft" && manage;

  const run = (fn: () => void, ok: string) => {
    try { fn(); toast.success(ok); } catch (e) { toast.fromError(e); }
  };

  return (
    <Page wide>
      <Link to="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Facturas</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-[26px] font-semibold tracking-[-0.02em]">{invoiceLabel(inv)}</h1>
            <Badge tone={INVOICE_VIEW[v].tone} dot>{INVOICE_VIEW[v].label}</Badge>
            {inv.source === "membership" && <Badge tone="accent">Cuota</Badge>}
            {inv.source === "import" && <Badge>Importada</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-3">
            {inv.customerId ? <Link className="font-medium text-fg-2 hover:underline" to={`/clientes/${inv.customerId}`}>{inv.customerName}</Link> : inv.customerName ?? "Sin destinatario"}
            {inv.issueDate ? ` · emitida el ${formatDate(inv.issueDate)}` : " · sin emitir"}
            {inv.dueDate && pending ? ` · vence el ${formatDate(inv.dueDate)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {legacyEditable && <Button icon={Pencil} onClick={() => navigate(`/facturas/${inv.id}/editar`)}>Editar</Button>}
          <Button icon={Download} onClick={() => void downloadInvoicePdf(ws, inv)}>PDF</Button>
          <Button icon={Printer} className="hidden sm:inline-flex" onClick={() => void printInvoicePdf(ws, inv)}>Imprimir</Button>
          {manage && (
            <Menu width={220} trigger={(_, t) => <Button icon={MoreHorizontal} onClick={t} aria-label="Más acciones">Más</Button>}>
              {(close) => (
                <>
                  <MenuItem icon={Copy} onClick={() => { close(); try { const c = duplicateInvoice(ctx, inv.id); toast.success("Borrador creado a partir de esta factura"); navigate(`/facturas/${c.id}/editar`); } catch (e) { toast.fromError(e); } }}>Duplicar</MenuItem>
                  <MenuItem icon={Printer} onClick={() => { close(); void printInvoicePdf(ws, inv); }}>Imprimir</MenuItem>
                  {inv.status !== "void" && <MenuItem icon={Ban} danger onClick={() => { close(); setVoiding(true); }}>{inv.status === "draft" ? "Descartar borrador" : "Anular factura"}</MenuItem>}
                </>
              )}
            </Menu>
          )}
          {inv.status === "draft" && manage && <Button variant="primary" icon={FileCheck2} onClick={() => setIssuing(true)}>Emitir</Button>}
          {pending && can("payments.manage") && ready && <Button variant="primary" icon={CheckCircle2} onClick={() => setPaying(true)}>Registrar cobro</Button>}
        </div>
      </div>

      {inv.status === "void" && <Callout tone="danger" className="mb-5" title={inv.status === "void" && !inv.number ? "Borrador descartado" : "Factura anulada"}>{inv.voidReason}{inv.voidedAt ? ` · ${formatDateTime(inv.voidedAt)}` : ""}</Callout>}
      {inv.status !== "draft" && !inv.number && !inv.externalNumber && inv.status !== "void" && <Callout tone="accent" className="mb-5">Asignando número en el servidor… aparecerá en cuanto se confirme el guardado.</Callout>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <InvoicePaper invoice={inv} />
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm text-fg-3">{pending ? "Pendiente de cobro" : "Total"}</p>
            <p className="figure mt-1 text-[36px] leading-none">{formatMoney(pending ? due : inv.total)}</p>
            {inv.status !== "draft" && inv.status !== "void" && (
              <>
                <ProgressBar className="mt-4" value={inv.amountPaid} max={inv.total} tone={inv.status === "paid" ? "success" : "accent"} label="Cobrado" />
                <p className="mt-2 text-xs text-fg-3 num">Cobrado {formatMoney(inv.amountPaid)} de {formatMoney(inv.total)}</p>
              </>
            )}
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-2"><CardHeader className="mb-0" title="Cobros" description={payments.length ? `${payments.length} ${payments.length === 1 ? "pago" : "pagos"}` : undefined} /></div>
            {payments.length ? (
              <ul>
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">{p.kind === "refund" ? "Devolución · " : ""}{methodName.get(p.methodKey) ?? "Pago"}</span>
                      <span className="block text-xs text-fg-3">{formatDateTime(p.paidAt)}{p.reference ? ` · ${p.reference}` : ""}</span>
                    </span>
                    <span className="font-semibold num">{p.kind === "refund" ? "−" : ""}{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-line px-5 py-4 text-sm text-fg-3">{inv.status === "paid" ? "Cobrada (el cobro consta en la factura importada)." : inv.status === "draft" ? "Se podrán registrar cobros al emitirla." : "Sin cobros registrados."}</p>
            )}
          </Card>
          {(membership || sale || imp) && (
            <Card>
              <CardHeader title="Relacionado" action={<Link2 className="h-4 w-4 text-fg-3" />} />
              <Ledger rows={[
                ...(membership ? [{ label: "Membresía", value: <Link className="text-accent-fg hover:underline" to={`/clientes/${membership.customerId}?tab=membresia`}>{plan?.name ?? "Ver"}</Link> }] : []),
                ...(sale ? [{ label: "Venta", value: <Link className="text-accent-fg hover:underline" to={`/ventas?venta=${sale.id}`}>Ticket {saleNo(sale.number)}</Link> }] : []),
                ...(imp ? [{ label: "Importación", value: <Link className="text-accent-fg hover:underline" to={`/importaciones/${imp.id}`}>{imp.fileName}</Link> }] : []),
              ]} />
            </Card>
          )}
          <Card><AuditTrail entityIds={[inv.id]} /></Card>
        </div>
      </div>

      {paying && <PaymentModal invoiceId={inv.id} due={due} onClose={() => setPaying(false)} />}
      <ReasonDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        danger
        title={inv.status === "draft" ? "Descartar borrador" : "Anular factura"}
        description={inv.status === "draft" ? "El borrador deja de aparecer como pendiente. Queda en el histórico." : "La factura no se borra: queda anulada con tu motivo y fuera de totales e IVA. Si había que corregirla, duplícala y emite una nueva."}
        confirmLabel={inv.status === "draft" ? "Descartar" : "Anular factura"}
        onConfirm={(r) => run(() => { voidInvoice(ctx, inv.id, r); setVoiding(false); }, inv.status === "draft" ? "Borrador descartado" : "Factura anulada")}
      />
      <Modal
        open={issuing}
        onClose={() => setIssuing(false)}
        size="sm"
        title="¿Emitir la factura?"
        description={`${inv.customerName ?? ""} · ${formatMoney(inv.total)}`}
        footer={<><Button onClick={() => setIssuing(false)}>Cancelar</Button><Button variant="primary" onClick={() => run(() => { issueInvoice(ctx, inv.id); setIssuing(false); }, "Factura emitida")}>Emitir ahora</Button></>}
      >
        <p className="text-sm text-fg-2">Se asignará el siguiente número de la serie y la factura quedará bloqueada (solo se podrá cobrar o anular).</p>
      </Modal>
    </Page>
  );
}

export function PaymentModal({ invoiceId, due, onClose }: { invoiceId: string; due: number; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const methods = ws.paymentMethods.filter((m) => m.status === "active" && m.kind !== "unknown");
  const [methodKey, setMethodKey] = useState(methods.find((m) => m.key === "transfer")?.key ?? methods[0]?.key ?? "card");
  const [amount, setAmount] = useState<number | null>(due);
  const [date, setDate] = useState(toISODate(new Date()));
  const [reference, setReference] = useState("");
  const submit = () => {
    try {
      registerInvoicePayment(ctx, invoiceId, { methodKey, amount: amount ?? undefined, paidAt: date, reference });
      toast.success(amount && amount < due ? "Cobro parcial registrado" : "Factura cobrada");
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Registrar cobro" description={`Pendiente: ${formatMoney(due)}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!amount || amount <= 0} onClick={submit}>{amount && amount < due ? "Registrar cobro parcial" : "Registrar cobro"}</Button></>}>
      <div className="grid gap-4">
        <Field label="Importe" hint={amount && amount < due ? `Quedarán ${formatMoney(due - amount)} pendientes` : "Cobro completo"}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Método"><Select value={methodKey} onChange={(e) => setMethodKey(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.key}>{m.name}</option>)}</Select></Field>
          <Field label="Fecha"><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Referencia" hint="Opcional: nº de transferencia, recibo…"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
