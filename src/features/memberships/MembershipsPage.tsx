import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, BadgeEuro, Contact, History, Pencil, Plus, Tags } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import {
  Avatar, Badge, Button, Card, CardHeader, DataTable, Drawer, EmptyState, Field, FilterBar, FilterSelect, Input, Kpi, KpiStrip, MoneyInput, Page, PageHeader,
  SearchField, Select, Switch, Tabs, Textarea, useToast, type Column,
} from "@/design-system/components";
import { BarList, CountTrend } from "@/design-system/components/charts";
import { createPlan, setPlanStatus, updatePlan, type PlanInput } from "@/data/repos/memberships";
import { customerName } from "@/data/repos/customers";
import { BILLING_PERIOD, currentVersion, MEMBERSHIP_VIEW, membershipEvolution, membershipSummary, membershipView, pastDueOwed, PLAN_KIND, type MembershipView } from "@/domain/memberships";
import type { CustomerMembership, MembershipPlan } from "@/domain/types";
import { capitalize, formatDate, monthName, monthShort, startOfMonth, toISODate, addMonths } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { euros } from "@/lib/export";
import { normalizeKey } from "@/lib/text";
import { AssignMembershipDrawer } from "./MembershipDialogs";

type Tab = "members" | "plans";

export default function MembershipsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { can } = useSession();
  const ready = useServerReady();
  const [params, setParams] = useSearchParams();
  const { filterId, current, locations } = useLocationScope();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "tarifas" ? "plans" : "members");
  const [assign, setAssign] = useState(false);
  const [planEdit, setPlanEdit] = useState<MembershipPlan | "new" | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<MembershipView | "">((params.get("estado") as MembershipView) || "");
  const [planF, setPlanF] = useState("");
  const now = useMemo(() => new Date(), []);
  const today = toISODate(now);
  const monthStart = toISODate(startOfMonth(now));
  const refs = { plans: ws.membershipPlans, versions: ws.planVersions, charges: ws.membershipCharges };
  const sum = useMemo(() => membershipSummary(ws.customerMemberships, refs, { start: monthStart, end: toISODate(addMonths(startOfMonth(now), 1)) }, today, 7, filterId), [ws.customerMemberships, ws.membershipPlans, ws.planVersions, ws.membershipCharges, filterId]); // eslint-disable-line react-hooks/exhaustive-deps
  const evo = useMemo(() => membershipEvolution(ws.customerMemberships, now, 12, filterId), [ws.customerMemberships, now, filterId]);
  const names = useMemo(() => new Map(ws.customers.map((c) => [c.id, customerName(c)])), [ws.customers]);
  const plans = useMemo(() => new Map(ws.membershipPlans.map((p) => [p.id, p])), [ws.membershipPlans]);
  const locName = useMemo(() => new Map(ws.locations.map((l) => [l.id, l.name])), [ws.locations]);
  const pastDueAmount = useMemo(() => pastDueOwed(ws.customerMemberships, ws.membershipCharges, ws.invoices, today, filterId), [ws.customerMemberships, ws.membershipCharges, ws.invoices, today, filterId]);
  const manage = can("memberships.manage") && ready;

  // Una fila por cliente: la membresía de referencia (la viva más reciente)
  const rows = useMemo(() => {
    const byCustomer = new Map<string, CustomerMembership>();
    for (const m of [...ws.customerMemberships].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      const prev = byCustomer.get(m.customerId);
      const live = (x: CustomerMembership) => x.status === "active" || x.status === "paused" || x.status === "pending";
      if (!prev || live(m) || !live(prev)) byCustomer.set(m.customerId, m);
    }
    const nq = normalizeKey(q);
    return [...byCustomer.values()]
      .filter((m) => !filterId || !m.locationId || m.locationId === filterId)
      .filter((m) => !status || membershipView(m, ws.membershipCharges, today) === status)
      .filter((m) => !planF || m.planId === planF)
      .filter((m) => !nq || normalizeKey(`${names.get(m.customerId) ?? ""} ${plans.get(m.planId)?.name ?? ""}`).includes(nq));
  }, [ws.customerMemberships, ws.membershipCharges, filterId, status, planF, q, names, plans, today]);

  const counts = useMemo(() => {
    const m = new Map<MembershipView, number>();
    for (const r of ws.customerMemberships) { const v = membershipView(r, ws.membershipCharges, today); m.set(v, (m.get(v) ?? 0) + 1); }
    return m;
  }, [ws.customerMemberships, ws.membershipCharges, today]);

  const columns: Column<CustomerMembership>[] = [
    { id: "customer", header: "Cliente", hideable: false, sortValue: (m) => names.get(m.customerId) ?? "", exportValue: (m) => names.get(m.customerId) ?? "", cell: (m) => <span className="flex items-center gap-2.5"><Avatar name={names.get(m.customerId) ?? "?"} size={28} /><span className="truncate font-medium">{names.get(m.customerId) ?? "Cliente"}</span></span> },
    { id: "plan", header: "Tarifa", sortValue: (m) => plans.get(m.planId)?.name ?? "", exportValue: (m) => plans.get(m.planId)?.name ?? "", cell: (m) => <span className="text-fg-2">{plans.get(m.planId)?.name ?? "—"}</span> },
    { id: "status", header: "Estado", sortValue: (m) => membershipView(m, ws.membershipCharges, today), exportValue: (m) => MEMBERSHIP_VIEW[membershipView(m, ws.membershipCharges, today)].label, cell: (m) => { const v = membershipView(m, ws.membershipCharges, today); return <Badge tone={MEMBERSHIP_VIEW[v].tone} dot>{MEMBERSHIP_VIEW[v].label}</Badge>; } },
    { id: "location", header: "Centro", priority: "low", exportValue: (m) => locName.get(m.locationId ?? "") ?? "", cell: (m) => <span className="text-fg-2">{locName.get(m.locationId ?? "") ?? "—"}</span> },
    { id: "start", header: "Desde", priority: "medium", sortValue: (m) => m.startDate, exportValue: (m) => m.startDate, cell: (m) => <span className="text-fg-2 num">{formatDate(m.startDate)}</span> },
    {
      id: "renewal", header: "Próxima renovación", priority: "medium", sortValue: (m) => m.nextRenewalDate ?? "9", exportValue: (m) => m.nextRenewalDate ?? "",
      cell: (m) => { const v = membershipView(m, ws.membershipCharges, today); return v === "CANCELLED" || v === "EXPIRED" ? <span className="text-fg-3">Baja {m.endDate ? formatDate(m.endDate) : ""}</span> : v === "PAUSED" ? <span className="text-fg-3">{m.resumeOn ? `Vuelve ${formatDate(m.resumeOn)}` : "En pausa"}</span> : m.nextRenewalDate ? <span className={m.nextRenewalDate < today ? "text-danger-fg num" : "num text-fg-2"}>{formatDate(m.nextRenewalDate)}</span> : <span className="text-fg-3">—</span>; },
    },
    { id: "price", header: "Cuota", align: "right", sortValue: (m) => m.price, exportValue: (m) => euros(m.price), exportFormat: "money", cell: (m) => { const p = plans.get(m.planId); return <span className="font-semibold">{formatMoney(m.price)}<span className="text-xs font-normal text-fg-3">{p && p.billingPeriod !== "none" ? ` /${BILLING_PERIOD[p.billingPeriod].per}` : ""}</span></span>; } },
  ];

  const newBtn = manage && <Button variant="primary" icon={Plus} onClick={() => setAssign(true)}>Nueva membresía</Button>;
  return (
    <Page wide>
      <PageHeader
        eyebrow={`${current ? current.name : "Todos los centros"} · ${capitalize(now.toLocaleDateString("es-ES", { month: "long", year: "numeric" }))}`}
        title="Membresías"
        description="Altas, pausas, bajas, renovaciones y cuotas. Cada cuota es una factura con su periodo de servicio."
        actions={<>{can("catalog.manage") && ready && <Button icon={Tags} onClick={() => setPlanEdit("new")}>Nueva tarifa</Button>}{newBtn}</>}
      />
      <ServerNotice what="La gestión de membresías" />
      <KpiStrip className="mb-5">
        <Kpi label="Membresías activas" value={(sum.active + sum.pastDue).toLocaleString("es-ES")} hint={`${sum.paused} en pausa · ${sum.pending} por empezar`} />
        <Kpi label="MRR" tooltip="Ingreso recurrente mensual sin IVA de las membresías vivas (anuales y trimestrales prorrateadas al mes)" value={formatMoney(sum.mrr)} hint="Sin IVA · anuales prorrateadas" />
        <Kpi label="Cuotas vencidas" value={sum.pastDue.toLocaleString("es-ES")} hint={sum.pastDue ? <button type="button" className="text-danger-fg hover:underline" onClick={() => { setTab("members"); setStatus("PAST_DUE"); }}>{formatMoney(pastDueAmount)} sin cobrar</button> : "Todo al día"} />
        <Kpi label="Renovaciones 7 días" value={sum.upcoming.count.toLocaleString("es-ES")} hint={formatMoney(sum.upcoming.amount)} />
        <Kpi label="Altas / bajas del mes" value={`+${sum.newInPeriod} / −${sum.cancelledInPeriod}`} hint={sum.active ? `Neto ${sum.newInPeriod - sum.cancelledInPeriod >= 0 ? "+" : ""}${sum.newInPeriod - sum.cancelledInPeriod}` : undefined} />
      </KpiStrip>

      <Tabs className="mb-5" value={tab} onChange={(t) => { setTab(t); setParams(t === "plans" ? { tab: "tarifas" } : {}, { replace: true }); }} items={[{ value: "members", label: "Membresías", count: rows.length }, { value: "plans", label: "Tarifas", count: ws.membershipPlans.filter((p) => p.status !== "archived").length }]} />

      {tab === "members" && (
        !ws.customerMemberships.length ? (
          <Card><EmptyState icon={Contact} title="Aún no hay membresías" description={ws.membershipPlans.length ? "Da de alta la primera: elige cliente y tarifa; la primera cuota se puede cobrar en el mismo paso." : "Empieza creando tus tarifas (mensual, trimestral, bonos…) y después da de alta a tus clientes."} action={ws.membershipPlans.length ? newBtn || undefined : can("catalog.manage") ? <Button variant="primary" icon={Tags} onClick={() => setPlanEdit("new")}>Crear tarifa</Button> : undefined} /></Card>
        ) : (
          <>
            <div className="mb-5 grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
              <Card className="md:col-span-7">
                <CardHeader title="Evolución" description="Membresías vivas al cierre de cada mes · altas y bajas en el detalle" />
                <CountTrend label="activas" height={200} data={evo.map((e) => ({ key: toISODate(e.date), label: capitalize(monthShort(e.date.getMonth())), tooltipLabel: capitalize(`${monthName(e.date.getMonth())} ${e.date.getFullYear()}`), value: e.active, sub: `+${e.added} altas · −${e.cancelled} bajas` }))} />
              </Card>
              <Card className="md:col-span-5">
                <CardHeader title="MRR por tarifa" description="Ingreso recurrente mensual · sin IVA" action={<BadgeEuro className="h-4 w-4 text-fg-3" />} />
                <BarList wrap rows={sum.byPlan.map((p) => ({ key: p.id, label: <button type="button" className="hover:underline" title={p.name} onClick={() => setPlanF(p.id)}>{p.name}</button>, sub: p.count, value: p.mrr }))} emptyText="Sin membresías vivas" />
              </Card>
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(m) => m.id}
              onRowClick={(m) => navigate(`/clientes/${m.customerId}?tab=membresia`)}
              storageKey="memberships"
              exportName="Membresias"
              exportCompany={ws.organization.name}
              filters={
                <FilterBar className="mb-0" active={[q, status, planF].filter(Boolean).length} onClear={() => { setQ(""); setStatus(""); setPlanF(""); }}>
                  <SearchField value={q} onChange={setQ} placeholder="Buscar cliente o tarifa…" />
                  <FilterSelect label="Estado" value={status} onChange={setStatus} options={(["ACTIVE", "PAST_DUE", "PAUSED", "PENDING", "CANCELLED", "EXPIRED"] as MembershipView[]).map((v) => ({ value: v, label: MEMBERSHIP_VIEW[v].label, count: counts.get(v) ?? 0 }))} />
                  <FilterSelect label="Tarifa" value={planF} onChange={setPlanF} options={ws.membershipPlans.map((p) => ({ value: p.id, label: p.name }))} />
                </FilterBar>
              }
              mobile={{
                leading: (m) => <Avatar name={names.get(m.customerId) ?? "?"} size={34} />,
                title: (m) => names.get(m.customerId) ?? "Cliente",
                subtitle: (m) => `${plans.get(m.planId)?.name ?? ""}${m.nextRenewalDate ? ` · renueva ${formatDate(m.nextRenewalDate)}` : ""}`,
                value: (m) => formatMoney(m.price),
                status: (m) => { const v = membershipView(m, ws.membershipCharges, today); return <Badge tone={MEMBERSHIP_VIEW[v].tone} dot>{MEMBERSHIP_VIEW[v].label}</Badge>; },
              }}
              empty={{ icon: Contact, title: "Ninguna membresía con estos filtros", description: "Prueba con otro estado o tarifa." }}
            />
          </>
        )
      )}

      {tab === "plans" && (
        ws.membershipPlans.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ws.membershipPlans.filter((p) => p.status !== "archived").map((p) => {
              const v = currentVersion(ws.planVersions, p.id);
              const versions = ws.planVersions.filter((x) => x.planId === p.id).sort((a, b) => b.version - a.version);
              const stat = sum.byPlan.find((x) => x.id === p.id);
              return (
                <Card key={p.id} className="flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">{p.name}</p>
                      <p className="mt-0.5 text-xs text-fg-3">{PLAN_KIND[p.kind]} · {BILLING_PERIOD[p.billingPeriod].label}{p.locationIds?.length ? ` · ${p.locationIds.map((id) => locName.get(id)).join(", ")}` : ""}</p>
                    </div>
                    {!p.openToNew ? <Badge>Cerrada a altas</Badge> : p.status === "inactive" ? <Badge tone="warning">Inactiva</Badge> : <Badge tone="success" dot>Abierta</Badge>}
                  </div>
                  <p className="mt-4 text-[28px] font-semibold leading-none tracking-[-0.03em] num">{v ? formatMoney(v.price) : "—"}<span className="ml-1 text-sm font-normal text-fg-3">{p.billingPeriod !== "none" ? `/ ${BILLING_PERIOD[p.billingPeriod].per}` : ""}</span></p>
                  <p className="mt-1 text-xs text-fg-3">IVA {v ? formatRate(v.taxRateBp) : "—"} incluido{v?.sessions ? ` · ${v.sessions} sesiones` : ""}{v?.durationDays ? ` · ${v.durationDays} días` : ""}</p>
                  {p.description && <p className="mt-3 text-sm text-fg-2">{p.description}</p>}
                  <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm">
                    <div className="bg-surface-2 px-3 py-2"><p className="text-xs text-fg-3">Activas</p><p className="font-semibold num">{stat?.count ?? 0}</p></div>
                    <div className="bg-surface-2 px-3 py-2"><p className="text-xs text-fg-3">MRR</p><p className="font-semibold num">{formatMoney(stat?.mrr ?? 0)}</p></div>
                  </div>
                  {versions.length > 1 && (
                    <div className="mt-3 text-xs text-fg-3">
                      <p className="flex items-center gap-1.5 font-medium text-fg-2"><History className="h-3.5 w-3.5" />Histórico de precio</p>
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {versions.slice(0, 3).map((x) => <li key={x.id} className="flex justify-between num"><span>v{x.version} · desde {formatDate(x.validFrom)}</span><span>{formatMoney(x.price)}</span></li>)}
                      </ul>
                    </div>
                  )}
                  {can("catalog.manage") && ready && (
                    <div className="mt-auto flex gap-2 pt-4">
                      <Button size="sm" icon={Pencil} onClick={() => setPlanEdit(p)}>Editar</Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card><EmptyState icon={Tags} title="Aún no hay tarifas" description="Define tus cuotas (mensual, trimestral, anual), bonos de sesiones o pruebas. El precio queda versionado: subirlo no cambia lo pactado con quien ya la tiene." action={can("catalog.manage") && ready ? <Button variant="primary" icon={Plus} onClick={() => setPlanEdit("new")}>Crear tarifa</Button> : undefined} /></Card>
        )
      )}

      <AssignMembershipDrawer open={assign} onClose={() => setAssign(false)} />
      <PlanDrawer plan={planEdit === "new" ? undefined : planEdit ?? undefined} open={!!planEdit} onClose={() => setPlanEdit(null)} locations={locations} />
    </Page>
  );
}

function PlanDrawer({ open, onClose, plan, locations }: { open: boolean; onClose: () => void; plan?: MembershipPlan; locations: { id: string; name: string }[] }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const blank: PlanInput = { name: "", kind: "recurring", billingPeriod: "month", price: 0, taxRateBp: ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100, openToNew: true, locationIds: null };
  const [f, setF] = useState<PlanInput>(blank);
  useEffect(() => {
    if (!open) return;
    if (plan) {
      const v = currentVersion(ws.planVersions, plan.id);
      setF({ name: plan.name, kind: plan.kind, billingPeriod: plan.billingPeriod, price: v?.price ?? 0, taxRateBp: v?.taxRateBp ?? 2100, description: plan.description, openToNew: plan.openToNew, isFounder: plan.isFounder, sessions: v?.sessions, durationDays: v?.durationDays, locationIds: plan.locationIds ?? null });
    } else setF(blank);
  }, [open, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = plan ? currentVersion(ws.planVersions, plan.id) : undefined;
  const priceChange = !!plan && !!cur && (cur.price !== f.price || cur.taxRateBp !== f.taxRateBp);
  const live = plan ? ws.customerMemberships.filter((m) => m.planId === plan.id && (m.status === "active" || m.status === "paused")).length : 0;
  const save = () => {
    try {
      if (plan) updatePlan(ctx, plan.id, f);
      else createPlan(ctx, f);
      toast.success(plan ? (priceChange ? "Nueva versión de precio creada" : "Tarifa actualizada") : "Tarifa creada");
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  const rates = [...new Set(ws.taxRates.filter((t) => t.status === "active").map((t) => t.rateBp))].sort((a, b) => b - a);
  return (
    <Drawer open={open} onClose={onClose} title={plan ? "Editar tarifa" : "Nueva tarifa"} subtitle="Precio con IVA incluido, versionado en el tiempo"
      footer={<>
        {plan && <Button variant="ghost" className="mr-auto" icon={Archive} onClick={() => { try { setPlanStatus(ctx, plan.id, "archived"); toast.success("Tarifa archivada", live ? `${live} membresías la conservan` : undefined); onClose(); } catch (e) { toast.fromError(e); } }}>Archivar</Button>}
        <Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.name.trim()} onClick={save}>{plan ? "Guardar" : "Crear tarifa"}</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Mensual ilimitada" /></Field>
        <Field label="Tipo">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PlanInput["kind"], billingPeriod: e.target.value === "recurring" ? (f.billingPeriod === "none" ? "month" : f.billingPeriod) : "none" })}>
            {Object.entries(PLAN_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Periodicidad">
          <Select value={f.billingPeriod} disabled={f.kind !== "recurring"} onChange={(e) => setF({ ...f, billingPeriod: e.target.value as PlanInput["billingPeriod"] })}>
            {Object.entries(BILLING_PERIOD).filter(([k]) => f.kind === "recurring" ? k !== "none" : k === "none").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Precio (IVA incluido)" required><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v ?? 0 })} /></Field>
        <Field label="IVA"><Select value={f.taxRateBp} onChange={(e) => setF({ ...f, taxRateBp: Number(e.target.value) })}>{rates.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}</Select></Field>
        {f.kind !== "recurring" && (
          <>
            <Field label="Sesiones incluidas"><Input inputMode="numeric" value={f.sessions ?? ""} onChange={(e) => setF({ ...f, sessions: Number(e.target.value) || undefined })} /></Field>
            <Field label="Validez (días)"><Input inputMode="numeric" value={f.durationDays ?? ""} onChange={(e) => setF({ ...f, durationDays: Number(e.target.value) || undefined })} /></Field>
          </>
        )}
        {locations.length > 1 && (
          <Field label="Centros" className="sm:col-span-2" hint="Vacío = todos">
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l) => {
                const on = !!f.locationIds?.includes(l.id);
                return <button key={l.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, locationIds: on ? ((f.locationIds ?? []).filter((x) => x !== l.id).length ? (f.locationIds ?? []).filter((x) => x !== l.id) : null) : [...(f.locationIds ?? []), l.id] })} className={`h-8 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent-soft text-accent-fg" : "border-line"}`}>{l.name}</button>;
              })}
            </div>
          </Field>
        )}
        <Field label="Descripción" className="sm:col-span-2"><Textarea value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.openToNew} onChange={(v) => setF({ ...f, openToNew: v })} label="Abierta a nuevas altas" description="Si la cierras, quien ya la tiene la conserva" /></div>
        {priceChange && (
          <p className="rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm text-accent-fg sm:col-span-2">
            Se creará la versión {Math.max(...ws.planVersions.filter((v) => v.planId === plan!.id).map((v) => v.version)) + 1} con precio {formatMoney(f.price)} desde hoy. {live ? `Las ${live} membresías actuales conservan su precio pactado.` : ""}
            {!can("catalog.prices") && " Necesitas permiso para cambiar precios."}
          </p>
        )}
      </div>
    </Drawer>
  );
}
