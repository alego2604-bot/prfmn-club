/**
 * Lectura automática de los datos: frases cortas que explican qué ha pasado en el periodo.
 * Solo se construyen con cifras calculadas de los registros (nunca inventadas) y solo cuando hay base suficiente.
 */
import { formatMoney, type Cents, NUM } from "@/lib/money";
import type { PeriodKpis, SeriesPoint, CustomerStats } from "./analytics";

export interface Insight {
  id: string;
  tone: "up" | "down" | "neutral";
  text: string;
  /** Relevancia (para ordenar y quedarse con las más útiles) */
  weight: number;
}

const pct = (v: number) => `${(Math.abs(v) * 100).toLocaleString("es-ES", { maximumFractionDigits: v !== 0 && Math.abs(v) < 0.1 ? 1 : 0 })} %`;
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function buildInsights(input: {
  k: PeriodKpis;
  prev: PeriodKpis;
  daily?: SeriesPoint[];
  customers?: CustomerStats;
  prevLabel?: string;
}): Insight[] {
  const { k, prev, daily, customers } = input;
  const vs = input.prevLabel ? `frente a ${input.prevLabel.toLowerCase()}` : "frente al periodo anterior";
  const out: Insight[] = [];

  if (prev.revenue > 0 && k.revenue > 0) {
    const ch = (k.revenue - prev.revenue) / prev.revenue;
    if (Math.abs(ch) >= 0.005) {
      out.push({
        id: "revenue",
        tone: ch > 0 ? "up" : "down",
        text: `La facturación ${ch > 0 ? "ha subido" : "ha bajado"} un ${pct(ch)} ${vs} (${ch > 0 ? "+" : "−"}${formatMoney(Math.abs(k.revenue - prev.revenue))}).`,
        weight: 100 + Math.abs(ch) * 100,
      });
    }
  }

  if (k.avgTicket !== null && prev.avgTicket !== null && Math.abs(k.avgTicket - prev.avgTicket) >= 50) {
    const d = k.avgTicket - prev.avgTicket;
    out.push({
      id: "ticket",
      tone: d > 0 ? "up" : "down",
      text: `El ticket medio ${d > 0 ? "ha subido" : "ha bajado"} ${formatMoney(Math.abs(d))}: de ${formatMoney(prev.avgTicket)} a ${formatMoney(k.avgTicket)}.`,
      weight: 60 + Math.min(40, Math.abs(d) / 10),
    });
  }

  if (k.revenue > 0 && k.invoiceRevenue > 0 && k.salesRevenue > 0) {
    const share = k.invoiceRevenue / k.revenue;
    out.push({ id: "recurring", tone: "neutral", text: `Las cuotas y facturas suponen el ${pct(share)} de la facturación; la caja, el ${pct(1 - share)}.`, weight: 55 });
  }

  const cat = k.byCategory.filter((c) => c.id !== "invoices");
  const catTotal = cat.reduce((s, c) => s + c.amount, 0);
  if (cat.length >= 2 && catTotal > 0) {
    const share = cat[0]!.amount / catTotal;
    if (share >= 0.25) out.push({ id: "category", tone: "neutral", text: `${cat[0]!.name} concentra el ${pct(share)} de las ventas de caja.`, weight: 40 + share * 20 });
  }

  const methods = k.byMethod.filter((m) => m.amount > 0 && m.key !== "pending" && m.key !== "unknown");
  const methodTotal = methods.reduce((s, m) => s + m.amount, 0);
  if (methods.length >= 2 && methodTotal > 0) {
    const top = [...methods].sort((a, b) => b.amount - a.amount)[0]!;
    out.push({ id: "method", tone: "neutral", text: `El ${pct(top.amount / methodTotal)} de lo cobrado entra por ${top.name.toLowerCase()}.`, weight: 35 });
  }

  if (daily && daily.length >= 14) {
    const byDow = new Array<number>(7).fill(0);
    let total = 0;
    for (const d of daily) {
      byDow[d.date.getDay()]! += d.txSales;
      total += d.txSales;
    }
    if (total > 0) {
      const best = byDow.indexOf(Math.max(...byDow));
      const share = byDow[best]! / total;
      if (share > 1 / 7 + 0.03) out.push({ id: "weekday", tone: "neutral", text: `Tu mejor día es el ${WEEKDAYS[best]}: concentra el ${pct(share)} de las ventas de caja.`, weight: 45 });
    }
  }

  if (customers) {
    if (customers.retention !== null) {
      out.push({
        id: "retention",
        tone: customers.retention >= 0.6 ? "up" : "down",
        text: `El ${pct(customers.retention)} de los clientes activos del periodo anterior ha vuelto a comprar o pagar.`,
        weight: 50,
      });
    }
    if (customers.newInPeriod > 0) {
      out.push({ id: "new", tone: "up", text: `${customers.newInPeriod.toLocaleString("es-ES", NUM)} cliente${customers.newInPeriod === 1 ? " nuevo" : "s nuevos"} en el periodo.`, weight: 30 });
    }
  }

  if (k.pendingInvoices.count > 0) {
    out.push({
      id: "pending",
      tone: "down",
      text: `${k.pendingInvoices.count} factura${k.pendingInvoices.count === 1 ? "" : "s"} pendiente${k.pendingInvoices.count === 1 ? "" : "s"} de cobro (${formatMoney(k.pendingInvoices.amount as Cents)}).`,
      weight: 70,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
