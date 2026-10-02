import { describe, expect, it } from "vitest";
import { computeKpis, customerStats, locationBreakdown, todayComparison, type Dataset } from "./analytics";
import { makePeriod, previousPeriod } from "@/lib/dates";
import type { Invoice, Sale } from "./types";

const sale = (id: string, at: Date, total: number, loc = "L1", customerId?: string): Sale => ({
  id, organizationId: "o", locationId: loc, number: 1, occurredAt: at.toISOString(), timePrecision: "exact", granularity: "transaction",
  subtotal: total, taxTotal: 0, discountTotal: 0, total, status: "completed", source: "pos", createdAt: at.toISOString(), customerId,
});
const invoice = (id: string, issue: string, total: number, status: Invoice["status"] = "paid", customerId?: string): Invoice => ({
  id, organizationId: "o", locationId: "L1", issueDate: issue, customerId, subtotal: total, taxTotal: 0, total, amountPaid: status === "paid" ? total : 0, status, source: "membership", createdAt: `${issue}T00:00:00.000Z`,
} as Invoice);
const ds = (sales: Sale[], invoices: Invoice[] = []): Dataset => ({ sales, saleItems: [], payments: [], invoices, categories: [], paymentMethods: [] });

describe("Comparaciones honestas", () => {
  // Viernes 2 de octubre de 2026, 11:00. Ayer (día 1) se emitieron las cuotas del mes.
  const now = new Date(2026, 9, 2, 11, 0);

  it("«hoy» se compara con el mismo día de la semana pasada a la misma hora, solo caja (sin alarma por cuotas)", () => {
    const d = ds(
      [
        sale("hoy", new Date(2026, 9, 2, 9, 0), 2000),
        sale("ref", new Date(2026, 8, 25, 10, 0), 1600), // viernes pasado antes de las 11
        sale("ref-tarde", new Date(2026, 8, 25, 18, 0), 9999), // después de la hora: no cuenta
      ],
      [invoice("cuotas-ayer", "2026-10-01", 350_000), invoice("cuota-hoy", "2026-10-02", 6900)],
    );
    const c = todayComparison(d, now);
    expect(c.today).toBe(2000);
    expect(c.reference).toBe(1600);
    expect(c.referenceLabel).toBe("el viernes pasado a esta hora");
    expect(c.invoicesToday).toBe(6900);
  });

  it("sin actividad en la referencia no hay porcentaje (null), nunca −100 % ni infinito", () => {
    const c = todayComparison(ds([sale("hoy", new Date(2026, 9, 2, 9, 0), 2000)]), now);
    expect(c.reference).toBeNull();
  });

  it("lo pendiente de cobro no aparece como método de pago", () => {
    const p = makePeriod("month", now);
    const k = computeKpis(ds([], [invoice("a", "2026-10-01", 5000, "paid"), invoice("b", "2026-10-01", 7000, "issued")]), p);
    expect(k.byMethod.map((m) => m.key)).not.toContain("pending");
    expect(k.uncollected).toBe(7000);
  });

  it("clientes nuevos frente a recurrentes en el periodo", () => {
    const p = makePeriod("month", now);
    const d = ds([sale("antes", new Date(2026, 7, 10), 100, "L1", "c-viejo"), sale("x", new Date(2026, 9, 1, 10), 100, "L1", "c-viejo"), sale("y", new Date(2026, 9, 1, 12), 100, "L1", "c-nuevo")]);
    const st = customerStats(d, [], p, previousPeriod(p));
    expect(st.active).toBe(2);
    expect(st.firstTimeBuyers).toBe(1);
    expect(st.returningBuyers).toBe(1);
  });

  it("comparación entre centros", () => {
    const p = makePeriod("month", now);
    const d = ds([sale("n", new Date(2026, 9, 1, 10), 3000, "N"), sale("s", new Date(2026, 9, 1, 11), 1000, "S")]);
    const rows = locationBreakdown(d, [{ id: "N", name: "Norte", status: "active" }, { id: "S", name: "Sur", status: "active" }], p);
    expect(rows.map((r) => [r.name, r.revenue])).toEqual([["Norte", 3000], ["Sur", 1000]]);
  });
});
