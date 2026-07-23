import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CreditCard } from "lucide-react";
import { CLIENTS } from "@/mocks/clients";
import { Avatar, Badge, SearchInput, Tabs } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatDate, daysAgo } from "@/lib/utils";
import { hasFailedPayment, paymentStatusLabel } from "@/lib/clientInsights";
import type { Client, ClientStatus } from "@/lib/types";

const STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Activo",
  paused: "Pausado",
  cancelled: "Baja",
  pending_approval: "Pendiente aprobación",
};

type QuickFilter = "all" | "active" | "risk" | "unpaid" | "new" | "inactive";

const FILTERS: { value: QuickFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "risk", label: "Riesgo" },
  { value: "unpaid", label: "Impagados" },
  { value: "new", label: "Nuevos" },
  { value: "inactive", label: "Inactivos" },
];

function matchesFilter(c: Client, filter: QuickFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return c.status === "active";
    case "risk":
      return c.status !== "cancelled" && c.health.riskLevel !== "low";
    case "unpaid":
      return hasFailedPayment(c.id);
    case "new":
      return daysAgo(c.joinedAt) <= 30;
    case "inactive":
      return c.status === "paused" || c.status === "cancelled";
    default:
      return true;
  }
}

export default function ClientsListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuickFilter>("all");

  const filtered = useMemo(() => {
    return CLIENTS.filter((c) => matchesFilter(c, filter) && c.fullName.toLowerCase().includes(query.toLowerCase()));
  }, [query, filter]);

  const pendingCount = CLIENTS.filter((c) => c.status === "pending_approval").length;

  const columns: Column<Client>[] = [
    {
      header: "Cliente",
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-text-primary">{c.fullName}</p>
            <p className="truncate text-xs text-text-tertiary">{STATUS_LABEL[c.status]}</p>
          </div>
        </div>
      ),
    },
    { header: "Membresía", render: (c) => c.ratePlan },
    { header: "Última visita", render: (c) => (c.lastVisitAt ? formatDate(c.lastVisitAt) : "—") },
    { header: "Frecuencia (30d)", render: (c) => `${c.visitsLast30Days} sesiones` },
    {
      header: "Pago",
      render: (c) => {
        const p = paymentStatusLabel(c.id);
        return <Badge tone={p.tone}>{p.label}</Badge>;
      },
    },
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
    {
      header: "Alertas",
      render: (c) => {
        const risk = c.health.riskLevel !== "low";
        const unpaid = hasFailedPayment(c.id);
        if (!risk && !unpaid) return <span className="text-text-tertiary">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            {risk && (
              <span title={`Riesgo de baja ${c.health.riskLevel === "high" ? "alto" : "medio"}`}>
                <AlertTriangle className={c.health.riskLevel === "high" ? "h-4 w-4 text-danger" : "h-4 w-4 text-warning"} />
              </span>
            )}
            {unpaid && (
              <span title="Pago rechazado pendiente">
                <CreditCard className="h-4 w-4 text-danger" />
              </span>
            )}
          </div>
        );
      },
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
        <Tabs value={filter} onChange={setFilter} options={FILTERS} />
        <SearchInput placeholder="Buscar por nombre..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-text-tertiary">
          Ningún cliente coincide con este filtro.
        </p>
      ) : (
        <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/clientes/${c.id}`)} />
      )}
    </div>
  );
}
