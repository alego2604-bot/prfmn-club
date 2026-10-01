import type { Cents } from "@/lib/money";
import type { CashMovement, CashSession, Payment, PaymentMethod, Sale } from "./types";

export interface CashSummary {
  salesCount: number;
  salesTotal: Cents;
  /** Totales cobrados por método (clave = payment_method.key) */
  totalsByMethod: Record<string, Cents>;
  openingFloat: Cents;
  cashIn: Cents;
  cashOut: Cents;
  /** Efectivo que debería haber en el cajón */
  expectedCash: Cents;
}

/**
 * Resumen de una sesión de caja. Fuente: pagos (no ventas) — una venta pagada mitad tarjeta mitad efectivo
 * solo aporta al cajón la parte en efectivo. Las ventas anuladas no cuentan.
 */
export function summarizeCashSession(
  session: CashSession,
  sales: Sale[],
  payments: Payment[],
  movements: CashMovement[],
  methods: PaymentMethod[],
): CashSummary {
  const sessionSales = sales.filter((s) => s.cashSessionId === session.id && s.status !== "voided");
  const validSaleIds = new Set(sessionSales.map((s) => s.id));
  const drawerKeys = new Set(methods.filter((m) => m.affectsCashDrawer).map((m) => m.key));

  const totalsByMethod: Record<string, Cents> = {};
  let drawerFromPayments = 0;
  for (const p of payments) {
    if (p.cashSessionId !== session.id || p.status !== "succeeded") continue;
    if (p.saleId && !validSaleIds.has(p.saleId)) continue;
    const signed = p.kind === "refund" ? -p.amount : p.amount;
    totalsByMethod[p.methodKey] = (totalsByMethod[p.methodKey] ?? 0) + signed;
    if (drawerKeys.has(p.methodKey)) drawerFromPayments += signed;
  }

  const sessionMovements = movements.filter((m) => m.cashSessionId === session.id);
  const cashIn = sessionMovements.filter((m) => m.kind === "cash_in").reduce((s, m) => s + m.amount, 0);
  const cashOut = sessionMovements.filter((m) => m.kind === "cash_out").reduce((s, m) => s + m.amount, 0);

  return {
    salesCount: sessionSales.length,
    salesTotal: sessionSales.reduce((s, x) => s + x.total, 0),
    totalsByMethod,
    openingFloat: session.openingFloat,
    cashIn,
    cashOut,
    expectedCash: session.openingFloat + drawerFromPayments + cashIn - cashOut,
  };
}

export function closingStatus(expected: Cents, counted: Cents): { difference: Cents; status: "balanced" | "discrepancy" } {
  const difference = counted - expected;
  return { difference, status: difference === 0 ? "balanced" : "discrepancy" };
}

/** Denominaciones para el arqueo asistido (euro). */
export const EURO_DENOMINATIONS: Cents[] = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

export function countDenominations(counts: Record<number, number>): Cents {
  return Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * (Number.isFinite(n) ? n : 0), 0);
}
