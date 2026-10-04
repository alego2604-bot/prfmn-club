/**
 * Tarifas (planes con versiones de precio) y membresías de clientes: alta, pausa, reactivación, cambio de tarifa,
 * baja y cobro de cuotas. Toda acción queda en la auditoría; nada se borra.
 *
 * Cobro de una cuota = factura emitida (origen «membership», con periodo de servicio) + cargo del periodo
 * (+ pago si se cobra en el momento). Así las cuotas cuentan en ingresos recurrentes, IVA y cobros como el resto.
 */
import type { AuditLog, CustomerMembership, Invoice, InvoiceItem, MembershipCharge, MembershipPlan, MembershipPlanVersion, Payment } from "@/domain/types";
import { BILLING_PERIOD, currentVersion, periodEnd, effectiveChargeStatus } from "@/domain/memberships";
import { formatSeriesNumber, invoiceSeriesFor, addDaysISO } from "@/domain/invoicing";
import { computeLine } from "@/domain/pricing";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";
import { assertCan, assertLocation, auditEntry, diff, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";
import { customerName } from "./customers";

// ---------------------------------------------------------------------------------------------------------------------
// Tarifas
// ---------------------------------------------------------------------------------------------------------------------
export interface PlanInput {
  name: string;
  kind: MembershipPlan["kind"];
  billingPeriod: MembershipPlan["billingPeriod"];
  price: number;
  taxRateBp: number;
  description?: string;
  openToNew: boolean;
  isFounder?: boolean;
  sessions?: number;
  durationDays?: number;
  locationIds?: string[] | null;
}

function validatePlan(input: PlanInput) {
  if (!input.name.trim()) throw new ValidationError("Indica el nombre de la tarifa");
  if (!Number.isFinite(input.price) || input.price < 0) throw new ValidationError("Precio no válido");
  if (input.kind === "recurring" && input.billingPeriod === "none") throw new ValidationError("Una cuota recurrente necesita periodicidad");
}

export function createPlan(ctx: Ctx, input: PlanInput): MembershipPlan {
  assertCan(ctx, "catalog.manage");
  validatePlan(input);
  let plan!: MembershipPlan;
  ctx.store.update((ws) => {
    if (ws.membershipPlans.some((p) => p.status !== "archived" && p.name.toLowerCase() === input.name.trim().toLowerCase())) throw new ValidationError("Ya existe una tarifa con ese nombre");
    const now = nowISO();
    plan = {
      id: uid(), organizationId: ws.organization.id, name: input.name.trim(), kind: input.kind, billingPeriod: input.kind === "recurring" ? input.billingPeriod : "none",
      isFounder: !!input.isFounder, openToNew: input.openToNew, description: input.description?.trim() || undefined, locationIds: input.locationIds ?? null, status: "active", createdAt: now,
    };
    const version: MembershipPlanVersion = {
      id: uid(), organizationId: ws.organization.id, planId: plan.id, version: 1, price: Math.round(input.price), taxRateBp: input.taxRateBp,
      sessions: input.sessions || undefined, durationDays: input.durationDays || undefined, validFrom: toISODate(new Date()),
    };
    return {
      ...ws,
      membershipPlans: [...ws.membershipPlans, plan],
      planVersions: [...ws.planVersions, version],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "membership_plans", entityId: plan.id, entityLabel: `${plan.name} · ${formatMoney(version.price)}` })],
    };
  });
  return plan;
}

/**
 * Editar una tarifa. Si cambia el precio o el IVA se crea una versión nueva desde hoy: quien ya la tiene conserva su
 * precio pactado (membresía.price) salvo que se le cambie expresamente.
 */
