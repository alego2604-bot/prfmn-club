import { useMemo, useState } from "react";
import { LEADS, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/mocks/leads";
import { Avatar, Badge, Button, Card, Modal, SearchInput } from "@/design-system/components";
import { formatDate } from "@/lib/utils";
import type { Lead, LeadSource, LeadStatus } from "@/lib/types";
import { Plus, ArrowRight, X } from "lucide-react";

const COLUMNS: LeadStatus[] = ["new", "contacted", "trial", "offer", "won", "lost"];
const FORWARD_STAGE: Partial<Record<LeadStatus, LeadStatus>> = {
  new: "contacted",
  contacted: "trial",
  trial: "offer",
  offer: "won",
};

const STATUS_TONE: Record<LeadStatus, "info" | "warning" | "success" | "danger" | "neutral"> = {
  new: "info",
  contacted: "warning",
  trial: "warning",
  offer: "warning",
  won: "success",
  lost: "danger",
};

const SOURCE_OPTIONS = Object.entries(LEAD_SOURCE_LABEL) as [LeadSource, string][];

function LeadCard({ lead, onAdvance, onLose }: { lead: Lead; onAdvance: () => void; onLose: () => void }) {
  const nextStage = FORWARD_STAGE[lead.status];
  const isTerminal = lead.status === "won" || lead.status === "lost";
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Avatar name={lead.fullName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{lead.fullName}</p>
          <p className="truncate text-xs text-text-tertiary">{lead.interest || "Sin interés registrado"}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>{LEAD_SOURCE_LABEL[lead.source]}</span>
        <span>{formatDate(lead.lastInteractionAt)}</span>
      </div>
      {!isTerminal && (
        <div className="flex items-center gap-1.5 pt-1">
          {nextStage && (
            <button
              onClick={onAdvance}
              className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent"
            >
              {LEAD_STATUS_LABEL[nextStage]} <ArrowRight className="h-3 w-3" />
            </button>
          )}
          <button onClick={onLose} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-tertiary hover:text-danger">
            <X className="h-3 w-3" /> Perdido
          </button>
        </div>
      )}
    </Card>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>(LEADS);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSource, setNewSource] = useState<LeadSource>("web");

  const filtered = useMemo(() => leads.filter((l) => l.fullName.toLowerCase().includes(query.toLowerCase())), [leads, query]);

  function advance(lead: Lead) {
    const next = FORWARD_STAGE[lead.status];
    if (!next) return;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: next, lastInteractionAt: new Date().toISOString() } : l)));
  }

  function markLost(lead: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "lost", lastInteractionAt: new Date().toISOString() } : l)));
  }

  function createLead() {
    if (!newName.trim()) return;
    const lead: Lead = {
      id: `local-${Date.now()}`,
      fullName: newName.trim(),
      phone: newPhone.trim(),
      email: "",
      source: newSource,
      status: "new",
      interest: "",
      notes: "",
      owner: "Sin asignar",
      lastInteractionAt: new Date().toISOString(),
      nextActionAt: null,
    };
    setLeads((prev) => [lead, ...prev]);
    setModalOpen(false);
    setNewName("");
    setNewPhone("");
    setNewSource("web");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Leads / CRM</h2>
          <p className="mt-1 text-sm text-text-tertiary">{leads.length} leads en el pipeline.</p>
        </div>
        <div className="flex gap-2">
          <SearchInput placeholder="Buscar lead..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> Nuevo lead
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((status) => {
          const items = filtered.filter((l) => l.status === status);
          return (
            <div key={status} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <Badge tone={STATUS_TONE[status]}>{LEAD_STATUS_LABEL[status]}</Badge>
                <span className="text-xs text-text-tertiary">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <LeadCard key={l.id} lead={l} onAdvance={() => advance(l)} onLose={() => markLost(l)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo lead">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-text-tertiary">Nombre</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-10 w-full rounded-xl border border-border-subtle bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
              placeholder="Nombre y apellidos"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-tertiary">Teléfono</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="h-10 w-full rounded-xl border border-border-subtle bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
              placeholder="+34 ..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-tertiary">Origen</label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setNewSource(value)}
                  className={
                    "rounded-lg border px-2.5 py-1 text-xs font-medium " +
                    (newSource === value ? "border-accent/50 bg-accent/10 text-accent" : "border-border-subtle text-text-secondary hover:text-text-primary")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={createLead} disabled={!newName.trim()}>Crear lead</Button>
        </div>
      </Modal>
    </div>
  );
}
