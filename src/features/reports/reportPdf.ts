import type { Report, ValueFormat } from "@/domain/reports";
import { formatMoney } from "@/lib/money";

export const fmtValue = (v: string | number | null, f: ValueFormat) =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : f === "money" ? formatMoney(v) : f === "percent" ? `${(v * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %` : v.toLocaleString("es-ES");

/** PDF de un informe: cabecera, KPIs y tabla (mismo contenido que la pantalla). */
export async function buildReportPdf(r: Report, ctx: { company: string; periodLabel: string; scope: string }): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const landscape = r.table.columns.length > 5;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(18, 18, 17);
  doc.rect(0, 0, W, 78, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(`Informe de ${r.meta.title.toLowerCase()} · ${ctx.periodLabel}`, 40, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(`${ctx.company} · ${ctx.scope} · generado ${new Date().toLocaleString("es-ES")}`, 40, 58);
  let y = 104;
  const cw = (W - 80 - 30) / 4;
  r.kpis.slice(0, 4).forEach((k, i) => {
    const x = 40 + i * (cw + 10);
    doc.setDrawColor(228, 227, 222);
    doc.roundedRect(x, y, cw, 50, 6, 6, "S");
    doc.setFontSize(8);
    doc.setTextColor(120, 119, 113);
    doc.text(k.label, x + 8, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(18, 18, 17);
    doc.text(fmtValue(k.value, k.format), x + 8, y + 36);
    doc.setFont("helvetica", "normal");
  });
  y += 70;
  autoTable(doc, {
    startY: y,
    head: [r.table.columns.map((c) => c.header)],
    body: r.table.rows.map((row) => row.map((v, i) => fmtValue(v, r.table.columns[i]!.format))),
    foot: r.table.totals ? [r.table.totals.map((v, i) => fmtValue(v, r.table.columns[i]!.format))] : undefined,
    theme: "striped",
    margin: { left: 40, right: 40 },
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [54, 70, 245] },
    footStyles: { fillColor: [240, 239, 235], textColor: [18, 18, 17], fontStyle: "bold" },
    columnStyles: Object.fromEntries(r.table.columns.map((c, i) => [i, { halign: c.align === "right" ? "right" : "left" }])),
  });
  if (r.notes.length) {
    // @ts-expect-error jspdf-autotable añade lastAutoTable
    const fy = (doc.lastAutoTable?.finalY ?? y) + 18;
    doc.setFontSize(8);
    doc.setTextColor(120, 119, 113);
    doc.text(doc.splitTextToSize(r.notes.join(" "), W - 80), 40, fy);
  }
  return doc.output("blob");
}