export function updatePlan(ctx: Ctx, id: string, input: PlanInput) {
  assertCan(ctx, "catalog.manage");
  validatePlan(input);
  ctx.store.update((ws) => {
    const before = ws.membershipPlans.find((p) => p.id === id);
    if (!before) throw new ValidationError("Tarifa no encontrada");
    const today = toISODate(new Date());
    const cur = currentVersion(ws.planVersions, id, today);
    const priceChanged = !cur || cur.price !== Math.round(input.price) || cur.taxRateBp !== input.taxRateBp || (cur.sessions ?? undefined) !== (input.sessions || undefined) || (cur.durationDays ?? undefined) !== (input.durationDays || undefined);
    if (priceChanged) assertCan(ctx, "catalog.prices");
    const after: MembershipPlan = {
      ...before, name: input.name.trim(), kind: input.kind, billingPeriod: input.kind === "recurring" ? input.billingPeriod : "none",
      openToNew: input.openToNew, isFounder: !!input.isFounder, description: input.description?.trim() || undefined, locationIds: input.locationIds ?? null,
    };
    let versions = ws.planVersions;
    const logs: AuditLog[] = [];
    if (priceChanged) {
      const next: MembershipPlanVersion = {
        id: uid(), organizationId: ws.organization.id, planId: id, version: Math.max(0, ...ws.planVersions.filter((v) => v.planId === id).map((v) => v.version)) + 1,
        price: Math.round(input.price), taxRateBp: input.taxRateBp, sessions: input.sessions || undefined, durationDays: input.durationDays || undefined, validFrom: today,
      };
      versions = [...ws.planVersions.map((v) => (v.id === cur?.id && !v.validTo ? { ...v, validTo: addDaysISO(today, -1) < v.validFrom ? v.validFrom : addDaysISO(today, -1) } : v)), next];
      // Va con la versión nueva (su propio id): no choca con el «editó» de la tarifa en la nube
      logs.push(auditEntry(ws, ctx, { action: "price_change", entityType: "membership_plan_versions", entityId: next.id, entityLabel: `${after.name} · ${cur ? formatMoney(cur.price) : "—"} → ${formatMoney(next.price)}` }));
    }
    const changes = diff(before, after);
    if (Object.keys(changes).length) logs.push(auditEntry(ws, ctx, { action: "update", entityType: "membership_plans", entityId: id, entityLabel: after.name, changes }));
    if (!logs.length) return ws;
    return { ...ws, membershipPlans: ws.membershipPlans.map((p) => (p.id === id ? after : p)), planVersions: versions, auditLogs: [...ws.auditLogs, ...logs] };
  });
}

export function setPlanStatus(ctx: Ctx, id: string, status: MembershipPlan["status"]) {
  assertCan(ctx, "catalog.manage");
  ctx.store.update((ws) => {
    const p = ws.membershipPlans.find((x) => x.id === id);
    if (!p) throw new ValidationError("Tarifa no encontrada");
    return {
      ...ws,
      membershipPlans: ws.membershipPlans.map((x) => (x.id === id ? { ...x, status } : x)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: status === "archived" ? "archive" : "update", entityType: "membership_plans", entityId: id, entityLabel: p.name })],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Membresías
// ---------------------------------------------------------------------------------------------------------------------
const label = (ws: Workspace, m: Pick<CustomerMembership, "customerId" | "planId">) => {
  const c = ws.customers.find((x) => x.id === m.customerId);
  const p = ws.membershipPlans.find((x) => x.id === m.planId);
  return `${c ? customerName(c) : "Cliente"} · ${p?.name ?? "Tarifa"}`;
};

export interface AssignInput {
  customerId: string;
  planId: string;
  startDate: string;
  locationId?: string;
  /** Precio pactado (por defecto, el vigente de la tarifa) */
  price?: number;
  autoRenew?: boolean;
  notes?: string;
  /** Cobrar ya la primera cuota (método) o dejarla emitida pendiente ("pending"), o no generar nada aún (undefined) */
  firstCharge?: { methodKey: string } | "pending";
}

export function assignMembership(ctx: Ctx, input: AssignInput): CustomerMembership {
  assertCan(ctx, "memberships.manage");
  let created!: CustomerMembership;
  ctx.store.update((ws) => {
    const c = ws.customers.find((x) => x.id === input.customerId);
    if (!c) throw new ValidationError("Cliente no encontrado");
    const plan = ws.membershipPlans.find((p) => p.id === input.planId);
    if (!plan || plan.status !== "active") throw new ValidationError("Tarifa no disponible");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new ValidationError("Fecha de inicio no válida");
    const version = currentVersion(ws.planVersions, plan.id, input.startDate);
    if (!version) throw new ValidationError("La tarifa no tiene precio");
    if (input.locationId && !ws.locations.some((l) => l.id === input.locationId)) throw new ValidationError("Centro no válido");
    assertLocation(ctx, input.locationId);
    if (plan.locationIds?.length && input.locationId && !plan.locationIds.includes(input.locationId)) throw new ValidationError("Esta tarifa no está disponible en ese centro");
    const today = toISODate(new Date());
    const now = nowISO();
    const recurring = plan.billingPeriod !== "none";
    created = {
      id: uid(), organizationId: ws.organization.id, customerId: c.id, planId: plan.id, planVersionId: version.id, locationId: input.locationId || undefined,
      price: Math.round(input.price ?? version.price), startDate: input.startDate,
      endDate: recurring ? undefined : addDaysISO(periodEnd(input.startDate, "none", version.durationDays), -1),
      nextRenewalDate: input.startDate, autoRenew: recurring && (input.autoRenew ?? true),
      creditsRemaining: version.sessions ?? undefined, status: input.startDate > today ? "pending" : "active",
      notes: input.notes?.trim() || undefined, createdBy: ctx.user.id, createdAt: now, updatedAt: now,
    };
    const customers = ws.customers.map((x) =>
      x.id === c.id && x.status !== "active" && created.status === "active" ? { ...x, status: "active" as const, joinedAt: x.joinedAt ?? input.startDate, leftAt: undefined, updatedAt: now } : x,
    );
    return {
      ...ws,
      customers,
      customerMemberships: [...ws.customerMemberships, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "customer_memberships", entityId: created.id, entityLabel: `${label(ws, created)} · desde ${formatDate(input.startDate)}` })],
    };
  });
  if (input.firstCharge) chargeMembership(ctx, created.id, input.firstCharge === "pending" ? {} : { methodKey: input.firstCharge.methodKey });
  return ctx.store.requireWorkspace().customerMemberships.find((m) => m.id === created.id) ?? created;
}

