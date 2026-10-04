import { History } from "lucide-react";
import { useWorkspace } from "@/app/session";
import { formatDateTime } from "@/lib/dates";
import { AUDIT_ACTION } from "./auditLabels";

/** Historial de un registro (auditoría): quién hizo qué y cuándo. Nada se borra; todo queda aquí. */
export function AuditTrail({ entityIds, limit = 12, title = "Historial" }: { entityIds: string[]; limit?: number; title?: string }) {
  const ws = useWorkspace();
  const ids = new Set(entityIds);
  const logs = ws.auditLogs.filter((l) => l.entityId && ids.has(l.entityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-fg-3" />{title}</p>
      {logs.length ? (
        <ol className="relative ml-1.5 border-l border-line pl-4">
          {logs.map((l) => (
            <li key={l.id} className="relative pb-3 last:pb-0">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-surface bg-line-strong" />
              <p className="text-sm"><span className="font-medium">{AUDIT_ACTION[l.action] ?? l.action}</span>{l.entityLabel && <span className="text-fg-3"> · {l.entityLabel}</span>}</p>
              <p className="text-xs text-fg-3">{l.actorName ?? "Sistema"} · {formatDateTime(l.createdAt)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-3">Sin cambios registrados todavía.</p>
      )}
    </div>
  );
}
