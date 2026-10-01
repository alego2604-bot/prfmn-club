import { NUM } from "@/lib/money";
/** Exportaciones en el navegador. XLSX con ExcelJS (carga diferida), CSV compatible con Excel español (; y BOM). */

export type ExportValue = string | number | Date | null | undefined;

export interface ExportColumn {
  header: string;
  width?: number;
  /** 'money' = número en euros con formato; 'date' = fecha; 'percent' */
  format?: "money" | "date" | "datetime" | "percent" | "integer" | "text";
}

export interface ExportSheet {
  name: string;
  title?: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: ExportValue[][];
  totals?: ExportValue[];
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: ExportValue, format?: ExportColumn["format"]): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = format === "datetime" ? v.toLocaleString("es-ES", NUM) : v.toLocaleDateString("es-ES");
  else if (typeof v === "number") s = format === "integer" ? String(v) : v.toFixed(format === "percent" ? 4 : 2).replace(".", ",");
  else s = v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(sheet: ExportSheet): string {
  const lines = [sheet.columns.map((c) => csvCell(c.header)).join(";")];
  for (const r of sheet.rows) lines.push(r.map((v, i) => csvCell(v, sheet.columns[i]?.format)).join(";"));
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(fileName: string, sheet: ExportSheet) {
  triggerDownload(new Blob([buildCsv(sheet)], { type: "text/csv;charset=utf-8" }), fileName.endsWith(".csv") ? fileName : `${fileName}.csv`);
}

const NUMFMT: Record<string, string> = {
  money: '#,##0.00 "€";[Red]-#,##0.00 "€"',
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  percent: "0.0%",
  integer: "#,##0",
};

export async function buildXlsx(sheets: ExportSheet[], meta: { company: string; generatedBy?: string }): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Business OS";
  wb.company = meta.company;
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: "frozen", ySplit: s.title ? 4 : 1 }] });
    let headerRow = 1;
    if (s.title) {
      ws.getCell("A1").value = s.title;
      ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0E1116" } };
      ws.getCell("A2").value = s.subtitle ?? "";
      ws.getCell("A2").font = { size: 10, color: { argb: "FF868C98" } };
      headerRow = 4;
    }
    const hr = ws.getRow(headerRow);
    s.columns.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E1116" } };
      cell.alignment = { vertical: "middle", horizontal: c.format && c.format !== "text" && c.format !== "date" && c.format !== "datetime" ? "right" : "left" };
      ws.getColumn(i + 1).width = c.width ?? Math.max(10, Math.min(48, c.header.length + 4));
    });
    hr.height = 20;
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(headerRow + 1 + ri);
      r.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === undefined ? null : v;
        const f = s.columns[i]?.format;
        if (f && NUMFMT[f]) cell.numFmt = NUMFMT[f]!;
        cell.font = { size: 10 };
      });
      if (ri % 2 === 1) row.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F8FA" } }));
    });
    if (s.totals) {
      const row = ws.getRow(headerRow + 1 + s.rows.length);
      s.totals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === undefined ? null : v;
        const f = s.columns[i]?.format;
        if (f && NUMFMT[f]) cell.numFmt = NUMFMT[f]!;
        cell.font = { bold: true, size: 10 };
        cell.border = { top: { style: "thin", color: { argb: "FF0E1116" } } };
      });
    }
    if (s.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: s.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function downloadXlsx(fileName: string, sheets: ExportSheet[], meta: { company: string }) {
  triggerDownload(await buildXlsx(sheets, meta), fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

export const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Math.round(cents) / 100);

export function slugFile(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "");
}
