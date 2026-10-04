/**
 * Membresías: estado visible, periodos, renovaciones y métricas recurrentes. Cálculos puros.
 *
 * Estado guardado (columna): pending | active | paused | cancelled | expired.
 * Estado visible añade PAST_DUE: activa con una cuota vencida sin cobrar (cargo fallido, o renovación pasada hace más
 * de `graceDays` sin cargo pagado o facturado para ese periodo).
 */
import type { Cents } from "@/lib/money";
import { splitGross } from "@/lib/money";
import { addMonths, startOfMonth, toISODate } from "@/lib/dates";
import type { CustomerMembership, Invoice, MembershipCharge, MembershipPlan, MembershipPlanVersion } from "./types";

export type MembershipView = "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | "PENDING" | "PAST_DUE";

export const MEMBERSHIP_VIEW: Record<MembershipView, { label: string; tone: "success" | "info" | "neutral" | "warning" | "danger" }> = {
  ACTIVE: { label: "Activa", tone: "success" },
  PAST_DUE: { label: "Cuota vencida", tone: "danger" },
  PAUSED: { label: "En pausa", tone: "info" },
  PENDING: { label: "Pendiente de inicio", tone: "warning" },
  CANCELLED: { label: "Baja", tone: "neutral" },
  EXPIRED: { label: "Finalizada", tone: "neutral" },
};

export const BILLING_PERIOD: Record<MembershipPlan["billingPeriod"], { label: string; per: string; months: number }> = {
  week: { label: "Semanal", per: "semana", months: 12 / 52 },
  month: { label: "Mensual", per: "mes", months: 1 },
  quarter: { label: "Trimestral", per: "trimestre", months: 3 },
  semester: { label: "Semestral", per: "semestre", months: 6 },
  year: { label: "Anual", per: "año", months: 12 },
  none: { label: "Pago único", per: "pago", months: 0 },
};

export const PLAN_KIND: Record<MembershipPlan["kind"], string> = {
  recurring: "Cuota recurrente",
  pack: "Bono",
  drop_in: "Entrada suelta",
  trial: "Prueba",
};

const D = (iso: string) => new Date(`${iso}T00:00:00`);

/** Suma meses conservando el día (31 ene + 1 mes → 28/29 feb). `addMonths` de lib/dates devuelve el día 1. */
export function addMonthsKeepDay(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}

/** Fin (exclusivo) de un periodo que empieza en `startIso`. Bonos sin periodo: `durationDays` o 30 días. */
export function periodEnd(startIso: string, period: MembershipPlan["billingPeriod"], durationDays?: number): string {
  const d = D(startIso);
  switch (period) {
    case "week": d.setDate(d.getDate() + 7); break;
    case "month": return toISODate(addMonthsKeepDay(d, 1));
    case "quarter": return toISODate(addMonthsKeepDay(d, 3));
    case "semester": return toISODate(addMonthsKeepDay(d, 6));
    case "year": return toISODate(addMonthsKeepDay(d, 12));
    case "none": d.setDate(d.getDate() + (durationDays ?? 30)); break;
  }
  return toISODate(d);
}

/**
 * Estado real de una cuota: si su factura ya está cobrada, está pagada aunque la fila diga «devuelta» o «facturada»
 * (el cobro de la factura lo registra quien gestiona cobros, que no siempre puede editar membresías). Sin esto, una
 * cuota devuelta y después cobrada dejaba la membresía en impago para siempre.
 */
export function effectiveChargeStatus(c: Pick<MembershipCharge, "status" | "invoiceId">, paidInvoices: Set<string>): MembershipCharge["status"] {
  return c.invoiceId && paidInvoices.has(c.invoiceId) && (c.status === "failed" || c.status === "invoiced" || c.status === "scheduled") ? "paid" : c.status;
}

export function membershipView(
  m: Pick<CustomerMembership, "id" | "status" | "startDate" | "endDate" | "nextRenewalDate" | "autoRenew">,
  charges: Pick<MembershipCharge, "customerMembershipId" | "status" | "periodStart">[],
  today = toISODate(new Date()),
  graceDays = 5,
): MembershipView {
  if (m.status === "cancelled") return "CANCELLED";
  if (m.status === "expired") return "EXPIRED";
  if (m.status === "paused") return "PAUSED";
  if (m.status === "pending" || m.startDate > today) return "PENDING";
  if (m.endDate && m.endDate < today && !m.autoRenew) return "EXPIRED";
  const mine = charges.filter((c) => c.customerMembershipId === m.id);
  if (mine.some((c) => c.status === "failed")) return "PAST_DUE";
  if (m.nextRenewalDate && m.autoRenew) {
    const grace = D(m.nextRenewalDate);
    grace.setDate(grace.getDate() + graceDays);
    if (toISODate(grace) < today && !mine.some((c) => c.periodStart >= m.nextRenewalDate! && c.status !== "failed")) return "PAST_DUE";
  }
  return "ACTIVE";
}

/** ¿Cuenta como membresía viva (genera ingresos recurrentes)? */
export const isLive = (v: MembershipView) => v === "ACTIVE" || v === "PAST_DUE";

/** Precio mensual equivalente sin IVA (MRR) de una membresía. */
export function monthlyBase(m: Pick<CustomerMembership, "price">, period: MembershipPlan["billingPeriod"], taxRateBp: number): Cents {
  const months = BILLING_PERIOD[period].months;
  if (!months) return 0;
  return Math.round(splitGross(m.price, taxRateBp).base / months);
}

