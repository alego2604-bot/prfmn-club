import { assertCan, assertLocation, auditEntry, ValidationError, type Ctx } from "@/data/context";
import type { Workspace } from "@/data/store";
import { CATEGORY_COLORS } from "@/data/workspace";
import { computeLine } from "@/domain/pricing";
import type { Customer, ImportJob, ImportRecordRow, Invoice, InvoiceItem, Payment, Product, ProductCategory, Sale, SaleItem } from "@/domain/types";
import { toISODate } from "@/lib/dates";
import { nowISO, uid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { normalizeKey } from "@/lib/text";
import { classifyTaxId } from "@/lib/taxid";
import { suggestKind, suggestTaxRate } from "./salesPlan";
import { hasModule } from "@/domain/modules";
import type { ImportPlan, InvoiceRow, PlanSummary, SalesRow } from "./types";

export function isImportable(r: SalesRow | InvoiceRow): boolean {
  if (r.decision !== "import" || r.status === "error") return false;
  if (r.type === "sale") return r.product.kind !== "none" && r.occurredAt !== null && r.total !== null;
  return r.issueDate !== null && r.total !== null;
}

export function summarizePlan(plan: ImportPlan, ws: Workspace): PlanSummary {
  const rows = plan.rows;
  const importable = rows.filter(isImportable);
  const newProducts = new Set<string>();
  for (const c of plan.catalog) if (c.decision === "import" && c.status === "valid" && !c.existingProductId) newProducts.add(normalizeKey(c.name));
  const newCustomers = new Set<string>();
  for (const r of importable) {
    if (r.type === "sale" && r.product.kind === "new") newProducts.add(normalizeKey(r.product.name));
    if (r.type === "invoice" && r.customer.kind === "new") newCustomers.add(r.customer.groupKey);
  }
  void ws;
  return {
    found: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    review: rows.filter((r) => r.status === "review").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    errors: rows.filter((r) => r.status === "error").length,
    toImport: importable.length,
    ignored: rows.length - importable.length,
    nonData: plan.nonDataRows.length,
    amountToImport: importable.reduce((s, r) => s + (r.total ?? 0), 0),
    newProducts: newProducts.size,
    newCustomers: newCustomers.size,
    highConfidence: importable.filter((r) => r.confidence === "high").length,
    mediumConfidence: importable.filter((r) => r.confidence === "medium").length,
  };
}

export interface FileMeta {
  name: string;
  sha256: string;
  size: number;
}

/** Ejecuta la importación en UNA transacción: o se crea todo o nada. */
export function commitPlan(ctx: Ctx, plan: ImportPlan, file: FileMeta): ImportJob {
  assertCan(ctx, "imports.run");
  assertLocation(ctx, plan.options.locationId);
  let job!: ImportJob;
  ctx.store.update((ws0) => {
    if (!ws0.locations.some((l) => l.id === plan.options.locationId)) throw new ValidationError("Centro no válido");
    const importId = uid();
    const now = nowISO();
    const org = ws0.organization.id;
    const summary = summarizePlan(plan, ws0);
    const created: Record<string, number> = {};
    const bump = (k: string, n = 1) => (created[k] = (created[k] ?? 0) + n);
    const records: ImportRecordRow[] = [];

    const categories: ProductCategory[] = [...ws0.categories];
    const products: Product[] = [...ws0.products];
    const productPrices = [...ws0.productPrices];
    const catByKey = new Map(categories.filter((c) => c.status !== "archived").map((c) => [normalizeKey(c.name), c]));
    const prodByKey = new Map(products.filter((p) => p.status !== "archived").map((p) => [normalizeKey(p.name), p]));

    const ensureCategory = (name: string): ProductCategory | undefined => {
      const n = name.trim();
      if (!n) return undefined;
      const k = normalizeKey(n);
      let c = catByKey.get(k);
      if (!c) {
        c = {
          id: uid(), organizationId: org, name: n, color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]!,
          defaultTaxRateBp: suggestTaxRate(n), sortOrder: categories.length, status: "active", createdAt: now, updatedAt: now,
        };
        categories.push(c);
        catByKey.set(k, c);
        bump("categorías");
      }
      return c;
    };
    const ensureProduct = (name: string, categoryName: string, price: number, taxRateBp?: number, kind?: Product["kind"]): Product => {
      const k = normalizeKey(name);
      let p = prodByKey.get(k);
      if (!p) {
        const cat = ensureCategory(categoryName || "Sin categoría");
        p = {
          id: uid(), organizationId: org, categoryId: cat?.id ?? null, name: name.trim(), kind: kind ?? suggestKind(name, categoryName, hasModule(ws0.organization, "fitness")),
          price, taxRateBp: taxRateBp ?? cat?.defaultTaxRateBp ?? suggestTaxRate(categoryName), trackStock: false, posVisible: true,
          sortOrder: products.length, status: "active", importId, createdAt: now, updatedAt: now,
        };
        products.push(p);
        prodByKey.set(k, p);
        productPrices.push({ id: uid(), organizationId: org, productId: p.id, price: p.price, taxRateBp: p.taxRateBp, validFrom: now, changedBy: ctx.user.id, reason: "Importación" });
        bump("productos");
      }
      return p;
    };

    // 1. Catálogo
    for (const c of plan.catalog) {
      if (c.decision === "import" && c.status === "valid" && !c.existingProductId && c.price !== null) {
        const p = ensureProduct(c.name, c.categoryName, c.price, c.taxRateBp, c.kind);
        records.push({ id: uid(), organizationId: org, importId, sheet: c.sheet, rowNumber: c.rowNumber, status: "imported", confidence: c.confidence, messages: c.issues.map((i) => i.text), entityType: "products", entityId: p.id, action: "created" });
      } else {
        records.push({ id: uid(), organizationId: org, importId, sheet: c.sheet, rowNumber: c.rowNumber, status: c.existingProductId ? "ignored" : c.status === "duplicate" ? "duplicate" : c.status === "error" ? "error" : "ignored", messages: c.issues.map((i) => i.text), entityType: c.existingProductId ? "products" : undefined, entityId: c.existingProductId, action: c.existingProductId ? "linked" : "skipped" });
      }
    }

    const methods = new Map(ws0.paymentMethods.map((m) => [m.key, m]));
    let ws: Workspace = ws0;

    if (plan.kind === "sales") {
      const sales: Sale[] = [];
      const items: SaleItem[] = [];
      const payments: Payment[] = [];
      let counter = ws0.counters.sale ?? 0;
      for (const r of plan.rows as SalesRow[]) {
        if (!isImportable(r)) {
          records.push({ id: uid(), organizationId: org, importId, sheet: r.sheet, rowNumber: r.rowNumber, status: r.status === "duplicate" ? "duplicate" : r.status === "error" ? "error" : "ignored", confidence: r.confidence, messages: r.issues.map((i) => i.text), action: "skipped" });
          continue;
        }
        const product = r.product.kind === "existing" ? products.find((p) => p.id === (r.product as { id: string }).id)! : ensureProduct((r.product as { name: string }).name, r.categoryName, r.unitPrice ?? r.total!);
        const cat = categories.find((c) => c.id === product.categoryId);
        const unitPrice = r.unitPrice ?? r.total!;
        const gross = Math.round(unitPrice * r.quantity!);
        const line = computeLine({ unitPrice, quantity: r.quantity!, discount: Math.max(0, gross - r.total!), taxRateBp: product.taxRateBp });
        const saleId = uid();
        counter++;
        sales.push({
          id: saleId, organizationId: org, locationId: plan.options.locationId, number: counter, occurredAt: r.occurredAt!.toISOString(), timePrecision: r.timePrecision,
          granularity: r.granularity, subtotal: line.baseAmount, taxTotal: line.taxAmount, discountTotal: line.gross - line.total, total: line.total,
          status: "completed", source: "import", importId, notes: r.granularity === "aggregate" ? "Resumen mensual importado" : undefined, createdAt: now,
        });
        items.push({
          id: uid(), organizationId: org, saleId, productId: product.id, productName: product.name, productKind: product.kind, categoryId: cat?.id, categoryName: cat?.name,
          quantity: r.quantity!, unitPrice, discount: line.gross - line.total, taxRateBp: product.taxRateBp, baseAmount: line.baseAmount, taxAmount: line.taxAmount, total: line.total,
        });
        const m = r.methodKey ? methods.get(r.methodKey) : undefined;
        if (m) {
          payments.push({ id: uid(), organizationId: org, locationId: plan.options.locationId, kind: "charge", saleId, paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind, amount: line.total, status: "succeeded", paidAt: r.occurredAt!.toISOString(), source: "import", importId, createdAt: now });
        }
        records.push({ id: uid(), organizationId: org, importId, sheet: r.sheet, rowNumber: r.rowNumber, status: "imported", confidence: r.confidence, messages: r.issues.map((i) => i.text), entityType: "sales", entityId: saleId, action: "created" });
      }
      bump("ventas", sales.length);
      ws = { ...ws0, sales: [...ws0.sales, ...sales], saleItems: [...ws0.saleItems, ...items], payments: [...ws0.payments, ...payments], counters: { ...ws0.counters, sale: counter } };
    } else {
      const customers: Customer[] = [...ws0.customers];
      const groupToCustomer = new Map<string, Customer>();
      const invoices: Invoice[] = [];
      const invItems: InvoiceItem[] = [];
      const payments: Payment[] = [];
      for (const r of plan.rows as InvoiceRow[]) {
        if (!isImportable(r)) {
          records.push({ id: uid(), organizationId: org, importId, sheet: r.sheet, rowNumber: r.rowNumber, status: r.status === "duplicate" ? "duplicate" : r.status === "error" ? "error" : "ignored", confidence: r.confidence, messages: r.issues.map((i) => i.text), action: "skipped" });
          continue;
        }
        let customerId: string;
        if (r.customer.kind === "existing") customerId = r.customer.id;
        else {
          let c = groupToCustomer.get(r.customer.groupKey);
          if (!c) {
            const parts = r.customerName.split(" ");
            const tax = classifyTaxId(r.taxId);
            c = {
              id: uid(), organizationId: org, firstName: parts[0] ?? r.customerName, lastName: parts.slice(1).join(" ") || undefined,
              taxId: r.taxId || undefined, taxIdNormalized: tax.normalized || undefined, taxIdValid: tax.kind === "empty" ? undefined : tax.valid,
              status: "active", source: "import", joinedAt: r.issueDate ? toISODate(r.issueDate) : undefined, tags: [], importId, createdAt: now, updatedAt: now,
            };
            customers.push(c);
            groupToCustomer.set(r.customer.groupKey, c);
            bump("clientes");
          } else if (r.issueDate && c.joinedAt && toISODate(r.issueDate) < c.joinedAt) {
            c.joinedAt = toISODate(r.issueDate);
          }
          customerId = c.id;
        }
        const invoiceId = uid();
        const m = methods.get(r.methodKey ?? "unknown") ?? methods.get("unknown")!;
        const issue = toISODate(r.issueDate!);
        const paidAt = new Date(r.issueDate!.getFullYear(), r.issueDate!.getMonth(), r.issueDate!.getDate(), 12).toISOString();
        invoices.push({
          id: invoiceId, organizationId: org, locationId: plan.options.locationId, series: r.series || undefined, externalNumber: r.number, issueDate: issue,
          customerId, customerName: r.customerName, customerTaxId: r.taxId || undefined, concept: r.planName || r.concept,
          servicePeriodStart: r.servicePeriod ? toISODate(r.servicePeriod.start) : undefined, servicePeriodEnd: r.servicePeriod ? toISODate(r.servicePeriod.end) : undefined,
          subtotal: r.subtotal!, taxTotal: r.taxTotal!, total: r.total!, amountPaid: r.invoiceStatus === "paid" ? r.total! : 0, status: r.invoiceStatus,
          paymentMethodId: m.id, paidAt: r.invoiceStatus === "paid" ? paidAt : undefined, notes: r.description || undefined, source: "import", importId, createdAt: now,
          voidedAt: r.invoiceStatus === "void" ? now : undefined, voidReason: r.invoiceStatus === "void" ? "Anulada en el sistema de origen" : undefined,
        });
        invItems.push({
          id: uid(), organizationId: org, invoiceId, description: [r.concept, r.description].filter(Boolean).join(" · "), quantity: 1, unitPrice: r.total!,
          taxRateBp: r.taxRateBp, baseAmount: r.subtotal!, taxAmount: r.taxTotal!, total: r.total!,
        });
        if (r.invoiceStatus === "paid") {
          payments.push({ id: uid(), organizationId: org, locationId: plan.options.locationId, kind: "charge", invoiceId, customerId, paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind, amount: r.total!, status: "succeeded", paidAt, source: "import", importId, createdAt: now });
        }
        records.push({ id: uid(), organizationId: org, importId, sheet: r.sheet, rowNumber: r.rowNumber, status: "imported", confidence: r.confidence, messages: r.issues.map((i) => i.text), entityType: "invoices", entityId: invoiceId, action: "created" });
      }
      bump("facturas", invoices.length);
      ws = { ...ws0, customers, invoices: [...ws0.invoices, ...invoices], invoiceItems: [...ws0.invoiceItems, ...invItems], payments: [...ws0.payments, ...payments] };
    }

    job = {
      id: importId, organizationId: org, locationId: plan.options.locationId, kind: plan.kind, fileName: file.name, fileSha256: file.sha256, fileSize: file.size,
      status: "completed", summary: { found: summary.found, valid: summary.valid, review: summary.review, duplicates: summary.duplicates, errors: summary.errors, ignored: summary.ignored, created, linked: 0, totalAmount: summary.amountToImport },
      createdBy: ctx.user.id, createdAt: now,
    };
    return {
      ...ws,
      categories,
      products,
      productPrices,
      imports: [...ws.imports, job],
      importRecords: [...ws.importRecords, ...records],
      auditLogs: [
        ...ws.auditLogs,
        auditEntry(ws, ctx, {
          action: "import", entityType: "imports", entityId: importId,
          entityLabel: `${file.name} · ${Object.entries(created).map(([k, v]) => `${v} ${k}`).join(", ")} · ${formatMoney(summary.amountToImport)}`,
        }),
      ],
    };
  });
  return job;
}

