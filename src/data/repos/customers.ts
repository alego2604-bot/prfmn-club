import type { Customer, CustomerNote, CustomerStatus } from "@/domain/types";
import { nowISO, uid, } from "@/lib/ids";
import { classifyTaxId } from "@/lib/taxid";
import { toISODate } from "@/lib/dates";
import { assertCan, auditEntry, diff, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";

export interface CustomerInput {
  firstName: string;
  lastName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  companyName?: string;
  status: CustomerStatus;
  source?: string;
  joinedAt?: string;
  leftAt?: string;
}

export function customerName(c: Pick<Customer, "firstName" | "lastName">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ");
}

function normalizeInput(ws: Workspace, input: CustomerInput, selfId?: string) {
  if (!input.firstName.trim()) throw new ValidationError("El nombre es obligatorio");
  const email = input.email?.trim().toLowerCase() || undefined;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Email no válido");
  const tax = classifyTaxId(input.taxId);
  if (tax.normalized && ws.customers.some((c) => c.id !== selfId && !c.deletedAt && c.taxIdNormalized === tax.normalized)) {
    throw new ValidationError(`Ya existe un cliente con el NIF ${tax.normalized}`);
  }
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName?.trim() || undefined,
    taxId: input.taxId?.trim() || undefined,
    taxIdNormalized: tax.normalized || undefined,
    taxIdValid: tax.kind === "empty" ? undefined : tax.valid,
    email,
    phone: input.phone?.trim() || undefined,
    birthDate: input.birthDate || undefined,
    address: input.address?.trim() || undefined,
    postalCode: input.postalCode?.trim() || undefined,
    city: input.city?.trim() || undefined,
    companyName: input.companyName?.trim() || undefined,
    status: input.status,
    source: input.source?.trim() || undefined,
    joinedAt: input.joinedAt || undefined,
    leftAt: input.leftAt || undefined,
  };
}

export function createCustomer(ctx: Ctx, input: CustomerInput): Customer {
  assertCan(ctx, "customers.manage");
  let created!: Customer;
  ctx.store.update((ws) => {
    const now = nowISO();
    created = {
      id: uid(), organizationId: ws.organization.id, tags: [], createdAt: now, updatedAt: now,
      ...normalizeInput(ws, { ...input, joinedAt: input.joinedAt ?? (input.status === "active" ? toISODate(new Date()) : undefined) }),
    };
    return {
      ...ws,
      customers: [...ws.customers, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "customers", entityId: created.id, entityLabel: customerName(created) })],
    };
  });
  return created;
}

export function updateCustomer(ctx: Ctx, id: string, input: CustomerInput): Customer {
  assertCan(ctx, "customers.manage");
  let updated!: Customer;
  ctx.store.update((ws) => {
    const before = ws.customers.find((c) => c.id === id);
    if (!before) throw new ValidationError("Cliente no encontrado");
    updated = { ...before, ...normalizeInput(ws, input, id), updatedAt: nowISO() };
    if (before.status !== "cancelled" && updated.status === "cancelled" && !updated.leftAt) updated.leftAt = toISODate(new Date());
    const changes = diff(before, updated, ["updatedAt"]);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      customers: ws.customers.map((c) => (c.id === id ? updated : c)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "customers", entityId: id, entityLabel: customerName(updated), changes })],
    };
  });
  return updated;
}

export function addCustomerNote(ctx: Ctx, customerId: string, body: string, opts: { pinned?: boolean; suppressAlertsUntil?: string } = {}): CustomerNote {
  assertCan(ctx, "customers.manage");
  if (!body.trim()) throw new ValidationError("La nota está vacía");
  let note!: CustomerNote;
  ctx.store.update((ws) => {
    const c = ws.customers.find((x) => x.id === customerId);
    if (!c) throw new ValidationError("Cliente no encontrado");
    note = {
      id: uid(), organizationId: ws.organization.id, customerId, authorId: ctx.user.id, body: body.trim(), pinned: !!opts.pinned,
      suppressAlertsUntil: opts.suppressAlertsUntil || undefined, createdAt: nowISO(),
    };
    return {
      ...ws,
      customerNotes: [...ws.customerNotes, note],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "note", entityType: "customers", entityId: customerId, entityLabel: customerName(c) })],
    };
  });
  return note;
}

export function findCustomerByTaxId(ws: Workspace, taxId: string | undefined) {
  const n = classifyTaxId(taxId).normalized;
  return n ? ws.customers.find((c) => !c.deletedAt && c.taxIdNormalized === n) : undefined;
}
