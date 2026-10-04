import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Ban, CirclePause, CirclePlay, CreditCard, MoreHorizontal, RotateCcw } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Button, Callout, Combobox, Drawer, Field, Input, Menu, MenuItem, Modal, MoneyInput, Segmented, Select, Switch, Textarea, useToast, DateInput } from "@/design-system/components";
import { assignMembership, cancelMembership, changeMembershipPlan, chargeMembership, pauseMembership, reactivateMembership, resumeMembership } from "@/data/repos/memberships";
import { customerName } from "@/data/repos/customers";
import { BILLING_PERIOD, currentVersion, membershipView, periodEnd } from "@/domain/memberships";
import { addDaysISO } from "@/domain/invoicing";
import type { CustomerMembership } from "@/domain/types";
import { formatDate, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const planLabel = (price: number, period: keyof typeof BILLING_PERIOD) => (period === "none" ? formatMoney(price) : `${formatMoney(price)} / ${BILLING_PERIOD[period].per}`);

/** Alta de membresía: cliente (si no viene dado), tarifa, inicio, centro, precio pactado y primera cuota. */
export function AssignMembershipDrawer({ open, onClose, customerId, onSaved }: { open: boolean; onClose: () => void; customerId?: string; onSaved?: (m: CustomerMembership) => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const { current, locations } = useLocationScope();
  const plans = ws.membershipPlans.filter((p) => p.status === "active" && p.openToNew);
  const [cid, setCid] = useState<string | undefined>(customerId);
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? "");
  const [start, setStart] = useState(toISODate(new Date()));
  const [loc, setLoc] = useState<string>(current?.id ?? locations[0]?.id ?? "");
  const [price, setPrice] = useState<number | null>(null);
  const [first, setFirst] = useState<"now" | "pending" | "later">("now");
  const [method, setMethod] = useState("card");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setCid(customerId);
    setStart(toISODate(new Date()));
    setPrice(null);
    setNotes("");
  }, [open, customerId]);
  const plan = ws.membershipPlans.find((p) => p.id === planId);
  const version = plan ? currentVersion(ws.planVersions, plan.id, start) : undefined;
  const effective = price ?? version?.price ?? 0;
  const canCharge = can("invoices.manage");
  const end = plan && version ? addDaysISO(periodEnd(start, plan.billingPeriod, version.durationDays), -1) : undefined;
  const save = () => {
    try {
      if (!cid) throw new Error("Elige el cliente");
      const m = assignMembership(ctx, {
        customerId: cid, planId, startDate: start, locationId: loc || undefined, price: price ?? undefined, notes,
        firstCharge: !canCharge || first === "later" ? undefined : first === "pending" ? "pending" : { methodKey: method },
      });
      toast.success("Membresía dada de alta", first === "now" && canCharge ? "Primera cuota cobrada y facturada" : undefined);
      onSaved?.(m);
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Nueva membresía" subtitle="Alta, precio pactado y primera cuota" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!cid || !planId} onClick={save}>Dar de alta</Button></>}>
      {!plans.length ? (
        <Callout tone="warning" title="No hay tarifas abiertas a nuevas altas">Crea una tarifa en Membresías → Tarifas.</Callout>
      ) : (
        <div className="flex flex-col gap-5">
          {!customerId && (
            <Field label="Cliente" required>
              <Combobox value={cid} onChange={setCid} placeholder="Buscar cliente…" options={ws.customers.filter((c) => !c.deletedAt).map((c) => ({ value: c.id, label: customerName(c), hint: c.email }))} />
            </Field>
          )}
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-2">Tarifa</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((p) => {
                const v = currentVersion(ws.planVersions, p.id, start);
                const sel = p.id === planId;
                return (
                  <button key={p.id} type="button" onClick={() => { setPlanId(p.id); setPrice(null); }} aria-pressed={sel}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${sel ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line bg-surface hover:border-line-strong"}`}>
                    <span className="block text-sm font-semibold">{p.name}</span>
                    <span className="mt-0.5 block text-sm text-fg-2 num">{v ? planLabel(v.price, p.billingPeriod) : "Sin precio"}</span>
                    {p.description && <span className="mt-1 block truncate text-xs text-fg-3">{p.description}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio" required hint={end ? `Primer periodo hasta el ${formatDate(end)}` : undefined}><DateInput value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Centro"><Select value={loc} onChange={(e) => setLoc(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Precio pactado (IVA incluido)" hint={version && price !== null && price !== version.price ? `Tarifa: ${formatMoney(version.price)}` : "Se conserva aunque la tarifa suba"}><MoneyInput value={effective} onChange={setPrice} /></Field>
          </div>
          {canCharge ? (
            <div>
              <p className="mb-2 text-[13px] font-medium text-fg-2">Primera cuota</p>
              <Segmented value={first} onChange={setFirst} items={[{ value: "now", label: "Cobrar ahora" }, { value: "pending", label: "Emitir pendiente" }, { value: "later", label: "Más tarde" }]} />
              {first === "now" && (
                <Field label="Cobrada con" className="mt-3 max-w-[240px]">
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>{ws.paymentMethods.filter((m) => m.status === "active" && m.kind !== "unknown").map((m) => <option key={m.id} value={m.key}>{m.name}</option>)}</Select>
                </Field>
              )}
              <p className="mt-2 text-xs text-fg-3">{first === "later" ? "La cuota quedará pendiente de generar en la fecha de inicio." : `Se emite la factura de ${formatMoney(effective)} con el periodo de servicio.`}</p>
            </div>
          ) : (
            <Callout>Tu rol no emite facturas: la cuota la generará alguien con permiso de facturación.</Callout>
          )}
          <Field label="Notas"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condiciones especiales, promoción…" /></Field>
        </div>
      )}
    </Drawer>
  );
}

type Dialog = "charge" | "pause" | "cancel" | "change" | null;

/** Acciones sobre una membresía (cobrar cuota, pausar, reanudar, cambiar tarifa, baja, reactivar) con sus diálogos. */
export function MembershipActions({ membership: m, size = "md" }: { membership: CustomerMembership; size?: "sm" | "md" }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const ready = useServerReady();
  const [dialog, setDialog] = useState<Dialog>(null);
  const v = membershipView(m, ws.membershipCharges);
  if (!can("memberships.manage") || !ready) return null;
  const run = (fn: () => void, ok: string) => { try { fn(); toast.success(ok); setDialog(null); } catch (e) { toast.fromError(e); } };
  const live = v === "ACTIVE" || v === "PAST_DUE" || v === "PENDING";
  const ended = v === "CANCELLED" || v === "EXPIRED";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {live && can("invoices.manage") && m.nextRenewalDate && <Button size={size === "sm" ? "sm" : "md"} variant="primary" icon={CreditCard} onClick={() => setDialog("charge")}>Cobrar cuota</Button>}
        {v === "PAUSED" && <Button size={size === "sm" ? "sm" : "md"} variant="primary" icon={CirclePlay} onClick={() => run(() => resumeMembership(ctx, m.id), "Membresía reanudada")}>Reanudar</Button>}
        {ended && <Button size={size === "sm" ? "sm" : "md"} variant="primary" icon={RotateCcw} onClick={() => run(() => reactivateMembership(ctx, m.id), "Membresía reactivada")}>Reactivar</Button>}
        {!ended && (
          <Menu width={210} trigger={(_, t) => <Button size={size === "sm" ? "sm" : "md"} icon={MoreHorizontal} onClick={t}>Gestionar</Button>}>
            {(close) => (
              <>
                <MenuItem icon={ArrowRightLeft} onClick={() => { close(); setDialog("change"); }}>Cambiar tarifa</MenuItem>
                {v === "ACTIVE" || v === "PAST_DUE" ? <MenuItem icon={CirclePause} onClick={() => { close(); setDialog("pause"); }}>Pausar</MenuItem> : null}
                <MenuItem icon={Ban} danger onClick={() => { close(); setDialog("cancel"); }}>Dar de baja</MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
      {dialog === "charge" && <ChargeModal m={m} onClose={() => setDialog(null)} onDone={(fn, ok) => run(fn, ok)} />}
      {dialog === "pause" && <PauseModal onClose={() => setDialog(null)} onConfirm={(resumeOn, reason) => run(() => pauseMembership(ctx, m.id, { resumeOn, reason }), "Membresía en pausa")} />}
      {dialog === "cancel" && <CancelModal m={m} onClose={() => setDialog(null)} onConfirm={(o) => run(() => cancelMembership(ctx, m.id, o), "Baja registrada")} />}
      {dialog === "change" && <ChangePlanModal m={m} onClose={() => setDialog(null)} onConfirm={(planId, startDate) => run(() => changeMembershipPlan(ctx, m.id, planId, { startDate }), "Tarifa cambiada")} />}
    </>
  );
}

function ChargeModal({ m, onClose, onDone }: { m: CustomerMembership; onClose: () => void; onDone: (fn: () => void, ok: string) => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const plan = ws.membershipPlans.find((p) => p.id === m.planId);
  const version = ws.planVersions.find((x) => x.id === m.planVersionId);
  const start = m.nextRenewalDate ?? m.startDate;
  const end = plan ? addDaysISO(periodEnd(start, plan.billingPeriod, version?.durationDays), -1) : start;
  const [mode, setMode] = useState<"paid" | "pending">(can("payments.manage") ? "paid" : "pending");
  const [method, setMethod] = useState("card");
  return (
    <Modal open onClose={onClose} size="sm" title="Cobrar cuota" description={`${plan?.name ?? "Tarifa"} · ${formatDate(start)} – ${formatDate(end)}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onDone(() => chargeMembership(ctx, m.id, mode === "paid" ? { methodKey: method } : {}), mode === "paid" ? "Cuota cobrada y facturada" : "Cuota emitida, pendiente de cobro")}>{mode === "paid" ? `Cobrar ${formatMoney(m.price)}` : "Emitir pendiente"}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="figure text-4xl">{formatMoney(m.price)}</p>
        {can("payments.manage") && <Segmented value={mode} onChange={setMode} items={[{ value: "paid", label: "Cobrada ahora" }, { value: "pending", label: "Pendiente de cobro" }]} />}
        {mode === "paid" && (
          <Field label="Método"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{ws.paymentMethods.filter((x) => x.status === "active" && x.kind !== "unknown").map((x) => <option key={x.id} value={x.key}>{x.name}</option>)}</Select></Field>
        )}
        <p className="text-xs text-fg-3">Se emite la factura de la cuota con su periodo de servicio y la próxima renovación pasa al {formatDate(addDaysISO(end, 1))}.</p>
      </div>
    </Modal>
  );
}

function PauseModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (resumeOn: string | undefined, reason: string) => void }) {
  const [resumeOn, setResumeOn] = useState(toISODate(new Date(Date.now() + 30 * 86_400_000)));
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} size="sm" title="Pausar membresía" description="No se generan cuotas mientras dure la pausa. Al reanudar, la renovación se desplaza los días pausados."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onConfirm(resumeOn || undefined, reason)}>Pausar</Button></>}>
      <div className="grid gap-4">
        <Field label="Vuelve el" hint="Opcional: crea un aviso en Seguimiento"><DateInput value={resumeOn} onChange={(e) => setResumeOn(e.target.value)} /></Field>
        <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Viaje, lesión, vacaciones…" /></Field>
      </div>
    </Modal>
  );
}

function CancelModal({ m, onClose, onConfirm }: { m: CustomerMembership; onClose: () => void; onConfirm: (o: { reason: string; endDate?: string; markCustomerInactive: boolean }) => void }) {
  const lastPaidEnd = m.nextRenewalDate ? addDaysISO(m.nextRenewalDate, -1) : toISODate(new Date());
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState(lastPaidEnd >= m.startDate ? lastPaidEnd : toISODate(new Date()));
  const [mark, setMark] = useState(true);
  return (
    <Modal open onClose={onClose} size="sm" title="Dar de baja" description="La membresía y sus cuotas se conservan en el histórico. No se generan más cuotas."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => onConfirm({ reason, endDate, markCustomerInactive: mark })}>Confirmar baja</Button></>}>
      <div className="grid gap-4">
        <Field label="Motivo" required><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cambio de ciudad, precio, horarios…" /></Field>
        <Field label="Último día con acceso" hint="Por defecto, el final del periodo ya pagado"><DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Switch checked={mark} onChange={setMark} label="Marcar al cliente como baja" description="Si no tiene otra membresía activa" />
      </div>
    </Modal>
  );
}

function ChangePlanModal({ m, onClose, onConfirm }: { m: CustomerMembership; onClose: () => void; onConfirm: (planId: string, startDate: string) => void }) {
  const ws = useWorkspace();
  const plans = useMemo(() => ws.membershipPlans.filter((p) => p.status === "active" && p.id !== m.planId), [ws.membershipPlans, m.planId]);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [start, setStart] = useState(m.nextRenewalDate && m.nextRenewalDate > toISODate(new Date()) ? m.nextRenewalDate : toISODate(new Date()));
  const v = currentVersion(ws.planVersions, planId, start);
  const p = ws.membershipPlans.find((x) => x.id === planId);
  return (
    <Modal open onClose={onClose} size="sm" title="Cambiar tarifa" description="La tarifa actual termina el día anterior y empieza la nueva con su precio vigente."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!planId} onClick={() => onConfirm(planId, start)}>Cambiar tarifa</Button></>}>
      <div className="grid gap-4">
        <Field label="Nueva tarifa"><Select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Desde" hint="Por defecto, la próxima renovación"><DateInput value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        {v && p && <p className="text-sm text-fg-2">Nuevo precio: <span className="font-semibold num">{planLabel(v.price, p.billingPeriod)}</span> (antes {formatMoney(m.price)})</p>}
      </div>
    </Modal>
  );
}
