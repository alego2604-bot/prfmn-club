import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, FileCheck2, Plus, Save, Trash2, UserRound } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import {
  Button, Callout, Card, Combobox, EmptyState, Field, IconButton, Input, Modal, MoneyInput, Page, Segmented, Select, Textarea, useToast,
} from "@/design-system/components";
import { issueInvoice, saveInvoiceDraft, type InvoiceDraftInput } from "@/data/repos/invoices";
import { customerName } from "@/data/repos/customers";
import { addDaysISO, draftTotals, invoiceSeriesFor, itemsToDraft, toInvoiceItems, type DraftLine } from "@/domain/invoicing";
import { currentVersion } from "@/domain/memberships";
import type { Invoice } from "@/domain/types";
import { formatMoney, formatRate } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";
import { InvoicePaper } from "./InvoicePaper";
import { Receipt } from "lucide-react";

const DUE: { value: number; label: string }[] = [
  { value: 0, label: "Al contado" },
  { value: 7, label: "7 días" },
  { value: 15, label: "15 días" },
  { value: 30, label: "30 días" },
  { value: 60, label: "60 días" },
];

const emptyLine = (rate: number): DraftLine => ({ description: "", quantity: 1, unitPrice: 0, taxRateBp: rate, discountPct: 0 });

/** Crear y editar borradores. Emitir asigna número de la serie (en el servidor) y congela la factura. */
export default function InvoiceEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useSession();
  const ready = useServerReady();
  const { current, locations } = useLocationScope();
  const existing = id ? ws.invoices.find((i) => i.id === id) : undefined;
  const defRate = ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100;
  const rates = [...new Set(ws.taxRates.filter((t) => t.status === "active").map((t) => t.rateBp))].sort((a, b) => b - a);

  const [mode, setMode] = useState<"customer" | "free">(existing && !existing.customerId && existing.customerName ? "free" : "customer");
  const [form, setForm] = useState<InvoiceDraftInput>(() => {
    if (existing) {
      const due = existing.issueDate && existing.dueDate ? Math.round((new Date(existing.dueDate).getTime() - new Date(existing.issueDate).getTime()) / 86_400_000) : 0;
      return {
        customerId: existing.customerId, customerName: existing.customerId ? undefined : existing.customerName, customerTaxId: existing.customerId ? undefined : existing.customerTaxId,
        customerAddress: existing.customerId ? undefined : existing.customerAddress, locationId: existing.locationId, issueDate: existing.issueDate ?? toISODate(new Date()), dueDays: due,
        concept: existing.concept, servicePeriodStart: existing.servicePeriodStart, servicePeriodEnd: existing.servicePeriodEnd, notes: existing.notes,
        lines: itemsToDraft(ws.invoiceItems.filter((it) => it.invoiceId === existing.id)),
      };
    }
    return { customerId: params.get("cliente") ?? undefined, issueDate: toISODate(new Date()), dueDays: 0, locationId: current?.id, lines: [emptyLine(defRate)] };
  });
  const [showPeriod, setShowPeriod] = useState(!!form.servicePeriodStart);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof InvoiceDraftInput>(k: K, v: InvoiceDraftInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<DraftLine>) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    if (existing && existing.status !== "draft") navigate(`/facturas/${existing.id}`, { replace: true });
  }, [existing, navigate]);

  const totals = useMemo(() => draftTotals(form.lines), [form.lines]);
  const customer = ws.customers.find((c) => c.id === form.customerId);
  const series = invoiceSeriesFor(ws.documentSeries, form.issueDate);
  const missingTax = !!customer && !customer.taxId;
  const recipientOk = mode === "customer" ? !!customer : !!form.customerName?.trim();
  const canIssue = recipientOk && totals.total > 0 && !!series;

  const productOptions = useMemo(() => [
    ...ws.products.filter((p) => p.status === "active").map((p) => ({ value: `p:${p.id}`, label: p.name, hint: formatMoney(p.price) })),
    ...ws.membershipPlans.filter((p) => p.status === "active").map((p) => {
      const v = currentVersion(ws.planVersions, p.id);
      return { value: `m:${p.id}`, label: p.name, hint: v ? `Tarifa · ${formatMoney(v.price)}` : "Tarifa" };
    }),
  ], [ws.products, ws.membershipPlans, ws.planVersions]);

  const addFromCatalog = (value: string | undefined) => {
    if (!value) return;
    const [kind, pid] = value.split(":");
    if (kind === "p") {
      const p = ws.products.find((x) => x.id === pid);
      if (p) setForm((f) => ({ ...f, lines: [...f.lines.filter((l) => l.description.trim() || l.unitPrice), { description: p.name, quantity: 1, unitPrice: p.price, taxRateBp: p.taxRateBp, productId: p.id, discountPct: 0 }] }));
    } else {
      const plan = ws.membershipPlans.find((x) => x.id === pid);
      const v = plan && currentVersion(ws.planVersions, plan.id);
      if (plan && v) setForm((f) => ({ ...f, lines: [...f.lines.filter((l) => l.description.trim() || l.unitPrice), { description: plan.name, quantity: 1, unitPrice: v.price, taxRateBp: v.taxRateBp, planVersionId: v.id, discountPct: 0 }] }));
    }
  };

  const payload = (): InvoiceDraftInput => (mode === "customer" ? { ...form, customerName: undefined, customerTaxId: undefined, customerAddress: undefined } : { ...form, customerId: undefined });
  const saveDraft = (): Invoice | null => {
    try {
      return saveInvoiceDraft(ctx, payload(), existing?.id);
    } catch (e) {
      toast.fromError(e, "No se ha podido guardar el borrador");
      return null;
    }
  };
  const onSave = () => {
    setBusy(true);
    const saved = saveDraft();
    setBusy(false);
    if (saved) {
      toast.success("Borrador guardado", "Puedes emitirlo cuando quieras");
      navigate(`/facturas/${saved.id}`);
    }
  };
  const onIssue = () => {
    setBusy(true);
    const saved = saveDraft();
    if (!saved) return setBusy(false);
    try {
      const inv = issueInvoice(ctx, saved.id);
      toast.success("Factura emitida", inv.number ? `Número ${inv.number}` : "El número se asigna al guardar en el servidor");
      navigate(`/facturas/${saved.id}`);
    } catch (e) {
      toast.fromError(e, "No se ha podido emitir");
      navigate(`/facturas/${saved.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (!can("invoices.manage")) {
    return <Page><EmptyState icon={Receipt} title="Sin permiso para facturar" description="Tu rol puede consultar facturas pero no crearlas. Pide a un administrador el permiso de facturación." /></Page>;
  }

  // Factura de vista previa (sin guardar)
  const previewInvoice: Invoice = {
    id: existing?.id ?? "preview", organizationId: ws.organization.id, status: "draft", amountPaid: 0, source: "manual", createdAt: "",
    issueDate: form.issueDate, dueDate: addDaysISO(form.issueDate, form.dueDays), concept: form.concept || form.lines.find((l) => l.description.trim())?.description,
    customerName: mode === "customer" ? (customer ? customer.companyName || customerName(customer) : undefined) : form.customerName,
    customerTaxId: mode === "customer" ? customer?.taxId : form.customerTaxId,
    customerAddress: mode === "customer" ? [customer?.address, [customer?.postalCode, customer?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined : form.customerAddress,
    servicePeriodStart: form.servicePeriodStart, servicePeriodEnd: form.servicePeriodEnd, notes: form.notes,
    subtotal: totals.subtotal, taxTotal: totals.taxTotal, discountTotal: totals.discountTotal, total: totals.total,
  };
  const previewItems = toInvoiceItems(form.lines, { organizationId: ws.organization.id, invoiceId: previewInvoice.id }, () => Math.random().toString(36).slice(2));

  return (
    <Page wide>
      <Link to={existing ? `/facturas/${existing.id}` : "/facturas"} className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />{existing ? "Volver a la factura" : "Facturas"}</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-3">{existing ? "Borrador · " : ""}{series ? `Serie ${series.prefix.replace(/[\s·/-]+$/, "")}` : "Sin serie para este año"}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em]">{existing ? "Editar borrador" : "Nueva factura"}</h1>
        </div>
        <Button icon={Eye} className="xl:hidden" onClick={() => setPreview(true)}>Vista previa</Button>
      </div>
      <ServerNotice what="La emisión de facturas" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">Destinatario</h2>
              <Segmented size="sm" value={mode} onChange={setMode} items={[{ value: "customer", label: "Cliente" }, { value: "free", label: "Otro destinatario" }]} />
            </div>
            {mode === "customer" ? (
              <>
                <Field label="Cliente" required>
                  <Combobox
                    value={form.customerId}
                    onChange={(v) => set("customerId", v)}
                    placeholder="Buscar cliente por nombre, NIF o email…"
                    options={ws.customers.filter((c) => !c.deletedAt).map((c) => ({ value: c.id, label: c.companyName || customerName(c), hint: c.taxId ?? c.email, keywords: `${c.email ?? ""} ${c.phone ?? ""}` }))}
                  />
                </Field>
                {customer && (
                  <div className="mt-3 flex items-start gap-3 rounded-lg bg-surface-2 px-3.5 py-3 text-sm">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
                    <div className="min-w-0 flex-1 text-fg-2">
                      <p className="font-medium text-fg">{customer.companyName || customerName(customer)}</p>
                      <p>{customer.taxId ? `NIF ${customer.taxId}` : "Sin NIF"}{customer.address ? ` · ${[customer.address, customer.city].filter(Boolean).join(", ")}` : ""}</p>
                    </div>
                    <Link to={`/clientes/${customer.id}`} className="shrink-0 text-xs font-medium text-fg-3 hover:text-fg">Ficha →</Link>
                  </div>
                )}
                {missingTax && <Callout tone="warning" className="mt-3">Este cliente no tiene NIF. Para una factura completa añádelo en su ficha (o usa «Otro destinatario»).</Callout>}
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre o razón social" required className="sm:col-span-2"><Input value={form.customerName ?? ""} onChange={(e) => set("customerName", e.target.value)} /></Field>
                <Field label="NIF / CIF"><Input value={form.customerTaxId ?? ""} onChange={(e) => set("customerTaxId", e.target.value)} /></Field>
                <Field label="Dirección fiscal"><Input value={form.customerAddress ?? ""} onChange={(e) => set("customerAddress", e.target.value)} /></Field>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-[15px] font-semibold">Datos de la factura</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Fecha de emisión" required><Input type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} /></Field>
              <Field label="Vencimiento" hint={`Vence el ${formatDate(addDaysISO(form.issueDate, form.dueDays))}`}>
                <Select value={form.dueDays} onChange={(e) => set("dueDays", Number(e.target.value))}>
                  {DUE.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </Select>
              </Field>
              <Field label="Centro">
                <Select value={form.locationId ?? ""} onChange={(e) => set("locationId", e.target.value || undefined)}>
                  <option value="">Sin centro</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
              <Field label="Concepto" className="sm:col-span-3" hint="Opcional. Si lo dejas vacío se usa la primera línea.">
                <Input value={form.concept ?? ""} onChange={(e) => set("concept", e.target.value)} placeholder="Ej. Servicios de octubre" />
              </Field>
            </div>
            {showPeriod ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Periodo de servicio: desde"><Input type="date" value={form.servicePeriodStart ?? ""} onChange={(e) => set("servicePeriodStart", e.target.value || undefined)} /></Field>
                <Field label="Hasta"><Input type="date" value={form.servicePeriodEnd ?? ""} min={form.servicePeriodStart} onChange={(e) => set("servicePeriodEnd", e.target.value || undefined)} /></Field>
              </div>
            ) : (
              <button type="button" className="mt-3 text-sm font-medium text-accent-fg hover:underline" onClick={() => setShowPeriod(true)}>+ Indicar periodo de servicio (cuotas, suscripciones)</button>
            )}
          </Card>

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
              <h2 className="text-[15px] font-semibold">Líneas</h2>
              <div className="w-full sm:w-72">
                <Combobox value={undefined} onChange={addFromCatalog} placeholder="Añadir producto o tarifa…" options={productOptions} clearable={false} />
              </div>
            </div>
            <ul className="border-t border-line">
              {form.lines.map((l, i) => {
                const gross = Math.round(l.unitPrice * (l.quantity || 0));
                const total = gross - Math.round((gross * Math.min(100, l.discountPct ?? 0)) / 100);
                return (
                  <li key={i} className="border-b border-line px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-2xs font-semibold text-fg-3 num">{i + 1}</span>
                      <Input className="min-w-0 flex-1" aria-label={`Descripción de la línea ${i + 1}`} placeholder="Descripción del producto o servicio" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      <span className="hidden w-24 shrink-0 text-right font-semibold num sm:block">{formatMoney(total)}</span>
                      <IconButton icon={Trash2} label="Quitar línea" size="sm" disabled={form.lines.length === 1} onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} />
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2.5 pl-9 sm:grid-cols-[88px_140px_96px_110px] sm:pr-[132px]">
                      <label className="flex flex-col gap-1 text-xs text-fg-3">Cantidad<Input inputMode="decimal" className="text-right num" value={String(l.quantity)} onChange={(e) => setLine(i, { quantity: Number(e.target.value.replace(",", ".")) || 0 })} /></label>
                      <label className="flex flex-col gap-1 text-xs text-fg-3">Precio (IVA incl.)<MoneyInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v ?? 0 })} /></label>
                      <label className="flex flex-col gap-1 text-xs text-fg-3">Descuento %<Input inputMode="decimal" className="text-right num" value={String(l.discountPct ?? 0)} onChange={(e) => setLine(i, { discountPct: Math.min(100, Math.max(0, Number(e.target.value.replace(",", ".")) || 0)) })} /></label>
                      <label className="flex flex-col gap-1 text-xs text-fg-3">IVA
                        <Select value={l.taxRateBp} onChange={(e) => setLine(i, { taxRateBp: Number(e.target.value) })}>
                          {[...new Set([...rates, l.taxRateBp])].map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
                        </Select>
                      </label>
                    </div>
                    <p className="mt-2 flex justify-between pl-9 text-sm sm:hidden"><span className="text-fg-3">Importe</span><span className="font-semibold num">{formatMoney(total)}</span></p>
                  </li>
                );
              })}
            </ul>
            <div className="px-5 py-3">
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine(defRate)] }))}>Añadir línea</Button>
            </div>
          </Card>

          <Card>
            <Field label="Notas en la factura" hint="Aparecen al pie del documento (forma de pago, IBAN, condiciones…)">
              <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <p className="text-sm text-fg-3">Total de la factura</p>
            <p className="figure mt-1 text-[40px] leading-none">{formatMoney(totals.total)}</p>
            <dl className="mt-4 text-sm">
              {totals.byRate.map((r) => (
                <div key={r.rateBp} className="flex justify-between border-t border-line py-2 text-fg-2"><dt>Base {formatRate(r.rateBp)} · IVA {formatMoney(r.tax)}</dt><dd className="num">{formatMoney(r.base)}</dd></div>
              ))}
              {totals.discountTotal > 0 && <div className="flex justify-between border-t border-line py-2 text-fg-2"><dt>Descuentos</dt><dd className="num">−{formatMoney(totals.discountTotal)}</dd></div>}
              <div className="flex justify-between border-t border-line-strong pt-2.5 font-semibold"><dt>Base imponible total</dt><dd className="num">{formatMoney(totals.subtotal)}</dd></div>
            </dl>
            {!series && <Callout tone="warning" className="mt-4">No hay serie de facturas activa para {form.issueDate.slice(0, 4)}. Créala en Ajustes → Facturación.</Callout>}
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" size="lg" icon={FileCheck2} disabled={!canIssue || busy || !ready} onClick={() => setConfirm(true)}>Emitir factura</Button>
              <Button size="lg" icon={Save} disabled={busy || !ready} onClick={onSave}>Guardar borrador</Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-fg-3">Al emitir se asigna el número correlativo de la serie y la factura deja de poder editarse (solo cobrarse o anularse).</p>
          </Card>
          <div className="hidden xl:block">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-fg-3">Vista previa</p>
            {/* Documento a tamaño real reducido (zoom): mismo aspecto que el PDF, sin recortar columnas */}
            <div style={{ zoom: 0.62 } as React.CSSProperties}><InvoicePaper invoice={previewInvoice} items={previewItems} className="w-[680px]" /></div>
          </div>
        </aside>
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} size="lg" title="Vista previa">
        <InvoicePaper invoice={previewInvoice} items={previewItems} />
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="¿Emitir la factura?"
        description={`${previewInvoice.customerName ?? ""} · ${formatMoney(totals.total)}`}
        footer={<><Button onClick={() => setConfirm(false)}>Revisar</Button><Button variant="primary" loading={busy} onClick={onIssue}>Emitir ahora</Button></>}
      >
        <ul className="flex flex-col gap-2 text-sm text-fg-2">
          <li>• Recibirá el siguiente número de la serie <span className="font-mono">{series?.prefix}</span>.</li>
          <li>• Importes, cliente y líneas quedarán bloqueados.</li>
          <li>• Si hay un error, podrás anularla (queda en el histórico) y duplicarla para corregirla.</li>
        </ul>
      </Modal>
    </Page>
  );
}
