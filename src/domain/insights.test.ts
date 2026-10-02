import { describe, expect, it } from "vitest";
import { buildInsights } from "./insights";
import type { PeriodKpis } from "./analytics";

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

const base: PeriodKpis = {
  revenue: 0, salesRevenue: 0, invoiceRevenue: 0, operations: 0, avgTicket: null, units: 0, byMethod: [], uncollected: 0, byCategory: [], byProduct: [],
  dropIns: { units: 0, amount: 0 }, vatCollected: 0, pendingInvoices: { count: 0, amount: 0 }, hasAggregates: false, hasUnknownTime: false,
};

describe("insights (lectura automática, solo con datos reales)", () => {
  it("explica la variación de facturación y de ticket medio con importes exactos", () => {
    const k = { ...base, revenue: 108_300, salesRevenue: 108_300, avgTicket: 1560 };
    const prev = { ...base, revenue: 100_000, salesRevenue: 100_000, avgTicket: 1240 };
    const r = buildInsights({ k, prev, prevLabel: "Septiembre 2026" });
    expect(plain(r[0]!.text)).toBe("La facturación ha subido un 8,3 % frente a septiembre 2026 (+83,00 €).");
    expect(plain(r.find((i) => i.id === "ticket")!.text)).toBe("El ticket medio ha subido 3,20 €: de 12,40 € a 15,60 €.");
  });

  it("no inventa nada sin base de comparación", () => {
    expect(buildInsights({ k: { ...base, revenue: 5000 }, prev: base })).toEqual([]);
  });

  it("peso de las cuotas, categoría dominante, método principal y retención", () => {
    const k = {
      ...base, revenue: 10_000, salesRevenue: 2_800, invoiceRevenue: 7_200,
      byCategory: [{ id: "a", name: "Bebidas", color: "", amount: 1_400, units: 10 }, { id: "b", name: "Merch", color: "", amount: 1_400, units: 2 }],
      byMethod: [{ key: "card", name: "Tarjeta", amount: 6_400 }, { key: "cash", name: "Efectivo", amount: 3_600 }],
    };
    const r = buildInsights({ k, prev: base, customers: { total: 50, active: 40, newInPeriod: 3, retention: 0.81, firstTimeBuyers: 3, returningBuyers: 37 } });
    const t = r.map((i) => plain(i.text));
    expect(t).toContain("Las cuotas y facturas suponen el 72 % de la facturación; la caja, el 28 %.");
    expect(t).toContain("Bebidas concentra el 50 % de las ventas de caja.");
    expect(t).toContain("El 64 % de lo cobrado entra por tarjeta.");
    expect(t).toContain("El 81 % de los clientes activos del periodo anterior ha vuelto a comprar o pagar.");
    expect(t).toContain("3 clientes nuevos en el periodo.");
  });
});

import { comparablePrevious, makePeriod } from "@/lib/dates";
describe("comparación justa de periodos en curso", () => {
  it("el trimestre en curso se compara con los mismos días del anterior", () => {
    const now = new Date(2026, 9, 5, 12);
    const p = comparablePrevious(makePeriod("quarter", now), now);
    expect([p.start.getMonth(), p.start.getDate(), p.end.getMonth(), p.end.getDate()]).toEqual([6, 1, 6, 6]);
  });
  it("un periodo cerrado se compara con el anterior completo", () => {
    const p = comparablePrevious(makePeriod("30d", new Date(2026, 9, 5)), new Date(2026, 9, 5));
    expect(Math.round((p.end.getTime() - p.start.getTime()) / 86_400_000)).toBe(30);
  });
});