/** ¿Se puede revertir sin romper nada? Devuelve los motivos de bloqueo. */
export function revertBlockers(ws: Workspace, importId: string): string[] {
  const job = ws.imports.find((i) => i.id === importId);
  if (!job) return ["Importación no encontrada"];
  if (job.status === "reverted") return ["Ya está revertida"];
  const blockers: string[] = [];
  const invIds = new Set(ws.invoices.filter((i) => i.importId === importId).map((i) => i.id));
  const laterPayments = ws.payments.filter((p) => p.invoiceId && invIds.has(p.invoiceId) && p.importId !== importId && p.kind === "charge");
  if (laterPayments.length) blockers.push(`${laterPayments.length} factura(s) importadas se han cobrado después en el sistema`);
  const saleIds = new Set(ws.sales.filter((s) => s.importId === importId).map((s) => s.id));
  const inClosed = ws.sales.filter((s) => saleIds.has(s.id) && s.cashSessionId).length;
  if (inClosed) blockers.push(`${inClosed} venta(s) pertenecen a un cierre de caja`);
  return blockers;
}

/**
 * Revertir: nada se borra. Ventas y facturas creadas quedan ANULADAS con motivo; pagos compensados;
 * clientes y productos creados se archivan solo si nadie más los usa.
 */
export function revertImport(ctx: Ctx, importId: string, reason: string) {
  assertCan(ctx, "imports.revert");
  if (!reason.trim()) throw new ValidationError("Indica el motivo");
  ctx.store.update((ws) => {
    const blockers = revertBlockers(ws, importId);
    if (blockers.length) throw new ValidationError(`No se puede revertir: ${blockers.join("; ")}`);
    const now = nowISO();
    const why = `Importación revertida: ${reason.trim()}`;
    const sales = ws.sales.map((s) => (s.importId === importId && s.status !== "voided" ? { ...s, status: "voided" as const, voidedAt: now, voidedBy: ctx.user.id, voidReason: why } : s));
    const invoices = ws.invoices.map((i) => (i.importId === importId && i.status !== "void" ? { ...i, status: "void" as const, voidedAt: now, voidReason: why } : i));
    const refunds: Payment[] = ws.payments
      .filter((p) => p.importId === importId && p.kind === "charge")
      .map((p) => ({ ...p, id: uid(), kind: "refund", refundOfPaymentId: p.id, paidAt: now, createdAt: now, reference: why }));
    const activeSaleProductIds = new Set(
      ws.saleItems.filter((it) => {
        const s = ws.sales.find((x) => x.id === it.saleId);
        return s && s.importId !== importId && s.status !== "voided";
      }).map((it) => it.productId),
    );
    const usedCustomerIds = new Set([
      ...ws.invoices.filter((i) => i.importId !== importId && i.status !== "void").map((i) => i.customerId),
      ...ws.sales.filter((s) => s.importId !== importId).map((s) => s.customerId),
      ...ws.customerNotes.map((n) => n.customerId),
    ]);
    const products = ws.products.map((p) => (p.importId === importId && !activeSaleProductIds.has(p.id) ? { ...p, status: "archived" as const, updatedAt: now } : p));
    const customers = ws.customers.map((c) => (c.importId === importId && !usedCustomerIds.has(c.id) ? { ...c, deletedAt: now, updatedAt: now } : c));
    const job = ws.imports.find((i) => i.id === importId)!;
    return {
      ...ws,
      sales,
      invoices,
      products,
      customers,
      payments: [...ws.payments, ...refunds],
      imports: ws.imports.map((i) => (i.id === importId ? { ...i, status: "reverted" as const, revertedAt: now, revertedBy: ctx.user.id, revertReason: reason.trim() } : i)),
      auditLogs: [...ws.auditLogs, auditEntry(ws, ctx, { action: "revert", entityType: "imports", entityId: importId, entityLabel: job.fileName, context: { reason: reason.trim() } })],
    };
  });
}
