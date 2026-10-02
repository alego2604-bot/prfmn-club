import type { AuditLog, Expense, ExpenseCategory, Supplier } from "@/domain/types";
import { duplicateSupplierInvoice, expenseAmounts } from "@/domain/expenses";
import { nowISO, uid } from "@/lib/ids";
import { classifyTaxId } from "@/lib/taxid";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";
import { assertCan, assertLocation, auditEntry, diff, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";
import { DEFAULT_EXPENSE_CATEGORIES } from "../workspace";

// ---------------------------------------------------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------------------------------------------------
export interface SupplierInput {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  defaultCategoryId?: string;
  notes?: string;
}

function supplierFields(ws: Workspace, input: SupplierInput, selfId?: string) {
  const name = input.name.trim();
  if (!name) throw new ValidationError("El nombre del proveedor es obligatorio");
  const email = input.email?.trim().toLowerCase() || undefined;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Email no válido");
  const tax = classifyTaxId(input.taxId);
  if (tax.normalized && ws.suppliers.some((s) => s.id !== selfId && s.status !== "archived" && s.taxIdNormalized === tax.normalized)) {
    throw new ValidationError(`Ya existe un proveedor con el NIF ${tax.normalized}`);
  }
  return {
    name, taxId: input.taxId?.trim() || undefined, taxIdNormalized: tax.normalized || undefined, email,
    phone: input.phone?.trim() || undefined, address: input.address?.trim() || undefined,
    defaultCategoryId: input.defaultCategoryId || undefined, notes: input.notes?.trim() || undefined,
  };
}

export function createSupplier(ctx: Ctx, input: SupplierInput): Supplier {
  assertCan(ctx, "expenses.manage");
  let created!: Supplier;
  ctx.store.update((ws) => {
    const now = nowISO();
    created = { id: uid(), organizationId: ws.organization.id, status: "active", createdAt: now, updatedAt: now, ...supplierFields(ws, input) };
    return {
      ...ws,
      suppliers: [...ws.suppliers, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "suppliers", entityId: created.id, entityLabel: created.name })],
    };
  });
  return created;
}

export function updateSupplier(ctx: Ctx, id: string, input: SupplierInput): Supplier {
  assertCan(ctx, "expenses.manage");
  let updated!: Supplier;
  ctx.store.update((ws) => {
    const before = ws.suppliers.find((s) => s.id === id);
    if (!before) throw new ValidationError("Proveedor no encontrado");
    updated = { ...before, ...supplierFields(ws, input, id), updatedAt: nowISO() };
    const changes = diff(before, updated, ["updatedAt", "taxIdNormalized"]);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      suppliers: ws.suppliers.map((s) => (s.id === id ? updated : s)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "suppliers", entityId: id, entityLabel: updated.name, changes })],
    };
  });
  return updated;
}

export function setSupplierStatus(ctx: Ctx, id: string, status: Supplier["status"]) {
  assertCan(ctx, "expenses.manage");
  ctx.store.update((ws) => {
    const s = ws.suppliers.find((x) => x.id === id);
    if (!s) throw new ValidationError("Proveedor no encontrado");
    if (s.status === status) return ws;
    return {
      ...ws,
      suppliers: ws.suppliers.map((x) => (x.id === id ? { ...x, status, updatedAt: nowISO() } : x)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: status === "archived" ? "archive" : "update", entityType: "suppliers", entityId: id, entityLabel: s.name })],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Categorías de gasto
// ---------------------------------------------------------------------------------------------------------------------
/** Crea las categorías sugeridas si la empresa aún no tiene ninguna (las empresas creadas en el servidor empiezan vacías). */
export function ensureExpenseCategories(ctx: Ctx): void {
  if (ctx.store.requireWorkspace().expenseCategories.length) return;
  assertCan(ctx, "expenses.manage");
  ctx.store.update((ws) => {
    if (ws.expenseCategories.length) return ws;
    return {
      ...ws,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ id: uid(), organizationId: ws.organization.id, name: c.name, defaultTaxRateBp: c.taxBp, status: "active" as const })),
    };
  });
}