function updateMembership(ctx: Ctx, id: string, action: string, fn: (m: CustomerMembership, ws: Workspace) => CustomerMembership, extra?: (ws: Workspace, m: CustomerMembership) => Partial<Workspace>, note?: string) {
  assertCan(ctx, "memberships.manage");
  ctx.store.update((ws) => {
    const before = ws.customerMemberships.find((m) => m.id === id);
    if (!before) throw new ValidationError("Membresía no encontrada");
    assertLocation(ctx, before.locationId);
    const after = { ...fn(before, ws), updatedAt: nowISO() };
    return {
      ...ws,
      ...extra?.(ws, after),
      customerMemberships: ws.customerMemberships.map((m) => (m.id === id ? after : m)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action, entityType: "customer_memberships", entityId: id, entityLabel: `${label(ws, after)}${note ? ` · ${note}` : ""}`, changes: diff(before, after, ["updatedAt"]) })],
    };
  });
}

export function pauseMembership(ctx: Ctx, id: string, opts: { resumeOn?: string; reason?: string } = {}) {
  updateMembership(ctx, id, "pause", (m) => {
    if (m.status !== "active") throw new ValidationError("Solo se puede pausar una membresía activa");
    return { ...m, status: "paused", pausedAt: nowISO(), resumeOn: opts.resumeOn || undefined, notes: opts.reason ? [m.notes, `Pausa: ${opts.reason}`].filter(Boolean).join("\n") : m.notes };
  }, undefined, opts.resumeOn ? `pausa hasta ${formatDate(opts.resumeOn)}` : "pausa");
}

/** Reanudar tras una pausa: la próxima renovación se desplaza los días que estuvo en pausa. */
export function resumeMembership(ctx: Ctx, id: string) {
  updateMembership(ctx, id, "resume", (m) => {
    if (m.status !== "paused") throw new ValidationError("La membresía no está en pausa");
    const paused = m.pausedAt ? Math.max(0, Math.round((Date.now() - new Date(m.pausedAt).getTime()) / 86_400_000)) : 0;
    const next = m.nextRenewalDate ? addDaysISO(m.nextRenewalDate, paused) : undefined;
    return { ...m, status: "active", pausedAt: undefined, resumeOn: undefined, nextRenewalDate: next };
  }, undefined, "reanudada");
}

