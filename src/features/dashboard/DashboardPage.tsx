import { Link } from "react-router-dom";
import { ShoppingCart, CalendarPlus, Users2, ChevronRight } from "lucide-react";
import { StatTile, Badge, Card } from "@/design-system/components";
import { AttentionCard } from "@/design-system/components/AttentionCard";
import { KPIS, ATTENTION_ITEMS, CLIENTS } from "@/mocks";
import { sessionsForOffset, TODAY_OFFSET } from "@/mocks/bookings";
import { formatCurrency, formatTime } from "@/lib/utils";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const QUICK_ACTIONS = [
  { to: "/pos", label: "Nueva venta", icon: ShoppingCart },
  { to: "/reservas", label: "Nueva reserva", icon: CalendarPlus },
  { to: "/clientes", label: "Ver clientes", icon: Users2 },
];

export default function DashboardPage() {
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  const sortedAttention = [...ATTENTION_ITEMS].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const urgentCount = ATTENTION_ITEMS.filter((i) => i.severity === "high").length;
  const todaySessions = sessionsForOffset(TODAY_OFFSET);
  const clientsAtRisk = CLIENTS.filter((c) => c.status === "active" && c.health.riskLevel !== "low").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{greeting}, Alex.</h2>
          <p className="mt-1 text-sm text-text-tertiary">Esto es lo que está pasando hoy en The Gravity Room.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
            >
              <a.icon className="h-4 w-4" />
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">Necesita tu atención</h3>
          {urgentCount > 0 && <Badge tone="danger">{urgentCount} urgentes</Badge>}
        </div>
        <div className="space-y-2">
          {sortedAttention.map((item) => (
            <AttentionCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">Operativa de hoy</h3>
          <Link to="/reservas" className="inline-flex items-center gap-0.5 text-xs font-medium text-text-tertiary hover:text-accent">
            Ver calendario <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-2">
            <div className="flex divide-x divide-border-subtle overflow-x-auto scrollbar-thin">
              {todaySessions.map((s) => {
                const occupancyPct = Math.round((s.booked / s.capacity) * 100);
                return (
                  <Link
                    key={s.id}
                    to="/reservas"
                    className="min-w-[132px] shrink-0 px-4 py-1 first:pl-1 last:pr-1 hover:opacity-80"
                  >
                    <p className="text-xs font-medium text-text-tertiary">{formatTime(s.startsAt)}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-text-primary">{s.className}</p>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {s.booked}/{s.capacity} · {occupancyPct}%
                    </p>
                  </Link>
                );
              })}
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <StatTile label="Reservas hoy" value={String(KPIS.bookingsToday)} />
            <StatTile label="Ocupación media" value={`${KPIS.occupancyPct}%`} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-tertiary">Estado del negocio</h3>
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium text-text-tertiary">Ingresos</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile label="Ingresos del mes" value={formatCurrency(KPIS.revenueMonthCents)} delta="+8%" deltaLabel="vs mes anterior" />
              <StatTile label="MRR" value={formatCurrency(KPIS.mrrCents)} />
              <StatTile label="Ticket medio" value={formatCurrency(KPIS.avgTicketCents)} />
              <StatTile label="Ventas tienda (mes)" value={formatCurrency(KPIS.shopSalesMonthCents)} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-text-tertiary">Clientes</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile label="Socios activos" value={String(KPIS.activeMembers)} delta={`+${KPIS.activeMembersDelta}`} deltaLabel="este mes" />
              <StatTile label="Altas del mes" value={String(KPIS.newSignupsMonth)} delta={`+${KPIS.newSignupsMonth}`} deltaLabel="nuevos socios" />
              <StatTile label="Bajas del mes" value={String(KPIS.cancellationsMonth)} positive={false} delta={`-${KPIS.cancellationsMonth}`} deltaLabel="cancelaciones" />
              <StatTile label="Churn" value={`${KPIS.churnPct}%`} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-text-tertiary">Riesgo</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile label="Clientes en riesgo" value={String(clientsAtRisk)} positive={false} />
              <StatTile label="Impagados" value={formatCurrency(KPIS.unpaidCents)} positive={false} />
              <StatTile label="Leads abiertos" value={String(KPIS.leadsOpen)} />
              <StatTile label="Conversión de leads" value={`${KPIS.leadConversionPct}%`} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
