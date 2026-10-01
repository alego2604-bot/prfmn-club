import type { CellValue, SheetData, WorkbookData } from "./types";

/**
 * Excel guarda fechas sin zona; ExcelJS las devuelve como si fueran UTC. Las reinterpretamos como hora local
 * ("lo que se ve en la celda"), que es lo que el usuario escribió.
 */
function excelDateToLocal(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : excelDateToLocal(v);
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return normalizeCell(o.result);
    if ("richText" in o && Array.isArray(o.richText)) return normalizeCell((o.richText as { text: string }[]).map((t) => t.text).join(""));
    if ("text" in o) return normalizeCell(o.text);
    if ("error" in o) return null;
  }
  return String(v);
}

export async function readXlsx(buffer: ArrayBuffer, fileName: string): Promise<WorkbookData> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    const maxCol = Math.min(ws.columnCount || 0, 60);
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      for (let c = 1; c <= maxCol; c++) cells.push(normalizeCell(row.getCell(c).value));
      rows[rowNumber - 1] = cells;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    // Recorta filas vacías al final
    while (rows.length && rows[rows.length - 1]!.every((c) => c === null)) rows.pop();
    sheets.push({ name: ws.name, rows });
  });
  return { fileName, format: "xlsx", sheets };
}

/** CSV con detección de separador (; , tab) y comillas. */
export function readCsv(text: string, fileName: string): WorkbookData {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    row.push(field.trim() === "" ? null : field);
    field = "";
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      pushField();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    pushField();
    rows.push(row);
  }
  return { fileName, format: "csv", sheets: [{ name: fileName.replace(/\.[^.]+$/, ""), rows }] };
}

export async function readFile(file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ data: WorkbookData; buffer: ArrayBuffer }> {
  const buffer = await file.arrayBuffer();
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return { data: await readXlsx(buffer, file.name), buffer };
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return { data: readCsv(new TextDecoder("utf-8").decode(buffer), file.name), buffer };
  if (lower.endsWith(".xls")) throw new Error("Formato .xls antiguo: ábrelo en Excel y guárdalo como .xlsx");
  if (/\.(pdf|jpe?g|png)$/.test(lower)) throw new Error("PDF e imágenes se procesarán con lectura inteligente (OCR) en una próxima fase. Por ahora: XLSX o CSV.");
  throw new Error("Formato no soportado. Usa XLSX o CSV.");
}