export function cancelMembership(ctx: Ctx, id: string, opts: { reason: string; endDate?: string; markCustomerInactive?: boolean }) {
  if (!opts.reason.trim()) throw new ValidationError("Indica el motivo de la baja");
  updateMembership(
    ctx, id, "cancel",
    (m) => {
      if (m.status === "cancelled") throw new ValidationError("La membresía ya está de baja");
      const end = opts.endDate || toISODate(new Date());
      // Una baja antes de empezar (membresía pendiente) termina el mismo día de inicio: nunca fin < inicio
      return { ...m, status: "cancelled", cancelledAt: nowISO(), cancelReason: opts.reason.trim(), autoRenew: false, endDate: end < m.startDate ? m.startDate : end, nextRenewalDate: undefined };
    },
    (ws, m) => {
      if (!opts.markCustomerInactive) return {};
      const others = ws.customerMemberships.some((x) => x.id !== m.id && x.customerId === m.customerId && (x.status === "active" || x.status === "paused" || x.status === "pending"));
      if (others) return {};
      const today = toISODate(new Date());
      return { customers: ws.customers.map((c) => (c.id === m.customerId && c.status === "active" ? { ...c, status: "cancelled" as const, leftAt: today, updatedAt: nowISO() } : c)) };
    },
    opts.reason.trim(),
  );
}

export function reactivateMembership(ctx: Ctx, id: string, startDate = toISODate(new Date())) {
  updateMembership(
    ctx, id, "reactivate",
    (m, ws) => {
      if (m.status !== "cancelled" && m.status !== "expired") throw new ValidationError("La membresía no está de baja");
      const plan = ws.membershipPlans.find((p) => p.id === m.planId);
      return { ...m, status: "active", cancelledAt: undefined, cancelReason: undefined, endDate: undefined, nextRenewalDate: startDate, autoRenew: plan?.billingPeriod !== "none" };
    },
    (ws, m) => ({ customers: ws.customers.map((c) => (c.id === m.customerId && c.status !== "active" ? { ...c, status: "active" as const, leftAt: undefined, updatedAt: nowISO() } : c)) }),
    "reactivada",
  );
}

/** Cambio de tarifa: la actual termina hoy y empieza la nueva (con su precio vigente) desde la próxima renovación o hoy. */
export function changeMembershipPlan(ctx: Ctx, id: string, planId: string, opts: { startDate?: string; price?: number } = {}): CustomerMembership {
  assertCan(ctx, "memberships.manage");
  const ws = ctx.store.requireWorkspace();
  const m = ws.customerMemberships.find((x) => x.id === id);
  if (!m) throw new ValidationError("Membresía no encontrada");
  if (m.planId === planId) throw new ValidationError("Ya tiene esa tarifa");
  const start = opts.startDate ?? (m.nextRenewalDate && m.nextRenewalDate > toISODate(new Date()) ? m.nextRenewalDate : toISODate(new Date()));
  updateMembership(ctx, id, "plan_change", (x) => ({ ...x, status: "cancelled", cancelledAt: nowISO(), cancelReason: "Cambio de tarifa", autoRenew: false, endDate: addDaysISO(start, -1) < x.startDate ? x.startDate : addDaysISO(start, -1), nextRenewalDate: undefined }), undefined, "cambio de tarifa");
  return assignMembership(ctx, { customerId: m.customerId, planId, startDate: start, locationId: m.locationId, price: opts.price });
}

/**
 * Cobra (o emite pendiente) la cuota del periodo que empieza en la próxima renovación. Avanza la renovación.
 * `methodKey` → factura cobrada + pago; sin método → factura emitida pendiente de cobro.
 */
