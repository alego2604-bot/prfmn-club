import type { GestoriaReport } from "./gestoria";
import { formatMoney, formatRate } from "@/lib/money";

/** PDF ejecutivo del paquete (resumen, IVA, facturación, categorías, cobros). Generado en el navegador. */
export async function buildGestoriaPdf(r: GestoriaReport, company: { name: string; legalName?: string; taxId?: string }): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const ink: [number, number, number] = [14, 17, 22];
  const muted: [number, number, number] = [134, 140, 152];
  const accent: [number, number, number] = [59, 91, 253];

  // Cabecera
  doc.setFillColor(...ink);
  doc.rect(0, 0, W, 92, "F");
  doc.setFillColor(...accent);
  doc.circle(W - 52, 38, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Informe para la gestoría · ${r.periodLabel}`, 40, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text([company.legalName || company.name, company.taxId ? `CIF ${company.taxId}` : ""].filter(Boolean).join(" · "), 40, 64);

  let y = 120;
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Resumen", 40, y);
  y += 10;

  // KPIs en rejilla
  const cards = r.kpis.slice(0, 8);
  const cw = (W - 80 - 3 * 10) / 4;
  cards.forEach((k, i) => {
    const x = 40 + (i % 4) * (cw + 10);
    const yy = y + Math.floor(i / 4) * 62;
    doc.setDrawColor(230, 232, 236);
    doc.roundedRect(x, yy, cw, 52, 6, 6, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(doc.splitTextToSize(k.label, cw - 16), x + 8, yy + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...ink);
    doc.text(k.format === "money" ? formatMoney(k.value) : k.value.toLocaleString("es-ES"), x + 8, yy + 40);
  });
  y += 2 * 62 + 16;

  const table = (title: string, head: string[], body: (string | number)[][], foot?: (string | number)[]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...ink);
    if (y > 720) { doc.addPage(); y = 50; }
    doc.text(title, 40, y);
    autoTable(doc, {
      startY: y + 8,
      head: [head],
      body: body.map((r) => r.map(String)),
      foot: foot ? [foot.map(String)] : undefined,
      theme: "plain",
      styles: { fontSize: 8.5, cellPadding: 5, textColor: ink, lineColor: [236, 238, 242], lineWidth: { bottom: 0.5 } as never },
      headStyles: { fillColor: [245, 246, 248], textColor: muted, fontStyle: "bold" },
      footStyles: { fontStyle: "bold", fillColor: [250, 251, 252] },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, { halign: i === 0 ? "left" : "right" }])) as never,
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error lastAutoTable lo añade el plugin
    y = (doc.lastAutoTable?.finalY ?? y) + 26;
  };

  table(
    "IVA repercutido por tipo",
    ["Origen", "Tipo", "Base", "Cuota IVA", "Total"],
    r.vat.map((v) => [v.source, formatRate(v.rateBp), formatMoney(v.base), formatMoney(v.tax), formatMoney(v.total)]),
    ["Total", "", formatMoney(r.vat.reduce((s, v) => s + v.base, 0)), formatMoney(r.vat.reduce((s, v) => s + v.tax, 0)), formatMoney(r.vat.reduce((s, v) => s + v.total, 0))],
  );

  const sheet = (n: string) => r.sheets.find((s) => s.name === n)!;
  const money = (v: unknown) => (typeof v === "number" ? formatMoney(Math.round(v * 100)) : String(v ?? ""));
  const meth = sheet("Métodos de pago");
  table("Cobros por método de pago", ["Método", "Cobros", "Devoluciones", "Neto"], meth.rows.map((row) => [String(row[0]), money(row[1]), money(row[2]), money(row[3])]));
  const cats = sheet("Categorías");
  table("Ventas de caja por categoría", ["Categoría", "Uds", "Base", "IVA", "Total"], cats.rows.map((row) => [String(row[0]), String(row[1]), money(row[2]), money(row[3]), money(row[4])]));
  const inv = sheet("Facturación");
  const pending = inv.rows.filter((row) => row[11] === "Pendiente");
  if (pending.length) table("Facturas pendientes de cobro", ["Nº", "Fecha", "Cliente", "Total"], pending.map((row) => [String(row[0]), row[2] instanceof Date ? row[2].toLocaleDateString("es-ES") : "", String(row[3]), money(row[9])]));

  if (r.warnings.length) {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Notas para la revisión", 40, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    y += 16;
    for (const w of r.warnings) {
      const lines = doc.splitTextToSize(`• ${w}`, W - 80);
      doc.text(lines, 40, y);
      y += lines.length * 12 + 2;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`${company.name} · Generado con PRFMN Club · ${new Date().toLocaleString("es-ES")}`, 40, 820);
    doc.text(`${i} / ${pages}`, W - 40, 820, { align: "right" });
  }
  return doc.output("blob");
}
