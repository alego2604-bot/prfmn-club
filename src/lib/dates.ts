/**
 * Fechas: se almacenan como ISO UTC. Los periodos se calculan en la hora local del dispositivo,
 * que para el MVP coincide con la zona de la empresa (Europe/Madrid). Ver docs/DECISIONS.md.
 */

export type PeriodPreset = "today" | "7d" | "30d" | "month" | "quarter" | "year" | "custom";

export interface Period {
  preset: PeriodPreset;
  start: Date; // inclusivo
  end: Date; // exclusivo
  label: string;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const monthName = (m: number) => MONTHS[m] ?? "";
export const monthShort = (m: number) => MONTHS_SHORT[m] ?? "";
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
export function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function makePeriod(preset: PeriodPreset, now = new Date(), custom?: { start: Date; end: Date }): Period {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { preset, start: today, end: addDays(today, 1), label: "Hoy" };
    case "7d":
      return { preset, start: addDays(today, -6), end: addDays(today, 1), label: "Últimos 7 días" };
    case "30d":
      return { preset, start: addDays(today, -29), end: addDays(today, 1), label: "Últimos 30 días" };
    case "month":
      return { preset, start: startOfMonth(today), end: addMonths(today, 1), label: capitalize(`${monthName(today.getMonth())} ${today.getFullYear()}`) };
    case "quarter": {
      const s = startOfQuarter(today);
      return { preset, start: s, end: addMonths(s, 3), label: `Q${quarterOf(today)} ${today.getFullYear()}` };
    }
    case "year":
      return { preset, start: startOfYear(today), end: new Date(today.getFullYear() + 1, 0, 1), label: `${today.getFullYear()}` };
    case "custom": {
      const s = startOfDay(custom?.start ?? today);
      const e = addDays(startOfDay(custom?.end ?? today), 1);
      return { preset, start: s, end: e, label: `${formatDate(s)} – ${formatDate(addDays(e, -1))}` };
    }
  }
}

export function quarterPeriod(year: number, q: number): Period {
  const start = new Date(year, (q - 1) * 3, 1);
  return { preset: "custom", start, end: addMonths(start, 3), label: `Q${q} ${year}` };
}

/** Periodo inmediatamente anterior de la misma duración (para meses/trimestres/años usa el calendario). */
export function previousPeriod(p: Period): Period {
  if (p.preset === "month") {
    const s = addMonths(p.start, -1);
    return { ...p, start: s, end: p.start, label: capitalize(`${monthName(s.getMonth())} ${s.getFullYear()}`) };
  }
  if (p.preset === "quarter") {
    const s = addMonths(p.start, -3);
    return { ...p, start: s, end: p.start, label: `Q${quarterOf(s)} ${s.getFullYear()}` };
  }
  if (p.preset === "year") {
    const s = new Date(p.start.getFullYear() - 1, 0, 1);
    return { ...p, start: s, end: p.start, label: `${s.getFullYear()}` };
  }
  const len = p.end.getTime() - p.start.getTime();
  return { ...p, start: new Date(p.start.getTime() - len), end: p.start, label: "Periodo anterior" };
}

/** Mismo periodo del año anterior. */
export function yearAgoPeriod(p: Period): Period {
  const shift = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
  return { ...p, start: shift(p.start), end: shift(p.end), label: `${p.label} (año anterior)` };
}

/** Para comparar "mes en curso" con "mes anterior" de forma justa: mismo nº de días transcurridos. */
export function toDateClamp(p: Period, now = new Date()): Period {
  const end = addDays(startOfDay(now), 1);
  return end < p.end ? { ...p, end } : p;
}

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
const longFmt = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });

export const formatDate = (d: Date | string) => dateFmt.format(typeof d === "string" ? new Date(d) : d);
export const formatDateShort = (d: Date | string) => dateShortFmt.format(typeof d === "string" ? new Date(d) : d).replace(".", "");
export const formatTime = (d: Date | string) => timeFmt.format(typeof d === "string" ? new Date(d) : d);
export const formatDateLong = (d: Date | string) => longFmt.format(typeof d === "string" ? new Date(d) : d);
export const formatDateTime = (d: Date | string) => `${formatDate(d)} ${formatTime(d)}`;

export function relativeDays(d: Date | string, now = new Date()): string {
  const n = daysBetween(typeof d === "string" ? new Date(d) : d, now);
  if (n === 0) return "hoy";
  if (n === 1) return "ayer";
  if (n > 1) return `hace ${n} días`;
  if (n === -1) return "mañana";
  return `en ${-n} días`;
}

/** ISO date (yyyy-mm-dd) en hora local. */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function inPeriod(iso: string, p: Period): boolean {
  const t = new Date(iso).getTime();
  return t >= p.start.getTime() && t < p.end.getTime();
}

/** Parse estricto dd/mm/yyyy (nunca Date.parse: invierte día y mes). */
export function parseDMY(s: string): Date | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  const year = yy!.length === 2 ? 2000 + Number(yy) : Number(yy);
  const d = new Date(year, Number(mm) - 1, Number(dd), hh ? Number(hh) : 0, mi ? Number(mi) : 0);
  if (d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return null;
  return d;
}