export function createExpenseCategory(ctx: Ctx, name: string, defaultTaxRateBp?: number): ExpenseCategory {
  assertCan(ctx, "expenses.manage");
  const n = name.trim();
  if (!n) throw new ValidationError("Indica un nombre");
  let created!: ExpenseCategory;
  ctx.store.update((ws) => {
    if (ws.expenseCategories.some((c) => c.status === "active" && c.name.toLowerCase() === n.toLowerCase())) throw new ValidationError("Ya existe una categoría con ese nombre");
    created = { id: uid(), organizationId: ws.organization.id, name: n, defaultTaxRateBp, status: "active" };
    return {
      ...ws,
      expenseCategories: [...ws.expenseCategories, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "expense_categories", entityId: created.id, entityLabel: n })],
    };
  });
  return created;
}

export function updateExpenseCategory(ctx: Ctx, id: string, patch: Partial<Pick<ExpenseCategory, "name" | "defaultTaxRateBp" | "status">>) {
  assertCan(ctx, "expenses.manage");
  ctx.store.update((ws) => {
    const c = ws.expenseCategories.find((x) => x.id === id);
    if (!c) throw new ValidationError("Categoría no encontrada");
    const next = { ...c, ...patch, name: patch.name?.trim() || c.name };
    return {
      ...ws,
      expenseCategories: ws.expenseCategories.map((x) => (x.id === id ? next : x)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: patch.status === "archived" ? "archive" : "update", entityType: "expense_categories", entityId: id, entityLabel: next.name, changes: diff(c, next) })],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------------------------------------------------
export interface ExpenseInput {
  description: string;
  issueDate: string;
  dueDate?: string;
  /** Importe tal y como se introduce (con o sin IVA según `includesTax`) */
  amount: number;
  includesTax: boolean;
  taxRateBp: number;
  supplierId?: string;
  categoryId?: string;
  locationId?: string;
  supplierInvoiceNumber?: string;
  paymentMethodId?: string;
  paid: boolean;
  paidAt?: string;
  notes?: string;
}

function expenseFields(ws: Workspace, ctx: Ctx, input: ExpenseInput, selfId?: string) {
  const description = input.description.trim();
  if (!description) throw new ValidationError("Indica el concepto del gasto");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) throw new ValidationError("Fecha no válida");
  if (input.dueDate && input.dueDate < input.issueDate) throw new ValidationError("El vencimiento no puede ser anterior a la fecha");
  if (input.taxRateBp < 0 || input.taxRateBp > 10000) throw new ValidationError("Tipo de IVA no válido");
  if (input.locationId && !ws.locations.some((l) => l.id === input.locationId)) throw new ValidationError("Centro no válido");
  assertLocation(ctx, input.locationId);
  if (input.supplierId && !ws.suppliers.some((s) => s.id === input.supplierId)) throw new ValidationError("Proveedor no válido");
  if (input.categoryId && !ws.expenseCategories.some((c) => c.id === input.categoryId)) throw new ValidationError("Categoría no válida");
  if (input.paymentMethodId && !ws.paymentMethods.some((m) => m.id === input.paymentMethodId)) throw new ValidationError("Método de pago no válido");
  let amounts;
  try {
    amounts = expenseAmounts({ amount: input.amount, taxRateBp: input.taxRateBp, includesTax: input.includesTax });
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const fields = {
    description, issueDate: input.issueDate, dueDate: input.dueDate || undefined, ...amounts, taxRateBp: input.taxRateBp,
    supplierId: input.supplierId || undefined, categoryId: input.categoryId || undefined, locationId: input.locationId || undefined,
    supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || undefined, paymentMethodId: input.paymentMethodId || undefined,
    status: (input.paid ? "paid" : "pending") as Expense["status"],
    paidAt: input.paid ? input.paidAt ? new Date(`${input.paidAt}T12:00:00`).toISOString() : nowISO() : undefined,
    notes: input.notes?.trim() || undefined,
  };
  const dup = duplicateSupplierInvoice(ws.expenses, { id: selfId ?? "", supplierId: fields.supplierId, supplierInvoiceNumber: fields.supplierInvoiceNumber });
  if (dup) throw new ValidationError(`La factura ${fields.supplierInvoiceNumber} de este proveedor ya está registrada (${dup.description}, ${formatMoney(dup.total)})`);
  return fields;
}

export function createExpense(ctx: Ctx, input: ExpenseInput, opts: { importId?: string } = {}): Expense {
  assertCan(ctx, "expenses.manage");
  let created!: Expense;
  ctx.store.update((ws) => {
    const now = nowISO();
    created = {
      id: uid(), organizationId: ws.organization.id, source: opts.importId ? "import" : "manual", importId: opts.importId,
      createdBy: ctx.user.id, createdAt: now, updatedAt: now, ...expenseFields(ws, ctx, input),
    };
    return {
      ...ws,
      expenses: [...ws.expenses, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "expenses", entityId: created.id, entityLabel: `${created.description} · ${formatMoney(created.total)}` })],
    };
  });
  return created;
}

