import type { ActivityRule, Organization, PaymentMethod, TaxRate } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { normalizeKey } from "@/lib/text";
import { assertCan, auditEntry, diff, ValidationError, type Ctx } from "../context";

type OrgPatch = Partial<Pick<Organization, "name" | "legalName" | "taxId" | "address" | "city" | "postalCode" | "phone" | "email" | "website" | "logoDataUrl" | "vertical" | "modules" | "fiscalYearStartMonth">>;

export function updateOrganization(ctx: Ctx, patch: OrgPatch) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError("El nombre comercial es obligatorio");
    const after = { ...ws.organization, ...patch };
    const changes = diff(ws.organization, after, ["logoDataUrl"]);
    if (!Object.keys(changes).length && patch.logoDataUrl === ws.organization.logoDataUrl) return ws;
    return {
      ...ws,
      organization: after,
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "organizations", entityId: ws.organization.id, entityLabel: after.name, changes })],
    };
  });
  const ws = ctx.store.requireWorkspace();
  void ctx.store.updateMeta((m) => ({ ...m, organizations: m.organizations.map((o) => (o.id === ws.organization.id ? { ...o, name: ws.organization.name } : o)) }));
}

export function addLocation(ctx: Ctx, name: string, city?: string) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    if (!name.trim()) throw new ValidationError("El nombre del centro es obligatorio");
    if (ws.locations.some((l) => normalizeKey(l.name) === normalizeKey(name))) throw new ValidationError("Ya existe un centro con ese nombre");
    const id = uid();
    return {
      ...ws,
      locations: [...ws.locations, { id, organizationId: ws.organization.id, name: name.trim(), city: city?.trim() || undefined, status: "active", createdAt: nowISO() }],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "locations", entityId: id, entityLabel: name.trim() })],
    };
  });
}

export function setLocationStatus(ctx: Ctx, id: string, status: "active" | "inactive") {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    const loc = ws.locations.find((l) => l.id === id);
    if (!loc) throw new ValidationError("Centro no encontrado");
    if (status === "inactive" && ws.locations.filter((l) => l.status === "active").length <= 1) throw new ValidationError("Debe quedar al menos un centro activo");
    if (status === "inactive" && ws.cashSessions.some((s) => s.locationId === id && s.status === "open")) throw new ValidationError("Cierra la caja de este centro antes de desactivarlo");
    return {
      ...ws,
      locations: ws.locations.map((l) => (l.id === id ? { ...l, status } : l)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: status === "active" ? "activate" : "deactivate", entityType: "locations", entityId: id, entityLabel: loc.name })],
    };
  });
}

export function updatePaymentMethod(ctx: Ctx, id: string, patch: Partial<Pick<PaymentMethod, "name" | "status" | "affectsCashDrawer">>) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    const before = ws.paymentMethods.find((m) => m.id === id);
    if (!before) throw new ValidationError("Método no encontrado");
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError("El nombre es obligatorio");
    const after = { ...before, ...patch };
    const changes = diff(before, after);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      paymentMethods: ws.paymentMethods.map((m) => (m.id === id ? after : m)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "payment_methods", entityId: id, entityLabel: after.name, changes })],
    };
  });
}

export function addPaymentMethod(ctx: Ctx, name: string, kind: PaymentMethod["kind"]) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    if (!name.trim()) throw new ValidationError("El nombre es obligatorio");
    let key = normalizeKey(name).replace(/\s+/g, "_") || "metodo";
    while (ws.paymentMethods.some((m) => m.key === key)) key += "_2";
    const pm: PaymentMethod = {
      id: uid(), organizationId: ws.organization.id, key, name: name.trim(), kind, affectsCashDrawer: kind === "cash", status: "active",
      sortOrder: Math.max(0, ...ws.paymentMethods.filter((m) => m.key !== "unknown").map((m) => m.sortOrder)) + 1,
    };
    return {
      ...ws,
      paymentMethods: [...ws.paymentMethods, pm],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "payment_methods", entityId: pm.id, entityLabel: pm.name })],
    };
  });
}

export function addTaxRate(ctx: Ctx, name: string, rateBp: number) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    if (!name.trim()) throw new ValidationError("El nombre es obligatorio");
    if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new ValidationError("Tipo no válido");
    const t: TaxRate = { id: uid(), organizationId: ws.organization.id, name: name.trim(), rateBp, isDefault: false, status: "active" };
    return { ...ws, taxRates: [...ws.taxRates, t], auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "tax_rates", entityId: t.id, entityLabel: t.name })] };
  });
}

export function setDefaultTaxRate(ctx: Ctx, id: string) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => ({
    ...ws,
    taxRates: ws.taxRates.map((t) => ({ ...t, isDefault: t.id === id })),
    auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "tax_rates", entityId: id, entityLabel: "IVA por defecto" })],
  }));
}

export function updateActivityRules(ctx: Ctx, rules: ActivityRule[], requireCashSession: boolean) {
  assertCan(ctx, "settings.manage");
  ctx.store.update((ws) => {
    const before = ws.settings;
    const after = { ...ws.settings, activityRules: rules, requireCashSession };
    const changes = diff(before, after);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      settings: after,
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "organization_settings", entityLabel: "Configuración", changes })],
    };
  });
}
