/**
 * Pipeline de importación por lotes.
 *
 *   ASISTENTE (navegador)                          SERVIDOR (Supabase)
 *   UPLOADING → ANALYZING → MAPPING → VALIDATING → IMPORTING ──lotes──► COMPLETED
 *                                                     │                    │
 *                                                     ├─ fallo ──► PARTIAL / FAILED (datos ocultos, limpiables)
 *                                                     └─ cancelar ► CANCELLED (lo que entró se anula)
 *                                                                          └─ revertir ► REVERTED
 *
 * - El job y sus datos se escriben en el almacén local de una vez; la sincronización los envía en trozos
 *   (data/cloud/sync.ts: orden FK, reintentos idempotentes, división si un trozo expira).
 * - Hasta COMPLETED los datos del job no se ven en ninguna pantalla ni informe (data/visibility.ts), aunque parte ya
 *   esté en el servidor: una importación a medias nunca parece definitiva.
 * - Si la pestaña se cierra a mitad, la cola persistida se reanuda al volver y el job se completa (resumeImports).
 */
import type { Ctx } from "@/data/context";
import { auditEntry } from "@/data/context";
import type { Workspace } from "@/data/store";
import type { ImportJob, ImportPipeline, ImportState } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { commitPlan, importState, voidImportData, withState, type FileMeta } from "./commit";
import type { ImportPlan } from "./types";

/** Lo que el pipeline necesita de la sincronización (CloudSync lo cumple; null en modo local). */
export interface GroupSync {
  tagNext(group: { id: string; label: string }): void;
  waitGroup(id: string): Promise<void>;
  cancelGroup(id: string): Promise<number>;
  hasGroup(id: string): boolean;
  /** Envía lo pendiente y descarga el estado real (tras un fallo o una cancelación). */
  settle(): Promise<void>;
}

export interface RunResult {
  job: ImportJob;
  state: ImportState;
}

const jobOf = (ws: Workspace, id: string) => ws.imports.find((i) => i.id === id);

/** Filas principales (ventas o facturas) y registros de trazabilidad que ya existen para un job. */
export function presentCounts(ws: Workspace, job: ImportJob) {
  const main = job.kind === "sales" ? ws.sales.filter((s) => s.importId === job.id).length : ws.invoices.filter((i) => i.importId === job.id).length;
  const records = ws.importRecords.filter((r) => r.importId === job.id).length;
  return { main, records };
}

function setState(ctx: Ctx, id: string, state: ImportState, extra: { note?: string; error?: string } = {}, transform?: (ws: Workspace) => Workspace) {
  ctx.store.update((ws) => {
    const job = jobOf(ws, id);
    if (!job) return ws;
    const base = transform ? transform(ws) : ws;
    return {
      ...base,
      imports: base.imports.map((i) => (i.id === id ? withState(i, state, nowISO(), extra) : i)),
      auditLogs: [...base.auditLogs, auditEntry(base, ctx, { action: state.toLowerCase(), entityType: "imports", entityId: id, entityLabel: job.fileName, context: extra.error ? { error: extra.error } : undefined })],
    };
  });
}

/** El job no llegó al servidor (falló el primer lote): se deja constancia con un registro sin datos. */
function recordWithoutData(ctx: Ctx, job: ImportJob, state: "FAILED" | "CANCELLED", extra: { note?: string; error?: string }) {
  ctx.store.update((ws) => {
    if (jobOf(ws, job.id)) return ws;
    const clean: ImportJob = withState({ ...job, summary: { ...job.summary, created: {} } }, state, nowISO(), extra);
    return { ...ws, imports: [...ws.imports, clean], auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: state.toLowerCase(), entityType: "imports", entityId: job.id, entityLabel: job.fileName })] };
  });
}

/** Tras un fallo: PARTIAL si parte de los datos está en el servidor, FAILED si no entró nada. */
function markInterrupted(ctx: Ctx, job: ImportJob, error: string): ImportState {
  const ws = ctx.store.requireWorkspace();
  const current = jobOf(ws, job.id);
  if (!current) {
    recordWithoutData(ctx, job, "FAILED", { error });
    return "FAILED";
  }
  const present = presentCounts(ws, current);
  const state: ImportState = present.main > 0 || present.records > 0 ? "PARTIAL" : "FAILED";
  setState(ctx, job.id, state, { error });
  return state;
}

/**
 * Ejecuta una importación de principio a fin. En Supabase espera a que todos los lotes estén confirmados antes de
 * darla por COMPLETED; en modo local (sin sync) se completa en el acto.
 */
