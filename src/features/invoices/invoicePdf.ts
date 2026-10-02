/**
 * Factura en PDF (generada en el navegador). Contenido fiscal mínimo parametrizable: emisor (razón social, NIF,
 * dirección), destinatario, número y serie, fechas, líneas, desglose de IVA por tipo y total. Los datos salen de la
 * empresa (Ajustes) y del snapshot de la factura: nada específico de un tenant en el código.
 * Borradores y anuladas llevan marca de agua: nunca pueden confundirse con una factura válida.
 */
import type { Workspace } from "@/data/store";
import type { Invoice, InvoiceItem } from "@/domain/types";
import { formatMoney, formatRate, splitGross } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { invoiceLabel } from "@/data/repos/invoices";
import { slugFile, triggerDownload } from "@/lib/export";

type RGB = [number, number, number];
const INK: RGB = [18, 18, 17];
const MUTED: RGB = [120, 119, 113];
const LINE: RGB = [228, 227, 222];
const ACCENT: RGB = [54, 70, 245];

export async function buildInvoicePdf(ws: Workspace, inv: Invoice): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const org = ws.organization;
  const items: InvoiceItem[] = ws.invoiceItems.filter((i) => i.invoiceId === inv.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const loc = ws.locations.find((l) => l.id === inv.locationId);

  // Cabecera: emisor a la izquierda, documento a la derecha
  let y = M;
  if (org.logoDataUrl) {
    try {
      doc.addImage(org.logoDataUrl, M, y - 6, 40, 40);
    } catch {
      /* logo no compatible: se omite */
    }
  }
  const ex = org.logoDataUrl ? M + 52 : M;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(org.legalName || org.name, ex, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const issuer = [org.taxId ? `NIF ${org.taxId}` : "NIF pendiente de configurar", org.address, [org.postalCode, org.city].filter(Boolean).join(" "), [org.email, org.phone].filter(Boolean).join(" · ")].filter(Boolean) as string[];
  doc.text(issuer, ex, y + 22, { lineHeightFactor: 1.35 });

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(inv.rectifiesInvoiceId ? "Factura rectificativa" : "Factura", W - M, y + 10, { align: "right" });
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT);
  doc.text(invoiceLabel(inv), W - M, y + 28, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const meta = [
    `Fecha de emisión: ${inv.issueDate ? formatDate(inv.issueDate) : "—"}`,
    inv.dueDate ? `Vencimiento: ${formatDate(inv.dueDate)}` : null,
    inv.servicePeriodStart ? `Periodo: ${formatDate(inv.servicePeriodStart)} – ${inv.servicePeriodEnd ? formatDate(inv.servicePeriodEnd) : ""}` : null,
    loc ? `Centro: ${loc.name}` : null,
  ].filter(Boolean) as string[];
  doc.text(meta, W - M, y + 44, { align: "right", lineHeightFactor: 1.35 });

  y = Math.max(y + 44 + meta.length * 12, M + 90) + 18;
  doc.setDrawColor(...LINE);
  doc.line(M, y, W - M, y);
  y += 22;

  // Destinatario
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("FACTURAR A", M, y);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(inv.customerName ?? "—", M, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const to = [inv.customerTaxId ? `NIF ${inv.customerTaxId}` : null, inv.customerAddress].filter(Boolean) as string[];
  if (to.length) doc.text(doc.splitTextToSize(to.join("\n"), 260), M, y + 30, { lineHeightFactor: 1.35 });
  if (inv.concept) {
    doc.setFontSize(8);
    doc.text("CONCEPTO", W / 2 + 20, y);
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(inv.concept, W / 2 - M - 20), W / 2 + 20, y + 16);
  }
  y += 30 + Math.max(to.length, 1) * 12 + 18;

  // Líneas
  const rows = items.length
    ? items.map((it) => [
        it.description,
        Number(it.quantity).toLocaleString("es-ES"),
        formatMoney(it.unitPrice),
        it.discount ? `−${formatMoney(it.discount)}` : "",
        formatRate(it.taxRateBp),
        formatMoney(it.total),
      ])
    : [[inv.concept ?? "Servicio", "1", formatMoney(inv.total), "", "", formatMoney(inv.total)]];
  autoTable(doc, {
    startY: y,
    head: [["Descripción", "Cant.", "Precio (IVA incl.)", "Dto.", "IVA", "Importe"]],
    body: rows,
    theme: "plain",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 9, cellPadding: { top: 7, bottom: 7, left: 6, right: 6 }, textColor: INK, lineColor: LINE },
    headStyles: { fontStyle: "bold", textColor: MUTED, fontSize: 8, lineWidth: { bottom: 0.8 } },
    bodyStyles: { lineWidth: { bottom: 0.5 } },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { halign: "right", cellWidth: 40 }, 2: { halign: "right", cellWidth: 90 }, 3: { halign: "right", cellWidth: 56 }, 4: { halign: "right", cellWidth: 40 }, 5: { halign: "right", cellWidth: 74, fontStyle: "bold" } },
  });
  // @ts-expect-error jspdf-autotable añade lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 18;

  // Desglose de IVA y totales
  const byRate = new Map<number, { base: number; tax: number }>();
  if (items.length) for (const it of items) byRate.set(it.taxRateBp, { base: (byRate.get(it.taxRateBp)?.base ?? 0) + it.baseAmount, tax: (byRate.get(it.taxRateBp)?.tax ?? 0) + it.taxAmount });
  else byRate.set(Math.round((inv.taxTotal / Math.max(1, inv.subtotal)) * 100) * 100, { base: inv.subtotal, tax: inv.taxTotal });
  const tx = W - M - 230;
  doc.setFontSize(9);
  const line = (label: string, value: string, bold = false, color: RGB = MUTED) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...color);
    doc.text(label, tx, y);
    doc.setTextColor(...INK);
    doc.text(value, W - M, y, { align: "right" });
    y += 16;
  };
  for (const [rate, v] of [...byRate].sort((a, b) => b[0] - a[0])) {
    line(`Base imponible ${formatRate(rate)}`, formatMoney(v.base));
    line(`IVA ${formatRate(rate)}`, formatMoney(v.tax));
  }
  if (inv.discountTotal) line("Descuentos aplicados", `−${formatMoney(inv.discountTotal)}`);
  doc.setDrawColor(...LINE);
  doc.line(tx, y - 6, W - M, y - 6);
  y += 6;
  doc.setFontSize(13);
  line("Total", formatMoney(inv.total), true, INK);
  doc.setFontSize(9);
  if (inv.amountPaid > 0 && inv.status !== "void") {
    line("Cobrado", formatMoney(inv.amountPaid));
    if (inv.total - inv.amountPaid > 0) line("Pendiente", formatMoney(inv.total - inv.amountPaid), true, INK);
  }

  // Notas y pie
  if (inv.notes) {
    y += 10;
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("NOTAS", M, y);
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(inv.notes, W - 2 * M), M, y + 14);
  }
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`${org.legalName || org.name}${org.taxId ? ` · NIF ${org.taxId}` : ""} · Documento generado con Business OS`, W / 2, H - 28, { align: "center" });

  // Marca de agua para lo que no es una factura válida
  const mark = inv.status === "draft" ? "BORRADOR" : inv.status === "void" ? "ANULADA" : null;
  if (mark) {
    doc.saveGraphicsState();
    // @ts-expect-error GState existe en jsPDF ≥ 2
    doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(110);
    doc.setTextColor(...INK);
    doc.text(mark, W / 2, H / 2, { align: "center", angle: 35 });
    doc.restoreGraphicsState();
  }
  return doc.output("blob");
}

export function invoiceFileName(inv: Invoice): string {
  return `Factura_${slugFile(invoiceLabel(inv))}_${slugFile(inv.customerName ?? "cliente")}.pdf`;
}

export async function downloadInvoicePdf(ws: Workspace, inv: Invoice) {
  triggerDownload(await buildInvoicePdf(ws, inv), invoiceFileName(inv));
}

/** Abre el PDF en una pestaña nueva con el diálogo de impresión. */
export async function printInvoicePdf(ws: Workspace, inv: Invoice) {
  const w = window.open("", "_blank");
  const url = URL.createObjectURL(await buildInvoicePdf(ws, inv));
  if (w) {
    w.location.href = url;
    setTimeout(() => { try { w.print(); } catch { /* el visor del navegador ofrece imprimir */ } }, 800);
  } else {
    window.open(url, "_blank");
  }
}

/** Base y cuota de una línea (para la vista previa en pantalla). */
export const lineBase = (total: number, rateBp: number) => splitGross(total, rateBp);
