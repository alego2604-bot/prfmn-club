import { StatTile } from "@/design-system/components";
import { AttentionCard } from "@/design-system/components/AttentionCard";
import { KPIS, ATTENTION_ITEMS } from "@/mocks";
import { formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{greeting}, Alex.</h2>
        <p className="mt-1 text-sm text-text-tertiary">Esto es lo que está pasando hoy en The Gravity Room.</p>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">Necesita tu atención</h3>
          <span className="text-xs text-text-tertiary">{ATTENTION_ITEMS.length} elementos</span>
        </div>
        <div className="space-y-2">
          {ATTENTION_ITEMS.map((item) => (
            <AttentionCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-tertiary">Cómo va el negocio</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <StatTile label="Socios activos" value={String(KPIS.activeMembers)} delta={`+${KPIS.activeMembersDelta}`} deltaLabel="este mes" />
          <StatTile label="Reservas hoy" value={String(KPIS.bookingsToday)} />
          <StatTile label="Ocupación media" value={`${KPIS.occupancyPct}%`} />
          <StatTile label="Ingresos del mes" value={formatCurrency(KPIS.revenueMonthCents)} delta="+8%" deltaLabel="vs mes anterior" />
          <StatTile label="MRR" value={formatCurrency(KPIS.mrrCents)} />
          <StatTile label="Ticket medio" value={formatCurrency(KPIS.avgTicketCents)} />
          <StatTile label="Altas del mes" value={String(KPIS.newSignupsMonth)} positive delta={`+${KPIS.newSignupsMonth}`} deltaLabel="nuevos socios" />
          <StatTile label="Bajas del mes" value={String(KPIS.cancellationsMonth)} positive={false} delta={`-${KPIS.cancellationsMonth}`} deltaLabel="cancelaciones" />
          <StatTile label="Churn" value={`${KPIS.churnPct}%`} />
          <StatTile label="Leads abiertos" value={String(KPIS.leadsOpen)} />
          <StatTile label="Conversión de leads" value={`${KPIS.leadConversionPct}%`} />
          <StatTile label="Ventas tienda (mes)" value={formatCurrency(KPIS.shopSalesMonthCents)} />
          <StatTile label="Impagados" value={formatCurrency(KPIS.unpaidCents)} positive={false} />
        </div>
      </section>
    </div>
  );
}
