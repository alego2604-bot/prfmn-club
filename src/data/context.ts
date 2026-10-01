import { roleCan, type Permission } from "@/domain/permissions";
import type { AuditLog, RoleKey, UserAccount } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import type { Store, Workspace } from "./store";

/** Contexto de quien ejecuta una acción. Los repositorios lo exigen siempre: nada se escribe sin autor ni permiso. */
export interface Ctx {
  store: Store;
  user: Pick<UserAccount, "id" | "fullName" | "email">;
  role: RoleKey;
  /** null = todos los centros */
  locationIds: string[] | null;
}

export class PermissionError extends Error {
  constructor(perm: Permission) {
    super(`No tienes permiso para esta acción (${perm})`);
    this.name = "PermissionError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertCan(ctx: Ctx, perm: Permission): void {
  if (!roleCan(ctx.role, perm)) throw new PermissionError(perm);
}

export function assertLocation(ctx: Ctx, locationId: string | undefined): void {
  if (locationId && ctx.locationIds && !ctx.locationIds.includes(locationId)) {
    throw new ValidationError("No tienes acceso a este centro");
  }
}

export function auditEntry(
  ws: Workspace,
  ctx: Ctx,
  e: Pick<AuditLog, "action" | "entityType"> & Partial<Pick<AuditLog, "entityId" | "entityLabel" | "changes" | "context">>,
): AuditLog {
  return {
    id: uid(),
    organizationId: ws.organization.id,
    actorId: ctx.user.id,
    actorName: ctx.user.fullName,
    createdAt: nowISO(),
    ...e,
  };
}

/** Diferencias campo a campo (para el registro de auditoría). */
export function diff<T extends object>(before: T, after: T, ignore: (keyof T)[] = []): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T>;
  for (const k of keys) {
    if (ignore.includes(k)) continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[String(k)] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export function nextCounter(ws: Workspace, name: string): { ws: Workspace; value: number } {
  const value = (ws.counters[name] ?? 0) + 1;
  return { ws: { ...ws, counters: { ...ws.counters, [name]: value } }, value };
}
