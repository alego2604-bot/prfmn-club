import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, ArrowRight, BellOff, CalendarClock, CheckCircle2, Circle, Contact, CreditCard, FileText, FolderOpen, ListTodo, Mail, MessageCircle,
  MoreHorizontal, NotebookPen, Pencil, Pin, Plus, Receipt, Repeat, ScrollText, ShoppingBag, StickyNote, Store, UserPlus, UserX, Wallet,
  type LucideIcon,
} from "lucide-react";
import { useCtx, useSession, useWorkspace, usePersonName } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Avatar, Badge, Button, Callout, Card, CardHeader, DescriptionList, EmptyState, Field, Ledger, Menu, MenuItem, Mono, Page, Switch, Tabs, Textarea, useToast, DateInput } from "@/design-system/components";
import { Sparkline } from "@/design-system/components/charts";
import { addCustomerNote, customerName } from "@/data/repos/customers";
import { invoiceLabel } from "@/data/repos/invoices";
import { setTaskStatus, taskBucket } from "@/data/repos/tasks";
import { customerIndex, EMPTY_SNAPSHOT, nextAction } from "@/domain/customer360";
import { INVOICE_VIEW, invoiceView } from "@/domain/invoicing";
import { BILLING_PERIOD, MEMBERSHIP_VIEW, membershipView } from "@/domain/memberships";
import { capitalize, daysBetween, formatDate, formatDateTime, relativeDays, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { CustomerForm, CUSTOMER_STATUS, sourceLabel } from "./CustomerForm";
import { AssignMembershipDrawer, MembershipActions } from "../memberships/MembershipDialogs";
import { TaskDrawer } from "../tasks/FollowUpPage";
import { PaymentModal } from "../invoices/InvoiceDetailPage";
import { ExpenseDrawer } from "../expenses/ExpenseDrawer";
import { saleNo } from "@/lib/text";

type Tab = "overview" | "timeline" | "membership" | "sales" | "payments" | "invoices" | "notes" | "tasks" | "documents";
const TAB_PARAM: Record<string, Tab> = { membresia: "membership", cronologia: "timeline", ventas: "sales", cobros: "payments", facturas: "invoices", notas: "notes", tareas: "tasks", documentos: "documents" };

export default function CustomerDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const ws = useWorkspace();
  const { can } = useSession();
  const ready = useServerReady();
  const authorName = usePersonName();
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(TAB_PARAM[params.get("tab") ?? ""] ?? "overview");
  const [editing, setEditing] = useState(false);
  const [assign, setAssign] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [relatedExpense, setRelatedExpense] = useState(false);
  const [note, setNote] = useState("");
  const [pinned, setPinned] = useState(false);
  const [suppress, setSuppress] = useState("");
  const c = ws.customers.find((x) => x.id === id);
  const today = toISODate(new Date());

  const data = useMemo(() => {
    if (!c) return null;
    const snap = customerIndex(ws, today).get(c.id) ?? EMPTY_SNAPSHOT;
    const invoices = ws.invoices.filter((i) => i.customerId === c.id && i.status !== "draft").sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
    const drafts = ws.invoices.filter((i) => i.customerId === c.id && i.status === "draft");
    const sales = ws.sales.filter((s) => s.customerId === c.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const payments = ws.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    const notes = ws.customerNotes.filter((n) => n.customerId === c.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
    const tasks = ws.tasks.filter((t) => t.customerId === c.id).sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
    const memberships = ws.customerMemberships.filter((m) => m.customerId === c.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
    const mIds = new Set(memberships.map((m) => m.id));
    const charges = ws.membershipCharges.filter((ch) => mIds.has(ch.customerMembershipId)).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    const planName = new Map(ws.membershipPlans.map((p) => [p.id, p.name]));
    const items = new Map<string, string>();
    const saleIds = new Set(sales.map((s) => s.id));
    for (const it of ws.saleItems) if (saleIds.has(it.saleId)) items.set(it.saleId, `${items.get(it.saleId) ? `${items.get(it.saleId)}, ` : ""}${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.productName}`);
    const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
    const MEMBER_ACTION: Record<string, string> = { insert: "Alta de membresía", pause: "Membresía en pausa", resume: "Membresía reanudada", cancel: "Baja de la membresía", reactivate: "Membresía reactivada", plan_change: "Cambio de tarifa", charge: "Cuota generada", update: "Membresía modificada" };
    const timeline = [
      ...invoices.map((i) => ({ at: `${i.issueDate}T12:00:00`, kind: "invoice", icon: Receipt, title: `Factura ${invoiceLabel(i)} · ${formatMoney(i.total)}`, sub: `${i.concept ?? ""} · ${INVOICE_VIEW[invoiceView(i, today)].label}`, to: `/facturas/${i.id}` })),
      ...sales.map((s) => ({ at: s.occurredAt, kind: "purchase", icon: ShoppingBag, title: `Compra ${saleNo(s.number)} · ${formatMoney(s.total)}${s.status === "voided" ? " (anulada)" : ""}`, sub: items.get(s.id) ?? "", to: `/ventas?venta=${s.id}` })),
      ...payments.filter((p) => !p.saleId).map((p) => ({ at: p.paidAt, kind: "payment", icon: CreditCard, title: `${p.kind === "refund" ? "Devolución" : "Cobro"} ${formatMoney(p.amount)}`, sub: methodName.get(p.methodKey) ?? "", to: p.invoiceId ? `/facturas/${p.invoiceId}` : undefined })),
      ...notes.map((n) => ({ at: n.createdAt, kind: "note", icon: StickyNote, title: "Nota interna", sub: n.body, to: undefined as string | undefined })),
      ...tasks.map((t) => ({ at: t.completedAt ?? t.createdAt, kind: "task", icon: t.status === "done" ? CheckCircle2 : ListTodo, title: `${t.status === "done" ? "Tarea hecha" : "Tarea"}: ${t.title}`, sub: t.reason ?? (t.dueDate ? `Para el ${formatDate(t.dueDate)}` : ""), to: undefined as string | undefined })),
      ...ws.auditLogs.filter((l) => l.entityId && mIds.has(l.entityId) && l.action !== "charge").map((l) => ({ at: l.createdAt, kind: "status", icon: Contact, title: MEMBER_ACTION[l.action] ?? "Membresía", sub: l.entityLabel ?? "", to: undefined as string | undefined })),
      ...memberships.filter((m) => !ws.auditLogs.some((l) => l.entityId === m.id && l.action === "insert")).map((m) => ({ at: `${m.startDate}T08:00:00`, kind: "status", icon: Contact, title: "Alta de membresía", sub: `${planName.get(m.planId) ?? ""} · ${formatMoney(m.price)}`, to: undefined as string | undefined })),
      ...ws.auditLogs.filter((l) => l.entityId === c.id && l.entityType === "customers" && l.action !== "note").map((l) => {
        const st = l.changes?.status as { from?: string; to?: string } | undefined;
        const label = (v?: string) => (v && v in CUSTOMER_STATUS ? CUSTOMER_STATUS[v as keyof typeof CUSTOMER_STATUS].label : v ?? "—");
        return st
          ? { at: l.createdAt, kind: "status", icon: Repeat, title: `Estado: ${label(st.from)} → ${label(st.to)}`, sub: l.actorName ?? "", to: undefined }
          : { at: l.createdAt, kind: "change", icon: Pencil, title: l.action === "insert" ? "Ficha creada" : "Ficha actualizada", sub: `${l.actorName}${l.changes ? ` · ${Object.keys(l.changes).join(", ")}` : ""}`, to: undefined };
      }),
      ...(c.joinedAt ? [{ at: `${c.joinedAt}T08:00:00`, kind: "status", icon: UserPlus, title: "Alta como cliente", sub: sourceLabel(c.source) !== "—" ? `Origen: ${sourceLabel(c.source)}` : "", to: undefined as string | undefined }] : []),
      ...(c.leftAt ? [{ at: `${c.leftAt}T20:00:00`, kind: "status", icon: UserX, title: "Baja", sub: "No se generan más cuotas", to: undefined as string | undefined }] : []),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const now = new Date();
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const key = toISODate(new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)).slice(0, 7);
      return sales.filter((s) => s.status !== "voided" && s.occurredAt.slice(0, 7) === key).reduce((a, s) => a + s.total, 0)
        + invoices.filter((x) => x.status !== "void" && (x.issueDate ?? "").slice(0, 7) === key).reduce((a, x) => a + x.total, 0);
    });
    return {
      snap, invoices, drafts, sales, payments, notes, tasks, memberships, charges, items, timeline, monthly,
      action: nextAction(c, snap, today),
      silenced: notes.find((n) => n.suppressAlertsUntil && n.suppressAlertsUntil >= today),
    };
  }, [c, ws, today]);

  if (!c || !data) {
    return <Page><EmptyState icon={UserX} title="Cliente no encontrado" description="Puede pertenecer a otra empresa o el enlace no es correcto." action={<Link to="/clientes"><Button>Volver a clientes</Button></Link>} /></Page>;
  }
  const name = customerName(c);
  const phoneDigits = c.phone?.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const waNumber = phoneDigits ? (phoneDigits.length === 9 ? `34${phoneDigits}` : phoneDigits) : null;
  const { snap, action } = data;
  const m = snap.membership;
  const mv = snap.membershipView;
  const plan = m ? ws.membershipPlans.find((p) => p.id === m.planId) : undefined;
  const loc = ws.locations.find((l) => l.id === (m?.locationId ?? snap.locationId));
  const oldestPending = [...snap.pendingInvoices].sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""))[0];
  const gone = mv === "CANCELLED" || mv === "EXPIRED" || c.status === "cancelled";

  const saveNote = () => {
    try {
      addCustomerNote(ctx, c.id, note, { pinned, suppressAlertsUntil: suppress || undefined });
      setNote(""); setPinned(false); setSuppress("");
      toast.success("Nota guardada");
    } catch (e) {
      toast.fromError(e);
    }
  };

  const runAction = () => {
    if (action.kind === "collect" && oldestPending && can("payments.manage")) return setPaying(oldestPending.id);
    if (action.kind === "collect" || action.kind === "renewal" || action.kind === "resume" || action.kind === "reactivate") return setTab("membership");
    if (action.kind === "task") return setTab("tasks");
    if (action.kind === "convert") return setAssign(true);
  };

  // Renovación coherente con el estado: una baja o una pausa nunca muestran «próxima renovación»
  const renewal = c.status === "lead" && !m
    ? { label: "Renovación", value: "—", sub: "Aún no es cliente" }
    : gone
      ? { label: "Baja", value: m?.endDate ? formatDate(m.endDate) : c.leftAt ? formatDate(c.leftAt) : "De baja", sub: "Sin renovación" }
      : mv === "PAUSED"
        ? { label: "En pausa", value: m?.resumeOn ? formatDate(m.resumeOn) : "Sin fecha", sub: "Fecha de vuelta" }
        : m?.nextRenewalDate
          ? { label: m.nextRenewalDate < today ? "Renovación pendiente" : "Próxima renovación", value: formatDate(m.nextRenewalDate), sub: relativeDays(`${m.nextRenewalDate}T00:00`), tone: m.nextRenewalDate < today ? "warning" : undefined }
          : { label: "Renovación", value: "—", sub: m ? "Pago único" : "Sin membresía" };
  const fields: { label: string; value: string; sub?: string; small?: boolean; tone?: string }[] = [
    { label: "Membresía", value: plan?.name ?? "Sin membresía", small: true, sub: m ? `${formatMoney(m.price)}${plan && plan.billingPeriod !== "none" ? ` / ${BILLING_PERIOD[plan.billingPeriod].per}` : ""}` : undefined },
    { label: "Valor del cliente", value: formatMoney(snap.lifetimeValue), sub: `${formatMoney(snap.value12m)} en 12 meses` },
    { label: "Última actividad", value: snap.lastActivity ? capitalize(relativeDays(`${snap.lastActivity}T12:00`)) : "—", sub: snap.lastActivity ? formatDate(snap.lastActivity) : undefined },
    { label: "Saldo pendiente", value: formatMoney(snap.balance), sub: snap.pendingInvoices.length ? `${snap.pendingInvoices.length} factura${snap.pendingInvoices.length === 1 ? "" : "s"}${snap.overdueInvoices.length ? ` · ${snap.overdueInvoices.length} vencida${snap.overdueInvoices.length === 1 ? "" : "s"}` : ""}` : "Al día", tone: snap.overdueInvoices.length ? "danger" : snap.balance > 0 ? "warning" : undefined },
    renewal,
    { label: "Cliente desde", value: c.joinedAt ? formatDate(c.joinedAt) : formatDate(c.createdAt), sub: c.joinedAt ? `${Math.max(0, Math.round(daysBetween(new Date(`${c.joinedAt}T00:00`), new Date(c.leftAt ? `${c.leftAt}T00:00` : Date.now())) / 30))} meses` : undefined },
  ];
  const MEMBERSHIP_TEXT: Record<string, string> = { success: "text-success-fg", info: "text-info-fg", neutral: "text-fg-3", warning: "text-warning-fg", danger: "text-danger-fg" };
  const ACTION_TONE = { danger: "bg-danger-soft text-danger-fg", warning: "bg-warning-soft text-warning-fg", info: "bg-accent-soft text-accent-fg", neutral: "bg-surface-sunken text-fg-2", success: "bg-success-soft text-success-fg" };

  return (
    <Page wide>
      <Link to="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Clientes</Link>

      {/* Ficha: identidad, acciones, próxima acción y cifras clave en una sola tarjeta */}
      <section className="surface-card relative mb-6 overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(120%_100%_at_0%_0%,var(--accent-soft),transparent_70%)] opacity-80" aria-hidden />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            {/* En móvil el avatar es pequeño: el nombre y la membresía ocupan el ancho */}
            <Avatar name={name} size={44} className="shrink-0 shadow-sm ring-4 ring-surface sm:hidden" />
            <Avatar name={name} size={64} className="hidden shrink-0 text-lg shadow-sm ring-4 ring-surface sm:inline-flex" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] sm:text-[28px]">{name}</h1>
                <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-3">
                {mv && (
                  <span className={cn("inline-flex items-center gap-1.5 font-medium", mv === "ACTIVE" ? "text-fg-2" : MEMBERSHIP_TEXT[MEMBERSHIP_VIEW[mv].tone])}>
                    <Contact className="h-3.5 w-3.5" />{plan?.name ?? "Membresía"}{mv !== "ACTIVE" && MEMBERSHIP_VIEW[mv].label !== CUSTOMER_STATUS[c.status].label && ` · ${MEMBERSHIP_VIEW[mv].label}`}
                  </span>
                )}
                {loc && <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" />{loc.name}</span>}
                {c.companyName && <span>{c.companyName}</span>}
                {c.email && <a href={`mailto:${c.email}`} className="hover:text-fg">{c.email}</a>}
                {c.phone && <span className="num">{c.phone}</span>}
                {c.taxId && <span className="inline-flex items-center gap-1"><Mono className="text-fg-2">{c.taxIdNormalized ?? c.taxId}</Mono>{c.taxIdValid === false && <AlertCircle className="h-3.5 w-3.5 text-danger" aria-label="NIF no válido" />}</span>}
                {data.silenced && <span className="inline-flex items-center gap-1 text-info-fg"><BellOff className="h-3.5 w-3.5" />Avisos silenciados hasta {formatDate(data.silenced.suppressAlertsUntil!)}</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {can("pos.sell") && <Button variant="primary" icon={ShoppingBag} onClick={() => navigate(`/caja?cliente=${c.id}`)}>Venta</Button>}
            <div className="inline-flex items-center divide-x divide-line overflow-hidden rounded-md border border-line bg-surface shadow-xs" role="group" aria-label="Acciones del cliente">
              {can("payments.manage") && ready && <QuickAction icon={CreditCard} label="Cobro" disabled={!oldestPending} title={oldestPending ? "Registrar el cobro pendiente más antiguo" : "Sin facturas pendientes"} onClick={() => oldestPending && setPaying(oldestPending.id)} />}
              {can("invoices.manage") && ready && <QuickAction icon={Receipt} label="Factura" onClick={() => navigate(`/facturas/nueva?cliente=${c.id}`)} />}
              {can("customers.manage") && <QuickAction icon={NotebookPen} label="Nota" onClick={() => setTab("notes")} />}
              {can("customers.manage") && ready && <QuickAction icon={ListTodo} label="Tarea" onClick={() => setNewTask(true)} />}
              <Menu width={240} trigger={(_, toggle) => <QuickAction icon={MoreHorizontal} label="Más" onClick={toggle} />}>
                {(close) => (
                  <>
                    {can("memberships.manage") && ready && <MenuItem icon={Contact} onClick={() => { close(); if (m && !gone) setTab("membership"); else setAssign(true); }}>{m && !gone ? "Cambiar membresía" : "Nueva membresía"}</MenuItem>}
                    {can("customers.manage") && <MenuItem icon={Pencil} onClick={() => { close(); setEditing(true); }}>Editar ficha</MenuItem>}
                    {can("expenses.manage") && ready && <MenuItem icon={ScrollText} onClick={() => { close(); setRelatedExpense(true); }}>Gasto relacionado</MenuItem>}
                    {waNumber && <MenuItem icon={MessageCircle} onClick={() => { close(); window.open(`https://wa.me/${waNumber}`, "_blank", "noopener"); }}>WhatsApp (manual)</MenuItem>}
                    {c.email && <MenuItem icon={Mail} onClick={() => { close(); window.location.href = `mailto:${c.email}`; }}>Email</MenuItem>}
                    <MenuItem icon={MessageCircle} disabled hint="Pronto">Mensaje desde la app</MenuItem>
                  </>
                )}
              </Menu>
            </div>
          </div>
        </div>

        {/* Próxima acción: qué hacer ahora con este cliente y por qué */}
        <div className={cn("relative flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-line px-5 py-2.5 sm:px-6", ACTION_TONE[action.tone])}>
          <CalendarClock className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">{action.label}</span><span className="opacity-80"> · {action.reason}</span></p>
          {action.kind !== "none" && <button type="button" onClick={runAction} className="inline-flex items-center gap-1 rounded-md text-sm font-semibold hover:underline">Hacerlo ahora<ArrowRight className="h-3.5 w-3.5" /></button>}
        </div>

        <div className="relative grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {fields.map((f) => (
            <div key={f.label} className="-ml-px -mt-px border-l border-t border-line px-5 py-4 first:border-l-0 sm:px-6">
              <p className="truncate text-xs font-medium text-fg-3">{f.label}</p>
              <p className={cn("mt-1 truncate font-semibold tracking-[-0.02em] num", f.small ? "text-[15px] leading-7" : "text-lg sm:text-xl", f.tone === "warning" && "text-warning-fg", f.tone === "danger" && "text-danger-fg")} title={String(f.value)}>{f.value}</p>
              {f.sub && <p className="mt-0.5 truncate text-xs text-fg-3">{f.sub}</p>}
            </div>
          ))}
        </div>
      </section>

      {c.taxIdValid === false && <Callout tone="warning" className="mb-4" title="NIF no válido">«{c.taxId}» no supera la validación de DNI/NIE/CIF. Corrígelo antes de emitirle facturas nuevas.</Callout>}

      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Resumen" },
          { value: "timeline", label: "Cronología", count: data.timeline.length },
          { value: "membership", label: "Membresía", count: data.memberships.length || undefined },
          { value: "sales", label: "Ventas", count: data.sales.length },
          { value: "payments", label: "Cobros", count: data.payments.length },
          { value: "invoices", label: "Facturas", count: data.invoices.length },
          { value: "notes", label: "Notas", count: data.notes.length },
          { value: "tasks", label: "Tareas", count: data.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length },
          { value: "documents", label: "Documentos" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
          <Card>
            <CardHeader title="Relación con el cliente" description="Lo último: compras, cuotas, cobros, notas, tareas y cambios" action={data.timeline.length > 8 ? <button type="button" onClick={() => setTab("timeline")} className="text-sm font-medium text-fg-3 hover:text-fg">Ver todo →</button> : undefined} />
            <Timeline items={data.timeline.slice(0, 8)} />
          </Card>
          <div className="flex flex-col gap-4">
            {m && (
              <Card>
                <CardHeader className="mb-3" title="Membresía" action={<button type="button" onClick={() => setTab("membership")} className="text-sm font-medium text-fg-3 hover:text-fg">Detalle →</button>} />
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[17px] font-semibold">{plan?.name}</p>
                  {mv && <Badge tone={MEMBERSHIP_VIEW[mv].tone} dot>{MEMBERSHIP_VIEW[mv].label}</Badge>}
                </div>
                <p className="mt-1 text-sm text-fg-3">{formatMoney(m.price)}{plan && plan.billingPeriod !== "none" ? ` / ${BILLING_PERIOD[plan.billingPeriod].per}` : ""} · desde {formatDate(m.startDate)}</p>
                <div className="mt-4"><MembershipActions membership={m} size="sm" /></div>
              </Card>
            )}
            <Card>
              <CardHeader className="mb-2" title="Gasto mensual" description="Compras + facturas · últimos 12 meses" />
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="figure text-3xl leading-none">{formatMoney(data.monthly.reduce((s, x) => s + x, 0))}</p>
                  <p className="mt-1.5 text-xs text-fg-3">en 12 meses</p>
                </div>
                <Sparkline values={data.monthly} width={150} height={44} />
              </div>
            </Card>
            {data.notes.filter((n) => n.pinned).map((n) => (
              <div key={n.id} className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg"><Pin className="mr-1.5 inline h-3.5 w-3.5" />{n.body}</div>
            ))}
            <Card>
              <CardHeader className="mb-1" title="Datos" action={can("customers.manage") ? <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-fg-3 hover:text-fg">Editar</button> : undefined} />
              <DescriptionList
                items={[
                  { label: "Email", value: c.email ?? "—" },
                  { label: "Teléfono", value: c.phone ?? "—" },
                  ...(can("customers.sensitive") ? [
                    { label: "Dirección", value: [c.address, c.postalCode, c.city].filter(Boolean).join(", ") || "—" },
                    { label: "Nacimiento", value: c.birthDate ? formatDate(c.birthDate) : "—" },
                    { label: "Empresa", value: c.companyName ?? "—" },
                  ] : [{ label: "Datos fiscales y personales", value: "Restringidos a tu rol" }]),
                  { label: "Origen", value: sourceLabel(c.source) },
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === "timeline" && <Card><Timeline items={data.timeline} /></Card>}

      {tab === "membership" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
          <div className="flex flex-col gap-4">
            {m ? (
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg-3">Membresía {gone ? "anterior" : "actual"}</p>
                    <p className="mt-1 truncate text-xl font-semibold tracking-tight">{plan?.name ?? "Tarifa"}</p>
                  </div>
                  {mv && <Badge tone={MEMBERSHIP_VIEW[mv].tone} dot>{MEMBERSHIP_VIEW[mv].label}</Badge>}
                </div>
                <Ledger className="mt-4" rows={[
                  { label: "Cuota pactada", value: `${formatMoney(m.price)}${plan && plan.billingPeriod !== "none" ? ` / ${BILLING_PERIOD[plan.billingPeriod].per}` : ""}` },
                  { label: "Inicio", value: formatDate(m.startDate) },
                  ...(gone ? [{ label: "Fin", value: m.endDate ? formatDate(m.endDate) : "—" }, { label: "Motivo de la baja", value: m.cancelReason ?? "—" }]
                    : mv === "PAUSED" ? [{ label: "En pausa desde", value: m.pausedAt ? formatDate(m.pausedAt) : "—" }, { label: "Vuelve", value: m.resumeOn ? formatDate(m.resumeOn) : "Sin fecha" }]
                    : [{ label: "Próxima renovación", value: m.nextRenewalDate ? formatDate(m.nextRenewalDate) : "—", tone: m.nextRenewalDate && m.nextRenewalDate < today ? "negative" as const : undefined }, { label: "Renovación automática", value: m.autoRenew ? "Sí" : "No" }]),
                  { label: "Centro", value: ws.locations.find((l) => l.id === m.locationId)?.name ?? "—" },
                  ...(m.creditsRemaining !== undefined ? [{ label: "Sesiones restantes", value: String(m.creditsRemaining) }] : []),
                ]} />
                {m.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">{m.notes}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <MembershipActions membership={m} />
                  {gone && can("memberships.manage") && ready && <Button icon={Plus} onClick={() => setAssign(true)}>Nueva membresía</Button>}
                </div>
              </Card>
            ) : (
              <Card>
                <EmptyState compact icon={Contact} title="Sin membresía" description={c.status === "lead" ? "Convierte a este lead dándole de alta en una tarifa." : "Da de alta una tarifa para generar sus cuotas automáticamente."} action={can("memberships.manage") && ready ? <Button variant="primary" icon={Plus} onClick={() => setAssign(true)}>Nueva membresía</Button> : undefined} />
              </Card>
            )}
            {data.memberships.length > 1 && (
              <Card>
                <CardHeader title="Historial de membresías" />
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {data.memberships.map((x) => {
                    const v = membershipView(x, ws.membershipCharges, today);
                    return (
                      <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0"><span className="block truncate font-medium">{ws.membershipPlans.find((p) => p.id === x.planId)?.name}</span><span className="text-xs text-fg-3">{formatDate(x.startDate)}{x.endDate ? ` – ${formatDate(x.endDate)}` : ""} · {formatMoney(x.price)}</span></span>
                        <Badge tone={MEMBERSHIP_VIEW[v].tone}>{MEMBERSHIP_VIEW[v].label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>
          <Card padded={false}>
            <div className="p-5 pb-3"><CardHeader className="mb-0" title="Cuotas" description="Cada periodo con su factura y su estado de cobro" /></div>
            {data.charges.length ? (
              <ul>
                {data.charges.map((ch) => {
                  const inv = ws.invoices.find((i) => i.id === ch.invoiceId);
                  const tone = ch.status === "paid" ? "success" : ch.status === "failed" ? "danger" : ch.status === "waived" ? "neutral" : "warning";
                  const label = { paid: "Cobrada", failed: "Devuelta", invoiced: "Pendiente", scheduled: "Programada", waived: "Condonada" }[ch.status];
                  return (
                    <li key={ch.id}>
                      <Link to={inv ? `/facturas/${inv.id}` : "#"} className="flex items-center gap-3 border-t border-line px-5 py-3 text-sm transition-colors hover:bg-surface-2">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{capitalize(new Date(`${ch.periodStart}T00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" }))}</span>
                          <span className="block text-xs text-fg-3">{formatDate(ch.periodStart)} – {formatDate(ch.periodEnd)}{inv ? ` · ${invoiceLabel(inv)}` : ""}</span>
                        </span>
                        <Badge tone={tone} dot>{label}</Badge>
                        <span className="w-20 text-right font-semibold num">{formatMoney(ch.amount)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="border-t border-line px-5 py-6 text-sm text-fg-3">Aún no se ha generado ninguna cuota.</p>}
          </Card>
        </div>
      )}

      {tab === "sales" && (
        <Card padded={false}>
          {data.sales.length ? (
            <div>
              {data.sales.map((s) => (
                <Link key={s.id} to={`/ventas?venta=${s.id}`} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{data.items.get(s.id)}</span>
                    <span className="text-xs text-fg-3">{saleNo(s.number)} · {formatDateTime(s.occurredAt)}</span>
                  </span>
                  <span className={cn("text-sm font-medium num", s.status === "voided" && "text-fg-3 line-through")}>{formatMoney(s.total)}</span>
                </Link>
              ))}
            </div>
          ) : <EmptyState compact icon={ShoppingBag} title="Sin compras en caja" description="Asocia el cliente al cobrar en Caja para verlas aquí." action={can("pos.sell") ? <Button icon={ShoppingBag} onClick={() => navigate(`/caja?cliente=${c.id}`)}>Nueva venta</Button> : undefined} />}
        </Card>
      )}

      {tab === "payments" && (
        <Card padded={false}>
          {data.payments.length ? (
            <ul>
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm last:border-0">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-3"><Wallet className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block font-medium">{p.kind === "refund" ? "Devolución" : "Cobro"} · {ws.paymentMethods.find((x) => x.key === p.methodKey)?.name ?? p.methodKey}</span>
                      <span className="block text-xs text-fg-3">{formatDateTime(p.paidAt)} · {p.saleId ? "Venta en caja" : p.invoiceId ? "Factura" : "Manual"}</span>
                    </span>
                  </span>
                  <span className="font-semibold num">{p.kind === "refund" ? "−" : ""}{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact icon={CreditCard} title="Sin cobros" description="Los cobros de ventas, cuotas y facturas aparecerán aquí." />}
        </Card>
      )}

      {tab === "invoices" && (
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-fg-3">{data.invoices.length} facturas{data.drafts.length ? ` · ${data.drafts.length} borrador${data.drafts.length === 1 ? "" : "es"}` : ""}</p>
            {can("invoices.manage") && ready && <Button size="sm" icon={Plus} onClick={() => navigate(`/facturas/nueva?cliente=${c.id}`)}>Nueva factura</Button>}
          </div>
          {data.invoices.length || data.drafts.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line bg-surface-2 text-xs text-fg-3"><th className="px-4 py-2 text-left font-medium">Factura</th><th className="px-4 py-2 text-left font-medium">Fecha</th><th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Concepto</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-left font-medium">Estado</th></tr></thead>
              <tbody>
                {[...data.drafts, ...data.invoices].map((i) => {
                  const v = invoiceView(i, today);
                  return (
                    <tr key={i.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => navigate(i.status === "draft" ? `/facturas/${i.id}/editar` : `/facturas/${i.id}`)}>
                      <td className="px-4 py-2.5"><span className="font-mono text-xs text-accent-fg">{invoiceLabel(i)}</span></td>
                      <td className="px-4 py-2.5">{i.issueDate ? formatDate(i.issueDate) : "—"}</td>
                      <td className="hidden max-w-[280px] truncate px-4 py-2.5 text-fg-2 sm:table-cell">{i.concept}</td>
                      <td className="px-4 py-2.5 text-right font-medium num">{formatMoney(i.total)}</td>
                      <td className="px-4 py-2.5"><Badge tone={INVOICE_VIEW[v].tone} dot>{INVOICE_VIEW[v].label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState compact icon={Receipt} title="Sin facturas" description="Las cuotas de su membresía y las facturas que le emitas aparecerán aquí." />}
        </Card>
      )}

      {tab === "notes" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {can("customers.manage") && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Nueva nota</h3>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: Estará dos semanas fuera por trabajo." aria-label="Nueva nota" />
              <div className="mt-3 flex flex-col gap-3">
                <Switch checked={pinned} onChange={setPinned} label="Fijar en la ficha" />
                <Field label="Silenciar avisos de inactividad hasta" hint="Evita falsos avisos en Seguimiento mientras dure la ausencia.">
                  <DateInput value={suppress} onChange={(e) => setSuppress(e.target.value)} className="max-w-[200px]" />
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
                  {n.suppressAlertsUntil && <span>· avisos silenciados hasta {formatDate(n.suppressAlertsUntil)}</span>}
                </p>
              </Card>
            )) : <EmptyState compact icon={StickyNote} title="Sin notas" description="Las notas registran autor, fecha y hora." />}
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-fg-3">Tareas de seguimiento con este cliente</p>
            {can("customers.manage") && ready && <Button size="sm" icon={Plus} onClick={() => setNewTask(true)}>Nueva tarea</Button>}
          </div>
          {data.tasks.length ? (
            <ul>
              {data.tasks.map((t) => {
                const b = taskBucket(t, today);
                return (
                  <li key={t.id} className="flex items-start gap-3 border-t border-line px-4 py-3">
                    <button type="button" disabled={!can("customers.manage") || !ready} aria-label={t.status === "done" ? "Reabrir" : "Completar"} onClick={() => setTaskStatus(ctx, t.id, t.status === "done" ? "pending" : "done")} className="mt-0.5 text-fg-3 hover:text-success disabled:opacity-50">
                      {t.status === "done" ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium", t.status === "done" && "text-fg-3 line-through")}>{t.title}</p>
                      <p className={cn("text-xs text-fg-3", b === "overdue" && "text-danger-fg")}>{t.dueDate ? `Para el ${formatDate(t.dueDate)}` : "Sin fecha"}{t.reason ? ` · ${t.reason}` : ""}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState compact icon={ListTodo} title="Sin tareas" description="Crea una tarea para no olvidar una llamada, una renovación o un cobro." />}
        </Card>
      )}

      {tab === "documents" && (
        <Card>
          <EmptyState compact icon={FolderOpen} title="Documentos del cliente" description="Contratos, consentimientos y justificantes vinculados a la ficha llegarán con el módulo de Documentos. Sus facturas ya están en la pestaña Facturas y se descargan en PDF." action={<Button icon={FileText} onClick={() => setTab("invoices")}>Ver facturas</Button>} />
        </Card>
      )}

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
      <AssignMembershipDrawer open={assign} onClose={() => setAssign(false)} customerId={c.id} />
      <TaskDrawer open={newTask} onClose={() => setNewTask(false)} defaults={{ customerId: c.id }} />
      <ExpenseDrawer open={relatedExpense} onClose={() => setRelatedExpense(false)} defaults={{ description: "", notes: `Relacionado con el cliente ${name}` }} />
      {paying && (() => { const inv = ws.invoices.find((i) => i.id === paying); return inv ? <PaymentModal invoiceId={inv.id} due={inv.total - inv.amountPaid} onClose={() => setPaying(null)} /> : null; })()}
    </Page>
  );
}

const TL_TONE: Record<string, string> = {
  status: "bg-ink text-fg-inverse",
  purchase: "bg-accent-soft text-accent-fg",
  invoice: "bg-surface-sunken text-fg-2",
  payment: "bg-success-soft text-success-fg",
  note: "bg-warning-soft text-warning-fg",
  task: "bg-info-soft text-info-fg",
  change: "bg-surface-sunken text-fg-3",
};

function Timeline({ items }: { items: { at: string; icon: typeof Receipt; title: string; sub: string; to?: string; kind?: string }[] }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-fg-3">Sin actividad todavía. Las compras en Caja, las cuotas, los cobros y las notas aparecerán aquí.</p>;
  const groups: { label: string; items: typeof items }[] = [];
  for (const t of items) {
    const label = capitalize(new Date(t.at).toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
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

/** Acción rápida de la ficha: icono + texto (solo icono en móvil, con nombre accesible). */
function QuickAction({ icon: Icon, label, onClick, disabled, title }: { icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title ?? label} aria-label={label}
      className="inline-flex h-9 items-center gap-2 px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-45">
      <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
    </button>
  );
}
