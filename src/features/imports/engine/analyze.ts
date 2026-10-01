import { normalizeKey } from "@/lib/text";
import { CATALOG_FIELDS, IGNORED_HEADERS, INVOICE_FIELDS, SALES_FIELDS } from "./fields";
import type { CellValue, ColumnMapping, FieldDef, FileAnalysis, SheetAnalysis, SheetData, SheetRole, TargetKind, WorkbookData } from "./types";

export function cellText(v: CellValue): string {
  if (v === null) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    const t = v.getHours() || v.getMinutes() ? ` ${p(v.getHours())}:${p(v.getMinutes())}` : "";
    return `${p(v.getDate())}/${p(v.getMonth() + 1)}/${v.getFullYear()}${t}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000).replace(".", ",");
  return String(v).replace(/\s+/g, " ").trim();
}

/** Puntuación de una cabecera para un campo: exacta = 3, contiene sinónimo como palabras = 1. */
function scoreHeader(header: string, field: FieldDef): number {
  const h = normalizeKey(header);
  if (!h) return 0;
  if (field.synonyms.includes(h)) return 3;
  if (field.synonyms.some((s) => s.length > 3 && (` ${h} `.includes(` ${s} `) || h.startsWith(s)))) return 1;
  return 0;
}

/** Asigna columnas a campos (cada campo como mucho una vez; gana la mejor puntuación). */
export function mapColumns(headers: CellValue[], fields: FieldDef[], samplesFor: (col: number) => string[]): ColumnMapping[] {
  const cols: ColumnMapping[] = [];
  const candidates: { col: number; field: string; score: number }[] = [];
  headers.forEach((h, i) => {
    if (typeof h !== "string") return;
    if (IGNORED_HEADERS.includes(normalizeKey(h))) return;
    for (const f of fields) {
      const s = scoreHeader(h, f);
      if (s) candidates.push({ col: i, field: f.key, score: s });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const usedCols = new Set<number>();
  const usedFields = new Set<string>();
  const assigned = new Map<number, { field: string; score: number }>();
  for (const c of candidates) {
    if (usedCols.has(c.col) || usedFields.has(c.field)) continue;
    usedCols.add(c.col);
    usedFields.add(c.field);
    assigned.set(c.col, c);
  }
  headers.forEach((h, i) => {
    if (typeof h !== "string" || !h.trim()) return;
    const a = assigned.get(i);
    cols.push({ index: i, header: h.replace(/\s+/g, " ").trim(), field: a?.field ?? null, confidence: a ? (a.score >= 3 ? "high" : "medium") : "none", samples: samplesFor(i) });
  });
  return cols;
}

function stringCount(row: CellValue[] | undefined): number {
  return (row ?? []).filter((c) => typeof c === "string" && c.trim().length > 0 && c.length < 60).length;
}

/** Busca la fila de cabecera: la que más campos conocidos reconoce en las primeras 30 filas. */
function findHeader(sheet: SheetData, fields: FieldDef[]): { index: number; score: number; matched: string[] } {
  let best = { index: -1, score: 0, matched: [] as string[] };
  for (let r = 0; r < Math.min(30, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    if (stringCount(row) < 2) continue;
    const matched = new Set<string>();
    let score = 0;
    for (const c of row) {
      if (typeof c !== "string") continue;
      for (const f of fields) {
        const s = scoreHeader(c, f);
        if (s && !matched.has(f.key)) {
          matched.add(f.key);
          score += s;
          break;
        }
      }
    }
    if (score > best.score) best = { index: r, score, matched: [...matched] };
  }
  return best;
}

function samples(sheet: SheetData, headerIndex: number, col: number): string[] {
  const out: string[] = [];
  for (let r = headerIndex + 1; r < sheet.rows.length && out.length < 4; r++) {
    const t = cellText(sheet.rows[r]?.[col] ?? null);
    if (t) out.push(t.length > 40 ? `${t.slice(0, 40)}…` : t);
  }
  return out;
}

function countDataRows(sheet: SheetData, headerIndex: number, cols: ColumnMapping[]): number {
  const mapped = cols.filter((c) => c.field).map((c) => c.index);
  let n = 0;
  for (let r = headerIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (mapped.filter((i) => row[i] !== null && row[i] !== undefined).length >= 2) n++;
  }
  return n;
}

const has = (m: string[], ...keys: string[]) => keys.every((k) => m.includes(k));

/** Analiza todas las hojas y decide el tipo de importación. */
export function analyzeWorkbook(wb: WorkbookData, forceKind?: TargetKind): FileAnalysis {
  const sheets: SheetAnalysis[] = [];
  const notes: string[] = [];
  for (const sheet of wb.sheets) {
    const nonEmpty = sheet.rows.filter((r) => r.some((c) => c !== null)).length;
    if (!nonEmpty) {
      sheets.push({ name: sheet.name, role: "empty", headerRowIndex: -1, columns: [], dataRowCount: 0, include: false, reason: "Hoja vacía" });
      continue;
    }
    const hs = findHeader(sheet, SALES_FIELDS);
    const hi = findHeader(sheet, INVOICE_FIELDS);
    const hc = findHeader(sheet, CATALOG_FIELDS);

    let role: SheetRole = "unknown";
    let header = hs;
    let fields = SALES_FIELDS;
    if (has(hi.matched, "invoice_number", "total") && (hi.matched.includes("customer") || hi.matched.includes("tax_id"))) {
      role = "invoices"; header = hi; fields = INVOICE_FIELDS;
    } else if (has(hs.matched, "date", "product") && (hs.matched.includes("total") || hs.matched.includes("unit_price"))) {
      role = "sales"; header = hs; fields = SALES_FIELDS;
    } else if (has(hc.matched, "product", "price") && !hs.matched.includes("date")) {
      role = "catalog"; header = hc; fields = CATALOG_FIELDS;
    } else if (hs.score > 0 || hi.score > 0) {
      role = "summary";
    }

    if (role === "summary" || role === "unknown") {
      sheets.push({
        name: sheet.name, role, headerRowIndex: -1, columns: [], dataRowCount: 0, include: false,
        reason: role === "summary" ? "Resumen calculado (fórmulas): el sistema recalcula estas cifras, no se importa" : "No se reconocen columnas de datos",
      });
      continue;
    }
    const columns = mapColumns(sheet.rows[header.index] ?? [], fields, (c) => samples(sheet, header.index, c));
    const dataRowCount = countDataRows(sheet, header.index, columns);
    sheets.push({
      name: sheet.name, role, headerRowIndex: header.index, columns, dataRowCount, include: dataRowCount > 0,
      reason: dataRowCount > 0 ? "" : "Sin filas de datos",
    });
  }

  const salesRows = sheets.filter((s) => s.role === "sales").reduce((a, s) => a + s.dataRowCount, 0);
  const invRows = sheets.filter((s) => s.role === "invoices").reduce((a, s) => a + s.dataRowCount, 0);
  const kind: TargetKind | null = forceKind ?? (salesRows === 0 && invRows === 0 ? null : invRows > salesRows ? "invoices" : "sales");
  for (const s of sheets) {
    if (kind === "sales" && s.role === "invoices") { s.include = false; s.reason = "Hoja de facturas: impórtala por separado"; }
    if (kind === "invoices" && (s.role === "sales" || s.role === "catalog")) { s.include = false; s.reason = "Hoja de ventas/catálogo: impórtala por separado"; }
  }
  if (kind === "sales" && sheets.some((s) => s.role === "catalog" && s.include)) {
    notes.push("Se ha encontrado un catálogo en el archivo: los productos se crearán/emparejarán antes de importar las ventas.");
  }
  if (sheets.some((s) => s.role === "summary")) {
    notes.push("Las hojas de resumen (dashboards con fórmulas) se omiten: el sistema calcula esos KPIs para cualquier periodo.");
  }
  return { kind, sheets, notes };
}
