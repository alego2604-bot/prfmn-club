/**
 * Vista 360 de un cliente: estado coherente, valor, actividad, saldo y la próxima acción recomendada.
 * Todo derivado de registros (ventas, facturas, membresías, tareas): si algo aparece, se puede justificar.
 */
import type { Workspace } from "@/data/store";
import { toISODate } from "@/lib/dates";
import type { Customer, CustomerMembership, Invoice, Task } from "./types";
import { invoiceView } from "./invoicing";
import { membershipView, type MembershipView } from "./memberships";

export interface CustomerSnapshot {
  membership?: CustomerMembership;
  membershipView?: MembershipView;
  planName?: string;
  locationId?: string;
  /** Compras + facturas no anuladas, IVA incluido */
  lifetimeValue: number;
  value12m: number;
  lastActivity?: string;
  balance: number;
  pendingInvoices: Invoice[];
  overdueInvoices: Invoice[];
  openTasks: Task[];
}

/** Membresía de referencia: la viva (activa, cuota vencida, pausa, pendiente) más reciente; si no, la última. */
export function currentMembership(list: CustomerMembership[], customerId: string): CustomerMembership | undefined {
  const mine = list.filter((m) => m.customerId === customerId).sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  return mine.find((m) => m.status === "active" || m.status === "paused" || m.status === "pending") ?? mine[0];
}

/** Índices por cliente (una sola pasada por colección: listados con miles de clientes). */
export function customerIndex(ws: Pick<Workspace, "sales" | "invoices" | "customerMemberships" | "membershipCharges" | "membershipPlans" | "tasks">, today = toISODate(new Date())) {
  const since12 = toISODate(new Date(Date.now() - 365 * 86_400_000));
  const out = new Map<string, CustomerSnapshot>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { lifetimeValue: 0, value12m: 0, balance: 0, pendingInvoices: [], overdueInvoices: [], openTasks: [] }));
    return s;
  };
  const touch = (s: CustomerSnapshot, d: string) => { if (!s.lastActivity || d > s.lastActivity) s.lastActivity = d; };
  for (const sale of ws.sales) {
    if (!sale.customerId || sale.status === "voided") continue;
    const s = get(sale.customerId);
    const d = sale.occurredAt.slice(0, 10);
    s.lifetimeValue += sale.total;
    if (d >= since12) s.value12m += sale.total;
    touch(s, d);
  }
  for (const inv of ws.invoices) {
    if (!inv.customerId || inv.status === "void" || inv.status === "draft") continue;
    const s = get(inv.customerId);
    const d = inv.issueDate ?? "";
    s.lifetimeValue += inv.total;
    if (d >= since12) s.value12m += inv.total;
    if (d) touch(s, d);
    if (inv.status === "issued" || inv.status === "partially_paid") {
      s.balance += inv.total - inv.amountPaid;
      s.pendingInvoices.push(inv);
      if (invoiceView(inv, today) === "overdue") s.overdueInvoices.push(inv);
    }
  }
  const plans = new Map(ws.membershipPlans.map((p) => [p.id, p.name]));
  const byCustomer = new Map<string, CustomerMembership[]>();
  for (const m of ws.customerMemberships) byCustomer.set(m.customerId, [...(byCustomer.get(m.customerId) ?? []), m]);
  for (const [cid, list] of byCustomer) {
    const m = currentMembership(list, cid)!;
    const s = get(cid);
    s.membership = m;
    s.membershipView = membershipView(m, ws.membershipCharges, today);
    s.planName = plans.get(m.planId);
    s.locationId = m.locationId;
  }
  for (const t of ws.tasks) if (t.customerId && (t.status === "pending" || t.status === "in_progress")) get(t.customerId).openTasks.push(t);
  return out;
}

export const EMPTY_SNAPSHOT: CustomerSnapshot = { lifetimeValue: 0, value12m: 0, balance: 0, pendingInvoices: [], overdueInvoices: [], openTasks: [] };

export interface NextAction {
  label: string;
  reason: string;
  tone: "danger" | "warning" | "info" | "neutral" | "success";
  kind: "collect" | "task" | "renewal" | "resume" | "convert" | "reactivate" | "none";
}

/** Siguiente paso con este cliente, por prioridad (dinero vencido → tareas → renovaciones → conversión). */
export function nextAction(c: Pick<Customer, "status" | "leftAt">, s: CustomerSnapshot, today = toISODate(new Date())): NextAction {
  if (s.membershipView === "PAST_DUE" || s.overdueInvoices.length) {
    return { kind: "collect", tone: "danger", label: "Cobrar cuota vencida", reason: s.overdueInvoices.length ? `${s.overdueInvoices.length} ${s.overdueInvoices.length === 1 ? "factura vencida" : "facturas vencidas"} sin cobrar` : "La última cuota no se pudo cobrar" };
  }
  const task = [...s.openTasks].sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))[0];
  if (task) return { kind: "task", tone: task.dueDate && task.dueDate < today ? "warning" : "info", label: task.title, reason: task.dueDate ? (task.dueDate < today ? "Tarea atrasada" : task.dueDate === today ? "Tarea para hoy" : `Tarea para el ${task.dueDate.split("-").reverse().join("/")}`) : "Tarea pendiente" };
  if (s.balance > 0) return { kind: "collect", tone: "warning", label: "Registrar cobro pendiente", reason: `${s.pendingInvoices.length} ${s.pendingInvoices.length === 1 ? "factura pendiente" : "facturas pendientes"}` };
  const m = s.membership;
  if (s.membershipView === "PAUSED") return { kind: "resume", tone: "info", label: "Confirmar la vuelta", reason: m?.resumeOn ? `Pausa hasta el ${m.resumeOn.split("-").reverse().join("/")}` : "Membresía en pausa sin fecha de vuelta" };
  if (s.membershipView === "ACTIVE" && m?.autoRenew && m.nextRenewalDate) {
    const days = Math.round((new Date(`${m.nextRenewalDate}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 86_400_000);
    if (days <= 7) return { kind: "renewal", tone: "info", label: days <= 0 ? "Generar la cuota de renovación" : `Renovación en ${days} ${days === 1 ? "día" : "días"}`, reason: "Cuota del siguiente periodo" };
  }
  if (c.status === "lead") return { kind: "convert", tone: "info", label: "Convertir en cliente", reason: "Lead sin membresía" };
  if (c.status === "cancelled" || s.membershipView === "CANCELLED" || s.membershipView === "EXPIRED") return { kind: "reactivate", tone: "neutral", label: "Proponer la vuelta", reason: c.leftAt ? `De baja desde el ${c.leftAt.split("-").reverse().join("/")}` : "Sin membresía activa" };
  return { kind: "none", tone: "success", label: "Todo al día", reason: "Sin cobros, tareas ni renovaciones pendientes" };
}
