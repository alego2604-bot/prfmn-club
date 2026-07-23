import { useMemo, useState } from "react";
import { LEADS, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/mocks/leads";
import { Avatar, Badge, Card, SearchInput } from "@/design-system/components";
import { formatDate } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/types";

const COLUMNS: LeadStatus[] = ["new", "contacted", "trial", "offer", "won", "lost"];

const STATUS_TONE: Record<LeadStatus, "info" | "warning" | "success" | "danger" | "neutral"> = {
  new: "info",
  contacted: "warning",
  trial: "warning",
  offer: "warning",
  won: "success",
  lost: "danger",
};

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Avatar name={lead.fullName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{lead.fullName}</p>
          <p className="truncate text-xs text-text-tertiary">{lead.interest}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>{LEAD_SOURCE_LABEL[lead.source]}</span>
        <span>{formatDate(lead.lastInteractionAt)}</span>
      </div>
    </Card>
  );
}

export default function LeadsPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => LEADS.filter((l) => l.fullName.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Leads / CRM</h2>
          <p className="mt-1 text-sm text-text-tertiary">{LEADS.length} leads en el pipeline.</p>
        </div>
        <SearchInput placeholder="Buscar lead..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
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
                  <LeadCard key={l.id} lead={l} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
