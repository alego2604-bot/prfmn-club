import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, unitMargin } from "./pricing";
import { closingStatus, countDenominations, summarizeCashSession } from "./cash";
import { computeKpis, percentChange, revenueSeries, type Dataset } from "./analytics";
import { parseMoneyInput, splitGross } from "@/lib/money";
import { makePeriod, parseDMY, previousPeriod, quarterPeriod } from "@/lib/dates";
import { classifyTaxId } from "@/lib/taxid";
import type { CashSession, Payment, PaymentMethod, Sale } from "./types";

describe("IVA y líneas", () => {
  it("desglosa IVA incluido sin perder céntimos", () => {
    expect(splitGross(7300, 2100)).toEqual({ base: 6033, tax: 1267 }); // cuota 16 créditos real
    expect(splitGross(6200, 2100)).toEqual({ base: 5124, tax: 1076 }); // cuota 11 créditos real
    expect(splitGross(100, 1000)).toEqual({ base: 91, tax: 9 });
    for (let g = 0; g < 5000; g += 7) {
      const { base, tax } = splitGross(g, 2100);
      expect(base + tax).toBe(g);
    }
  });

  it("calcula línea con cantidad y descuento", () => {
    expect(computeLine({ unitPrice: 250, quantity: 3, taxRateBp: 1000 })).toEqual({ gross: 750, baseAmount: 682, taxAmount: 68, total: 750 });
    expect(computeLine({ unitPrice: 1500, quantity: 2, discount: 500, taxRateBp: 2100 }).total).toBe(2500);
    expect(() => computeLine({ unitPrice: 100, quantity: 0, taxRateBp: 2100 })).toThrow();
  });

  it("totaliza por tipo de IVA y cuadra base + IVA = total", () => {
    const t = computeTotals([
      { unitPrice: 100, quantity: 2, taxRateBp: 1000 },
      { unitPrice: 1500, quantity: 1, taxRateBp: 2100 },
      { unitPrice: 200, quantity: 1, taxRateBp: 1000 },
    ]);
    expect(t.total).toBe(1900);
    expect(t.subtotal + t.taxTotal).toBe(t.total);
    expect(t.byRate.map((r) => r.rateBp)).toEqual([2100, 1000]);
  });

  it("margen sobre base imponible", () => {
    expect(unitMargin(250, 1000, 120)).toEqual({ margin: 107, pct: 107 / 227 });
    expect(unitMargin(250, 1000)).toBeNull();
  });

  it("interpreta importes escritos a mano", () => {
    expect(parseMoneyInput("2,50")).toBe(250);
    expect(parseMoneyInput("1.234,56 €")).toBe(123456);
    expect(parseMoneyInput("1,234.56")).toBe(123456);
    expect(parseMoneyInput(73)).toBe(7300);
    expect(parseMoneyInput("abc")).toBeNull();
  });
});

const methods: PaymentMethod[] = [
  { id: "m1", organizationId: "o", key: "cash", name: "Efectivo", kind: "cash", affectsCashDrawer: true, status: "active", sortOrder: 1 },
  { id: "m2", organizationId: "o", key: "card", name: "Tarjeta", kind: "card", affectsCashDrawer: false, status: "active", sortOrder: 2 },
  { id: "m3", organizationId: "o", key: "bizum", name: "Bizum", kind: "bizum", affectsCashDrawer: false, status: "active", sortOrder: 3 },
];

function sale(id: string, total: number, extra: Partial<Sale> = {}): Sale {
  return {
    id, organizationId: "o", locationId: "l", number: 1, occurredAt: new Date().toISOString(), timePrecision: "exact",
    granularity: "transaction", subtotal: total, taxTotal: 0, discountTotal: 0, total, status: "completed", source: "pos",
    createdAt: new Date().toISOString(), cashSessionId: "s", ...extra,
  };
}
function pay(saleId: string, methodKey: string, amount: number, extra: Partial<Payment> = {}): Payment {
  return {
    id: `${saleId}-${methodKey}`, organizationId: "o", kind: "charge", saleId, paymentMethodId: methodKey, methodKey,
    methodKind: methodKey as Payment["methodKind"], amount, status: "succeeded", paidAt: new Date().toISOString(),
    cashSessionId: "s", source: "pos", createdAt: new Date().toISOString(), ...extra,
  };
}

