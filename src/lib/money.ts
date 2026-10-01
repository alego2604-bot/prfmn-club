/**
 * Dinero SIEMPRE en céntimos enteros. IVA en puntos básicos (2100 = 21 %).
 * Los precios de venta son con IVA incluido (B2C); base e IVA se derivan.
 */
export type Cents = number;
export type BasisPoints = number;

export function toCents(euros: number): Cents {
  return Math.round(euros * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Desglosa un importe con IVA incluido en base + cuota. La cuota absorbe el redondeo (base + iva = total, siempre). */
export function splitGross(gross: Cents, rateBp: BasisPoints): { base: Cents; tax: Cents } {
  const base = Math.round((gross * 10000) / (10000 + rateBp));
  return { base, tax: gross - base };
}

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const eurCompact = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurShort = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(cents: Cents, opts: { compact?: boolean; short?: boolean } = {}): string {
  const v = cents / 100;
  if (opts.short && Math.abs(v) >= 10000) return eurShort.format(v);
  if (opts.compact && Number.isInteger(v)) return eurCompact.format(v);
  return eur.format(v);
}

export function formatRate(bp: BasisPoints): string {
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(".", ",")} %`;
}

/**
 * Interpreta "2,50", "2.50", "1.234,56", "1,234.56", "€ 12", "12 €" → céntimos. null si no es un número.
 */
export function parseMoneyInput(raw: string | number | null | undefined): Cents | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? toCents(raw) : null;
  let s = raw.replace(/[€\s]/g, "").replace(/EUR/i, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El separador que aparece último es el decimal
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return toCents(Number(s));
}
