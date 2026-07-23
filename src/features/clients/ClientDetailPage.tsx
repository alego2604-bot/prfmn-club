import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Phone, FileText, StickyNote, Check, MessageCircle, ShoppingCart, CalendarPlus, PenLine, IdCard } from "lucide-react";
import { getClientById } from "@/mocks/clients";
import { BOOKINGS } from "@/mocks/bookings";
import { INVOICES, PAYMENTS } from "@/mocks/invoices";
import { Avatar, Badge, Button, Card, EmptyState, Modal, Tabs } from "@/design-system/components";
import { HealthScoreRing } from "@/design-system/components/HealthScoreRing";
import { formatCurrency, formatDate, daysAgo } from "@/lib/utils";
import { paymentStatusLabel } from "@/lib/clientInsights";
import type { ClientNote, ClientStatus } from "@/lib/types";

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

const TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "reservas", label: "Reservas" },
  { value: "facturacion", label: "Facturación" },
  { value: "notas", label: "Notas" },
  { value: "documentos", label: "Documentos" },
] as const;

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = id ? getClientById(id) : undefined;

  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("resumen");
  const [notes, setNotes] = useState<ClientNote[]>(client?.notes ?? []);
  const [status, setStatus] = useState<ClientStatus | undefined>(client?.status);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [membershipModalOpen, setMembershipModalOpen] = useState(false);
  const [membershipConfirmed, setMembershipConfirmed] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");

  if (!client || !status) {
    return <EmptyState icon={FileText} title="Cliente no encontrado" description="El cliente que buscas no existe o fue eliminado." />;
  }

  const clientBookings = BOOKINGS.filter((b) => b.clientId === client.id);
  const clientInvoices = INVOICES.filter((i) => i.clientId === client.id);
  const clientPayments = PAYMENTS.filter((p) => p.clientId === client.id);
  const lastVisitDays = client.lastVisitAt ? daysAgo(client.lastVisitAt) : null;
  const payment = paymentStatusLabel(client.id);

  function addNote() {
    if (!noteDraft.trim()) return;
    setNotes((prev) => [{ id: `local-${Date.now()}`, author: "Alex", body: noteDraft.trim(), createdAt: new Date().toISOString() }, ...prev]);
    setNoteDraft("");
    setNoteModalOpen(false);
    setTab("notas");
  }

  function applyMembershipAction(next: ClientStatus) {
    setStatus(next);
    setMembershipConfirmed(true);
    setTimeout(() => {
      setMembershipModalOpen(false);
      setMembershipConfirmed(false);
    }, 900);
  }

  function sendContactMessage() {
    setContactSent(true);
    setTimeout(() => {
      setContactModalOpen(false);
      setContactSent(false);
      setMessageDraft("");
    }, 900);
  }

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /> Volver a Clientes
      </Link>

      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <Avatar name={client.fullName} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{client.fullName}</h2>
              <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
              <Badge tone={payment.tone}>{payment.label}</Badge>
              <Badge tone={client.health.riskLevel === "high" ? "danger" : client.health.riskLevel === "medium" ? "warning" : "success"}>
                Score {client.health.score}/100
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-tertiary">
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {client.email}</span>
              <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {client.phone}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setContactModalOpen(true)}>
          <MessageCircle className="h-4 w-4" /> Contactar
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/pos?clientId=${client.id}`)}>
          <ShoppingCart className="h-4 w-4" /> Añadir venta
        </Button>
        <Button variant="secondary" onClick={() => navigate("/reservas")}>
          <CalendarPlus className="h-4 w-4" /> Crear reserva
        </Button>
        <Button variant="secondary" onClick={() => setNoteModalOpen(true)}>
          <PenLine className="h-4 w-4" /> Añadir nota
        </Button>
        <Button variant="secondary" onClick={() => setMembershipModalOpen(true)}>
          <IdCard className="h-4 w-4" /> Gestionar membresía
        </Button>
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
        notes.length === 0 ? (
          <EmptyState icon={StickyNote} title="Sin notas todavía" description="Añade notas internas sobre este cliente." />
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
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

      <Modal open={noteModalOpen} onClose={() => setNoteModalOpen(false)} title="Añadir nota">
        <textarea
          autoFocus
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Escribe una nota interna sobre este cliente..."
          className="h-28 w-full resize-none rounded-xl border border-border-subtle bg-surface p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={addNote} disabled={!noteDraft.trim()}>Guardar nota</Button>
        </div>
      </Modal>

      <Modal open={membershipModalOpen} onClose={() => setMembershipModalOpen(false)} title="Gestionar membresía">
        {membershipConfirmed ? (
          <div className="flex items-center gap-2 py-6 text-success">
            <Check className="h-5 w-5" /> Membresía actualizada
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-text-tertiary">Tarifa actual</p>
              <p className="font-medium text-text-primary">{client.ratePlan}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary">Estado actual</p>
              <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
              {status !== "active" && (
                <Button size="sm" onClick={() => applyMembershipAction("active")}>Reanudar membresía</Button>
              )}
              {status === "active" && (
                <Button size="sm" variant="secondary" onClick={() => applyMembershipAction("paused")}>Pausar membresía</Button>
              )}
              {status !== "cancelled" && (
                <Button size="sm" variant="destructive" onClick={() => applyMembershipAction("cancelled")}>Cancelar membresía</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={contactModalOpen} onClose={() => setContactModalOpen(false)} title={`Contactar a ${client.fullName}`}>
        {contactSent ? (
          <div className="flex items-center gap-2 py-6 text-success">
            <Check className="h-5 w-5" /> Mensaje enviado
          </div>
        ) : (
          <>
            <textarea
              autoFocus
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              placeholder="Escribe un mensaje..."
              className="h-28 w-full resize-none rounded-xl border border-border-subtle bg-surface p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={sendContactMessage} disabled={!messageDraft.trim()}>Enviar</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
