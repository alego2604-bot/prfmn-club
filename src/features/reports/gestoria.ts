/**
 * Paquete para la gestoría. Datos puros (sin UI) → hojas exportables a XLSX / CSV / PDF.
 * Criterios: ventas por fecha de operación; facturas por FECHA DE EMISIÓN (IVA); anuladas fuera de totales pero listadas.
 */
import type { Workspace } from "@/data/store";
import { customerName } from "@/data/repos/customers";
import { addDays, inPeriod, quarterOf, toISODate, type Period } from "@/lib/dates";
import { formatRate, NUM } from "@/lib/money";
import { euros, slugFile, type ExportSheet } from "@/lib/export";

export interface GestoriaReport {
  fileBase: string;
  title: string;
  periodLabel: string;
  kpis: { label: string; value: number; format: "money" | "integer" }[];
  vat: { source: string; rateBp: number; base: number; tax: number; total: number }[];
  sheets: ExportSheet[];
  warnings: string[];
}

export function periodFileLabel(p: Period): string {
  const s = p.start;
  const e = addDays(p.end, -1);
  if (s.getDate() === 1 && p.end.getDate() === 1) {
    const months = (p.end.getFullYear() - s.getFullYear()) * 12 + p.end.getMonth() - s.getMonth();
    if (months === 3 && s.getMonth() % 3 === 0) return `Q${quarterOf(s)}_${s.getFullYear()}`;
    if (months === 12 && s.getMonth() === 0) return `${s.getFullYear()}`;
    if (months === 1) return `${s.getFullYear()}_${String(s.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${toISODate(s)}_${toISODate(e)}`;
}

/** `canSensitive: false` → el workspace llega sin NIF de clientes: no se avisa de «facturas sin NIF» (sería un falso aviso). */
export function buildGestoriaReport(ws: Workspace, p: Period, locationId?: string, opts: { canSensitive?: boolean } = {}): GestoriaReport {
  const inP = (iso?: string) => !!iso && inPeriod(iso.length === 10 ? new Date(`${iso}T00:00`).toISOString() : iso, p);
  const loc = (id?: string) => !locationId || !id || id === locationId;
  const methodByKey = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
  const methodById = new Map(ws.paymentMethods.map((m) => [m.id, m.name]));
  const locName = new Map(ws.locations.map((l) => [l.id, l.name]));

  const salesAll = ws.sales.filter((s) => inP(s.occurredAt) && loc(s.locationId)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const sales = salesAll.filter((s) => s.status !== "voided");
  const saleIds = new Set(sales.map((s) => s.id));
  const saleById = new Map(salesAll.map((s) => [s.id, s]));
  const itemsAll = ws.saleItems.filter((i) => saleById.has(i.saleId));
  const items = itemsAll.filter((i) => saleIds.has(i.saleId));
  const paysBySale = new Map<string, string[]>();
  for (const pay of ws.payments) if (pay.saleId && pay.kind === "charge") paysBySale.set(pay.saleId, [...(paysBySale.get(pay.saleId) ?? []), pay.methodKey]);
  const invAll = ws.invoices.filter((i) => i.status !== "draft" && inP(i.issueDate) && loc(i.locationId)).sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? "") || (a.number ?? a.externalNumber ?? "").localeCompare(b.number ?? b.externalNumber ?? ""));
  const inv = invAll.filter((i) => i.status !== "void" && !i.saleId);
  const invItems = ws.invoiceItems.filter((it) => inv.some((i) => i.id === it.invoiceId));

  // IVA por tipo y origen
  const vatMap = new Map<string, { source: string; rateBp: number; base: number; tax: number; total: number }>();
  const addVat = (source: string, rateBp: number, base: number, tax: number, total: number) => {
    const k = `${source}|${rateBp}`;
    const r = vatMap.get(k) ?? { source, rateBp, base: 0, tax: 0, total: 0 };
    r.base += base; r.tax += tax; r.total += total;
    vatMap.set(k, r);
  };
  for (const it of items) addVat("Ventas de caja (tickets)", it.taxRateBp, it.baseAmount, it.taxAmount, it.total);
  for (const it of invItems) addVat("Facturas emitidas", it.taxRateBp, it.baseAmount, it.taxAmount, it.total);
  // Facturas sin líneas de detalle (solo cabecera): el tipo se deduce de su base y cuota, redondeado al tipo legal más cercano
  const withItems = new Set(invItems.map((it) => it.invoiceId));
  for (const i of inv) {
    if (withItems.has(i.id)) continue;
    addVat("Facturas emitidas", inferRateBp(i.subtotal, i.taxTotal), i.subtotal, i.taxTotal, i.total);
  }
  const vat = [...vatMap.values()].sort((a, b) => a.source.localeCompare(b.source) || b.rateBp - a.rateBp);

  const salesTotal = sales.reduce((s, x) => s + x.total, 0);
  const invTotal = inv.reduce((s, x) => s + x.total, 0);
  const pending = inv.filter((i) => i.status === "issued" || i.status === "partially_paid");
  const closings = ws.cashClosings.filter((c) => !c.supersededAt && inP(c.closedAt) && loc(ws.cashSessions.find((s) => s.id === c.cashSessionId)?.locationId));

  const kpis: GestoriaReport["kpis"] = [
    { label: "Ingresos totales (IVA incl.)", value: salesTotal + invTotal, format: "money" },
    { label: "Base imponible total", value: vat.reduce((s, v) => s + v.base, 0), format: "money" },
    { label: "IVA repercutido total", value: vat.reduce((s, v) => s + v.tax, 0), format: "money" },
    { label: "Ventas de caja", value: salesTotal, format: "money" },
    { label: "Facturas emitidas", value: invTotal, format: "money" },
    { label: "Nº facturas", value: inv.length, format: "integer" },
    { label: "Nº operaciones de caja", value: sales.filter((s) => s.granularity === "transaction").length, format: "integer" },
    { label: "Pendiente de cobro", value: pending.reduce((s, i) => s + i.total - i.amountPaid, 0), format: "money" },
    { label: "Ventas anuladas (excluidas)", value: salesAll.length - sales.length, format: "integer" },
    { label: "Facturas anuladas (excluidas)", value: invAll.filter((i) => i.status === "void").length, format: "integer" },
  ];

  const warnings: string[] = [];
  if (sales.some((s) => s.granularity === "aggregate")) warnings.push("Incluye resúmenes mensuales importados (sin detalle por ticket).");
  if (sales.some((s) => s.source === "import" && !paysBySale.has(s.id))) warnings.push("Hay ventas importadas sin método de pago (el Excel de origen no lo indicaba).");
  if (ws.products.some((p) => p.importId && p.taxRateBp === 1000)) warnings.push("El IVA de algunos productos importados es una propuesta por categoría (10 %): pendiente de validar.");
  if (opts.canSensitive !== false && inv.some((i) => !i.customerTaxId)) warnings.push(`${inv.filter((i) => !i.customerTaxId).length} facturas sin NIF del cliente.`);
  // Gastos (facturas recibidas) por fecha de factura: IVA soportado
  const expAll = ws.expenses.filter((e) => inP(e.issueDate) && loc(e.locationId)).sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const exps = expAll.filter((e) => e.status !== "void");
  const supName = new Map(ws.suppliers.map((x) => [x.id, x]));
  const expCat = new Map(ws.expenseCategories.map((x) => [x.id, x.name]));
  const inputVat = new Map<number, { base: number; tax: number; total: number }>();
  for (const e of exps) {
    const rate = e.taxRateBp ?? inferRateBp(e.subtotal, e.taxTotal);
    const r = inputVat.get(rate) ?? { base: 0, tax: 0, total: 0 };
    r.base += e.subtotal; r.tax += e.taxTotal; r.total += e.total;
    inputVat.set(rate, r);
  }
  const inputTax = exps.reduce((t, e) => t + e.taxTotal, 0);
  kpis.push(
    { label: "Gastos (base imponible)", value: exps.reduce((t, e) => t + e.subtotal, 0), format: "money" },
    { label: "IVA soportado", value: inputTax, format: "money" },
    { label: "Posición IVA estimada (repercutido − soportado)", value: vat.reduce((s, v) => s + v.tax, 0) - inputTax, format: "money" },
  );
  if (!ws.expenses.length) warnings.push("No hay gastos registrados: el IVA soportado no está incluido.");
  if (exps.some((e) => !e.supplierId)) warnings.push(`${exps.filter((e) => !e.supplierId).length} gastos sin proveedor asignado.`);
  if (exps.some((e) => e.supplierId && !supName.get(e.supplierId)?.taxId)) warnings.push("Hay gastos de proveedores sin NIF registrado.");

  const title = `${ws.organization.name} · ${p.label}`;
  const sub = `Periodo ${p.start.toLocaleDateString("es-ES")} – ${addDays(p.end, -1).toLocaleDateString("es-ES")}${locationId ? ` · ${locName.get(locationId)}` : ""} · generado ${new Date().toLocaleString("es-ES", NUM)}`;

  // Caja diaria
  const methodKeys = [...new Set([...ws.paymentMethods.filter((m) => m.status === "active").map((m) => m.key), "unknown"])];
  const days = new Map<string, { n: number; total: number; by: Record<string, number> }>();
  for (const s of sales) {
    const d = toISODate(new Date(s.occurredAt));
    const r = days.get(d) ?? { n: 0, total: 0, by: {} };
    r.n += s.granularity === "transaction" ? 1 : 0;
    r.total += s.total;
    const ps = ws.payments.filter((x) => x.saleId === s.id && x.kind === "charge");
    if (!ps.length) r.by.unknown = (r.by.unknown ?? 0) + s.total;
    for (const x of ps) r.by[x.methodKey] = (r.by[x.methodKey] ?? 0) + x.amount;
    days.set(d, r);
  }
  const dayRows = [...days.entries()].sort();

  // Categorías y productos
  const cat = new Map<string, { units: number; base: number; tax: number; total: number }>();
  const prod = new Map<string, { cat: string; units: number; total: number }>();
  for (const it of items) {
    const c = cat.get(it.categoryName ?? "Sin categoría") ?? { units: 0, base: 0, tax: 0, total: 0 };
    c.units += it.quantity; c.base += it.baseAmount; c.tax += it.taxAmount; c.total += it.total;
    cat.set(it.categoryName ?? "Sin categoría", c);
    const pr = prod.get(it.productName) ?? { cat: it.categoryName ?? "", units: 0, total: 0 };
    pr.units += it.quantity; pr.total += it.total;
    prod.set(it.productName, pr);
  }

  // Métodos (cobros reales del periodo)
  const meth = new Map<string, { charges: number; refunds: number }>();
  for (const pay of ws.payments) {
    if (!inP(pay.paidAt) || !loc(pay.locationId) || pay.status !== "succeeded") continue;
    const r = meth.get(pay.methodKey) ?? { charges: 0, refunds: 0 };
    if (pay.kind === "refund") r.refunds += pay.amount; else r.charges += pay.amount;
    meth.set(pay.methodKey, r);
  }

  // Clientes facturados
  const cust = new Map<string, { name: string; tax: string; n: number; base: number; vat: number; total: number }>();
  for (const i of inv) {
    const k = i.customerId ?? i.customerName ?? "—";
    const c = ws.customers.find((x) => x.id === i.customerId);
    const r = cust.get(k) ?? { name: c ? customerName(c) : i.customerName ?? "", tax: i.customerTaxId ?? "", n: 0, base: 0, vat: 0, total: 0 };
    r.n++; r.base += i.subtotal; r.vat += i.taxTotal; r.total += i.total;
    cust.set(k, r);
  }

  const sheets: ExportSheet[] = [
    {
      name: "Resumen", title, subtitle: sub,
      columns: [{ header: "Concepto", width: 40 }, { header: "Valor", width: 18, format: "money" }],
      rows: [
        ...kpis.map((k) => [k.label, k.format === "money" ? euros(k.value) : k.value]),
        ["", null],
        ["IVA por tipo", null],
        ...vat.map((v) => [`${v.source} · ${formatRate(v.rateBp)} · base ${(v.base / 100).toFixed(2).replace(".", ",")} €`, euros(v.tax)]),
        ["", null],
        ...warnings.map((w) => [`⚠ ${w}`, null]),
      ],
    },
    {
      name: "Caja diaria", title: "Caja diaria", subtitle: sub,
      columns: [{ header: "Fecha", format: "date", width: 12 }, { header: "Operaciones", format: "integer" }, { header: "Total", format: "money", width: 14 }, ...methodKeys.map((k) => ({ header: methodByKey.get(k) ?? "Desconocido", format: "money" as const, width: 14 }))],
      rows: dayRows.map(([d, r]) => [new Date(`${d}T00:00`), r.n, euros(r.total), ...methodKeys.map((k) => euros(r.by[k] ?? 0))]),
      totals: ["TOTAL", dayRows.reduce((s, [, r]) => s + r.n, 0), euros(salesTotal), ...methodKeys.map((k) => euros(dayRows.reduce((s, [, r]) => s + (r.by[k] ?? 0), 0)))],
    },
    {
      name: "Ventas", title: "Ventas (líneas)", subtitle: sub,
      columns: [{ header: "Fecha", format: "datetime", width: 16 }, { header: "Nº", format: "integer" }, { header: "Producto", width: 28 }, { header: "Categoría", width: 18 }, { header: "Uds", format: "integer" }, { header: "Precio", format: "money" }, { header: "Base", format: "money" }, { header: "% IVA", format: "percent" }, { header: "Cuota IVA", format: "money" }, { header: "Total", format: "money" }, { header: "Método", width: 16 }, { header: "Centro", width: 14 }, { header: "Estado", width: 12 }, { header: "Origen", width: 12 }],
      rows: itemsAll.map((it) => {
        const s = saleById.get(it.saleId)!;
        return [new Date(s.occurredAt), s.number, it.productName, it.categoryName ?? "", it.quantity, euros(it.unitPrice), euros(it.baseAmount), it.taxRateBp / 10000, euros(it.taxAmount), euros(it.total), (paysBySale.get(s.id) ?? []).map((k) => methodByKey.get(k)).join(" + ") || "Desconocido", locName.get(s.locationId) ?? "", s.status === "voided" ? "ANULADA" : "Cobrada", s.source === "import" ? (s.granularity === "aggregate" ? "Import. (resumen)" : "Importada") : "Caja"];
      }),
      totals: ["TOTAL (sin anuladas)", null, null, null, items.reduce((s, i) => s + i.quantity, 0), null, euros(items.reduce((s, i) => s + i.baseAmount, 0)), null, euros(items.reduce((s, i) => s + i.taxAmount, 0)), euros(items.reduce((s, i) => s + i.total, 0))],
    },
    {
      name: "Facturación", title: "Facturas emitidas (por fecha de emisión)", subtitle: sub,
      columns: [{ header: "Nº factura", width: 14 }, { header: "Serie" }, { header: "Fecha emisión", format: "date", width: 13 }, { header: "Cliente", width: 28 }, { header: "NIF", width: 13 }, { header: "Concepto", width: 28 }, { header: "Periodo servicio", width: 16 }, { header: "Base", format: "money" }, { header: "IVA", format: "money" }, { header: "Total", format: "money" }, { header: "Método", width: 16 }, { header: "Estado", width: 12 }, { header: "Fecha cobro", format: "date", width: 13 }],
      rows: invAll.map((i) => [i.number ?? i.externalNumber ?? "", i.series ?? "", i.issueDate ? new Date(`${i.issueDate}T00:00`) : null, i.customerName ?? "", i.customerTaxId ?? "", i.concept ?? "", i.servicePeriodStart ? i.servicePeriodStart.slice(0, 7) : "", euros(i.subtotal), euros(i.taxTotal), euros(i.total), methodById.get(i.paymentMethodId ?? "") ?? "", ({ paid: "Cobrada", issued: "Pendiente", partially_paid: "Parcial", void: "ANULADA", draft: "Borrador" } as const)[i.status], i.paidAt ? new Date(i.paidAt) : null]),
      totals: ["TOTAL (sin anuladas)", null, null, null, null, null, null, euros(inv.reduce((s, i) => s + i.subtotal, 0)), euros(inv.reduce((s, i) => s + i.taxTotal, 0)), euros(invTotal)],
    },
    {
      name: "IVA", title: "IVA repercutido por tipo", subtitle: sub,
      columns: [{ header: "Origen", width: 28 }, { header: "Tipo IVA", format: "percent" }, { header: "Base imponible", format: "money", width: 16 }, { header: "Cuota IVA", format: "money", width: 14 }, { header: "Total", format: "money", width: 14 }],
      rows: vat.map((v) => [v.source, v.rateBp / 10000, euros(v.base), euros(v.tax), euros(v.total)]),
      totals: ["TOTAL", null, euros(vat.reduce((s, v) => s + v.base, 0)), euros(vat.reduce((s, v) => s + v.tax, 0)), euros(vat.reduce((s, v) => s + v.total, 0))],
    },
    {
      name: "Gastos", title: "Gastos y facturas recibidas (por fecha de factura)", subtitle: sub,
      columns: [{ header: "Fecha", format: "date", width: 12 }, { header: "Proveedor", width: 26 }, { header: "NIF", width: 13 }, { header: "Nº factura", width: 16 }, { header: "Concepto", width: 30 }, { header: "Categoría", width: 18 }, { header: "Centro", width: 14 }, { header: "Base", format: "money" }, { header: "% IVA", format: "percent" }, { header: "IVA soportado", format: "money" }, { header: "Total", format: "money" }, { header: "Estado", width: 12 }],
      rows: expAll.map((e) => [new Date(`${e.issueDate}T00:00`), supName.get(e.supplierId ?? "")?.name ?? "", supName.get(e.supplierId ?? "")?.taxId ?? "", e.supplierInvoiceNumber ?? "", e.description, expCat.get(e.categoryId ?? "") ?? "", locName.get(e.locationId ?? "") ?? "General", euros(e.subtotal), (e.taxRateBp ?? 0) / 10000, euros(e.taxTotal), euros(e.total), e.status === "void" ? "ANULADO" : e.status === "paid" ? "Pagado" : "Pendiente"]),
      totals: ["TOTAL (sin anulados)", null, null, null, null, null, null, euros(exps.reduce((t, e) => t + e.subtotal, 0)), null, euros(inputTax), euros(exps.reduce((t, e) => t + e.total, 0))],
    },
    {
      name: "IVA soportado", title: "IVA soportado por tipo", subtitle: sub,
      columns: [{ header: "Tipo IVA", format: "percent" }, { header: "Base imponible", format: "money", width: 16 }, { header: "Cuota", format: "money", width: 14 }, { header: "Total", format: "money", width: 14 }],
      rows: [...inputVat.entries()].sort((a, b) => b[0] - a[0]).map(([r, v]) => [r / 10000, euros(v.base), euros(v.tax), euros(v.total)]),
      totals: ["TOTAL", euros([...inputVat.values()].reduce((t, v) => t + v.base, 0)), euros(inputTax), euros([...inputVat.values()].reduce((t, v) => t + v.total, 0))],
    },
    {
      name: "Métodos de pago", title: "Cobros por método de pago", subtitle: sub,
      columns: [{ header: "Método", width: 24 }, { header: "Cobros", format: "money" }, { header: "Devoluciones", format: "money" }, { header: "Neto", format: "money" }],
      rows: [...meth.entries()].map(([k, v]) => [methodByKey.get(k) ?? k, euros(v.charges), euros(v.refunds), euros(v.charges - v.refunds)]),
      totals: ["TOTAL", euros([...meth.values()].reduce((s, v) => s + v.charges, 0)), euros([...meth.values()].reduce((s, v) => s + v.refunds, 0)), euros([...meth.values()].reduce((s, v) => s + v.charges - v.refunds, 0))],
    },
    {
      name: "Categorías", title: "Ventas de caja por categoría", subtitle: sub,
      columns: [{ header: "Categoría", width: 24 }, { header: "Uds", format: "integer" }, { header: "Base", format: "money" }, { header: "IVA", format: "money" }, { header: "Total", format: "money" }, { header: "% s/total", format: "percent" }],
      rows: [...cat.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, v.units, euros(v.base), euros(v.tax), euros(v.total), salesTotal ? v.total / salesTotal : 0]),
    },
    {
      name: "Productos", title: "Ventas de caja por producto", subtitle: sub,
      columns: [{ header: "Producto", width: 30 }, { header: "Categoría", width: 20 }, { header: "Uds", format: "integer" }, { header: "Total", format: "money" }],
      rows: [...prod.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, v.cat, v.units, euros(v.total)]),
    },
    {
      name: "Clientes", title: "Clientes facturados", subtitle: sub,
      columns: [{ header: "Cliente", width: 30 }, { header: "NIF", width: 13 }, { header: "Nº facturas", format: "integer" }, { header: "Base", format: "money" }, { header: "IVA", format: "money" }, { header: "Total", format: "money" }],
      rows: [...cust.values()].sort((a, b) => b.total - a.total).map((c) => [c.name, c.tax, c.n, euros(c.base), euros(c.vat), euros(c.total)]),
    },
    {
      name: "Cierres", title: "Cierres de caja", subtitle: sub,
      columns: [{ header: "Fecha cierre", format: "datetime", width: 16 }, { header: "Centro", width: 14 }, { header: "Ventas", format: "money" }, { header: "Esperado", format: "money" }, { header: "Contado", format: "money" }, { header: "Diferencia", format: "money" }, { header: "Estado", width: 12 }, { header: "Observaciones", width: 30 }],
      rows: closings.map((c) => [new Date(c.closedAt), locName.get(ws.cashSessions.find((s) => s.id === c.cashSessionId)?.locationId ?? "") ?? "", euros(c.salesTotal), euros(c.expectedCash), euros(c.countedCash), euros(c.difference), c.status === "balanced" ? "Cuadrada" : "Descuadre", c.notes ?? ""]),
    },
  ];

  const fileBase = `${periodFileLabel(p)}_${slugFile(ws.organization.name)}`;
  return { fileBase, title, periodLabel: p.label, kpis, vat, sheets, warnings };
}

const LEGAL_RATES = [0, 400, 500, 1000, 2100];
/** Tipo de IVA a partir de base y cuota (p. ej. 51,24 € + 10,76 € → 21 %). */
export function inferRateBp(base: number, tax: number): number {
  if (base <= 0 || tax <= 0) return 0;
  const raw = (tax / base) * 10000;
  return LEGAL_RATES.reduce((best, r) => (Math.abs(r - raw) < Math.abs(best - raw) ? r : best), LEGAL_RATES[0]!);
}
