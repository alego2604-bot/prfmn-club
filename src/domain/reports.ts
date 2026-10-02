/**
 * Informes: definiciones puras. Cada informe devuelve KPIs (con comparación honesta), una serie temporal opcional y
 * una tabla exportable. Sin UI: la pantalla y las exportaciones (XLSX/CSV/PDF) consumen esta misma estructura.
 *
 * Comparaciones: frente al periodo anterior de la misma duración o al mismo periodo del año anterior. Si en el periodo
 * de comparación no hay datos de ese tipo, la variación es null (nunca un «+1.500 %» engañoso).
 */
import type { Workspace } from "@/data/store";
import { customerName } from "@/data/repos/customers";
import { addDays, addMonths, capitalize, monthName, startOfMonth, startOfWeek, toISODate, type Period } from "@/lib/dates";
import { computeKpis, percentChange, revenueSeries, type Granularity } from "./analytics";
import { expenseKpis, periodExpenses } from "./expenses";
import { profitAndLoss } from "./finance";
import { invoiceView, INVOICE_VIEW } from "./invoicing";
import { BILLING_PERIOD, membershipSummary, monthlyBase, membershipView } from "./memberships";

export type ReportKey = "sales" | "revenue" | "expenses" | "cash" | "payments" | "invoices" | "customers" | "memberships" | "products" | "locations";
export type ValueFormat = "money" | "int" | "percent" | "text";

export interface ReportMeta { key: ReportKey; title: string; description: string; group: "Ventas e ingresos" | "Finanzas" | "Clientes" | "Operativa" }

export const REPORTS: ReportMeta[] = [
  { key: "sales", title: "Ventas", description: "Ventas de caja: importe, operaciones y ticket medio por día, semana o mes", group: "Ventas e ingresos" },
  { key: "revenue", title: "Ingresos", description: "Caja + cuotas y facturas, recurrente frente a puntual, base e IVA", group: "Ventas e ingresos" },
  { key: "products", title: "Productos", description: "Unidades e importe por producto y categoría, con variación", group: "Ventas e ingresos" },
  { key: "expenses", title: "Gastos", description: "Gasto por categoría y proveedor, IVA soportado y pendientes", group: "Finanzas" },
  { key: "payments", title: "Cobros", description: "Cobrado por método de pago, devoluciones y pendiente", group: "Finanzas" },
  { key: "invoices", title: "Facturas", description: "Emitidas, cobradas, pendientes y vencidas", group: "Finanzas" },
  { key: "customers", title: "Clientes", description: "Activos, nuevos, bajas y los clientes de más valor", group: "Clientes" },
  { key: "memberships", title: "Membresías", description: "Activas, MRR, altas, bajas y churn por tarifa", group: "Clientes" },
  { key: "cash", title: "Caja y cierres", description: "Cierres, efectivo contado y descuadres por centro", group: "Operativa" },
  { key: "locations", title: "Centros", description: "Centro frente a centro: ingresos, ventas, gastos y resultado", group: "Operativa" },
];

export interface ReportKpi { label: string; value: number; previous: number | null; format: ValueFormat; invert?: boolean; hint?: string }
export interface ReportColumn { header: string; format: ValueFormat; align?: "left" | "right" }
export interface ReportTable { columns: ReportColumn[]; rows: (string | number | null)[][]; totals?: (string | number | null)[] }
export interface ReportSeries { label: string; current: number; previous: number | null; key: string }
export interface Report {
  meta: ReportMeta;
  kpis: ReportKpi[];
  series?: { label: string; points: ReportSeries[]; format: ValueFormat; tone?: "accent" | "out" };
  table: ReportTable;
  notes: string[];
}

export interface ReportFilters {
  period: Period;
  compare: Period | null;
  locationId?: string;
  categoryId?: string;
  methodKey?: string;
}

const ms = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime();
const inP = (iso: string | undefined, p: Period) => !!iso && ms(iso) >= p.start.getTime() && ms(iso) < p.end.getTime();
const days = (p: Period) => Math.round((p.end.getTime() - p.start.getTime()) / 86_400_000);
export const granularityFor = (p: Period): Granularity => (days(p) <= 31 ? "day" : days(p) <= 120 ? "week" : "month");

