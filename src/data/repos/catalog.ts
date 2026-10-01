import type { CatalogStatus, Product, ProductCategory, ProductKind } from "@/domain/types";
import { nowISO, uid } from "@/lib/ids";
import { normalizeKey } from "@/lib/text";
import { assertCan, auditEntry, diff, ValidationError, type Ctx } from "../context";
import type { Workspace } from "../store";
import { CATEGORY_COLORS } from "../workspace";

export interface ProductInput {
  name: string;
  categoryId: string | null;
  kind: ProductKind;
  sku?: string;
  subcategory?: string;
  description?: string;
  price: number; // céntimos IVA incl.
  taxRateBp: number;
  cost?: number;
  trackStock: boolean;
  stockQuantity?: number;
  minStock?: number;
  posVisible: boolean;
}

function validateProduct(ws: Workspace, input: ProductInput, selfId?: string) {
  if (!input.name.trim()) throw new ValidationError("El nombre es obligatorio");
  if (!Number.isInteger(input.price) || input.price < 0) throw new ValidationError("Precio no válido");
  if (input.cost !== undefined && (!Number.isInteger(input.cost) || input.cost < 0)) throw new ValidationError("Coste no válido");
  if (input.taxRateBp < 0 || input.taxRateBp > 10000) throw new ValidationError("IVA no válido");
  if (input.categoryId && !ws.categories.some((c) => c.id === input.categoryId)) throw new ValidationError("Categoría inexistente");
  const sku = input.sku?.trim();
  if (sku && ws.products.some((p) => p.id !== selfId && p.status !== "archived" && p.sku?.toLowerCase() === sku.toLowerCase())) {
    throw new ValidationError(`El SKU ${sku} ya existe`);
  }
  const name = normalizeKey(input.name);
  if (ws.products.some((p) => p.id !== selfId && p.status !== "archived" && normalizeKey(p.name) === name)) {
    throw new ValidationError(`Ya existe un producto llamado "${input.name.trim()}"`);
  }
}

export function createCategory(ctx: Ctx, input: { name: string; color?: string; defaultTaxRateBp?: number }): ProductCategory {
  assertCan(ctx, "catalog.manage");
  let created!: ProductCategory;
  ctx.store.update((ws) => {
    if (!input.name.trim()) throw new ValidationError("El nombre es obligatorio");
    if (ws.categories.some((c) => c.status !== "archived" && normalizeKey(c.name) === normalizeKey(input.name))) {
      throw new ValidationError("Ya existe una categoría con ese nombre");
    }
    const now = nowISO();
    created = {
      id: uid(),
      organizationId: ws.organization.id,
      name: input.name.trim(),
      color: input.color ?? CATEGORY_COLORS[ws.categories.length % CATEGORY_COLORS.length]!,
      defaultTaxRateBp: input.defaultTaxRateBp,
      sortOrder: ws.categories.length,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    return {
      ...ws,
      categories: [...ws.categories, created],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "product_categories", entityId: created.id, entityLabel: created.name })],
    };
  });
  return created;
}

export function updateCategory(ctx: Ctx, id: string, patch: Partial<Pick<ProductCategory, "name" | "color" | "defaultTaxRateBp" | "status">>) {
  assertCan(ctx, "catalog.manage");
  ctx.store.update((ws) => {
    const before = ws.categories.find((c) => c.id === id);
    if (!before) throw new ValidationError("Categoría no encontrada");
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError("El nombre es obligatorio");
    const after = { ...before, ...patch, updatedAt: nowISO() };
    const changes = diff(before, after, ["updatedAt"]);
    if (!Object.keys(changes).length) return ws;
    return {
      ...ws,
      categories: ws.categories.map((c) => (c.id === id ? after : c)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: patch.status === "archived" ? "archive" : "update", entityType: "product_categories", entityId: id, entityLabel: after.name, changes })],
    };
  });
}

export function createProduct(ctx: Ctx, input: ProductInput, opts: { importId?: string } = {}): Product {
  assertCan(ctx, "catalog.manage");
  let created!: Product;
  ctx.store.update((ws) => {
    validateProduct(ws, input);
    const now = nowISO();
    created = {
      id: uid(),
      organizationId: ws.organization.id,
      categoryId: input.categoryId,
      name: input.name.trim(),
      sku: input.sku?.trim() || undefined,
      kind: input.kind,
      subcategory: input.subcategory?.trim() || undefined,
      description: input.description?.trim() || undefined,
      price: input.price,
      taxRateBp: input.taxRateBp,
      cost: input.cost,
      trackStock: input.trackStock,
      stockQuantity: input.trackStock ? input.stockQuantity ?? 0 : undefined,
      minStock: input.trackStock ? input.minStock : undefined,
      posVisible: input.posVisible,
      sortOrder: ws.products.length,
      status: "active",
      importId: opts.importId,
      createdAt: now,
      updatedAt: now,
    };
    return {
      ...ws,
      products: [...ws.products, created],
      productPrices: [
        ...ws.productPrices,
        { id: uid(), organizationId: ws.organization.id, productId: created.id, price: created.price, taxRateBp: created.taxRateBp, cost: created.cost, validFrom: now, changedBy: ctx.user.id },
      ],
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "insert", entityType: "products", entityId: created.id, entityLabel: created.name, context: opts.importId ? { importId: opts.importId } : undefined })],
    };
  });
  return created;
}

