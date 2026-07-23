import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Phone, FileText, StickyNote } from "lucide-react";
import { getClientById } from "@/mocks/clients";
import { BOOKINGS } from "@/mocks/bookings";
import { INVOICES, PAYMENTS } from "@/mocks/invoices";
import { Avatar, Badge, Button, Card, EmptyState, Tabs } from "@/design-system/components";
import { HealthScoreRing } from "@/design-system/components/HealthScoreRing";
import { formatCurrency, formatDate, daysAgo } from "@/lib/utils";
import type { ClientStatus } from "@/lib/types";

const STATUS_LABEL: Record<ClientStatus, string> = {
  active: "Activo",
  paused: "Pausado",
  cancelled: "Baja",
  pending_approval: "Pendiente aprobación",
};

const TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "reservas", label: "Reservas" },
  { value: "facturacion", label: "Facturación" },
  { value: "notas", label: "Notas" },
  { value: "documentos", label: "Documentos" },
] as const;

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("resumen");
  const client = id ? getClientById(id) : undefined;

  if (!client) {
    return (
      <EmptyState icon={FileText} title="Cliente no encontrado" description="El cliente que buscas no existe o fue eliminado." />
    );
  }

  const clientBookings = BOOKINGS.filter((b) => b.clientId === client.id);
  const clientInvoices = INVOICES.filter((i) => i.clientId === client.id);
  const clientPayments = PAYMENTS.filter((p) => p.clientId === client.id);
  const lastVisitDays = client.lastVisitAt ? daysAgo(client.lastVisitAt) : null;

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /> Volver a Clientes
      </Link>

      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <Avatar name={client.fullName} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{client.fullName}</h2>
              <Badge tone={client.status === "active" ? "success" : client.status === "pending_approval" ? "info" : "warning"}>
                {STATUS_LABEL[client.status]}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-tertiary">
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {client.email}</span>
              <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {client.phone}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">Enviar mensaje</Button>
          <Button>Editar ficha</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-text-tertiary">Tarifa</p>
          <p className="mt-1 font-medium text-text-primary">{client.ratePlan}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-tertiary">Antigüedad</p>
          <p className="mt-1 font-medium text-text-primary">{formatDate(client.joinedAt)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-tertiary">Última visita</p>
          <p className="mt-1 font-medium text-text-primary">{lastVisitDays !== null ? `Hace ${lastVisitDays} días` : "Nunca"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-tertiary">Frecuencia (30d)</p>
          <p className="mt-1 font-medium text-text-primary">{client.visitsLast30Days} sesiones</p>
        </Card>
      </div>

      <Tabs value={tab} onChange={setTab} options={TABS as unknown as { value: typeof tab; label: string }[]} />

      {tab === "resumen" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-1">
            <p className="mb-4 text-sm font-semibold text-text-primary">Client Health Score</p>
            <div className="flex justify-center">
              <HealthScoreRing score={client.health.score} riskLevel={client.health.riskLevel} size={120} />
            </div>
            <ul className="mt-5 space-y-2 text-sm text-text-secondary">
              {client.health.factors.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-text-tertiary">·</span> {f}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6 lg:col-span-2">
            <p className="mb-4 text-sm font-semibold text-text-primary">Actividad reciente</p>
            <ul className="space-y-3 text-sm">
              <li className="flex justify-between border-b border-border-subtle pb-2">
                <span className="text-text-secondary">Cancelaciones (30d)</span>
                <span className="font-medium text-text-primary">{client.cancellationsLast30Days}</span>
              </li>
              <li className="flex justify-between border-b border-border-subtle pb-2">
                <span className="text-text-secondary">No-shows (30d)</span>
                <span className="font-medium text-text-primary">{client.noShowsLast30Days}</span>
              </li>
              <li className="flex justify-between border-b border-border-subtle pb-2">
                <span className="text-text-secondary">Sesiones mes anterior</span>
                <span className="font-medium text-text-primary">{client.visitsPrevious30Days}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-text-secondary">Facturas emitidas</span>
                <span className="font-medium text-text-primary">{clientInvoices.length}</span>
              </li>
            </ul>
          </Card>
        </div>
      )}

      {tab === "reservas" && (
        clientBookings.length === 0 ? (
          <EmptyState icon={FileText} title="Sin reservas registradas" />
        ) : (
          <div className="space-y-2">
            {clientBookings.map((b) => (
              <Card key={b.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">Sesión {b.sessionId}</p>
                  <p className="text-xs text-text-tertiary">{formatDate(b.bookedAt)}</p>
                </div>
                <Badge tone={b.status === "attended" ? "success" : b.status === "waitlisted" ? "warning" : "info"}>{b.status}</Badge>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "facturacion" && (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-semibold text-text-primary">Facturas</p>
            {clientInvoices.length === 0 ? (
              <EmptyState icon={FileText} title="Sin facturas" />
            ) : (
              <div className="space-y-2">
                {clientInvoices.map((inv) => (
                  <Card key={inv.id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium text-text-primary">Factura {inv.number}</p>
                      <p className="text-xs text-text-tertiary">{formatDate(inv.issueDate)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium tabular-nums text-text-primary">{formatCurrency(inv.totalCents)}</span>
                      <Badge tone={inv.status === "paid" ? "success" : inv.status === "void" ? "neutral" : "warning"}>{inv.status}</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-text-primary">Pagos</p>
            {clientPayments.length === 0 ? (
              <EmptyState icon={FileText} title="Sin pagos" />
            ) : (
              <div className="space-y-2">
                {clientPayments.map((p) => (
                  <Card key={p.id} className="flex items-center justify-between p-4">
                    <p className="text-sm text-text-primary">{formatDate(p.createdAt)} · {p.method}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium tabular-nums text-text-primary">{formatCurrency(p.amountCents)}</span>
                      <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{p.status}</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "notas" && (
        client.notes.length === 0 ? (
          <EmptyState icon={StickyNote} title="Sin notas todavía" description="Añade notas internas sobre este cliente." />
        ) : (
          <div className="space-y-2">
            {client.notes.map((n) => (
              <Card key={n.id} className="p-4">
                <p className="text-sm text-text-primary">{n.body}</p>
                <p className="mt-2 text-xs text-text-tertiary">{n.author} · {formatDate(n.createdAt)}</p>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "documentos" && (
        client.documents.length === 0 ? (
          <EmptyState icon={FileText} title="Sin documentos" />
        ) : (
          <div className="space-y-2">
            {client.documents.map((d) => (
              <Card key={d.name} className="flex items-center justify-between p-4">
                <span className="inline-flex items-center gap-2 text-sm text-text-primary">
                  <FileText className="h-4 w-4 text-text-tertiary" /> {d.name}
                </span>
                <span className="text-xs text-text-tertiary">{formatDate(d.uploadedAt)}</span>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