describe("Cierre de caja", () => {
  const session: CashSession = { id: "s", organizationId: "o", locationId: "l", openedAt: "", openingFloat: 0, status: "open" };

  it("reproduce el ejemplo del enunciado: 482 € → esperado 122 € en efectivo", () => {
    const sales = [sale("a", 32000), sale("b", 12200), sale("c", 4000)];
    const payments = [pay("a", "card", 32000), pay("b", "cash", 12200), pay("c", "bizum", 4000)];
    const s = summarizeCashSession(session, sales, payments, [], methods);
    expect(s.salesTotal).toBe(48200);
    expect(s.expectedCash).toBe(12200);
    expect(s.totalsByMethod).toEqual({ card: 32000, cash: 12200, bizum: 4000 });
    expect(closingStatus(12200, 12200)).toEqual({ difference: 0, status: "balanced" });
    expect(closingStatus(12200, 12000)).toEqual({ difference: -200, status: "discrepancy" });
  });

  it("pago dividido, fondo, movimientos y ventas anuladas", () => {
    const sales = [sale("a", 2000), sale("v", 999, { status: "voided" })];
    const payments = [pay("a", "cash", 500), pay("a", "card", 1500), pay("v", "cash", 999)];
    const s = summarizeCashSession({ ...session, openingFloat: 5000 }, sales, payments, [
      { id: "1", organizationId: "o", cashSessionId: "s", kind: "cash_in", amount: 1000, reason: "cambio", createdAt: "" },
      { id: "2", organizationId: "o", cashSessionId: "s", kind: "cash_out", amount: 300, reason: "hielo", createdAt: "" },
    ], methods);
    expect(s.salesCount).toBe(1);
    expect(s.expectedCash).toBe(5000 + 500 + 1000 - 300);
  });

  it("arqueo por denominaciones", () => {
    expect(countDenominations({ 5000: 2, 2000: 1, 200: 1 })).toBe(12200);
  });
});

describe("KPIs", () => {
  const p = makePeriod("month", new Date(2026, 8, 15));
  const inSep = (d: number) => new Date(2026, 8, d, 18).toISOString();
  const ds: Dataset = {
    sales: [
      sale("a", 1000, { occurredAt: inSep(1) }),
      sale("b", 3000, { occurredAt: inSep(2) }),
      sale("c", 9000, { occurredAt: inSep(1), granularity: "aggregate" }),
      sale("d", 5000, { occurredAt: inSep(3), status: "voided" }),
      sale("e", 7777, { occurredAt: new Date(2026, 7, 31, 23).toISOString() }),
    ],
    saleItems: [],
    payments: [pay("a", "cash", 1000), pay("b", "card", 3000)],
    invoices: [
      { id: "i", organizationId: "o", subtotal: 6033, taxTotal: 1267, total: 7300, amountPaid: 7300, status: "paid", source: "import", issueDate: "2026-09-01", createdAt: "" },
      { id: "j", organizationId: "o", subtotal: 0, taxTotal: 0, total: 6200, amountPaid: 0, status: "issued", source: "import", issueDate: "2026-09-30", createdAt: "" },
      { id: "k", organizationId: "o", subtotal: 0, taxTotal: 0, total: 6200, amountPaid: 0, status: "paid", source: "import", issueDate: "2026-10-01", createdAt: "" },
    ],
    categories: [],
    paymentMethods: methods,
  };

  it("suma ventas no anuladas + facturas de cuotas por fecha de emisión", () => {
    const k = computeKpis(ds, p);
    expect(k.salesRevenue).toBe(13000);
    expect(k.invoiceRevenue).toBe(13500);
    expect(k.revenue).toBe(26500);
    expect(k.pendingInvoices).toEqual({ count: 1, amount: 6200 });
  });

  it("ticket medio excluye agregados mensuales importados", () => {
    const k = computeKpis(ds, p);
    expect(k.operations).toBe(2);
    expect(k.avgTicket).toBe(2000);
    expect(k.hasAggregates).toBe(true);
  });

  it("métodos de pago: cobrado, desconocido y pendiente", () => {
    const byKey = Object.fromEntries(computeKpis(ds, p).byMethod.map((m) => [m.key, m.amount]));
    expect(byKey).toEqual({ cash: 1000, card: 3000, unknown: 9000 + 7300, pending: 6200 });
  });

  it("serie diaria del mes", () => {
    const s = revenueSeries(ds, p, "day");
    expect(s).toHaveLength(30);
    expect(s[0]!.total).toBe(1000 + 9000 + 7300);
    expect(s[0]!.operations).toBe(1);
  });

  it("variaciones", () => {
    expect(percentChange(110, 100)).toBeCloseTo(0.1);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("Fechas y NIF", () => {
  it("parsea dd/mm/yyyy sin invertir día y mes", () => {
    expect(parseDMY("03/08/2026")?.getMonth()).toBe(7);
    expect(parseDMY("31/02/2026")).toBeNull();
  });
  it("periodos comparables", () => {
    const q3 = quarterPeriod(2026, 3);
    expect(q3.start).toEqual(new Date(2026, 6, 1));
    expect(q3.end).toEqual(new Date(2026, 9, 1));
    const prev = previousPeriod(makePeriod("month", new Date(2026, 0, 10)));
    expect(prev.start).toEqual(new Date(2025, 11, 1));
  });
  it("clasifica identificadores reales del Excel", () => {
    expect(classifyTaxId("87654321X").kind).toBe("dni");
    expect(classifyTaxId("12345678z").normalized).toBe("12345678Z");
    expect(classifyTaxId("x1234567l").kind).toBe("nie");
    expect(classifyTaxId("1234@678Z").valid).toBe(false);
    expect(classifyTaxId("1").valid).toBe(false);
    expect(classifyTaxId("AB1234567").kind).toBe("foreign");
    expect(classifyTaxId("").kind).toBe("empty");
  });
});
