import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, CalendarClock, CheckCircle2, Circle, CircleDollarSign, ListTodo, PauseCircle, Plus, RotateCcw, Sparkles, UserPlus, UserRoundX } from "lucide-react";
import { useCtx, usePersonName, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import { Avatar, Badge, Button, Card, Combobox, Drawer, EmptyState, Field, IconButton, Input, Page, PageHeader, Segmented, Textarea, useToast, DateInput } from "@/design-system/components";
import { createTask, setTaskStatus, snoozeTask, taskBucket, type TaskBucket, type TaskInput } from "@/data/repos/tasks";
import { customerName } from "@/data/repos/customers";
import { customerIndex } from "@/domain/customer360";
import { formatMoney } from "@/lib/money";
import { addDays, formatDate, relativeDays, toISODate } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { Task } from "@/domain/types";

const BUCKET: Record<TaskBucket, { label: string; tone: string }> = {
  overdue: { label: "Atrasadas", tone: "text-danger-fg" },
  today: { label: "Hoy", tone: "text-fg" },
  upcoming: { label: "Próximas", tone: "text-fg" },
  someday: { label: "Sin fecha", tone: "text-fg-2" },
  done: { label: "Hechas", tone: "text-fg-3" },
};

export function TaskDrawer({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: Partial<TaskInput> }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const [f, setF] = useState<TaskInput>({ title: "", ...defaults });
  useEffect(() => { if (open) setF({ title: "", dueDate: toISODate(new Date()), ...defaults }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    try { createTask(ctx, f); toast.success("Tarea creada"); onClose(); } catch (e) { toast.fromError(e); }
  };
  const quick = [["Hoy", 0], ["Mañana", 1], ["En 3 días", 3], ["En una semana", 7]] as const;
  return (
    <Drawer open={open} onClose={onClose} title="Nueva tarea" subtitle="Qué hay que hacer, con quién y cuándo" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.title.trim()} onClick={save}>Crear tarea</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Tarea" required><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej. Llamar para renovar la cuota" /></Field>
        <Field label="Cliente">
          <Combobox value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} placeholder="Sin cliente (tarea interna)" options={ws.customers.filter((c) => !c.deletedAt).map((c) => ({ value: c.id, label: customerName(c), hint: c.email }))} />
        </Field>
        <Field label="Para">
          <div className="flex flex-wrap gap-1.5">
            {quick.map(([l, d]) => {
              const v = toISODate(addDays(new Date(), d));
              return <button key={l} type="button" onClick={() => setF({ ...f, dueDate: v })} className={cn("h-8 rounded-full border px-3 text-sm transition-colors", f.dueDate === v ? "border-accent bg-accent-soft text-accent-fg" : "border-line hover:bg-surface-2")}>{l}</button>;
            })}
            <DateInput size="sm" className="w-[150px]" value={f.dueDate ?? ""} onChange={(e) => setF({ ...f, dueDate: e.target.value || undefined })} aria-label="Fecha" />
          </div>
        </Field>
        <Field label="Detalle"><Textarea value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {f.reason && <p className="text-xs text-fg-3">Motivo: {f.reason}</p>}
      </form>
    </Drawer>
  );
}

interface Signal { id: string; icon: typeof Sparkles; tone: "danger" | "warning" | "info"; customerId?: string; title: string; reason: string; task: Partial<TaskInput>; to: string }

/** Seguimiento: tareas por plazo y avisos con su motivo, listos para convertir en tarea. */
export default function FollowUpPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const ready = useServerReady();
  const person = usePersonName();
  const [view, setView] = useState<"open" | "done">("open");
  const [creating, setCreating] = useState<Partial<TaskInput> | null>(null);
  const today = toISODate(new Date());
  const names = useMemo(() => new Map(ws.customers.map((c) => [c.id, customerName(c)])), [ws.customers]);
  const idx = useMemo(() => customerIndex(ws, today), [ws, today]);
  const manage = can("customers.manage") && ready;

  const groups = useMemo(() => {
    const g = new Map<TaskBucket, Task[]>();
    for (const t of ws.tasks) {
      const b = taskBucket(t, today);
      if ((view === "done") !== (b === "done")) continue;
      g.set(b, [...(g.get(b) ?? []), t]);
    }
    for (const list of g.values()) list.sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9") || b.createdAt.localeCompare(a.createdAt));
    return (["overdue", "today", "upcoming", "someday", "done"] as TaskBucket[]).filter((b) => g.get(b)?.length).map((b) => ({ b, items: g.get(b)! }));
  }, [ws.tasks, view, today]);

  // Avisos: siempre con el motivo y sin duplicar lo que ya tiene una tarea abierta
  const signals = useMemo(() => {
    const out: Signal[] = [];
    const hasTask = (cid: string) => (idx.get(cid)?.openTasks.length ?? 0) > 0;
    for (const c of ws.customers) {
      const s = idx.get(c.id);
      if (!s || c.deletedAt || hasTask(c.id)) continue;
      const n = customerName(c);
      if (s.membershipView === "PAST_DUE" || s.overdueInvoices.length) {
        out.push({ id: `due-${c.id}`, icon: CircleDollarSign, tone: "danger", customerId: c.id, title: n, reason: s.overdueInvoices.length ? `${formatMoney(s.overdueInvoices.reduce((t, i) => t + i.total - i.amountPaid, 0))} vencido sin cobrar` : "La última cuota no se pudo cobrar", task: { customerId: c.id, title: "Reclamar el cobro pendiente", reason: "Cuota vencida", alertKey: "past_due" }, to: `/clientes/${c.id}` });
        continue;
      }
      const m = s.membership;
      if (s.membershipView === "ACTIVE" && m?.autoRenew && m.nextRenewalDate && m.nextRenewalDate <= toISODate(addDays(new Date(), 7))) {
        out.push({ id: `ren-${c.id}`, icon: CalendarClock, tone: "info", customerId: c.id, title: n, reason: `${s.planName ?? "Cuota"} se renueva ${relativeDays(`${m.nextRenewalDate}T00:00`)} · ${formatMoney(m.price)}`, task: { customerId: c.id, title: "Confirmar la renovación", reason: "Renovación próxima", dueDate: m.nextRenewalDate, alertKey: "renewal" }, to: `/clientes/${c.id}?tab=membresia` });
      } else if (s.membershipView === "PAUSED" && m?.resumeOn && m.resumeOn <= toISODate(addDays(new Date(), 10))) {
        out.push({ id: `pause-${c.id}`, icon: PauseCircle, tone: "info", customerId: c.id, title: n, reason: `Vuelve de la pausa ${relativeDays(`${m.resumeOn}T00:00`)}`, task: { customerId: c.id, title: "Confirmar la vuelta tras la pausa", dueDate: m.resumeOn, alertKey: "resume" }, to: `/clientes/${c.id}?tab=membresia` });
      } else if (c.status === "active" && s.lastActivity && s.lastActivity < toISODate(addDays(new Date(), -30)) && s.membershipView !== "ACTIVE") {
        out.push({ id: `idle-${c.id}`, icon: UserRoundX, tone: "warning", customerId: c.id, title: n, reason: `Sin actividad desde ${relativeDays(`${s.lastActivity}T12:00`)}`, task: { customerId: c.id, title: "Contactar: sin actividad reciente", reason: "Inactividad", alertKey: "inactive" }, to: `/clientes/${c.id}` });
      } else if (c.status === "lead" && !s.membership) {
        out.push({ id: `lead-${c.id}`, icon: UserPlus, tone: "info", customerId: c.id, title: n, reason: `Lead desde ${relativeDays(c.createdAt)}`, task: { customerId: c.id, title: "Ofrecer una clase de prueba", reason: "Lead sin convertir", alertKey: "lead" }, to: `/clientes/${c.id}` });
      }
    }
    const rank = { danger: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }, [ws.customers, idx]);

  const openCount = ws.tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
  const overdue = ws.tasks.filter((t) => taskBucket(t, today) === "overdue").length;

  return (
    <Page wide>
      <PageHeader
        title="Seguimiento"
        eyebrow={`${openCount} ${openCount === 1 ? "tarea abierta" : "tareas abiertas"}${overdue ? ` · ${overdue} atrasada${overdue === 1 ? "" : "s"}` : ""} · ${signals.length} avisos`}
        description="Con quién hablar hoy y por qué. Cada aviso explica su motivo; conviértelo en tarea para no perderlo."
        actions={manage && <Button variant="primary" icon={Plus} onClick={() => setCreating({})}>Nueva tarea</Button>}
      />
      <ServerNotice what="El seguimiento con tareas" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><ListTodo className="h-4 w-4 text-fg-3" />Tareas</h2>
            <Segmented size="sm" value={view} onChange={setView} items={[{ value: "open", label: "Pendientes" }, { value: "done", label: "Hechas" }]} />
          </div>
          {groups.length ? (
            <div className="flex flex-col gap-5">
              {groups.map(({ b, items }) => (
                <div key={b}>
                  <p className={cn("mb-2 text-2xs font-semibold uppercase tracking-[0.08em]", BUCKET[b].tone)}>{BUCKET[b].label} · {items.length}</p>
                  <Card padded={false} className="overflow-hidden">
                    <ul>
                      {items.map((t) => (
                        <li key={t.id} className="group flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                          <button
                            type="button"
                            disabled={!manage}
                            aria-label={t.status === "done" ? "Marcar como pendiente" : "Marcar como hecha"}
                            onClick={() => { setTaskStatus(ctx, t.id, t.status === "done" ? "pending" : "done"); toast.success(t.status === "done" ? "Tarea reabierta" : "Tarea completada"); }}
                            className="-mx-1.5 -mb-1.5 -mt-1 shrink-0 rounded-full p-1.5 text-fg-3 transition-colors hover:text-success disabled:opacity-50"
                          >
                            {t.status === "done" ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm font-medium", t.status === "done" && "text-fg-3 line-through")}>{t.title}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3 [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
                              {t.customerId && <Link to={`/clientes/${t.customerId}`} className="font-medium text-fg-2 hover:underline">{names.get(t.customerId) ?? "Cliente"}</Link>}
                              {t.reason && <span>{t.reason}</span>}
                              {t.dueDate && <span className={cn(b === "overdue" && "text-danger-fg")}>{formatDate(t.dueDate)}</span>}
                              {t.status === "done" && t.completedAt && <span>hecha {relativeDays(t.completedAt)}</span>}
                              {t.createdBy && <span>{person(t.createdBy)}</span>}
                            </p>
                            {t.description && <p className="mt-1 text-sm text-fg-2">{t.description}</p>}
                          </div>
                          {manage && t.status !== "done" && (
                            <IconButton icon={AlarmClock} label="Posponer a mañana" size="sm" className="opacity-60 group-hover:opacity-100" onClick={() => { snoozeTask(ctx, t.id, toISODate(addDays(new Date(), 1))); toast.success("Pospuesta a mañana"); }} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState compact icon={view === "done" ? RotateCcw : CheckCircle2} title={view === "done" ? "Aún no has completado tareas" : "Nada pendiente"} description={view === "done" ? "Las tareas completadas aparecerán aquí." : "Convierte un aviso en tarea o crea una nueva para no olvidar nada."} action={manage && view === "open" ? <Button icon={Plus} onClick={() => setCreating({})}>Nueva tarea</Button> : undefined} />
            </Card>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="h-4 w-4 text-accent" />Avisos</h2>
          {signals.length ? (
            <Card padded={false} className="overflow-hidden">
              <ul>
                {signals.slice(0, 30).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", s.tone === "danger" ? "bg-danger-soft text-danger-fg" : s.tone === "warning" ? "bg-warning-soft text-warning-fg" : "bg-accent-soft text-accent-fg")}><s.icon className="h-4 w-4" /></span>
                    <Link to={s.to} className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><Avatar name={s.title} size={18} /><span className="truncate text-sm font-medium hover:underline">{s.title}</span></span>
                      <span className="block truncate text-xs text-fg-3">{s.reason}</span>
                    </Link>
                    {manage && <Button size="sm" icon={Plus} onClick={() => setCreating(s.task)}>Tarea</Button>}
                  </li>
                ))}
              </ul>
              {signals.length > 30 && <p className="border-t border-line px-4 py-2.5 text-xs text-fg-3">Y {signals.length - 30} avisos más</p>}
            </Card>
          ) : (
            <Card><EmptyState compact icon={Sparkles} title="Sin avisos" description="Cuotas vencidas, renovaciones, vueltas de pausa, inactividad y leads aparecerán aquí con su motivo." /></Card>
          )}
          <p className="mt-3 text-xs text-fg-3"><Badge>Reglas</Badge> Cuota vencida · renovación en 7 días · vuelta de pausa en 10 días · 30 días sin actividad · leads sin convertir.</p>
        </section>
      </div>
      <TaskDrawer open={!!creating} onClose={() => setCreating(null)} defaults={creating ?? undefined} />
    </Page>
  );
}