export function updateExpense(ctx: Ctx, id: string, input: ExpenseInput): Expense {
  assertCan(ctx, "expenses.manage");
  let updated!: Expense;
  ctx.store.update((ws) => {
    const before = ws.expenses.find((e) => e.id === id);
    if (!before) throw new ValidationError("Gasto no encontrado");
    if (before.status === "void") throw new ValidationError("Un gasto anulado no se edita");
    assertLocation(ctx, before.locationId);
    const fields = expenseFields(ws, ctx, input, id);
    // Si ya estaba pagado y sigue pagado, se conserva la fecha de pago original salvo que se indique otra
    if (before.status === "paid" && fields.status === "paid" && !input.paidAt) fields.paidAt = before.paidAt;
    updated = { ...before, ...fields, updatedAt: nowISO() };
    const changes = diff(before, updated, ["updatedAt"]);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      expenses: ws.expenses.map((e) => (e.id === id ? updated : e)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "update", entityType: "expenses", entityId: id, entityLabel: `${updated.description} · ${formatMoney(updated.total)}`, changes })],
    };
  });
  return updated;
}

export function markExpensePaid(ctx: Ctx, ids: string[], opts: { paymentMethodId?: string; paidAt?: string } = {}): number {
  assertCan(ctx, "expenses.manage");
  let n = 0;
  ctx.store.update((ws) => {
    const set = new Set(ids);
    const at = opts.paidAt ? new Date(`${opts.paidAt}T12:00:00`).toISOString() : nowISO();
    const logs: AuditLog[] = [];
    const expenses = ws.expenses.map((e) => {
      if (!set.has(e.id) || e.status !== "pending") return e;
      assertLocation(ctx, e.locationId);
      n++;
      logs.push(auditEntry(ws, ctx, { action: "payment", entityType: "expenses", entityId: e.id, entityLabel: `${e.description} · pagado ${formatMoney(e.total)}` }));
      return { ...e, status: "paid" as const, paidAt: at, paymentMethodId: opts.paymentMethodId ?? e.paymentMethodId, updatedAt: nowISO() };
    });
    if (!n) throw new ValidationError("No hay gastos pendientes en la selección");
    return { ...ws, expenses, auditLogs: [...ws.auditLogs, ...logs] };
  });
  return n;
}

/** Anular: el gasto se conserva en el histórico con motivo (nunca se borra). */
export function voidExpense(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "expenses.manage");
  if (!reason.trim()) throw new ValidationError("Indica el motivo de la anulación");
  ctx.store.update((ws) => {
    const e = ws.expenses.find((x) => x.id === id);
    if (!e) throw new ValidationError("Gasto no encontrado");
    if (e.status === "void") throw new ValidationError("El gasto ya está anulado");
    assertLocation(ctx, e.locationId);
    const now = nowISO();
    return {
      ...ws,
      expenses: ws.expenses.map((x) => (x.id === id ? { ...x, status: "void" as const, voidedAt: now, voidedBy: ctx.user.id, voidReason: reason.trim(), updatedAt: now } : x)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "void", entityType: "expenses", entityId: id, entityLabel: e.description, context: { reason: reason.trim() } })],
    };
  });
}

/** Datos para «Duplicar» (p. ej. un gasto recurrente: alquiler, software). Fecha de hoy, pendiente, sin nº de factura. */
export function expenseToInput(e: Expense, duplicate = false): ExpenseInput {
  return {
    description: e.description, issueDate: duplicate ? toISODate(new Date()) : e.issueDate, dueDate: duplicate ? undefined : e.dueDate,
    amount: e.total, includesTax: true, taxRateBp: e.taxRateBp ?? 0, supplierId: e.supplierId, categoryId: e.categoryId, locationId: e.locationId,
    supplierInvoiceNumber: duplicate ? undefined : e.supplierInvoiceNumber, paymentMethodId: e.paymentMethodId,
    paid: duplicate ? false : e.status === "paid", paidAt: !duplicate && e.paidAt ? e.paidAt.slice(0, 10) : undefined, notes: e.notes,
  };
}
