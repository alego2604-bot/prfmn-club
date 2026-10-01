import type { Workspace } from "@/data/store";
import { addMonths, capitalize, monthName, quarterOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { classifyTaxId } from "@/lib/taxid";
import { normalizeKey, squash } from "@/lib/text";
import { INVOICE_STATUS_SYNONYMS } from "./fields";
import { mapPaymentMethod } from "./salesPlan";
import { monthFromName, monthInText, rawOf, rowFields, rowText, toDate, toMoney } from "./shared";
import type { FileAnalysis, ImportPlan, InvoiceRow, Issue, PlanOptions, WorkbookData } from "./types";

const KNOWN_RATES = [2100, 1000, 400, 0];

/** "16 CREDITOS -  (73.00€)" / "11 CREDITOS-Precio mensual" → "16 CREDITOS" */
export function planNameFromConcept(concept: string): string {
  return squash(concept.split(/-\s*precio|\s-\s+\(|\(\s*\d/i)[0] ?? concept).replace(/[-–\s]+$/, "");
}

function mapStatus(text: string): InvoiceRow["invoiceStatus"] | null {
  const k = normalizeKey(text);
  if (!k) return null;
  for (const [re, st] of INVOICE_STATUS_SYNONYMS) if (re.test(k)) return st;
  return null;
}

export function buildInvoicesPlan(wb: WorkbookData, analysis: FileAnalysis, ws: Workspace, options: PlanOptions): ImportPlan {
  const rows: InvoiceRow[] = [];
  const nonDataRows: ImportPlan["nonDataRows"] = [];
  const controls: ImportPlan["controls"] = [];
  const insights: string[] = [];
  const sheetsUsed: string[] = [];

  const existingNumbers = new Set(ws.invoices.filter((i) => i.status !== "void").flatMap((i) => [i.number, i.externalNumber]).filter(Boolean) as string[]);
  const byTax = new Map(ws.customers.filter((c) => !c.deletedAt && c.taxIdNormalized).map((c) => [c.taxIdNormalized!, c]));
  const byName = new Map(ws.customers.filter((c) => !c.deletedAt).map((c) => [normalizeKey(`${c.firstName} ${c.lastName ?? ""}`), c]));
  const seenNumbers = new Map<string, string>();
  let issuedOutsideSheet = 0;
  const outsideSheetByQuarter = new Map<string, { n: number; amount: number }>();

  for (const sa of analysis.sheets.filter((s) => s.role === "invoices" && s.include)) {
    const sheet = wb.sheets.find((s) => s.name === sa.name)!;
    sheetsUsed.push(sa.name);
    const sheetMonth = monthFromName(sa.name);
    let paidSum = 0;
    let pendingSum = 0;
    let declaredPaid: number | null = null;
    let declaredPending: number | null = null;
    let declaredCount: number | null = null;
    let rowCount = 0;

    for (let r = sa.headerRowIndex + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const f = rowFields(row, sa);
      const number = squash(String(f.invoice_number ?? ""));
      const customerName = squash(String(f.customer ?? ""));
      if (!number && !customerName) {
        // Pie del listado: lo usamos como control de cuadre
        const text = normalizeKey(rowText(row));
        const totalVal = toMoney(f.total ?? null);
        if (/total cobrado|total pagado|cobrado/.test(text) && totalVal !== null) declaredPaid = totalVal;
        else if (/pendiente/.test(text) && totalVal !== null) declaredPending = totalVal;
        const m = /total registros\s*(\d+)/.exec(text);
        if (m) declaredCount = Number(m[1]);
        const t = rowText(row);
        if (t) nonDataRows.push({ sheet: sa.name, rowNumber: r + 1, text: t });
        continue;
      }
      rowCount++;
      const issues: Issue[] = [];
      let status: InvoiceRow["invoiceStatus"] = "issued";
      let state: InvoiceRow["invoiceStatus"] | null = mapStatus(String(f.status ?? ""));
      let rs: "valid" | "review" | "duplicate" | "error" = "valid";
      let confidence: InvoiceRow["confidence"] = "high";

      const issueDate = toDate(f.issue_date ?? null);
      if (!number) { rs = "error"; issues.push({ code: "NO_NUMBER", severity: "error", text: "Sin número de factura" }); }
      if (!issueDate) { rs = "error"; issues.push({ code: "NO_DATE", severity: "error", text: "Fecha de factura vacía o no válida" }); }
      if (!customerName) { rs = "error"; issues.push({ code: "NO_CUSTOMER", severity: "error", text: "Sin cliente" }); }

      const total = toMoney(f.total ?? null);
      let subtotal = toMoney(f.base ?? null);
      let taxTotal = toMoney(f.vat_amount ?? null);
      if (total === null) { rs = "error"; issues.push({ code: "NO_TOTAL", severity: "error", text: "Sin total" }); }
      if (total !== null) {
        if (subtotal === null && taxTotal !== null) subtotal = total - taxTotal;
        if (taxTotal === null && subtotal !== null) taxTotal = total - subtotal;
        if (subtotal === null && taxTotal === null) {
          subtotal = Math.round((total * 10000) / 12100);
          taxTotal = total - subtotal;
          issues.push({ code: "VAT_ASSUMED", severity: "warning", text: "Sin base ni IVA: se asume IVA 21 % incluido" });
          if (rs === "valid") rs = "review";
          confidence = "review";
        }
        if (subtotal !== null && taxTotal !== null && Math.abs(subtotal + taxTotal - total) > 1) {
          issues.push({ code: "VAT_MISMATCH", severity: "warning", text: `Base ${formatMoney(subtotal)} + IVA ${formatMoney(taxTotal)} ≠ total ${formatMoney(total)}` });
          if (rs === "valid") rs = "review";
          confidence = "review";
        } else if (subtotal !== null && taxTotal !== null) {
          taxTotal = total - subtotal; // absorbe el céntimo de redondeo
        }
      }
      let taxRateBp = 2100;
      if (subtotal && taxTotal !== null) {
        const raw = Math.round((taxTotal / subtotal) * 10000);
        const near = KNOWN_RATES.find((k) => Math.abs(k - raw) <= 15);
        if (near === undefined) {
          issues.push({ code: "VAT_RATE", severity: "warning", text: `Tipo de IVA no estándar (${(raw / 100).toFixed(2)} %)` });
          if (rs === "valid") rs = "review";
        } else taxRateBp = near;
      }

      // NIF
      const tax = classifyTaxId(String(f.tax_id ?? ""));
      const taxIdState: InvoiceRow["taxIdState"] = tax.kind === "empty" ? "empty" : tax.kind === "foreign" ? "foreign" : tax.valid ? "valid" : "invalid";
      if (taxIdState === "empty") {
        issues.push({ code: "NO_TAX_ID", severity: "info", text: "Cliente sin NIF: dato fiscal incompleto" });
        if (confidence === "high") confidence = "medium";
      } else if (taxIdState === "invalid") {
        issues.push({ code: "BAD_TAX_ID", severity: "warning", text: `NIF «${String(f.tax_id)}» no es un DNI/NIE/CIF válido` });
        if (rs === "valid") rs = "review";
        confidence = "review";
      } else if (taxIdState === "foreign") {
        issues.push({ code: "FOREIGN_TAX_ID", severity: "info", text: `«${tax.normalized}» parece un documento extranjero` });
        if (confidence === "high") confidence = "medium";
      }

      // Cliente: NIF → nombre → nuevo
      const nameKey = normalizeKey(customerName);
      let customer: InvoiceRow["customer"];
      const byTaxMatch = tax.valid && tax.normalized ? byTax.get(tax.normalized) : undefined;
      if (byTaxMatch) customer = { kind: "existing", id: byTaxMatch.id };
      else if (byName.get(nameKey)) {
        customer = { kind: "existing", id: byName.get(nameKey)!.id };
        issues.push({ code: "CUSTOMER_BY_NAME", severity: "info", text: "Cliente existente asociado por nombre" });
        if (confidence === "high") confidence = "medium";
      } else customer = { kind: "new", groupKey: tax.valid && tax.normalized ? `tax:${tax.normalized}` : `name:${nameKey}` };

      // Estado y método
      if (!state) {
        state = "paid";
        if (f.status) { issues.push({ code: "STATUS_UNKNOWN", severity: "warning", text: `Estado «${String(f.status)}» no reconocido: se asume cobrada` }); if (rs === "valid") rs = "review"; }
      }
      status = state;
      const methodLabel = squash(String(f.payment_method ?? ""));
      const methodKey = mapPaymentMethod(methodLabel);
      if (methodLabel && !methodKey) issues.push({ code: "UNKNOWN_METHOD", severity: "warning", text: `Método «${methodLabel}» no reconocido` });
      if (status === "issued") issues.push({ code: "PENDING", severity: "info", text: "Pendiente de cobro: aparecerá en Facturas pendientes" });

      // Periodo de servicio y concepto
      const concept = squash(String(f.concept ?? ""));
      const periodText = squash(String(f.period ?? ""));
      let servicePeriod: InvoiceRow["servicePeriod"] = null;
      const pm = monthInText(periodText) ?? (sheetMonth !== null && /cuota/i.test(periodText) ? sheetMonth : null);
      if (pm !== null && issueDate) {
        let y = issueDate.getFullYear();
        if (pm - issueDate.getMonth() > 6) y--;
        if (issueDate.getMonth() - pm > 6) y++;
        const start = new Date(y, pm, 1);
        servicePeriod = { start, end: new Date(addMonths(start, 1).getTime() - 86_400_000) };
      }
      if (issueDate && sheetMonth !== null && issueDate.getMonth() !== sheetMonth) {
        issuedOutsideSheet++;
        if (quarterOf(issueDate) !== quarterOf(new Date(issueDate.getFullYear(), sheetMonth, 1))) {
          const q = `Q${quarterOf(issueDate)} ${issueDate.getFullYear()}`;
          const cur = outsideSheetByQuarter.get(q) ?? { n: 0, amount: 0 };
          cur.n++;
          cur.amount += total ?? 0;
          outsideSheetByQuarter.set(q, cur);
          issues.push({ code: "OTHER_QUARTER", severity: "info", text: `Emitida el ${issueDate.toLocaleDateString("es-ES")} (hoja ${sa.name}): a efectos de IVA pertenece al ${q}` });
        }
      }

      // Duplicados
      if (number) {
        if (existingNumbers.has(number)) {
          rs = "duplicate";
          issues.unshift({ code: "DUP_IN_DB", severity: "warning", text: `La factura ${number} ya existe en el sistema` });
        } else if (seenNumbers.has(number)) {
          rs = "duplicate";
          issues.unshift({ code: "DUP_IN_FILE", severity: "warning", text: `Número repetido en el archivo (también en ${seenNumbers.get(number)})` });
        } else seenNumbers.set(number, `${sa.name} fila ${r + 1}`);
      }

      if (status === "paid") paidSum += total ?? 0;
      if (status === "issued") pendingSum += total ?? 0;

      rows.push({
        type: "invoice", key: `${sa.name}:${r + 1}`, sheet: sa.name, rowNumber: r + 1, raw: rawOf(row, sa), status: rs, confidence, issues,
        decision: rs === "error" || rs === "duplicate" ? "ignore" : "import",
        number, series: /^[A-Za-z]+/.exec(number)?.[0]?.toUpperCase() ?? "", issueDate, customerName, taxId: tax.normalized, taxIdState,
        concept, planName: planNameFromConcept(concept), description: squash(String(f.description ?? "")), servicePeriod, subtotal, taxTotal, total, taxRateBp,
        methodKey, methodLabel, invoiceStatus: status, customer,
      });
    }
    if (declaredPaid !== null) controls.push({ label: `Total cobrado declarado en "${sa.name}"`, expected: declaredPaid, actual: paidSum, ok: declaredPaid === paidSum });
    if (declaredPending !== null) controls.push({ label: `Pendiente declarado en "${sa.name}"`, expected: declaredPending, actual: pendingSum, ok: declaredPending === pendingSum });
    if (declaredCount !== null) controls.push({ label: `Nº de registros declarado en "${sa.name}"`, expected: declaredCount, actual: rowCount, ok: declaredCount === rowCount, unit: "count" });
  }

  // Insights fiscales y de calidad
  for (const [q, v] of outsideSheetByQuarter) {
    insights.push(`${v.n} factura(s) por ${formatMoney(v.amount)} están en una hoja de otro mes pero se emitieron en el ${q}: el IVA se declara por fecha de emisión, no por mes de servicio.`);
  }
  if (issuedOutsideSheet && !outsideSheetByQuarter.size) insights.push(`${issuedOutsideSheet} factura(s) se emitieron en un mes distinto al de su hoja (cobro anticipado de la cuota).`);
  const bySeries = new Map<string, number[]>();
  for (const r of rows) {
    const n = Number(/\d+$/.exec(r.number)?.[0]);
    if (r.series && Number.isFinite(n)) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), n]);
  }
  for (const [s, nums] of bySeries) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const gaps = max - min + 1 - new Set(nums).size;
    insights.push(`Serie ${s}: ${nums.length} facturas (${s}${min} → ${s}${max})${gaps ? `, ${gaps} número(s) sin aparecer en el archivo: confirmar con la gestoría si son de otro periodo o rectificativas` : ", numeración continua"}.`);
  }
  const plans = new Map<string, Set<number>>();
  for (const r of rows) if (r.planName && r.total !== null) plans.set(r.planName, (plans.get(r.planName) ?? new Set()).add(r.total));
  const multiPrice = [...plans.entries()].filter(([, v]) => v.size > 1);
  if (plans.size) insights.push(`${plans.size} tarifas distintas detectadas en los conceptos${multiPrice.length ? `; ${multiPrice.length} con varios precios (p. ej. ${multiPrice[0]![0]}: ${[...multiPrice[0]![1]].map((v) => formatMoney(v)).join(" / ")}) → histórico de precios o pagos trimestrales` : ""}.`);
  const months = [...new Set(rows.filter((r) => r.servicePeriod).map((r) => capitalize(monthName(r.servicePeriod!.start.getMonth()))))];
  if (months.length) insights.push(`Periodos de servicio detectados: ${months.join(", ")}. Se guardan aparte de la fecha de emisión (MRR por periodo, IVA por emisión).`);

  return { kind: "invoices", fileName: wb.fileName, sheetsUsed, catalog: [], rows, nonDataRows, controls, insights, options };
}