function bucketLabel(d: Date, g: Granularity) {
  if (g === "month") return capitalize(`${monthName(d.getMonth())} ${d.getFullYear()}`);
  if (g === "week") return `Semana del ${d.toLocaleDateString("es-ES")}`;
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Comparación honesta: null si el periodo de comparación no tiene ningún dato de ese tipo. */
const cmp = (hasData: boolean, v: number) => (hasData ? v : null);

export function buildReport(ws: Workspace, key: ReportKey, f: ReportFilters, today = toISODate(new Date())): Report {
  const meta = REPORTS.find((r) => r.key === key)!;
  const loc = f.locationId;
  const notes: string[] = [];
  const g = granularityFor(f.period);

  switch (key) {
    case "sales": {
      const filterSales = (p: Period) => {
        const k = computeKpis(ws, p, loc);
        if (!f.categoryId) return { revenue: k.salesRevenue, ops: k.operations, ticket: k.avgTicket, units: k.units };
        const cat = k.byCategory.find((c) => c.id === f.categoryId);
        return { revenue: cat?.amount ?? 0, ops: k.operations, ticket: k.avgTicket, units: cat?.units ?? 0 };
      };
      const cur = filterSales(f.period);
      const prev = f.compare ? filterSales(f.compare) : null;
      const has = !!prev && (prev.revenue > 0 || prev.ops > 0);
      const s = revenueSeries(ws, f.period, g, loc);
      const sp = f.compare ? revenueSeries(ws, f.compare, g, loc) : [];
      if (f.categoryId) notes.push("Filtrado por categoría: importe y unidades de esa categoría; operaciones y ticket son del total de caja.");
      return {
        meta, notes,
        kpis: [
          { label: "Ventas de caja", value: cur.revenue, previous: has ? cmp(true, prev!.revenue) : null, format: "money", hint: "IVA incluido" },
          { label: "Operaciones", value: cur.ops, previous: has ? prev!.ops : null, format: "int" },
          { label: "Ticket medio", value: cur.ticket ?? 0, previous: has && prev!.ticket !== null ? prev!.ticket : null, format: "money" },
          { label: "Unidades", value: cur.units, previous: has ? prev!.units : null, format: "int" },
        ],
        series: { label: "Ventas de caja", format: "money", points: s.map((p, i) => ({ key: p.key, label: bucketLabel(p.date, g), current: p.sales, previous: sp[i]?.sales ?? null })) },
        table: {
          columns: [{ header: "Periodo", format: "text" }, { header: "Operaciones", format: "int", align: "right" }, { header: "Ventas", format: "money", align: "right" }, { header: "Ticket medio", format: "money", align: "right" }, { header: "Comparación", format: "money", align: "right" }],
          rows: s.map((p, i) => [bucketLabel(p.date, g), p.operations, p.sales, p.operations ? Math.round(p.sales / p.operations) : null, f.compare ? sp[i]?.sales ?? 0 : null]),
          totals: ["Total", cur.ops, cur.revenue, cur.ticket ?? null, prev?.revenue ?? null],
        },
      };
    }
    case "revenue": {
      const k = computeKpis(ws, f.period, loc);
      const kp = f.compare ? computeKpis(ws, f.compare, loc) : null;
      const pl = profitAndLoss(ws, ws.expenses, f.period, loc);
      const plp = f.compare ? profitAndLoss(ws, ws.expenses, f.compare, loc) : null;
      const has = !!kp && kp.revenue > 0;
      const s = revenueSeries(ws, f.period, g === "day" && days(f.period) > 14 ? "week" : g, loc);
      const sp = f.compare ? revenueSeries(ws, f.compare, g === "day" && days(f.period) > 14 ? "week" : g, loc) : [];
      const gg: Granularity = g === "day" && days(f.period) > 14 ? "week" : g;
      return {
        meta, notes,
        kpis: [
          { label: "Ingresos (IVA incl.)", value: k.revenue, previous: has ? kp!.revenue : null, format: "money" },
          { label: "Base imponible", value: pl.revenueBase, previous: has ? plp!.revenueBase : null, format: "money" },
          { label: "IVA repercutido", value: k.vatCollected, previous: has ? kp!.vatCollected : null, format: "money" },
          { label: "Recurrente", value: k.revenue ? k.invoiceRevenue / k.revenue : 0, previous: has && kp!.revenue ? kp!.invoiceRevenue / kp!.revenue : null, format: "percent", hint: "cuotas y facturas sobre el total" },
        ],
        series: { label: "Ingresos", format: "money", points: s.map((p, i) => ({ key: p.key, label: bucketLabel(p.date, gg), current: p.total, previous: sp[i]?.total ?? null })) },
        table: {
          columns: [{ header: "Periodo", format: "text" }, { header: "Caja (puntual)", format: "money", align: "right" }, { header: "Cuotas y facturas (recurrente)", format: "money", align: "right" }, { header: "Total", format: "money", align: "right" }, { header: "Comparación", format: "money", align: "right" }],
          rows: s.map((p, i) => [bucketLabel(p.date, gg), p.sales, p.invoices, p.total, f.compare ? sp[i]?.total ?? 0 : null]),
          totals: ["Total", k.salesRevenue, k.invoiceRevenue, k.revenue, kp?.revenue ?? null],
        },
      };
    }
    case "products": {
      const k = computeKpis(ws, f.period, loc);
      const kp = f.compare ? computeKpis(ws, f.compare, loc) : null;
      const prevMap = new Map((kp?.byProduct ?? []).map((p) => [p.key, p.amount]));
      const productCat = new Map(ws.products.map((p) => [p.id, p.categoryId]));
      const rows = k.byProduct.filter((p) => !f.categoryId || productCat.get(p.key) === f.categoryId);
      const total = rows.reduce((t, p) => t + p.amount, 0);
      const catName = new Map(ws.categories.map((c) => [c.id, c.name]));
      return {
        meta, notes,
        kpis: [
          { label: "Importe vendido", value: total, previous: kp ? (kp.byProduct.filter((p) => !f.categoryId || productCat.get(p.key) === f.categoryId).reduce((t, p) => t + p.amount, 0) || null) : null, format: "money" },
          { label: "Unidades", value: rows.reduce((t, p) => t + p.units, 0), previous: null, format: "int" },
          { label: "Productos con ventas", value: rows.length, previous: null, format: "int" },
          { label: "Top 3 sobre el total", value: total ? rows.slice(0, 3).reduce((t, p) => t + p.amount, 0) / total : 0, previous: null, format: "percent" },
        ],
        table: {
          columns: [{ header: "Producto", format: "text" }, { header: "Categoría", format: "text" }, { header: "Unidades", format: "int", align: "right" }, { header: "Importe", format: "money", align: "right" }, { header: "Peso", format: "percent", align: "right" }, { header: "Comparación", format: "money", align: "right" }],
          rows: rows.map((p) => [p.name, catName.get(productCat.get(p.key) ?? "") ?? "—", p.units, p.amount, total ? p.amount / total : 0, f.compare ? prevMap.get(p.key) ?? 0 : null]),
          totals: ["Total", "", rows.reduce((t, p) => t + p.units, 0), total, 1, null],
        },
      };
    }
    case "expenses": {
      const refs = { categories: ws.expenseCategories, suppliers: ws.suppliers, locations: ws.locations };
      const k = expenseKpis(ws.expenses, refs, f.period, loc, today);
      const hasPrev = !!f.compare && periodExpenses(ws.expenses, f.compare, loc).length > 0;
      const kp = f.compare ? expenseKpis(ws.expenses, refs, f.compare, loc, today) : null;
      const prevCat = new Map((kp?.byCategory ?? []).map((c) => [c.id, c.amount]));
      if (f.compare && !hasPrev) notes.push("No hay gastos en el periodo de comparación: no se muestran variaciones.");
      return {
        meta, notes,
        kpis: [
          { label: "Gasto (IVA incl.)", value: k.total, previous: hasPrev ? kp!.total : null, format: "money", invert: true },
          { label: "Base imponible", value: k.base, previous: hasPrev ? kp!.base : null, format: "money", invert: true },
          { label: "IVA soportado", value: k.vat, previous: hasPrev ? kp!.vat : null, format: "money" },
          { label: "Pendiente de pago", value: k.pending.amount, previous: null, format: "money", hint: `${k.pending.count} gastos · ${k.overdue.count} vencidos` },
        ],
        table: {
          columns: [{ header: "Categoría", format: "text" }, { header: "Gastos", format: "int", align: "right" }, { header: "Importe", format: "money", align: "right" }, { header: "Peso", format: "percent", align: "right" }, { header: "Comparación", format: "money", align: "right" }],
          rows: k.byCategory.map((c) => [c.name, c.count, c.amount, k.total ? c.amount / k.total : 0, hasPrev ? prevCat.get(c.id) ?? 0 : null]),
          totals: ["Total", k.count, k.total, 1, hasPrev ? kp!.total : null],
        },
      };
    }
    case "payments": {
      const sum = (p: Period) => {
        const by = new Map<string, { charges: number; refunds: number; n: number }>();
        for (const pay of ws.payments) {
          if (pay.status !== "succeeded" || !inP(pay.paidAt, p) || (loc && pay.locationId && pay.locationId !== loc) || (f.methodKey && pay.methodKey !== f.methodKey)) continue;
          const r = by.get(pay.methodKey) ?? { charges: 0, refunds: 0, n: 0 };
          if (pay.kind === "refund") r.refunds += pay.amount; else { r.charges += pay.amount; r.n++; }
          by.set(pay.methodKey, r);
        }
        return by;
      };
      const cur = sum(f.period);
      const prev = f.compare ? sum(f.compare) : null;
      const net = (m: Map<string, { charges: number; refunds: number }>) => [...m.values()].reduce((t, x) => t + x.charges - x.refunds, 0);
      const name = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
      const has = !!prev && prev.size > 0;
      const k = computeKpis(ws, f.period, loc);
      return {
        meta, notes,
        kpis: [
          { label: "Cobrado neto", value: net(cur), previous: has ? net(prev!) : null, format: "money" },
          { label: "Cobros", value: [...cur.values()].reduce((t, x) => t + x.n, 0), previous: has ? [...prev!.values()].reduce((t, x) => t + x.n, 0) : null, format: "int" },
          { label: "Devoluciones", value: [...cur.values()].reduce((t, x) => t + x.refunds, 0), previous: null, format: "money", invert: true },
          { label: "Pendiente de cobro", value: k.uncollected, previous: null, format: "money", hint: "facturado en el periodo y aún sin cobrar" },
        ],
        table: {
          columns: [{ header: "Método", format: "text" }, { header: "Cobros", format: "int", align: "right" }, { header: "Cobrado", format: "money", align: "right" }, { header: "Devoluciones", format: "money", align: "right" }, { header: "Neto", format: "money", align: "right" }, { header: "Comparación", format: "money", align: "right" }],
          rows: [...cur.entries()].sort((a, b) => b[1].charges - a[1].charges).map(([key, x]) => [name.get(key) ?? key, x.n, x.charges, x.refunds, x.charges - x.refunds, has ? (prev!.get(key)?.charges ?? 0) - (prev!.get(key)?.refunds ?? 0) : null]),
          totals: ["Total", [...cur.values()].reduce((t, x) => t + x.n, 0), [...cur.values()].reduce((t, x) => t + x.charges, 0), [...cur.values()].reduce((t, x) => t + x.refunds, 0), net(cur), has ? net(prev!) : null],
        },
      };
    }
    case "invoices": {
      const list = (p: Period) => ws.invoices.filter((i) => i.status !== "draft" && inP(i.issueDate, p) && (!loc || !i.locationId || i.locationId === loc));
      const cur = list(f.period);
      const prev = f.compare ? list(f.compare) : [];
      const valid = cur.filter((i) => i.status !== "void");
      const has = prev.length > 0;
      const views = ["pending", "partial", "overdue", "paid", "void"] as const;
      return {
        meta, notes,
        kpis: [
          { label: "Facturado", value: valid.reduce((t, i) => t + i.total, 0), previous: has ? prev.filter((i) => i.status !== "void").reduce((t, i) => t + i.total, 0) : null, format: "money" },
          { label: "Facturas emitidas", value: valid.length, previous: has ? prev.filter((i) => i.status !== "void").length : null, format: "int" },
          { label: "Cobrado de lo emitido", value: valid.length ? valid.reduce((t, i) => t + i.amountPaid, 0) / Math.max(1, valid.reduce((t, i) => t + i.total, 0)) : 0, previous: null, format: "percent" },
          { label: "Vencido sin cobrar", value: valid.filter((i) => invoiceView(i, today) === "overdue").reduce((t, i) => t + i.total - i.amountPaid, 0), previous: null, format: "money", invert: true },
        ],
        table: {
          columns: [{ header: "Estado", format: "text" }, { header: "Facturas", format: "int", align: "right" }, { header: "Importe", format: "money", align: "right" }, { header: "Pendiente", format: "money", align: "right" }],
          rows: views.map((v) => {
            const xs = cur.filter((i) => invoiceView(i, today) === v);
            return [INVOICE_VIEW[v].label, xs.length, xs.reduce((t, i) => t + i.total, 0), v === "void" || v === "paid" ? 0 : xs.reduce((t, i) => t + i.total - i.amountPaid, 0)];
          }),
          totals: ["Total", cur.length, valid.reduce((t, i) => t + i.total, 0), valid.reduce((t, i) => t + (i.status === "paid" ? 0 : i.total - i.amountPaid), 0)],
        },
      };
    }
    case "customers": {
      const value = new Map<string, number>();
      for (const s of ws.sales) if (s.customerId && s.status !== "voided" && inP(s.occurredAt, f.period) && (!loc || s.locationId === loc)) value.set(s.customerId, (value.get(s.customerId) ?? 0) + s.total);
      for (const i of ws.invoices) if (i.customerId && i.status !== "void" && i.status !== "draft" && inP(i.issueDate, f.period) && (!loc || !i.locationId || i.locationId === loc)) value.set(i.customerId, (value.get(i.customerId) ?? 0) + i.total);
      const joined = ws.customers.filter((c) => c.joinedAt && inP(c.joinedAt, f.period)).length;
      const left = ws.customers.filter((c) => c.leftAt && inP(c.leftAt, f.period)).length;
      const top = [...value.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
      const byId = new Map(ws.customers.map((c) => [c.id, c]));
      const total = [...value.values()].reduce((t, v) => t + v, 0);
      return {
        meta, notes,
        kpis: [
          { label: "Clientes con actividad", value: value.size, previous: null, format: "int" },
          { label: "Altas", value: joined, previous: f.compare ? ws.customers.filter((c) => c.joinedAt && inP(c.joinedAt, f.compare!)).length : null, format: "int" },
          { label: "Bajas", value: left, previous: f.compare ? ws.customers.filter((c) => c.leftAt && inP(c.leftAt, f.compare!)).length : null, format: "int", invert: true },
          { label: "Valor medio", value: value.size ? Math.round(total / value.size) : 0, previous: null, format: "money", hint: "por cliente activo en el periodo" },
        ],
        table: {
          columns: [{ header: "Cliente", format: "text" }, { header: "Estado", format: "text" }, { header: "Alta", format: "text" }, { header: "Valor en el periodo", format: "money", align: "right" }, { header: "Peso", format: "percent", align: "right" }],
          rows: top.map(([id, v]) => { const c = byId.get(id); return [c ? customerName(c) : "—", c?.status === "cancelled" ? "Baja" : c?.status === "lead" ? "Lead" : "Activo", c?.joinedAt ? c.joinedAt.split("-").reverse().join("/") : "—", v, total ? v / total : 0]; }),
          totals: [`${value.size} clientes (top 50)`, "", "", total, 1],
        },
      };
    }
    case "memberships": {
      const refs = { plans: ws.membershipPlans, versions: ws.planVersions, charges: ws.membershipCharges };
      const range = { start: toISODate(f.period.start), end: toISODate(f.period.end) };
      const s = membershipSummary(ws.customerMemberships, refs, range, today, 7, loc);
      const sp = f.compare ? membershipSummary(ws.customerMemberships, refs, { start: toISODate(f.compare.start), end: toISODate(f.compare.end) }, today, 7, loc) : null;
      const startActive = ws.customerMemberships.filter((m) => m.startDate < range.start && (!m.cancelledAt || m.cancelledAt.slice(0, 10) >= range.start) && m.status !== "pending").length;
      const ver = new Map(ws.planVersions.map((v) => [v.id, v]));
      const byPlan = ws.membershipPlans.map((p) => {
        const ms_ = ws.customerMemberships.filter((m) => m.planId === p.id && (!loc || !m.locationId || m.locationId === loc));
        const live = ms_.filter((m) => { const v = membershipView(m, ws.membershipCharges, today); return v === "ACTIVE" || v === "PAST_DUE"; });
        return [p.name, BILLING_PERIOD[p.billingPeriod].label, live.length, live.reduce((t, m) => t + monthlyBase(m, p.billingPeriod, ver.get(m.planVersionId)?.taxRateBp ?? 2100), 0), ms_.filter((m) => m.startDate >= range.start && m.startDate < range.end).length, ms_.filter((m) => m.cancelledAt && m.cancelledAt.slice(0, 10) >= range.start && m.cancelledAt.slice(0, 10) < range.end).length] as (string | number)[];
      });
      return {
        meta, notes: ["MRR y activas: situación a día de hoy. Altas y bajas: dentro del periodo."],
        kpis: [
          { label: "Activas hoy", value: s.active + s.pastDue, previous: null, format: "int", hint: `${s.pastDue} con cuota vencida · ${s.paused} en pausa` },
          { label: "MRR", value: s.mrr, previous: null, format: "money", hint: "sin IVA" },
          { label: "Altas / bajas", value: s.newInPeriod - s.cancelledInPeriod, previous: sp ? sp.newInPeriod - sp.cancelledInPeriod : null, format: "int", hint: `+${s.newInPeriod} / −${s.cancelledInPeriod}` },
          { label: "Churn del periodo", value: startActive ? s.cancelledInPeriod / startActive : 0, previous: null, format: "percent", invert: true, hint: "bajas sobre activas al inicio" },
        ],
        table: {
          columns: [{ header: "Tarifa", format: "text" }, { header: "Periodicidad", format: "text" }, { header: "Activas", format: "int", align: "right" }, { header: "MRR (sin IVA)", format: "money", align: "right" }, { header: "Altas", format: "int", align: "right" }, { header: "Bajas", format: "int", align: "right" }],
          rows: byPlan.filter((r) => Number(r[2]) || Number(r[4]) || Number(r[5])),
          totals: ["Total", "", s.active + s.pastDue, s.mrr, s.newInPeriod, s.cancelledInPeriod],
        },
      };
    }
    case "cash": {
      const closings = ws.cashClosings.filter((c) => !c.supersededAt && inP(c.closedAt, f.period)).map((c) => ({ c, s: ws.cashSessions.find((x) => x.id === c.cashSessionId) })).filter(({ s }) => !loc || s?.locationId === loc);
      const locName = new Map(ws.locations.map((l) => [l.id, l.name]));
      const disc = closings.filter(({ c }) => c.status === "discrepancy");
      return {
        meta, notes,
        kpis: [
          { label: "Cierres", value: closings.length, previous: null, format: "int" },
          { label: "Ventas cerradas", value: closings.reduce((t, { c }) => t + c.salesTotal, 0), previous: null, format: "money" },
          { label: "Efectivo contado", value: closings.reduce((t, { c }) => t + c.countedCash, 0), previous: null, format: "money" },
          { label: "Descuadres", value: disc.length, previous: null, format: "int", invert: true, hint: `Neto ${(disc.reduce((t, { c }) => t + c.difference, 0) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` },
        ],
        table: {
          columns: [{ header: "Fecha", format: "text" }, { header: "Centro", format: "text" }, { header: "Ventas", format: "int", align: "right" }, { header: "Importe", format: "money", align: "right" }, { header: "Esperado", format: "money", align: "right" }, { header: "Contado", format: "money", align: "right" }, { header: "Diferencia", format: "money", align: "right" }],
          rows: closings.sort((a, b) => b.c.closedAt.localeCompare(a.c.closedAt)).map(({ c, s }) => [new Date(c.closedAt).toLocaleDateString("es-ES"), locName.get(s?.locationId ?? "") ?? "—", c.salesCount, c.salesTotal, c.expectedCash, c.countedCash, c.difference]),
          totals: ["Total", "", closings.reduce((t, { c }) => t + c.salesCount, 0), closings.reduce((t, { c }) => t + c.salesTotal, 0), closings.reduce((t, { c }) => t + c.expectedCash, 0), closings.reduce((t, { c }) => t + c.countedCash, 0), closings.reduce((t, { c }) => t + c.difference, 0)],
        },
      };
    }
    case "locations": {
      const rows = ws.locations.filter((l) => l.status !== "archived").map((l) => {
        const k = computeKpis(ws, f.period, l.id);
        const pl = profitAndLoss(ws, ws.expenses, f.period, l.id);
        return [l.name, k.operations, k.salesRevenue, k.revenue, pl.expensesGross, pl.result] as (string | number)[];
      });
      const general = periodExpenses(ws.expenses, f.period).filter((e) => !e.locationId).reduce((t, e) => t + e.total, 0);
      if (general) notes.push(`Gastos generales sin centro (${(general / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}) no se reparten: solo cuentan en el consolidado.`);
      const totalRev = rows.reduce((t, r) => t + Number(r[3]), 0);
      return {
        meta, notes,
        kpis: rows.slice(0, 4).map((r) => ({ label: String(r[0]), value: Number(r[3]), previous: null, format: "money" as const, hint: `${totalRev ? Math.round((Number(r[3]) / totalRev) * 100) : 0} % de los ingresos` })),
        table: {
          columns: [{ header: "Centro", format: "text" }, { header: "Operaciones", format: "int", align: "right" }, { header: "Caja", format: "money", align: "right" }, { header: "Ingresos totales", format: "money", align: "right" }, { header: "Gastos (IVA incl.)", format: "money", align: "right" }, { header: "Resultado (sin IVA)", format: "money", align: "right" }],
          rows,
          totals: ["Total", rows.reduce((t, r) => t + Number(r[1]), 0), rows.reduce((t, r) => t + Number(r[2]), 0), totalRev, rows.reduce((t, r) => t + Number(r[4]), 0), rows.reduce((t, r) => t + Number(r[5]), 0)],
        },
      };
    }
  }
}

/** Variación relativa para un KPI (null si no hay comparación honesta). */
export const kpiDelta = (k: ReportKpi) => (k.previous === null || k.format === "percent" || k.format === "text" ? null : percentChange(k.value, k.previous));

/** Periodos rápidos del selector de informes. */
export function reportPeriod(preset: "today" | "week" | "month" | "quarter" | "year" | "prev_month" | "prev_quarter", now = new Date()): Period {
  const y = now.getFullYear();
  switch (preset) {
    case "today": { const s = new Date(y, now.getMonth(), now.getDate()); return { preset: "today", start: s, end: addDays(s, 1), label: "Hoy" }; }
    case "week": { const s = startOfWeek(now); return { preset: "custom", start: s, end: addDays(s, 7), label: "Esta semana" }; }
    case "month": { const s = startOfMonth(now); return { preset: "month", start: s, end: addMonths(s, 1), label: capitalize(`${monthName(s.getMonth())} ${y}`) }; }
    case "prev_month": { const s = addMonths(startOfMonth(now), -1); return { preset: "custom", start: s, end: startOfMonth(now), label: capitalize(`${monthName(s.getMonth())} ${s.getFullYear()}`) }; }
    case "quarter": { const s = new Date(y, Math.floor(now.getMonth() / 3) * 3, 1); return { preset: "quarter", start: s, end: addMonths(s, 3), label: `T${Math.floor(now.getMonth() / 3) + 1} ${y}` }; }
    case "prev_quarter": { const s = addMonths(new Date(y, Math.floor(now.getMonth() / 3) * 3, 1), -3); return { preset: "custom", start: s, end: addMonths(s, 3), label: `T${Math.floor(s.getMonth() / 3) + 1} ${s.getFullYear()}` }; }
    case "year": return { preset: "year", start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: `Año ${y}` };
  }
}

export function previousOf(p: Period, mode: "previous" | "year"): Period {
  if (mode === "year") return { preset: "custom", start: addMonths(p.start, -12), end: addMonths(p.end, -12), label: "mismo periodo del año anterior" };
  const len = p.end.getTime() - p.start.getTime();
  const sameMonths = p.start.getDate() === 1 && p.end.getDate() === 1;
  if (sameMonths) {
    const months = (p.end.getFullYear() - p.start.getFullYear()) * 12 + p.end.getMonth() - p.start.getMonth();
    return { preset: "custom", start: addMonths(p.start, -months), end: p.start, label: "periodo anterior" };
  }
  return { preset: "custom", start: new Date(p.start.getTime() - len), end: p.start, label: "periodo anterior" };
}
