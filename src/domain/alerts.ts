/**
 * Alertas calculadas a partir de datos reales. Cada alerta explica su motivo y enlaza a la acción.
 * (Nunca puntuaciones arbitrarias: si aparece, se puede justificar con los registros.)
 */
import type { Workspace } from "@/data/store";
import { daysBetween, formatDate, isSameDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export interface Alert {
  id: string;
  severity: "info" | "warning" | "danger";
  title: string;
  reason: string;
  to: string;
  cta: string;
}

export function computeAlerts(ws: Workspace, now = new Date(), locationId?: string): Alert[] {
  const out: Alert[] = [];
  const locName = new Map(ws.locations.map((l) => [l.id, l.name]));

  for (const s of ws.cashSessions) {
    if (s.status !== "open" || (locationId && s.locationId !== locationId)) continue;
    if (!isSameDay(new Date(s.openedAt), now)) {
      out.push({
        id: `cash-open-${s.id}`, severity: "danger", title: `Caja sin cerrar en ${locName.get(s.locationId) ?? "un centro"}`,
        reason: `Abierta el ${formatDate(s.openedAt)} (hace ${daysBetween(new Date(s.openedAt), now)} días). Las ventas de hoy se están sumando a ese turno.`,
        to: "/cierres", cta: "Cerrar caja",
      });
    }
  }

  // Cierres recientes con descuadre (últimos 7 días, vigentes)
  const recentDiscrepancies = ws.cashClosings.filter((c) => {
    if (c.supersededAt || c.status !== "discrepancy" || daysBetween(new Date(c.closedAt), now) > 7) return false;
    const session = ws.cashSessions.find((x) => x.id === c.cashSessionId);
    return !locationId || session?.locationId === locationId;
  });
  if (recentDiscrepancies.length) {
    const last = recentDiscrepancies.reduce((a, c) => (c.closedAt > a.closedAt ? c : a));
    out.push({
      id: "cash-discrepancy", severity: "warning",
      title: recentDiscrepancies.length === 1 ? "Descuadre en un cierre de caja" : `${recentDiscrepancies.length} cierres con descuadre esta semana`,
      reason: `Último: ${formatDate(last.closedAt)}, diferencia de ${formatMoney(last.difference)}${last.notes ? ` · «${last.notes}»` : ""}.`,
      to: "/cierres", cta: "Revisar cierres",
    });
  }

  // Clientes en riesgo: compraban o pagaban con regularidad (≥ 2 veces) y llevan más de 30 días sin actividad
  const lastActivity = new Map<string, { last: number; count: number }>();
  const touch = (id: string | undefined, iso: string | undefined) => {
    if (!id || !iso) return;
    const t = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime();
    const r = lastActivity.get(id) ?? { last: 0, count: 0 };
    lastActivity.set(id, { last: Math.max(r.last, t), count: r.count + 1 });
  };
  for (const x of ws.sales) if (x.status !== "voided" && (!locationId || x.locationId === locationId)) touch(x.customerId, x.occurredAt);
  for (const x of ws.invoices) if (x.status !== "void") touch(x.customerId, x.issueDate);
  const atRisk = ws.customers.filter((c) => {
    const r = lastActivity.get(c.id);
    return !c.deletedAt && c.status === "active" && r && r.count >= 2 && daysBetween(new Date(r.last), now) > 30;
  });
  if (atRisk.length) {
    out.push({
      id: "customers-at-risk", severity: "info",
      title: `${atRisk.length} ${atRisk.length === 1 ? "cliente habitual" : "clientes habituales"} sin actividad en 30 días`,
      reason: "Compraban o pagaban con regularidad y no hay ventas ni facturas suyas en el último mes.",
      to: "/clientes?filtro=riesgo", cta: "Ver clientes",
    });
  }

  const pending = ws.invoices.filter((i) => i.status === "issued" || i.status === "partially_paid");
  if (pending.length) {
    const amount = pending.reduce((s, i) => s + i.total - i.amountPaid, 0);
    const oldest = pending.reduce((a, i) => (!a || (i.issueDate ?? "") < a ? i.issueDate ?? a : a), "" as string);
    out.push({
      id: "invoices-pending", severity: "warning", title: `${pending.length} ${pending.length === 1 ? "factura pendiente" : "facturas pendientes"} de cobro`,
      reason: `${formatMoney(amount)} sin cobrar${oldest ? `; la más antigua del ${formatDate(oldest)}` : ""}.`, to: "/facturas?estado=pendiente", cta: "Ver pendientes",
    });
  }

  const low = ws.products.filter((p) => p.status === "active" && p.trackStock && p.minStock !== undefined && (p.stockQuantity ?? 0) <= p.minStock);
  if (low.length) {
    out.push({
      id: "low-stock", severity: "warning", title: `${low.length} ${low.length === 1 ? "producto con stock bajo" : "productos con stock bajo"}`,
      reason: low.slice(0, 3).map((p) => `${p.name} (${p.stockQuantity ?? 0})`).join(", ") + (low.length > 3 ? "…" : ""), to: "/catalogo", cta: "Revisar stock",
    });
  }

  const badTax = ws.customers.filter((c) => !c.deletedAt && c.taxIdValid === false);
  const noTax = ws.customers.filter((c) => !c.deletedAt && !c.taxId && ws.invoices.some((i) => i.customerId === c.id));
  if (badTax.length || noTax.length) {
    out.push({
      id: "customer-taxid", severity: "info", title: "Datos fiscales de clientes incompletos",
      reason: [badTax.length && `${badTax.length} con NIF no válido`, noTax.length && `${noTax.length} facturados sin NIF`].filter(Boolean).join(" · ") + ". Corrígelos antes de emitir facturas nuevas.",
      to: "/clientes?filtro=fiscal", cta: "Revisar clientes",
    });
  }

  const unvalidatedTax = ws.products.filter((p) => p.status === "active" && p.importId && p.taxRateBp === 1000);
  if (unvalidatedTax.length) {
    out.push({
      id: "tax-validate", severity: "info", title: `IVA propuesto en ${unvalidatedTax.length} productos importados`,
      reason: "Se propuso IVA reducido (10 %) según la categoría (alimentación y bebidas). Confírmalo con tu asesoría fiscal.", to: "/catalogo", cta: "Revisar catálogo",
    });
  }

  if (!ws.cashSessions.some((s) => s.status === "open" && (!locationId || s.locationId === locationId)) && ws.products.some((p) => p.status === "active")) {
    out.push({ id: "cash-closed", severity: "info", title: "La caja está cerrada", reason: "Ábrela para empezar a registrar ventas de hoy.", to: "/caja", cta: "Abrir caja" });
  }

  const rank = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
