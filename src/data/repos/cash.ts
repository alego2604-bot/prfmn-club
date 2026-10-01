import { closingStatus, summarizeCashSession } from "@/domain/cash";
import type { CashClosing, CashSession } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { assertCan, assertLocation, auditEntry, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";

export function sessionSummary(ws: Workspace, session: CashSession) {
  return summarizeCashSession(session, ws.sales, ws.payments, ws.cashMovements, ws.paymentMethods);
}

export function openCashSession(ctx: Ctx, locationId: string, openingFloat: number): CashSession {
  assertCan(ctx, "cash.operate");
  assertLocation(ctx, locationId);
  if (!Number.isInteger(openingFloat) || openingFloat < 0) throw new ValidationError("Fondo de caja no válido");
  let created!: CashSession;
  ctx.store.update((ws) => {
    if (ws.cashSessions.some((s) => s.locationId === locationId && s.status === "open")) throw new ValidationError("Ya hay una caja abierta en este centro");
    created = { id: uid(), organizationId: ws.organization.id, locationId, openedBy: ctx.user.id, openedAt: nowISO(), openingFloat, status: "open" };
    const loc = ws.locations.find((l) => l.id === locationId)?.name;
    return {
      ...ws,
      cashSessions: [...ws.cashSessions, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "open", entityType: "cash_sessions", entityId: created.id, entityLabel: `Caja ${loc ?? ""} · fondo ${formatMoney(openingFloat)}` })],
    };
  });
  return created;
}

export function addCashMovement(ctx: Ctx, sessionId: string, kind: "cash_in" | "cash_out", amount: number, reason: string) {
  assertCan(ctx, "cash.operate");
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError("Importe no válido");
  if (!reason.trim()) throw new ValidationError("Indica el motivo");
  ctx.store.update((ws) => {
    const s = ws.cashSessions.find((x) => x.id === sessionId);
    if (!s || s.status !== "open") throw new ValidationError("La caja no está abierta");
    assertLocation(ctx, s.locationId);
    const id = uid();
    return {
      ...ws,
      cashMovements: [...ws.cashMovements, { id, organizationId: ws.organization.id, cashSessionId: sessionId, kind, amount, reason: reason.trim(), createdBy: ctx.user.id, createdAt: nowISO() }],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: kind, entityType: "cash_movements", entityId: id, entityLabel: `${kind === "cash_in" ? "Entrada" : "Salida"} ${formatMoney(amount)} · ${reason.trim()}` })],
    };
  });
}

export function closeCashSession(ctx: Ctx, sessionId: string, countedCash: number, notes?: string): CashClosing {
  assertCan(ctx, "cash.operate");
  if (!Number.isInteger(countedCash) || countedCash < 0) throw new ValidationError("Importe contado no válido");
  let closing!: CashClosing;
  ctx.store.update((ws) => {
    const s = ws.cashSessions.find((x) => x.id === sessionId);
    if (!s) throw new ValidationError("Caja no encontrada");
    if (s.status !== "open") throw new ValidationError("La caja ya está cerrada");
    assertLocation(ctx, s.locationId);
    const sum = sessionSummary(ws, s);
    const { difference, status } = closingStatus(sum.expectedCash, countedCash);
    if (status === "discrepancy" && !notes?.trim()) throw new ValidationError("Hay descuadre: añade una observación");
    const version = ws.cashClosings.filter((c) => c.cashSessionId === sessionId).length + 1;
    const now = nowISO();
    closing = {
      id: uid(), organizationId: ws.organization.id, cashSessionId: sessionId, version, salesCount: sum.salesCount, salesTotal: sum.salesTotal,
      totalsByMethod: sum.totalsByMethod, openingFloat: sum.openingFloat, cashIn: sum.cashIn, cashOut: sum.cashOut, expectedCash: sum.expectedCash,
      countedCash, difference, status, notes: notes?.trim() || undefined, closedBy: ctx.user.id, closedAt: now,
    };
    return {
      ...ws,
      cashSessions: ws.cashSessions.map((x) => (x.id === sessionId ? { ...x, status: "closed", closedAt: now } : x)),
      cashClosings: [...ws.cashClosings, closing],
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, {
          action: "close", entityType: "cash_closings", entityId: closing.id,
          entityLabel: `Cierre v${version} · ${status === "balanced" ? "cuadrada" : `descuadre ${formatMoney(difference)}`}`,
          context: { expected: sum.expectedCash, counted: countedCash, difference },
        }),
      ],
    };
  });
  return closing;
}

/** Reabrir: el cierre actual queda como "reemplazado" (no se borra) y la caja vuelve a estar abierta. */
export function reopenCashSession(ctx: Ctx, sessionId: string, reason: string) {
  assertCan(ctx, "cash.reopen");
  if (!reason.trim()) throw new ValidationError("Indica el motivo de la reapertura");
  ctx.store.update((ws) => {
    const s = ws.cashSessions.find((x) => x.id === sessionId);
    if (!s || s.status !== "closed") throw new ValidationError("La caja no está cerrada");
    if (ws.cashSessions.some((x) => x.locationId === s.locationId && x.status === "open")) {
      throw new ValidationError("Hay otra caja abierta en este centro. Ciérrala antes de reabrir esta.");
    }
    const now = nowISO();
    return {
      ...ws,
      cashSessions: ws.cashSessions.map((x) => (x.id === sessionId ? { ...x, status: "open", closedAt: undefined } : x)),
      cashClosings: ws.cashClosings.map((c) =>
        c.cashSessionId === sessionId && !c.supersededAt ? { ...c, supersededAt: now, supersededBy: ctx.user.id, reopenReason: reason.trim() } : c,
      ),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "reopen", entityType: "cash_sessions", entityId: sessionId, entityLabel: "Reapertura de caja", context: { reason: reason.trim() } })],
    };
  });
}