export async function runImport(ctx: Ctx, plan: ImportPlan, file: FileMeta, sync: GroupSync | null, opts: { stages?: ImportPipeline["events"]; ownerTab?: string } = {}): Promise<RunResult> {
  if (!sync) {
    const job = commitPlan(ctx, plan, file, { state: "COMPLETED", stages: opts.stages });
    return { job, state: "COMPLETED" };
  }
  const importId = uid();
  sync.tagNext({ id: importId, label: `Importando ${file.name}` });
  const job = commitPlan(ctx, plan, file, { importId, state: "IMPORTING", stages: opts.stages, ownerTab: opts.ownerTab });
  return awaitImport(ctx, job, sync);
}

/** Espera los lotes de un job ya encolado y lo cierra (también al reanudar tras recargar la pestaña). */
export async function awaitImport(ctx: Ctx, job: ImportJob, sync: GroupSync): Promise<RunResult> {
  try {
    await sync.waitGroup(job.id);
  } catch (e) {
    // Cancelada por el usuario: cancelImport se encarga de anular lo que entrara y de dejar la traza
    if ((e as { code?: string }).code === "CANCELLED") return { job: jobOf(ctx.store.requireWorkspace(), job.id) ?? job, state: "CANCELLED" };
    await sync.settle().catch(() => undefined);
    const state = markInterrupted(ctx, job, e instanceof Error ? e.message : String(e));
    return { job: jobOf(ctx.store.requireWorkspace(), job.id) ?? job, state };
  }
  setState(ctx, job.id, "COMPLETED");
  return { job: jobOf(ctx.store.requireWorkspace(), job.id)!, state: "COMPLETED" };
}

/**
 * Cancelar una importación en curso: se descartan los lotes no enviados y lo que ya hubiera entrado se anula
 * (nunca se borra). El job queda CANCELLED con su traza.
 */
export async function cancelImport(ctx: Ctx, job: ImportJob, sync: GroupSync | null): Promise<ImportState> {
  if (!sync) return importState(job);
  await sync.cancelGroup(job.id);
  await sync.settle().catch(() => undefined);
  const ws = ctx.store.requireWorkspace();
  const current = jobOf(ws, job.id);
  if (!current) {
    recordWithoutData(ctx, job, "CANCELLED", { note: "Cancelada antes de que entrara ningún dato" });
    return "CANCELLED";
  }
  const why = `Importación cancelada: ${job.fileName}`;
  setState(ctx, job.id, "CANCELLED", { note: "Lo importado parcialmente queda anulado" }, (w) => voidImportData(w, ctx, job.id, why));
  return "CANCELLED";
}

/** Limpiar una importación PARTIAL: anula lo que llegó a entrar y la deja FAILED (sin datos activos). */
export function cleanupImport(ctx: Ctx, importId: string): void {
  const job = jobOf(ctx.store.requireWorkspace(), importId);
  if (!job || importState(job) !== "PARTIAL") return;
  setState(ctx, importId, "FAILED", { note: "Datos parciales anulados" }, (w) => voidImportData(w, ctx, importId, `Importación incompleta: ${job.fileName}`));
}

/** Margen tras el que una importación de otro dispositivo sin progreso se considera interrumpida. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Al abrir una empresa: cierra los jobs IMPORTING que se quedaron a medias.
 *  - Si sus lotes siguen en la cola de esta pestaña: se espera a que terminen (reanudación).
 *  - Si ya no hay lotes y todo lo esperado está en el servidor: COMPLETED.
 *  - Si falta algo y lleva más de STALE_AFTER_MS sin avanzar: PARTIAL. Antes no: puede estar enviándose desde otra
 *    pestaña u otro dispositivo (si fuera una pestaña cerrada de este navegador, su cola ya se habría adoptado).
 */
export async function resumeImports(ctx: Ctx, sync: GroupSync, live: Set<string> | null, now = Date.now()): Promise<RunResult[]> {
  const ws = ctx.store.requireWorkspace();
  const pending = ws.imports.filter((j) => importState(j) === "IMPORTING");
  const out: RunResult[] = [];
  for (const job of pending) {
    if (sync.hasGroup(job.id)) {
      out.push(await awaitImport(ctx, job, sync));
      continue;
    }
    const p = job.pipeline!;
    const present = presentCounts(ctx.store.requireWorkspace(), job);
    if (present.main >= p.expected.main && present.records >= p.expected.records) {
      setState(ctx, job.id, "COMPLETED", { note: "Verificada al reanudar" });
      out.push({ job, state: "COMPLETED" });
      continue;
    }
    const ownerAlive = !!p.ownerTab && !!live?.has(p.ownerTab);
    const stale = now - new Date(p.updatedAt).getTime() > STALE_AFTER_MS;
    if (!ownerAlive && stale) {
      setState(ctx, job.id, "PARTIAL", { error: `Interrumpida: ${present.main} de ${p.expected.main} registros en el servidor` });
      out.push({ job, state: "PARTIAL" });
    }
  }
  return out;
}
