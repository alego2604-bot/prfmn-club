import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ListTodo, Plus, Store, Users } from "lucide-react";
import { useSession, useWorkspace, useLocationScope } from "@/app/session";
import { Avatar, Badge, Button, DataTable, FilterBar, FilterSelect, Page, PageHeader, SearchField, StatStrip, type Column } from "@/design-system/components";
import { customerName } from "@/data/repos/customers";
import { customerIndex, EMPTY_SNAPSHOT, nextAction } from "@/domain/customer360";
import { MEMBERSHIP_VIEW, type MembershipView } from "@/domain/memberships";
import type { Customer, CustomerStatus } from "@/domain/types";
import { formatDate, relativeDays, toISODate } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";
import { euros } from "@/lib/export";
import { normalizeKey } from "@/lib/text";
import { CustomerForm, CUSTOMER_STATUS } from "./CustomerForm";

type Quick = "" | "riesgo" | "fiscal" | "saldo" | "renovacion";

export default function CustomersPage() {
  const ws = useWorkspace();
  const { can } = useSession();
  const navigate = useNavigate();
  const { filterId, locations } = useLocationScope();
  const [params, setParams] = useSearchParams();
  const today = toISODate(new Date());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CustomerStatus | "">((params.get("estado") as CustomerStatus) || "");
  const [mview, setMview] = useState<MembershipView | "none" | "">("");
  const [plan, setPlan] = useState("");
  const [loc, setLoc] = useState("");
  const [tag, setTag] = useState("");
  const [quick, setQuick] = useState<Quick>((params.get("filtro") as Quick) || "");
  const idx = useMemo(() => customerIndex(ws, today), [ws, today]);
  const snap = (c: Customer) => idx.get(c.id) ?? EMPTY_SNAPSHOT;
  const locName = useMemo(() => new Map(ws.locations.map((l) => [l.id, l.name])), [ws.locations]);
  const all = ws.customers.filter((c) => !c.deletedAt);
  const monthAgo = toISODate(new Date(Date.now() - 30 * 86_400_000));
  const atRisk = (c: Customer) => c.status === "active" && !!snap(c).lastActivity && snap(c).lastActivity! < monthAgo;
  const fiscal = (c: Customer) => c.taxIdValid === false || (!c.taxId && snap(c).pendingInvoices.length + (snap(c).lifetimeValue > 0 ? 1 : 0) > 0 && !!c.companyName);
  const soonRenew = (c: Customer) => { const m = snap(c).membership; return snap(c).membershipView === "ACTIVE" && !!m?.nextRenewalDate && m.nextRenewalDate <= toISODate(new Date(Date.now() + 7 * 86_400_000)); };
  const tags = [...new Set(all.flatMap((c) => c.tags))].sort();
  const nq = normalizeKey(q);

  const rows = all
    .filter((c) => !filterId || !snap(c).locationId || snap(c).locationId === filterId)
    .filter((c) => !status || c.status === status)
    .filter((c) => !mview || (mview === "none" ? !snap(c).membership : snap(c).membershipView === mview))
    .filter((c) => !plan || snap(c).membership?.planId === plan)
    .filter((c) => !loc || snap(c).locationId === loc)
    .filter((c) => !tag || c.tags.includes(tag))
    .filter((c) => quick === "" ? true : quick === "riesgo" ? atRisk(c) : quick === "fiscal" ? fiscal(c) : quick === "saldo" ? snap(c).balance > 0 : soonRenew(c))
    .filter((c) => !nq || normalizeKey(`${customerName(c)} ${c.taxId ?? ""} ${c.email ?? ""} ${c.phone ?? ""} ${c.city ?? ""} ${snap(c).planName ?? ""}`).includes(nq));
  const active = [q, status, mview, plan, loc, tag, quick].filter(Boolean).length;
  const clear = () => { setQ(""); setStatus(""); setMview(""); setPlan(""); setLoc(""); setTag(""); setQuick(""); setParams({}, { replace: true }); };

  const columns: Column<Customer>[] = [
    {
      id: "name", header: "Cliente", hideable: false, sortValue: (c) => customerName(c).toLowerCase(), exportValue: customerName,
      cell: (c) => (
        <span className="flex items-center gap-3">
          <Avatar name={customerName(c)} size={30} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5"><span className="truncate font-medium">{customerName(c)}</span>{c.taxIdValid === false && <span title="NIF no válido"><AlertCircle className="h-3.5 w-3.5 text-danger" /></span>}</span>
            <span className="block truncate text-xs text-fg-3">{c.email ?? c.phone ?? "Sin contacto"}</span>
          </span>
        </span>
      ),
    },
    { id: "status", header: "Estado", sortValue: (c) => c.status, exportValue: (c) => CUSTOMER_STATUS[c.status].label, cell: (c) => <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge> },
    {
      id: "membership", header: "Membresía", sortValue: (c) => snap(c).planName ?? "", exportValue: (c) => (snap(c).planName ? `${snap(c).planName} · ${MEMBERSHIP_VIEW[snap(c).membershipView!].label}` : ""),
      cell: (c) => { const s = snap(c); return s.membership ? <span className="block min-w-0"><span className="block truncate text-fg-2">{s.planName}</span>{s.membershipView !== "ACTIVE" && <span className={`text-xs ${s.membershipView === "PAST_DUE" ? "text-danger-fg" : "text-fg-3"}`}>{MEMBERSHIP_VIEW[s.membershipView!].label}</span>}</span> : <span className="text-fg-3">—</span>; },
    },
    { id: "location", header: "Centro", priority: "low", exportValue: (c) => locName.get(snap(c).locationId ?? "") ?? "", cell: (c) => <span className="text-fg-2">{locName.get(snap(c).locationId ?? "") ?? "—"}</span>, defaultHidden: locations.length < 2 },
    { id: "last", header: "Última actividad", priority: "medium", sortValue: (c) => snap(c).lastActivity ?? "", exportValue: (c) => snap(c).lastActivity ?? "", cell: (c) => { const l = snap(c).lastActivity; return l ? <span className={l < monthAgo && c.status === "active" ? "text-warning-fg" : "text-fg-2"}>{relativeDays(`${l}T12:00`)}</span> : <span className="text-fg-3">—</span>; } },
    { id: "next", header: "Próxima acción", priority: "low", exportValue: (c) => nextAction(c, snap(c), today).label, cell: (c) => { const a = nextAction(c, snap(c), today); return a.kind === "none" ? <span className="text-fg-3">—</span> : <span className={`block max-w-[200px] truncate text-xs ${a.tone === "danger" ? "text-danger-fg" : a.tone === "warning" ? "text-warning-fg" : "text-fg-2"}`}>{a.label}</span>; } },
    { id: "tags", header: "Etiquetas", priority: "low", defaultHidden: !tags.length, exportValue: (c) => c.tags.join(", "), cell: (c) => (c.tags.length ? <span className="flex flex-wrap gap-1">{c.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span> : <span className="text-fg-3">—</span>) },
    { id: "joined", header: "Alta", defaultHidden: true, sortValue: (c) => c.joinedAt ?? "", exportValue: (c) => (c.joinedAt ? new Date(`${c.joinedAt}T00:00`) : null), exportFormat: "date", cell: (c) => (c.joinedAt ? formatDate(c.joinedAt) : "—") },
    { id: "tax", header: "NIF", defaultHidden: true, exportValue: (c) => c.taxId ?? "", cell: (c) => <span className="font-mono text-xs">{c.taxIdNormalized ?? c.taxId ?? "—"}</span> },
    { id: "phone", header: "Teléfono", defaultHidden: true, exportValue: (c) => c.phone ?? "", cell: (c) => c.phone ?? "—" },
    { id: "balance", header: "Saldo", align: "right", sortValue: (c) => snap(c).balance, exportValue: (c) => euros(snap(c).balance), exportFormat: "money", cell: (c) => (snap(c).balance ? <span className={snap(c).overdueInvoices.length ? "font-medium text-danger-fg" : "font-medium text-warning-fg"}>{formatMoney(snap(c).balance)}</span> : <span className="text-fg-3">—</span>) },
    { id: "value", header: "Valor", align: "right", sortValue: (c) => snap(c).lifetimeValue, exportValue: (c) => euros(snap(c).lifetimeValue), exportFormat: "money", cell: (c) => <span className="font-semibold">{formatMoney(snap(c).lifetimeValue)}</span> },
  ];

  const riskCount = all.filter(atRisk).length;
  const fiscalCount = all.filter(fiscal).length;
  const owed = all.filter((c) => snap(c).balance > 0);
  const renewCount = all.filter(soonRenew).length;

  return (
    <Page wide>
      <PageHeader
        title="Clientes"
        description="Una ficha por persona con todo su historial: membresía, compras, cuotas, cobros, notas y tareas."
        actions={<>{can("customers.view") && <Button icon={ListTodo} onClick={() => navigate("/seguimiento")}>Seguimiento</Button>}{can("customers.manage") && <Button variant="primary" icon={Plus} onClick={() => setParams({ nuevo: "1" })}>Nuevo cliente</Button>}</>}
      />
      <StatStrip
        className="mb-5"
        items={[
          { key: "active", label: "Activos", value: formatNumber(all.filter((c) => c.status === "active").length), hint: `${formatNumber(all.filter((c) => c.status === "lead").length)} leads`, onClick: () => { clear(); setStatus("active"); } },
          { key: "owed", label: "Con saldo pendiente", value: formatNumber(owed.length), hint: formatMoney(owed.reduce((t, c) => t + snap(c).balance, 0)), onClick: () => setQuick("saldo") },
          { key: "renew", label: "Renuevan en 7 días", value: formatNumber(renewCount), onClick: () => setQuick("renovacion") },
          { key: "risk", label: "Sin actividad 30 días", value: formatNumber(riskCount), hint: "activos sin compras ni cuotas", onClick: () => setQuick("riesgo") },
          { key: "fiscal", label: "Datos fiscales a revisar", value: formatNumber(fiscalCount), hint: "NIF no válido o falta", onClick: () => setQuick("fiscal") },
        ]}
      />
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        exportName="Clientes"
        exportCompany={ws.organization.name}
        storageKey="customers.v3"
        filters={
          <FilterBar className="mb-0" active={active} onClear={clear}>
            <SearchField value={q} onChange={setQ} placeholder="Nombre, NIF, email o teléfono…" />
            <FilterSelect label="Estado" value={status} onChange={setStatus} options={(Object.keys(CUSTOMER_STATUS) as CustomerStatus[]).map((s) => ({ value: s, label: CUSTOMER_STATUS[s].label, count: all.filter((c) => c.status === s).length }))} />
            <FilterSelect label="Membresía" value={mview} onChange={setMview} options={[...(["ACTIVE", "PAST_DUE", "PAUSED", "PENDING", "CANCELLED"] as MembershipView[]).map((v) => ({ value: v, label: MEMBERSHIP_VIEW[v].label })), { value: "none" as const, label: "Sin membresía" }]} />
            {ws.membershipPlans.length > 0 && <FilterSelect label="Tarifa" value={plan} onChange={setPlan} options={ws.membershipPlans.map((p) => ({ value: p.id, label: p.name }))} />}
            {locations.length > 1 && !filterId && <FilterSelect label="Centro" icon={Store} value={loc} onChange={setLoc} options={locations.map((l) => ({ value: l.id, label: l.name }))} />}
            {tags.length > 0 && <FilterSelect label="Etiqueta" value={tag} onChange={setTag} options={tags.map((t) => ({ value: t, label: t }))} />}
            {quick && <Badge tone="accent">{{ riesgo: "Sin actividad 30 días", fiscal: "Revisar NIF", saldo: "Con saldo pendiente", renovacion: "Renuevan en 7 días" }[quick]}</Badge>}
          </FilterBar>
        }
        mobile={{
          leading: (c) => <Avatar name={customerName(c)} size={36} />,
          title: (c) => customerName(c),
          value: (c) => (snap(c).balance ? <span className="text-warning-fg">{formatMoney(snap(c).balance)}</span> : snap(c).lifetimeValue ? formatMoney(snap(c).lifetimeValue) : null),
          subtitle: (c) => [snap(c).planName, snap(c).lastActivity ? relativeDays(`${snap(c).lastActivity}T12:00`) : null].filter(Boolean).join(" · ") || c.email || "Sin actividad",
          status: (c) => { const v = snap(c).membershipView; return v && v !== "ACTIVE" ? <Badge tone={MEMBERSHIP_VIEW[v].tone} dot>{MEMBERSHIP_VIEW[v].label}</Badge> : c.status !== "active" ? <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge> : null; },
        }}
        empty={{ icon: Users, title: active ? "Ningún cliente con estos filtros" : "Aún no hay clientes", description: active ? "Quita algún filtro para ver más." : "Crea tu primer cliente o importa tus facturas: los clientes se crean automáticamente, sin duplicados.", action: active ? <Button onClick={clear}>Quitar filtros</Button> : can("customers.manage") ? <Button variant="primary" icon={Plus} onClick={() => setParams({ nuevo: "1" })}>Nuevo cliente</Button> : undefined }}
      />
      {params.get("nuevo") === "1" && <CustomerForm onClose={() => setParams({})} onSaved={(c) => navigate(`/clientes/${c.id}`)} />}
    </Page>
  );
}