/** Editar producto. Si cambia precio/IVA/coste: se cierra la vigencia anterior y se abre otra (histórico intacto). */
export function updateProduct(ctx: Ctx, id: string, input: ProductInput, reason?: string): Product {
  assertCan(ctx, "catalog.manage");
  let updated!: Product;
  ctx.store.update((ws) => {
    const before = ws.products.find((p) => p.id === id);
    if (!before) throw new ValidationError("Producto no encontrado");
    validateProduct(ws, input, id);
    const now = nowISO();
    const priceChanged = before.price !== input.price || before.taxRateBp !== input.taxRateBp || before.cost !== input.cost;
    if ((before.price !== input.price || before.taxRateBp !== input.taxRateBp)) assertCan(ctx, "catalog.prices");
    updated = {
      ...before,
      name: input.name.trim(),
      categoryId: input.categoryId,
      kind: input.kind,
      sku: input.sku?.trim() || undefined,
      subcategory: input.subcategory?.trim() || undefined,
      description: input.description?.trim() || undefined,
      price: input.price,
      taxRateBp: input.taxRateBp,
      cost: input.cost,
      trackStock: input.trackStock,
      stockQuantity: input.trackStock ? input.stockQuantity ?? before.stockQuantity ?? 0 : undefined,
      minStock: input.trackStock ? input.minStock : undefined,
      posVisible: input.posVisible,
      updatedAt: now,
    };
    const changes = diff(before, updated, ["updatedAt"]);
    if (!Object.keys(changes).length) return ws;
    let productPrices = ws.productPrices;
    if (priceChanged) {
      productPrices = [
        ...productPrices.map((pp) => (pp.productId === id && !pp.validTo ? { ...pp, validTo: now } : pp)),
        { id: uid(), organizationId: ws.organization.id, productId: id, price: updated.price, taxRateBp: updated.taxRateBp, cost: updated.cost, validFrom: now, changedBy: ctx.user.id, reason },
      ];
    }
    return {
      ...ws,
      products: ws.products.map((p) => (p.id === id ? updated : p)),
      productPrices,
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: before.price !== updated.price ? "price_change" : "update", entityType: "products", entityId: id, entityLabel: updated.name, changes, context: reason ? { reason } : undefined }),
      ],
    };
  });
  return updated;
}

export function duplicateProduct(ctx: Ctx, id: string): Product {
  const ws = ctx.store.requireWorkspace();
  const src = ws.products.find((p) => p.id === id);
  if (!src) throw new ValidationError("Producto no encontrado");
  let name = `${src.name} (copia)`;
  for (let i = 2; ws.products.some((p) => normalizeKey(p.name) === normalizeKey(name)); i++) name = `${src.name} (copia ${i})`;
  return createProduct(ctx, {
    name, categoryId: src.categoryId, kind: src.kind, sku: undefined, subcategory: src.subcategory, description: src.description,
    price: src.price, taxRateBp: src.taxRateBp, cost: src.cost, trackStock: src.trackStock, stockQuantity: 0, minStock: src.minStock,
    posVisible: src.posVisible,
  });
}

/** Activar / desactivar / archivar. Nunca se borra un producto (puede tener ventas históricas). */
export function setProductStatus(ctx: Ctx, id: string, status: CatalogStatus) {
  assertCan(ctx, "catalog.manage");
  ctx.store.update((ws) => {
    const before = ws.products.find((p) => p.id === id);
    if (!before) throw new ValidationError("Producto no encontrado");
    if (before.status === status) return ws;
    const after = { ...before, status, updatedAt: nowISO() };
    return {
      ...ws,
      products: ws.products.map((p) => (p.id === id ? after : p)),
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, { action: status === "archived" ? "archive" : status === "inactive" ? "deactivate" : "activate", entityType: "products", entityId: id, entityLabel: before.name, changes: { status: { from: before.status, to: status } } }),
      ],
    };
  });
}

export function productUsage(ws: Workspace, productId: string): { sales: number; units: number } {
  let sales = 0;
  let units = 0;
  for (const it of ws.saleItems) {
    if (it.productId === productId) {
      sales++;
      units += it.quantity;
    }
  }
  return { sales, units };
}