export function chargeMembership(ctx: Ctx, id: string, opts: { methodKey?: string; issueDate?: string } = {}): { invoice: Invoice; charge: MembershipCharge } {
  assertCan(ctx, "memberships.manage");
  assertCan(ctx, "invoices.manage");
  if (opts.methodKey) assertCan(ctx, "payments.manage");
  let result!: { invoice: Invoice; charge: MembershipCharge };
  ctx.store.update((ws) => {
    const m = ws.customerMemberships.find((x) => x.id === id);
    if (!m) throw new ValidationError("Membresía no encontrada");
    if (m.status === "cancelled" || m.status === "expired" || m.status === "paused") throw new ValidationError("La membresía no está activa");
    assertLocation(ctx, m.locationId);
    const plan = ws.membershipPlans.find((p) => p.id === m.planId);
    const version = ws.planVersions.find((v) => v.id === m.planVersionId);
    const c = ws.customers.find((x) => x.id === m.customerId);
    if (!plan || !version || !c) throw new ValidationError("Faltan datos de la tarifa o del cliente");
    const start = m.nextRenewalDate ?? m.startDate;
    const paid = new Set(ws.invoices.filter((i) => i.status === "paid").map((i) => i.id));
    if (ws.membershipCharges.some((x) => x.customerMembershipId === id && x.periodStart === start && effectiveChargeStatus(x, paid) !== "failed")) throw new ValidationError(`La cuota del ${formatDate(start)} ya está generada`);
    const endExcl = periodEnd(start, plan.billingPeriod, version.durationDays);
    const end = addDaysISO(endExcl, -1);
    const issueDate = opts.issueDate ?? toISODate(new Date());
    const series = invoiceSeriesFor(ws.documentSeries, issueDate);
    if (!series) throw new ValidationError(`No hay una serie de facturas activa para ${issueDate.slice(0, 4)}`);
    const method = opts.methodKey ? ws.paymentMethods.find((x) => x.key === opts.methodKey) : undefined;
    if (opts.methodKey && !method) throw new ValidationError("Método de pago no válido");
    const local = !ws.server;
    const now = nowISO();
    const line = computeLine({ unitPrice: m.price, quantity: 1, taxRateBp: version.taxRateBp });
    const invoiceId = uid();
    const concept = `${plan.name} · ${formatDate(start)} – ${formatDate(end)}`;
    const invoice: Invoice = {
      id: invoiceId, organizationId: ws.organization.id, locationId: m.locationId, seriesId: series.id,
      number: local ? formatSeriesNumber(series, series.nextNumber) : undefined, issueDate, dueDate: start > issueDate ? start : issueDate,
      customerId: c.id, customerName: c.companyName || customerName(c), customerTaxId: c.taxId,
      customerAddress: [c.address, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined,
      concept, servicePeriodStart: start, servicePeriodEnd: end, subtotal: line.baseAmount, taxTotal: line.taxAmount, discountTotal: 0, total: line.total,
      amountPaid: method ? line.total : 0, status: method ? "paid" : "issued", paymentMethodId: method?.id, paidAt: method ? now : undefined,
      planVersionId: version.id, customerMembershipId: m.id, source: "membership", createdAt: now,
    };
    const item: InvoiceItem = {
      id: uid(), organizationId: ws.organization.id, invoiceId, description: concept, quantity: 1, unitPrice: m.price, discount: 0, taxRateBp: version.taxRateBp,
      baseAmount: line.baseAmount, taxAmount: line.taxAmount, total: line.total, planVersionId: version.id, sortOrder: 0,
    };
    const payments: Payment[] = method
      ? [{ id: uid(), organizationId: ws.organization.id, locationId: m.locationId, kind: "charge", invoiceId, customerId: c.id, paymentMethodId: method.id, methodKey: method.key, methodKind: method.kind, amount: line.total, status: "succeeded", paidAt: now, source: "manual", createdAt: now }]
      : [];
    const charge: MembershipCharge = {
      id: uid(), organizationId: ws.organization.id, customerMembershipId: m.id, periodStart: start, periodEnd: end, amount: line.total,
      status: method ? "paid" : "invoiced", invoiceId, createdAt: now,
    };
    const recurring = BILLING_PERIOD[plan.billingPeriod].months > 0;
    const updated: CustomerMembership = {
      ...m, status: m.status === "pending" && start <= toISODate(new Date()) ? "active" : m.status,
      nextRenewalDate: recurring && m.autoRenew ? endExcl : undefined, endDate: recurring ? m.endDate : end, updatedAt: now,
    };
    result = { invoice, charge };
    return {
      ...ws,
      invoices: [...ws.invoices, invoice],
      invoiceItems: [...ws.invoiceItems, item],
      payments: [...ws.payments, ...payments],
      membershipCharges: [...ws.membershipCharges, charge],
      customerMemberships: ws.customerMemberships.map((x) => (x.id === id ? updated : x)),
      documentSeries: local ? ws.documentSeries.map((s) => (s.id === series.id ? { ...s, nextNumber: s.nextNumber + 1 } : s)) : ws.documentSeries,
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: "charge", entityType: "customer_memberships", entityId: m.id, entityLabel: `${label(ws, m)} · cuota ${formatMoney(line.total)} ${method ? `cobrada (${method.name})` : "pendiente"}` }),
        auditEntry(ws, ctx, { action: "issue", entityType: "invoices", entityId: invoiceId, entityLabel: `${invoice.customerName} · ${concept}` }),
      ],
    };
  });
  return result;
}
