import { parseDMY } from "@/lib/dates";
import { parseMoneyInput, type Cents } from "@/lib/money";
import { normalizeKey } from "@/lib/text";
import { cellText } from "./analyze";
import type { CellValue, SheetAnalysis, SheetData } from "./types";

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_CA = ["gener", "febrer", "marc", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"];

/** Índice de mes (0-11) si el texto ES un nombre de mes (es/en/ca), si no null. */
export function monthFromName(s: string): number | null {
  const k = normalizeKey(s);
  for (const list of [MONTHS_ES, MONTHS_EN, MONTHS_CA]) {
    const i = list.indexOf(k);
    if (i >= 0) return i;
  }
  if (k === "setiembre") return 8;
  return null;
}

/** Busca un nombre de mes dentro de un texto ("Cuota july   16 CREDITOS" → 6). */
export function monthInText(s: string): number | null {
  for (const w of normalizeKey(s).split(" ")) {
    const m = monthFromName(w);
    if (m !== null && w.length > 3) return m;
  }
  return null;
}

export function toDate(v: CellValue): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = parseDMY(v);
    if (d) return d;
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v.trim());
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0));
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Serial de Excel (CSV exportado sin formato)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  }
  return null;
}

export function toMoney(v: CellValue): Cents | null {
  if (v === null) return null;
  if (typeof v === "number") return Math.round(v * 100);
  if (typeof v === "string") return parseMoneyInput(v);
  return null;
}

export function toNumber(v: CellValue): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valores de una fila por campo según el mapeo de la hoja. */
export function rowFields(row: CellValue[], sa: SheetAnalysis): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of sa.columns) if (c.field) out[c.field] = row[c.index] ?? null;
  return out;
}

export function rawOf(row: CellValue[], sa: SheetAnalysis): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of sa.columns) {
    const t = cellText(row[c.index] ?? null);
    if (t) out[c.header] = t;
  }
  return out;
}

/** Texto de una fila que no es un registro (instrucciones, "...", pies) */
export function rowText(row: CellValue[]): string {
  return row.map(cellText).filter(Boolean).join(" · ").slice(0, 120);
}

/** Control de cuadre: busca "Total mes"/"Total" sobre la cabecera y el número inmediatamente debajo. */
export function findDeclaredTotal(sheet: SheetData, headerIndex: number): Cents | null {
  for (let r = 0; r <= headerIndex; r++) {
    const row = sheet.rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === "string" && ["total mes", "total", "total del mes", "total periodo"].includes(normalizeKey(v))) {
        const below = sheet.rows[r + 1]?.[c];
        if (typeof below === "number") return Math.round(below * 100);
      }
    }
  }
  return null;
}
