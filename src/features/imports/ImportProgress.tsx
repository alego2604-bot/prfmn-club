import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CloudOff, Loader2, OctagonX, TriangleAlert, Undo2 } from "lucide-react";
import { useCtx, useSession } from "@/app/session";
import { Badge, Button, useToast } from "@/design-system/components";
import type { ImportJob, ImportState } from "@/domain/types";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { importState } from "./engine/commit";
import { cancelImport, cleanupImport } from "./engine/pipeline";

export const STATE_LABEL: Record<ImportState, { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" | "info" }> = {
  UPLOADING: { label: "Subiendo", tone: "info" },
  ANALYZING: { label: "Analizando", tone: "info" },
  MAPPING: { label: "Mapeando", tone: "info" },
  VALIDATING: { label: "Validando", tone: "info" },
  IMPORTING: { label: "Importando", tone: "accent" },
  COMPLETED: { label: "Completada", tone: "success" },
  PARTIAL: { label: "Incompleta", tone: "warning" },
  FAILED: { label: "Fallida", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
  REVERTED: { label: "Revertida", tone: "neutral" },
};

/** Barra de progreso de una importación en curso (lotes confirmados en el servidor) con cancelación. */
export function ImportProgressPanel({ job }: { job: ImportJob }) {
  const s = useSession();
  const ctx = useCtx();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const progress = s.sync?.progress?.groupId === job.id ? s.sync.progress : null;
  const offline = s.sync?.state === "offline";
  const local = !!s.groupSync?.hasGroup(job.id);
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-xs" data-testid="import-progress">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {offline ? <CloudOff className="h-4 w-4 text-warning" /> : <Loader2 className="h-4 w-4 animate-spin text-accent" />}
            {offline ? "Sin conexión: se reanudará sola" : "Importando por lotes"}
          </p>
          <p className="mt-1 text-sm text-fg-3">
            {progress ? <>Lote <span className="num font-medium text-fg-2">{progress.done}</span> de <span className="num font-medium text-fg-2">{progress.total}</span> confirmado en el servidor.</> : local ? "Preparando el envío…" : "Se está enviando desde otra pestaña o dispositivo."}
            {" "}Nada de esta importación aparece en informes hasta que termine.
          </p>
        </div>
        {local && (
          <Button
            variant="ghost"
            size="sm"
            loading={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await cancelImport(ctx, job, s.groupSync);
                toast.success("Importación cancelada", "Lo que llegó a entrar se ha anulado. No queda nada a medias.");
              } catch (e) {
                toast.fromError(e);
              } finally {
                setCancelling(false);
              }
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", offline ? "bg-warning" : "bg-accent")} style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
    </div>
  );
}

/** Mensaje y acciones para una importación que no terminó bien. */
export function ImportOutcome({ job, compact }: { job: ImportJob; compact?: boolean }) {
  const ctx = useCtx();
  const s = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const state = importState(job);
  if (state === "IMPORTING") return <ImportProgressPanel job={job} />;
  if (state !== "PARTIAL" && state !== "FAILED" && state !== "CANCELLED") return null;
  const tone = state === "PARTIAL" ? "border-warning/30 bg-warning-soft" : state === "FAILED" ? "border-danger/25 bg-danger-soft" : "border-line bg-surface-2";
  const Icon = state === "PARTIAL" ? TriangleAlert : state === "FAILED" ? OctagonX : Undo2;
  const title = state === "PARTIAL" ? "Importación incompleta" : state === "FAILED" ? "La importación no se ha aplicado" : "Importación cancelada";
  const text =
    state === "PARTIAL" ? "Parte de los lotes llegó al servidor. Esos datos están ocultos e identificados: no cuentan en ningún informe. Límpialos y vuelve a importar el archivo."
    : state === "FAILED" ? "No queda ningún dato activo de este archivo. Revisa el motivo y vuelve a intentarlo."
    : "Se descartó lo pendiente y se anuló lo que llegó a entrar. No queda nada a medias.";
  return (
    <div className={cn("rounded-xl border p-5", tone)} data-testid="import-outcome" data-state={state}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", state === "PARTIAL" ? "text-warning" : state === "FAILED" ? "text-danger" : "text-fg-3")} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-fg-2">{text}</p>
          {job.pipeline?.error && <p className="mt-2 break-words rounded-md bg-surface/70 px-2.5 py-1.5 font-mono text-xs text-fg-2">{job.pipeline.error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {state === "PARTIAL" && s.can("imports.revert") && (
              <Button variant="primary" size="sm" onClick={() => { try { cleanupImport(ctx, job.id); toast.success("Datos parciales anulados", "La importación queda como fallida, sin datos activos."); } catch (e) { toast.fromError(e); } }}>
                Limpiar datos parciales
              </Button>
            )}
            <Button size="sm" onClick={() => navigate("/importaciones/nueva")}>Importar de nuevo</Button>
            {!compact && <Button size="sm" variant="ghost" onClick={() => navigate(`/importaciones/${job.id}`)}>Ver detalle</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Historial de estados del job (trazabilidad). */
export function ImportTimeline({ job }: { job: ImportJob }) {
  const events = job.pipeline?.events ?? [];
  if (!events.length) return <p className="text-sm text-fg-3">Importación anterior al pipeline por lotes: sin historial de fases.</p>;
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const meta = STATE_LABEL[e.state];
        return (
          <li key={`${e.state}${i}`} className="relative flex gap-3 pb-3 last:pb-0">
            {!last && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-line" />}
            <span className={cn("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full", last ? "bg-ink text-fg-inverse" : "bg-surface-sunken text-fg-3")}>
              <Check className="h-3 w-3" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 text-sm">
              <span className="flex flex-wrap items-center gap-2"><Badge tone={meta.tone}>{meta.label}</Badge><span className="text-xs text-fg-3 num">{formatDateTime(e.at)}</span></span>
              {e.note && <span className="mt-1 block text-xs text-fg-3">{e.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
