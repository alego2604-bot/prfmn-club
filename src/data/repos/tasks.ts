import type { Task } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { toISODate } from "@/lib/dates";
import { assertCan, auditEntry, ValidationError, type Ctx } from "../context";
import { customerName } from "./customers";

export interface TaskInput {
  title: string;
  description?: string;
  customerId?: string;
  dueDate?: string;
  assigneeId?: string;
  reason?: string;
  alertKey?: string;
}

export function createTask(ctx: Ctx, input: TaskInput): Task {
  assertCan(ctx, "customers.manage");
  const title = input.title.trim();
  if (!title) throw new ValidationError("Indica qué hay que hacer");
  let created!: Task;
  ctx.store.update((ws) => {
    const c = input.customerId ? ws.customers.find((x) => x.id === input.customerId) : undefined;
    if (input.customerId && !c) throw new ValidationError("Cliente no encontrado");
    const now = nowISO();
    created = {
      id: uid(), organizationId: ws.organization.id, customerId: c?.id, title, description: input.description?.trim() || undefined,
      reason: input.reason, alertKey: input.alertKey, assigneeId: input.assigneeId || undefined, dueDate: input.dueDate || undefined,
      status: "pending", createdBy: ctx.user.id, createdAt: now, updatedAt: now,
    };
    return {
      ...ws,
      tasks: [...ws.tasks, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "tasks", entityId: created.id, entityLabel: c ? `${title} · ${customerName(c)}` : title })],
    };
  });
  return created;
}

export function setTaskStatus(ctx: Ctx, id: string, status: Task["status"]) {
  assertCan(ctx, "customers.manage");
  ctx.store.update((ws) => {
    const t = ws.tasks.find((x) => x.id === id);
    if (!t) throw new ValidationError("Tarea no encontrada");
    if (t.status === status) return ws;
    const now = nowISO();
    return {
      ...ws,
      tasks: ws.tasks.map((x) => (x.id === id ? { ...x, status, completedAt: status === "done" ? now : undefined, updatedAt: now } : x)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: status === "done" ? "complete" : "update", entityType: "tasks", entityId: id, entityLabel: t.title })],
    };
  });
}

export function snoozeTask(ctx: Ctx, id: string, until: string) {
  assertCan(ctx, "customers.manage");
  ctx.store.update((ws) => ({
    ...ws,
    tasks: ws.tasks.map((x) => (x.id === id ? { ...x, dueDate: until, snoozedUntil: until, updatedAt: nowISO() } : x)),
  }));
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "someday" | "done";

export function taskBucket(t: Pick<Task, "status" | "dueDate">, today = toISODate(new Date())): TaskBucket {
  if (t.status === "done" || t.status === "cancelled") return "done";
  if (!t.dueDate) return "someday";
  if (t.dueDate < today) return "overdue";
  if (t.dueDate === today) return "today";
  return "upcoming";
}
