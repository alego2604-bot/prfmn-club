import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, Plus, Users } from "lucide-react";
import { useSession, useWorkspace } from "@/app/session";
import { Avatar, Badge, Button, DataTable, Page, PageHeader, Segmented, StatStrip, type Column } from "@/design-system/components";
import { customerName } from "@/data/repos/customers";
import type { Customer } from "@/domain/types";
import { formatDate, relativeDays, toISODate } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";
import { CustomerForm, CUSTOMER_STATUS } from "./CustomerForm";

type Filter = "all" | "active" | "lead" | "cancelled" | "fiscal" | "riesgo";

export default function CustomersPage() {
  const ws = useWorkspace();
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>((params.get("filtro") as Filter) || "all");

  const stats = useMemo(() => {
    const m = new Map<string, { invoices: number; billed: number; purchases: number; spent: number; last?: string; events: number }>();
    const get = (id: string) => m.get(id) ?? (m.set(id, { invoices: 0, billed: 0, purchases: 0, spent: 0, events: 0 }), m.get(id)!);
    for (const i of ws.invoices) {
      if (!i.customerId || i.status === "void") continue;
      const s = get(i.customerId);
      s.invoices++;
      s.events++;
      s.billed += i.total;
      if (!s.last || (i.issueDate ?? "") > s.last) s.last = i.issueDate;
    }
    for (const sale of ws.sales) {
      if (!sale.customerId || sale.status === "voided") continue;
      const s = get(sale.customerId);
      s.purchases++;
      s.events++;
      s.spent += sale.total;
      const d = sale.occurredAt.slice(0, 10);
      if (!s.last || d > s.last) s.last = d;
    }
    return m;
  }, [ws.invoices, ws.sales]);

  const all = ws.customers.filter((c) => !c.deletedAt);
  // Mismo criterio que la alerta "clientes habituales sin actividad en 30 días" (domain/alerts.ts)
  const monthAgo = toISODate(new Date(Date.now() - 30 * 86_400_000));
  const atRisk = (c: Customer) => c.status === "active" && (stats.get(c.id)?.events ?? 0) >= 2 && (stats.get(c.id)?.last ?? "9") < monthAgo;
  const rows = all.filter((c) =>
    filter === "all" ? true
    : filter === "fiscal" ? c.taxIdValid === false || (!c.taxId && (stats.get(c.id)?.invoices ?? 0) > 0)
    : filter === "riesgo" ? atRisk(c)
    : c.status === filter,
  );
  const riskCount = all.filter(atRisk).length;

  const columns: Column<Customer>[] = [
    {
      id: "name", header: "Cliente", hideable: false, sortValue: (c) => customerName(c).toLowerCase(), exportValue: customerName,
      cell: (c) => (
        <span className="flex items-center gap-3">
          <Avatar name={customerName(c)} size={30} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{customerName(c)}</span>
            {c.email && <span className="block truncate text-xs text-fg-3">{c.email}</span>}
          </span>
        </span>
      ),
    },
    {
      id: "tax", header: "NIF", priority: "low", defaultHidden: !rows.some((c) => c.taxId), sortValue: (c) => c.taxIdNormalized ?? "", exportValue: (c) => c.taxId ?? "",
      cell: (c) =>
        c.taxId ? (
          <span className="flex items-center gap-1.5 font-mono text-xs">
            {c.taxIdNormalized ?? c.taxId}
            {c.taxIdValid === false && <span title="NIF no válido"><AlertCircle className="h-3.5 w-3.5 text-danger" /></span>}
          </span>
        ) : <span className="text-fg-3">—</span>,
    },
    { id: "phone", header: "Teléfono", cell: (c) => c.phone ?? <span className="text-fg-3">—</span>, exportValue: (c) => c.phone ?? "", defaultHidden: true },
    { id: "email", header: "Email", cell: (c) => c.email ?? "—", exportValue: (c) => c.email ?? "", defaultHidden: true },
    { id: "status", header: "Estado", sortValue: (c) => c.status, exportValue: (c) => CUSTOMER_STATUS[c.status].label, cell: (c) => <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge> },
    { id: "joined", header: "Alta", priority: "medium", sortValue: (c) => c.joinedAt ?? "", exportValue: (c) => (c.joinedAt ? new Date(`${c.joinedAt}T00:00`) : null), exportFormat: "date", cell: (c) => (c.joinedAt ? formatDate(`${c.joinedAt}T00:00`) : "—") },
    { id: "invoices", header: "Facturas", align: "right", priority: "low", sortValue: (c) => stats.get(c.id)?.invoices ?? 0, exportValue: (c) => stats.get(c.id)?.invoices ?? 0, exportFormat: "integer", cell: (c) => stats.get(c.id)?.invoices ?? 0 },
    { id: "total", header: "Total", align: "right", sortValue: (c) => (stats.get(c.id)?.billed ?? 0) + (stats.get(c.id)?.spent ?? 0), exportValue: (c) => ((stats.get(c.id)?.billed ?? 0) + (stats.get(c.id)?.spent ?? 0)) / 100, exportFormat: "money", cell: (c) => <span className="font-medium">{formatMoney((stats.get(c.id)?.billed ?? 0) + (stats.get(c.id)?.spent ?? 0))}</span> },
    { id: "last", header: "Último movimiento", priority: "medium", sortValue: (c) => stats.get(c.id)?.last ?? "", exportValue: (c) => stats.get(c.id)?.last ?? "", cell: (c) => { const l = stats.get(c.id)?.last; return l ? <span className="text-fg-2">{relativeDays(`${l}T12:00`)}</span> : <span className="text-fg-3">—</span>; } },
  ];

  const fiscalIssues = all.filter((c) => c.taxIdValid === false || (!c.taxId && (stats.get(c.id)?.invoices ?? 0) > 0)).length;

  return (
    <Page wide>
      <PageHeader
        title="Clientes"
        description="Una ficha por persona, con todo su historial: compras, facturas y notas."
        actions={can("customers.manage") && <Button variant="primary" icon={Plus} onClick={() => setParams({ nuevo: "1" })}>Nuevo cliente</Button>}
      />
      <StatStrip
        className="mb-5"
        items={[
          { key: "all", label: "Clientes", value: formatNumber(all.filter((c) => c.status !== "lead").length), hint: "sin contar leads", onClick: () => setFilter("all") },
          { key: "active", label: "Activos", value: formatNumber(all.filter((c) => c.status === "active").length), onClick: () => setFilter("active") },
          { key: "risk", label: "En riesgo", value: formatNumber(riskCount), hint: "habituales sin actividad en 30 días", tooltip: "Al menos 2 compras o facturas y ninguna en los últimos 30 días", onClick: () => setFilter("riesgo") },
          { key: "lead", label: "Leads", value: formatNumber(all.filter((c) => c.status === "lead").length), onClick: () => setFilter("lead") },
          { key: "fiscal", label: "Datos fiscales a revisar", value: formatNumber(fiscalIssues), hint: "NIF no válido o facturado sin NIF", onClick: () => setFilter("fiscal") },
        ]}
      />
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        searchText={(c) => `${customerName(c)} ${c.taxId ?? ""} ${c.email ?? ""} ${c.phone ?? ""} ${c.city ?? ""}`}
        searchPlaceholder="Nombre, NIF, email o teléfono…"
        exportName="Clientes"
        exportCompany={ws.organization.name}
        storageKey="customers"
        mobile={{
          leading: (c) => <Avatar name={customerName(c)} size={36} />,
          title: (c) => customerName(c),
          value: (c) => { const st = stats.get(c.id); const v = (st?.billed ?? 0) + (st?.spent ?? 0); return v ? formatMoney(v) : null; },
          subtitle: (c) => { const l = stats.get(c.id)?.last; return l ? `Último movimiento: ${relativeDays(`${l}T12:00`)}` : c.email ?? "Sin actividad"; },
          status: (c) => (c.status === "active" ? null : <Badge tone={CUSTOMER_STATUS[c.status].tone} dot>{CUSTOMER_STATUS[c.status].label}</Badge>),
        }}
        toolbar={
          <Segmented
            value={filter}
            onChange={setFilter}
            size="sm"
            items={[
              { value: "all", label: "Todos" },
              { value: "active", label: "Activos" },
              { value: "riesgo", label: `En riesgo${riskCount ? ` (${riskCount})` : ""}` },
              { value: "lead", label: "Leads" },
              { value: "cancelled", label: "Bajas" },
              { value: "fiscal", label: `Revisar NIF${fiscalIssues ? ` (${fiscalIssues})` : ""}` },
            ]}
          />
        }
        empty={{ icon: Users, title: "Aún no hay clientes", description: "Crea tu primer cliente o importa tus facturas: los clientes se crean automáticamente sin duplicados." }}
      />
      {params.get("nuevo") === "1" && <CustomerForm onClose={() => setParams({})} onSaved={(c) => navigate(`/clientes/${c.id}`)} />}
    </Page>
  );
}
