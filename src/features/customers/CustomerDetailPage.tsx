import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, BellOff, CreditCard, ListTodo, Mail, MessageCircle, MoreHorizontal, NotebookPen, Pencil, Pin, Receipt, Repeat, ShoppingBag, StickyNote, UserPlus, UserX } from "lucide-react";
import { useCtx, useSession, useWorkspace, usePersonName } from "@/app/session";
import { Avatar, Badge, Button, Callout, Card, CardHeader, DescriptionList, EmptyState, Field, IconButton, Input, Menu, MenuItem, Mono, Page, Switch, Tabs, Textarea, useToast } from "@/design-system/components";
import { Sparkline } from "@/design-system/components/charts";
import { addCustomerNote, customerName } from "@/data/repos/customers";
import { capitalize, daysBetween, formatDate, formatDateTime, relativeDays, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { CustomerForm, CUSTOMER_STATUS, sourceLabel } from "./CustomerForm";
import { INVOICE_STATUS } from "../invoices/status";

type Tab = "overview" | "activity" | "invoices" | "purchases" | "notes";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const { can } = useSession();
  const authorName = usePersonName();
  const ctx = useCtx();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState(false);
  const [suppress, setSuppress] = useState("");
  const c = ws.customers.find((x) => x.id === id);

  const data = useMemo(() => {
    if (!c) return null;
    const invoices = ws.invoices.filter((i) => i.customerId === c.id).sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
    const sales = ws.sales.filter((s) => s.customerId === c.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const notes = ws.customerNotes.filter((n) => n.customerId === c.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
    const items = new Map<string, string>();
    for (const it of ws.saleItems) if (sales.some((s) => s.id === it.saleId)) items.set(it.saleId, `${items.get(it.saleId) ? `${items.get(it.saleId)}, ` : ""}${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.productName}`);
    const lastInvoice = invoices.find((i) => i.status !== "void");
    const activeInv = invoices.filter((i) => i.status !== "void");
    const pending = activeInv.filter((i) => i.status === "issued" || i.status === "partially_paid");
    const timeline = [
      ...invoices.map((i) => ({ at: `${i.issueDate}T12:00:00`, kind: "invoice", icon: Receipt, title: `Factura ${i.number ?? i.externalNumber} · ${formatMoney(i.total)}`, sub: `${i.concept ?? ""}${i.servicePeriodStart ? ` · periodo ${formatDate(`${i.servicePeriodStart}T00:00`).slice(3)}` : ""} · ${INVOICE_STATUS[i.status].label}`, to: `/facturas?factura=${i.id}` })),
      ...sales.map((s) => ({ at: s.occurredAt, kind: "purchase", icon: ShoppingBag, title: `Compra #${s.number} · ${formatMoney(s.total)}${s.status === "voided" ? " (anulada)" : ""}`, sub: items.get(s.id) ?? "", to: `/ventas?venta=${s.id}` })),
      ...notes.map((n) => ({ at: n.createdAt, kind: "note", icon: StickyNote, title: "Nota interna", sub: n.body, to: undefined as string | undefined })),
      ...ws.auditLogs.filter((l) => l.entityId === c.id && l.entityType === "customers" && l.action !== "note").map((l) => {
        const st = l.changes?.status as { from?: string; to?: string } | undefined;
        const label = (v?: string) => (v && v in CUSTOMER_STATUS ? CUSTOMER_STATUS[v as keyof typeof CUSTOMER_STATUS].label : v ?? "—");
        return st
          ? { at: l.createdAt, kind: "status", icon: Repeat, title: `Estado: ${label(st.from)} → ${label(st.to)}`, sub: l.actorName ?? "", to: undefined }
          : { at: l.createdAt, kind: "change", icon: Pencil, title: l.action === "insert" ? "Ficha creada" : "Ficha actualizada", sub: `${l.actorName}${l.changes ? ` · ${Object.keys(l.changes).join(", ")}` : ""}`, to: undefined };
      }),
      ...(c.joinedAt ? [{ at: `${c.joinedAt}T08:00:00`, kind: "status", icon: UserPlus, title: "Alta como cliente", sub: sourceLabel(c.source) !== "—" ? `Origen: ${sourceLabel(c.source)}` : "", to: undefined as string | undefined }] : []),
      ...(c.leftAt ? [{ at: `${c.leftAt}T20:00:00`, kind: "status", icon: UserX, title: "Baja", sub: "Deja de facturarse la cuota", to: undefined as string | undefined }] : []),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const now = new Date();
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = toISODate(start).slice(0, 7);
      return sales.filter((s) => s.status !== "voided" && s.occurredAt.slice(0, 7) === key).reduce((a, s) => a + s.total, 0)
        + activeInv.filter((x) => (x.issueDate ?? "").slice(0, 7) === key).reduce((a, x) => a + x.total, 0);
    });
    const lastFee = activeInv.filter((i) => i.servicePeriodEnd).sort((a, b) => (b.servicePeriodEnd ?? "").localeCompare(a.servicePeriodEnd ?? ""))[0];
    const renewal = lastFee?.servicePeriodEnd ? toISODate(new Date(new Date(`${lastFee.servicePeriodEnd}T00:00`).getTime() + 86_400_000)) : undefined;
    return {
      invoices, sales, notes, items, lastInvoice, pending, timeline, monthly, renewal,
      pendingAmount: pending.reduce((s, i) => s + i.total - i.amountPaid, 0),
      billed: activeInv.reduce((s, i) => s + i.total, 0),
      spent: sales.filter((s) => s.status !== "voided").reduce((a, s) => a + s.total, 0),
      lastActivity: timeline.find((t) => t.kind === "purchase" || t.kind === "invoice")?.at,
      silenced: notes.find((n) => n.suppressAlertsUntil && n.suppressAlertsUntil >= new Date().toISOString().slice(0, 10)),
    };
  }, [c, ws]);

  if (!c || !data) {
    return <Page><EmptyState icon={UserX} title="Cliente no encontrado" action={<Link to="/clientes"><Button>Volver a clientes</Button></Link>} /></Page>;
  }
  const name = customerName(c);
  const phoneDigits = c.phone?.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const waNumber = phoneDigits ? (phoneDigits.length === 9 ? `34${phoneDigits}` : phoneDigits) : null;

  const saveNote = () => {
    try {
      addCustomerNote(ctx, c.id, note, { pinned, suppressAlertsUntil: suppress || undefined });
      setNote("");
      setPinned(false);
      setSuppress("");
      toast.success("Nota guardada");
    } catch (e) {
      toast.fromError(e);
    }
  };

  return (
    <Page>
      <Link to="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Clientes</Link>

      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={name} size={64} className="text-lg ring-4 ring-surface shadow-sm" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-3xl font-semibold tracking-[-0.03em]">{name}</h1>
              <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge>
              {data.lastInvoice?.concept && c.status !== "cancelled" && <Badge>{data.lastInvoice.concept}</Badge>}
              {data.silenced && <Badge tone="info"><BellOff className="h-3 w-3" />Avisos silenciados hasta {formatDate(`${data.silenced.suppressAlertsUntil}T00:00`)}</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-3">
              {c.email && <span>{c.email}</span>}
              {c.phone && <span className="num">{c.phone}</span>}
              {c.taxId && <span className="flex items-center gap-1"><Mono className="text-fg-2">{c.taxIdNormalized ?? c.taxId}</Mono>{c.taxIdValid === false && <AlertCircle className="h-3.5 w-3.5 text-danger" />}</span>}
              {!c.email && !c.phone && !c.taxId && <span>Sin datos de contacto</span>}
            </p>
          </div>
        </div>
        {/* Acciones rápidas: lo frecuente a la vista; lo que aún no existe, en «Más» y marcado como Pronto */}
        <div className="flex flex-wrap gap-2">
          {data.pending.length > 0 && can("payments.manage") && <Link to={`/facturas?factura=${data.pending[0]!.id}`}><Button variant="primary" icon={CreditCard}>Registrar cobro</Button></Link>}
          {can("customers.manage") && <Button icon={NotebookPen} onClick={() => setTab("notes")}>Nota</Button>}
          {waNumber && <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" title="Abre WhatsApp con este número (envío manual)"><Button icon={MessageCircle}>Mensaje</Button></a>}
          {c.email && <a href={`mailto:${c.email}`}><Button icon={Mail}>Email</Button></a>}
          {can("customers.manage") && <Button variant={data.pending.length ? "secondary" : "primary"} icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>}
          <Menu trigger={(_, toggle) => <IconButton icon={MoreHorizontal} label="Más acciones" onClick={toggle} className="border border-line" />}>
            {() => (
              <>
                <MenuItem icon={Receipt} disabled hint="Pronto">Nueva factura</MenuItem>
                <MenuItem icon={ListTodo} disabled hint="Pronto">Nueva tarea</MenuItem>
                <MenuItem icon={MessageCircle} disabled hint="Pronto">Mensaje desde la app</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      {(() => {
        const gone = c.status === "cancelled" || !!c.leftAt;
        const overdue = !gone && data.renewal && data.renewal < toISODate(new Date());
        const renewal = c.status === "lead"
          ? { label: "Próxima renovación", value: "—", sub: "Aún no es cliente" }
          : gone
            ? { label: "Baja", value: c.leftAt ? formatDate(`${c.leftAt}T00:00`) : "Dado de baja", sub: "Sin renovación" }
            : data.renewal
              ? { label: overdue ? "Renovación pendiente" : "Próxima renovación", value: formatDate(`${data.renewal}T00:00`), sub: overdue ? `Vencida ${relativeDays(`${data.renewal}T00:00`)}` : relativeDays(`${data.renewal}T00:00`), tone: overdue ? "warning" : undefined }
              : { label: "Próxima renovación", value: "—", sub: "Sin cuota periódica" };
        const fields: { label: string; value: string; sub?: string; small?: boolean; tone?: string }[] = [
          { label: gone ? "Última tarifa" : "Tarifa actual", value: data.lastInvoice?.concept ?? "—", small: true, sub: data.lastInvoice ? `${formatMoney(data.lastInvoice.total)} · ${data.lastInvoice.issueDate ? formatDate(`${data.lastInvoice.issueDate}T00:00`) : ""}` : undefined },
          { label: "Última actividad", value: data.lastActivity ? capitalize(relativeDays(data.lastActivity)) : "—", sub: data.lastActivity ? formatDate(data.lastActivity) : undefined },
          { label: "Saldo pendiente", value: formatMoney(data.pendingAmount), sub: data.pending.length ? `${data.pending.length} factura${data.pending.length === 1 ? "" : "s"}` : "Al día", tone: data.pendingAmount > 0 ? "warning" : undefined },
          renewal,
          { label: "Valor total", value: formatMoney(data.billed + data.spent), sub: `${data.invoices.length} facturas · ${data.sales.length} compras` },
          { label: "Cliente desde", value: c.joinedAt ? formatDate(`${c.joinedAt}T00:00`) : formatDate(c.createdAt), sub: c.joinedAt ? `${Math.max(0, Math.round(daysBetween(new Date(`${c.joinedAt}T00:00`), new Date(c.leftAt ? `${c.leftAt}T00:00` : Date.now())) / 30))} meses` : undefined },
        ];
        return (
          <div className="surface-card mb-6 grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3 xl:grid-cols-6">
            {fields.map((f) => (
              <div key={f.label} className="-ml-px -mt-px border-l border-t border-line px-4 py-3.5 sm:px-5 sm:py-4">
                <p className="truncate text-xs font-medium text-fg-3">{f.label}</p>
                <p className={cn("mt-1 truncate font-semibold tracking-[-0.02em]", f.small ? "text-[15px] leading-7" : "text-lg sm:text-xl", f.tone === "warning" && "text-warning-fg")} title={String(f.value)}>{f.value}</p>
                {f.sub && <p className="mt-0.5 truncate text-xs text-fg-3">{f.sub}</p>}
              </div>
            ))}
          </div>
        );
      })()}

      {c.taxIdValid === false && <Callout tone="warning" className="mb-4" title="NIF no válido">«{c.taxId}» no supera la validación de DNI/NIE/CIF. Corrígelo antes de emitirle facturas nuevas.</Callout>}

      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Resumen" },
          { value: "activity", label: "Actividad", count: data.timeline.length },
          { value: "invoices", label: "Facturas", count: data.invoices.length },
          { value: "purchases", label: "Compras", count: data.sales.length },
          { value: "notes", label: "Notas", count: data.notes.length },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
          <Card>
            <CardHeader title="Relación con el cliente" description="Compras, facturas, notas y cambios, del más reciente al más antiguo" action={data.timeline.length > 8 ? <button onClick={() => setTab("activity")} className="text-sm font-medium text-fg-3 hover:text-fg">Ver todo →</button> : undefined} />
            <Timeline items={data.timeline.slice(0, 8)} />
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="mb-2" title="Gasto mensual" description="Compras + facturas · últimos 12 meses" />
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="figure text-3xl leading-none">{formatMoney(data.monthly.reduce((s, m) => s + m, 0))}</p>
                  <p className="mt-1.5 text-xs text-fg-3">en 12 meses</p>
                </div>
                <Sparkline values={data.monthly} width={150} height={44} />
              </div>
            </Card>
            {data.notes.filter((n) => n.pinned).map((n) => (
              <div key={n.id} className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg"><Pin className="mr-1.5 inline h-3.5 w-3.5" />{n.body}</div>
            ))}
            <Card>
              <CardHeader className="mb-1" title="Datos" />
              <DescriptionList
                items={[
                  { label: "Email", value: c.email ?? "—" },
                  { label: "Teléfono", value: c.phone ?? "—" },
                  { label: "Dirección", value: [c.address, c.postalCode, c.city].filter(Boolean).join(", ") || "—" },
                  { label: "Nacimiento", value: c.birthDate ? formatDate(`${c.birthDate}T00:00`) : "—" },
                  { label: "Empresa", value: c.companyName ?? "—" },
                  { label: "Origen", value: sourceLabel(c.source) },
                  { label: "Baja", value: c.leftAt ? formatDate(`${c.leftAt}T00:00`) : "—" },
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === "activity" && <Card><Timeline items={data.timeline} /></Card>}

      {tab === "invoices" && (
        <Card padded={false}>
          {data.invoices.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-xs text-fg-3"><th className="px-4 py-2 text-left font-medium">Factura</th><th className="px-4 py-2 text-left font-medium">Fecha</th><th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Concepto</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-left font-medium">Estado</th></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2.5"><Link className="font-mono text-xs text-accent-fg hover:underline" to={`/facturas?factura=${i.id}`}>{i.number ?? i.externalNumber}</Link></td>
                    <td className="px-4 py-2.5">{i.issueDate ? formatDate(`${i.issueDate}T00:00`) : "—"}</td>
                    <td className="hidden px-4 py-2.5 text-fg-2 sm:table-cell">{i.concept}</td>
                    <td className="px-4 py-2.5 text-right font-medium num">{formatMoney(i.total)}</td>
                    <td className="px-4 py-2.5"><Badge tone={INVOICE_STATUS[i.status].tone} dot>{INVOICE_STATUS[i.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState compact icon={Receipt} title="Sin facturas" />}
        </Card>
      )}

      {tab === "purchases" && (
        <Card padded={false}>
          {data.sales.length ? (
            <div>
              {data.sales.map((s) => (
                <Link key={s.id} to={`/ventas?venta=${s.id}`} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{data.items.get(s.id)}</span>
                    <span className="text-xs text-fg-3">#{s.number} · {formatDateTime(s.occurredAt)}</span>
                  </span>
                  <span className={cn("text-sm font-medium num", s.status === "voided" && "text-fg-3 line-through")}>{formatMoney(s.total)}</span>
                </Link>
              ))}
            </div>
          ) : <EmptyState compact icon={ShoppingBag} title="Sin compras en caja" description="Asocia el cliente al cobrar en Caja para verlas aquí." />}
        </Card>
      )}

      {tab === "notes" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {can("customers.manage") && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Nueva nota</h3>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: Estará dos semanas fuera por trabajo." />
              <div className="mt-3 flex flex-col gap-3">
                <Switch checked={pinned} onChange={setPinned} label="Fijar en la ficha" />
                <Field label="Silenciar avisos de inactividad hasta" hint="Evita falsos avisos en Seguimiento mientras dure la ausencia.">
                  <Input type="date" value={suppress} onChange={(e) => setSuppress(e.target.value)} className="max-w-[200px]" />
                </Field>
                <Button variant="primary" disabled={!note.trim()} onClick={saveNote} className="self-start">Guardar nota</Button>
              </div>
            </Card>
          )}
          <div className="flex flex-col gap-2">
            {data.notes.length ? data.notes.map((n) => (
              <Card key={n.id} className="p-4">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                  {n.pinned && <Badge tone="warning"><Pin className="h-3 w-3" />Fijada</Badge>}
                  {authorName(n.authorId)} · {formatDateTime(n.createdAt)}
                  {n.suppressAlertsUntil && <span>· avisos silenciados hasta {formatDate(`${n.suppressAlertsUntil}T00:00`)}</span>}
                </p>
              </Card>
            )) : <EmptyState compact icon={StickyNote} title="Sin notas" description="Las notas registran autor, fecha y hora." />}
          </div>
        </div>
      )}

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
    </Page>
  );
}

const TL_TONE: Record<string, string> = {
  status: "bg-ink text-fg-inverse",
  purchase: "bg-accent-soft text-accent-fg",
  invoice: "bg-surface-sunken text-fg-2",
  note: "bg-warning-soft text-warning-fg",
  change: "bg-surface-sunken text-fg-3",
};

function Timeline({ items }: { items: { at: string; icon: typeof Receipt; title: string; sub: string; to?: string; kind?: string }[] }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-fg-3">Sin actividad todavía. Las compras en Caja, las facturas y las notas aparecerán aquí.</p>;
  const groups: { label: string; items: typeof items }[] = [];
  for (const t of items) {
    const d = new Date(t.at);
    const label = capitalize(d.toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(t);
    else groups.push({ label, items: [t] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.label}>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-3">{g.label}</p>
          <ol className="relative flex flex-col">
            {g.items.map((t, i) => {
              const body = (
                <>
                  <span className={cn("relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TL_TONE[t.kind ?? "change"])}><t.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1 pb-4">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium">{t.title}</span>
                      <span className="text-xs text-fg-3 num">{formatDate(t.at).slice(0, 5)}</span>
                    </span>
                    {t.sub && <span className="mt-0.5 line-clamp-2 block text-sm text-fg-3">{t.sub}</span>}
                  </span>
                </>
              );
              return (
                <li key={i} className="relative flex gap-3">
                  {i < g.items.length - 1 && <span className="absolute left-[13.5px] top-8 h-[calc(100%-28px)] w-px bg-line" />}
                  {t.to ? <Link to={t.to} className="-mx-2 flex flex-1 gap-3 rounded-lg px-2 transition-colors hover:bg-surface-2">{body}</Link> : body}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
