import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CLIENTS } from "@/mocks";
import { Avatar, Badge, SearchInput, Tabs } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatDate } from "@/lib/utils";
import type { Client, ClientStatus } from "@/lib/types";

const STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Activo",
  paused: "Pausado",
  cancelled: "Baja",
  pending_approval: "Pendiente aprobación",
};

const STATUS_TONE: Record<ClientStatus, "success" | "warning" | "danger" | "info"> = {
  active: "success",
  paused: "warning",
  cancelled: "danger",
  pending_approval: "info",
};

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "pending_approval", label: "Pendientes" },
  { value: "paused", label: "Pausados" },
  { value: "cancelled", label: "Bajas" },
] as const;

export default function ClientsListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const filtered = useMemo(() => {
    return CLIENTS.filter((c) => {
      const matchesFilter = filter === "all" || c.status === filter;
      const matchesQuery = c.fullName.toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [query, filter]);

  const pendingCount = CLIENTS.filter((c) => c.status === "pending_approval").length;

  const columns: Column<Client>[] = [
    {
      header: "Cliente",
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.fullName} size="sm" />
          <div>
            <p className="font-medium text-text-primary">{c.fullName}</p>
            <p className="text-xs text-text-tertiary">{c.email}</p>
          </div>
        </div>
      ),
    },
    { header: "Tarifa", render: (c) => c.ratePlan },
    { header: "Estado", render: (c) => <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge> },
    { header: "Alta", render: (c) => formatDate(c.joinedAt) },
    { header: "Última visita", render: (c) => (c.lastVisitAt ? formatDate(c.lastVisitAt) : "—") },
    {
      header: "Health Score",
      render: (c) => (
        <span
          className={
            c.health.riskLevel === "high" ? "text-danger" : c.health.riskLevel === "medium" ? "text-warning" : "text-success"
          }
        >
          {c.health.score}/100
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Clientes</h2>
          <p className="mt-1 text-sm text-text-tertiary">{CLIENTS.length} clientes totales · {pendingCount} solicitudes pendientes</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onChange={setFilter} options={FILTERS as unknown as { value: typeof filter; label: string }[]} />
        <SearchInput placeholder="Buscar por nombre..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/clientes/${c.id}`)} />
    </div>
  );
}