export interface MembershipRefs {
  plans: MembershipPlan[];
  versions: MembershipPlanVersion[];
  charges: MembershipCharge[];
}

export interface MembershipSummary {
  active: number;
  pastDue: number;
  paused: number;
  pending: number;
  cancelledInPeriod: number;
  newInPeriod: number;
  /** Ingreso recurrente mensual (sin IVA) de las vivas */
  mrr: Cents;
  /** Renovaciones en los próximos `days` días */
  upcoming: { count: number; amount: Cents };
  byPlan: { id: string; name: string; count: number; mrr: Cents }[];
}

export function membershipSummary(
  list: CustomerMembership[],
  refs: MembershipRefs,
  period: { start: string; end: string },
  today = toISODate(new Date()),
  days = 7,
  locationId?: string,
): MembershipSummary {
  const plan = new Map(refs.plans.map((p) => [p.id, p]));
  const ver = new Map(refs.versions.map((v) => [v.id, v]));
  const horizon = D(today);
  horizon.setDate(horizon.getDate() + days);
  const h = toISODate(horizon);
  const out: MembershipSummary = { active: 0, pastDue: 0, paused: 0, pending: 0, cancelledInPeriod: 0, newInPeriod: 0, mrr: 0, upcoming: { count: 0, amount: 0 }, byPlan: [] };
  const byPlan = new Map<string, { id: string; name: string; count: number; mrr: number }>();
  for (const m of list) {
    if (locationId && m.locationId && m.locationId !== locationId) continue;
    const v = membershipView(m, refs.charges, today);
    const p = plan.get(m.planId);
    if (m.startDate >= period.start && m.startDate < period.end) out.newInPeriod++;
    const cancelled = m.cancelledAt?.slice(0, 10);
    if (v === "CANCELLED" && cancelled && cancelled >= period.start && cancelled < period.end) out.cancelledInPeriod++;
    if (v === "PAUSED") out.paused++;
    if (v === "PENDING") out.pending++;
    if (!isLive(v)) continue;
    if (v === "PAST_DUE") out.pastDue++;
    else out.active++;
    const mrr = p ? monthlyBase(m, p.billingPeriod, ver.get(m.planVersionId)?.taxRateBp ?? 2100) : 0;
    out.mrr += mrr;
    const r = byPlan.get(m.planId) ?? { id: m.planId, name: p?.name ?? "Tarifa", count: 0, mrr: 0 };
    r.count++;
    r.mrr += mrr;
    byPlan.set(m.planId, r);
    if (m.autoRenew && m.nextRenewalDate && m.nextRenewalDate >= today && m.nextRenewalDate <= h) {
      out.upcoming.count++;
      out.upcoming.amount += m.price;
    }
  }
  out.byPlan = [...byPlan.values()].sort((a, b) => b.mrr - a.mrr);
  return out;
}

/** Membresías vivas al cierre de cada mes (evolución), con altas y bajas del mes. */
export function membershipEvolution(list: CustomerMembership[], end: Date, months = 12, locationId?: string): { date: Date; active: number; added: number; cancelled: number }[] {
  const first = startOfMonth(addMonths(end, -(months - 1)));
  return Array.from({ length: months }, (_, i) => {
    const start = toISODate(addMonths(first, i));
    const next = toISODate(addMonths(first, i + 1));
    let active = 0;
    let added = 0;
    let cancelled = 0;
    for (const m of list) {
      if (locationId && m.locationId && m.locationId !== locationId) continue;
      if (m.status === "pending") continue;
      const stop = m.cancelledAt?.slice(0, 10) ?? (m.status === "expired" ? m.endDate : undefined);
      if (m.startDate >= start && m.startDate < next) added++;
      if (stop && stop >= start && stop < next) cancelled++;
      if (m.startDate < next && (!stop || stop >= next)) active++;
    }
    return { date: addMonths(first, i), active, added, cancelled };
  });
}

/** Versión vigente de una tarifa en una fecha (la de número más alto que ya ha empezado). */
export function currentVersion(versions: MembershipPlanVersion[], planId: string, at = toISODate(new Date())): MembershipPlanVersion | undefined {
  return versions
    .filter((v) => v.planId === planId && v.validFrom <= at && (!v.validTo || v.validTo >= at))
    .sort((a, b) => b.version - a.version)[0] ?? versions.filter((v) => v.planId === planId).sort((a, b) => b.version - a.version)[0];
}

/**
 * Importe que se debe por cuotas vencidas: lo pendiente de las facturas de cuota de cada membresía PAST_DUE y, si la
 * cuota vencida aún no se ha emitido (ninguna factura pendiente), el precio de un periodo.
 */
export function pastDueOwed(
  list: CustomerMembership[],
  charges: Pick<MembershipCharge, "customerMembershipId" | "status" | "periodStart">[],
  invoices: Pick<Invoice, "customerMembershipId" | "status" | "total" | "amountPaid">[],
  today = toISODate(new Date()),
  locationId?: string,
): Cents {
  let owed = 0;
  for (const m of list) {
    if (locationId && m.locationId && m.locationId !== locationId) continue;
    if (membershipView(m, charges, today) !== "PAST_DUE") continue;
    const open = invoices.filter((i) => i.customerMembershipId === m.id && (i.status === "issued" || i.status === "partially_paid"));
    owed += open.length ? open.reduce((t, i) => t + i.total - i.amountPaid, 0) : m.price;
  }
  return owed;
}
