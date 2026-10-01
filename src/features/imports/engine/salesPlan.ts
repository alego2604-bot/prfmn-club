import type { Workspace } from "@/data/store";
import { capitalize, monthName, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { normalizeKey, similarity, squash } from "@/lib/text";
import { PAYMENT_SYNONYMS } from "./fields";
import { findDeclaredTotal, monthFromName, rawOf, rowFields, rowText, toDate, toMoney, toNumber } from "./shared";
import type { CatalogRow, FileAnalysis, ImportPlan, Issue, PlanOptions, SalesRow, WorkbookData } from "./types";

const REDUCED_VAT = /bebida|suplement|aliment|comida|nutric|bar|cafeteria/;

export function suggestTaxRate(categoryName: string): number {
  return REDUCED_VAT.test(normalizeKey(categoryName)) ? 1000 : 2100;
}

export function suggestKind(name: string, category: string): CatalogRow["kind"] {
  const n = normalizeKey(`${name} ${category}`);
  if (/drop/.test(normalizeKey(name))) return "drop_in";
  if (/bono|pack/.test(normalizeKey(name))) return "pack";
  if (/drop|bono|clase|sesion|servicio/.test(n)) return "service";
  return "physical";
}

export function mapPaymentMethod(text: string): string | null {
  const k = normalizeKey(text);
  if (!k) return null;
  for (const [re, key] of PAYMENT_SYNONYMS) if (re.test(k)) return key;
  return null;
}

interface ProductRef {
  kind: "existing" | "new";
  id?: string;
  name: string;
  price: number | null;
  category: string;
}

export function buildSalesPlan(wb: WorkbookData, analysis: FileAnalysis, ws: Workspace, options: PlanOptions): ImportPlan {
  const nonDataRows: ImportPlan["nonDataRows"] = [];
  const controls: ImportPlan["controls"] = [];
  const insights: string[] = [];
  const sheetsUsed: string[] = [];

  // ---------------------------------------------------------------- 1. Catálogo
  const catalog: CatalogRow[] = [];
  const productIndex = new Map<string, ProductRef>();
  const categoryOfExisting = new Map(ws.categories.map((c) => [c.id, c.name]));
  for (const p of ws.products) {
    if (p.status === "archived") continue;
    productIndex.set(normalizeKey(p.name), { kind: "existing", id: p.id, name: p.name, price: p.price, category: categoryOfExisting.get(p.categoryId ?? "") ?? "" });
  }
  for (const sa of analysis.sheets.filter((s) => s.role === "catalog" && s.include)) {
    const sheet = wb.sheets.find((s) => s.name === sa.name)!;
    sheetsUsed.push(sa.name);
    for (let r = sa.headerRowIndex + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const f = rowFields(row, sa);
      const name = squash(typeof f.product === "string" ? f.product : f.product === null ? "" : String(f.product));
      const price = toMoney(f.price ?? null);
      if (!name && price === null) continue;
      const categoryName = squash(String(f.category ?? "")) || "Sin categoría";
      const issues: Issue[] = [];
      const key = normalizeKey(name);
      const existing = productIndex.get(key);
      let status: CatalogRow["status"] = "valid";
      let confidence: CatalogRow["confidence"] = "high";
      if (!name || price === null) {
        status = "error";
        confidence = "review";
        issues.push({ code: "CATALOG_INCOMPLETE", severity: "error", text: "Falta nombre o precio" });
      } else if (existing?.kind === "new") {
        status = "duplicate";
        issues.push({ code: "CATALOG_DUP", severity: "warning", text: `"${name}" aparece dos veces en el catálogo` });
      } else if (existing?.kind === "existing") {
        issues.push({ code: "CATALOG_EXISTS", severity: "info", text: `Ya existe en tu catálogo${existing.price !== price ? ` (precio actual ${formatMoney(existing.price ?? 0)}; no se modifica)` : ""}` });
      }
      const taxRateBp = suggestTaxRate(categoryName);
      if (status === "valid" && !existing) {
        issues.push({ code: "TAX_SUGGESTED", severity: "info", text: `IVA propuesto ${taxRateBp / 100} % por categoría — validar con la gestoría` });
        if (name !== String(f.product ?? "")) issues.push({ code: "TRIMMED", severity: "info", text: "Espacios sobrantes eliminados del nombre" });
        confidence = "medium";
      }
      catalog.push({
        type: "catalog", key: `${sa.name}:${r + 1}`, sheet: sa.name, rowNumber: r + 1, raw: rawOf(row, sa), status, confidence, issues,
        decision: status === "valid" ? "import" : "ignore", name, categoryName, price, taxRateBp, kind: suggestKind(name, categoryName),
        existingProductId: existing?.kind === "existing" ? existing.id : undefined,
      });
      if (status === "valid" && !existing) productIndex.set(key, { kind: "new", name, price, category: categoryName });
    }
  }

  // ---------------------------------------------------------------- 2. Ventas
  const salesSheets = analysis.sheets
    .filter((s) => s.role === "sales" && s.include)
    .sort((a, b) => {
      const ma = monthFromName(a.name);
      const mb = monthFromName(b.name);
      return (ma === null ? 99 : ma) - (mb === null ? 99 : mb);
    });

  // Precisión horaria global: si casi todas las filas tienen la misma hora, la hora no es real.
  const timeCounts = new Map<string, number>();
  let datedRows = 0;
  for (const sa of salesSheets) {
    const sheet = wb.sheets.find((s) => s.name === sa.name)!;
    const dateCol = sa.columns.find((c) => c.field === "date")?.index;
    if (dateCol === undefined) continue;
    for (let r = sa.headerRowIndex + 1; r < sheet.rows.length; r++) {
      const d = toDate(sheet.rows[r]?.[dateCol] ?? null);
      if (!d) continue;
      datedRows++;
      const k = `${d.getHours()}:${d.getMinutes()}`;
      timeCounts.set(k, (timeCounts.get(k) ?? 0) + 1);
    }
  }
  const fileYearCounts = new Map<number, number>();
  for (const sa of salesSheets) {
    const sheet = wb.sheets.find((s) => s.name === sa.name)!;
    const dateCol = sa.columns.find((c) => c.field === "date")?.index;
    if (dateCol === undefined) continue;
    for (let r = sa.headerRowIndex + 1; r < sheet.rows.length; r++) {
      const d = toDate(sheet.rows[r]?.[dateCol] ?? null);
      if (d) fileYearCounts.set(d.getFullYear(), (fileYearCounts.get(d.getFullYear()) ?? 0) + 1);
    }
  }
  const fileYear = [...fileYearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();
  const modeTime = [...timeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const timeUnknown = !!modeTime && datedRows > 10 && (modeTime[1] / datedRows > 0.6 || timeCounts.size <= 3);
  if (timeUnknown) {
    const [h, m] = modeTime![0].split(":").map(Number);
    insights.push(`La hora no es real: el ${Math.round((modeTime![1] / datedRows) * 100)} % de las filas tiene la misma hora (${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}). Se guarda solo la fecha; las gráficas por hora excluirán estos datos.`);
  }

  // Duplicados contra la base de datos (ventas importadas previamente)
  const dbKeys = new Map<string, number>();
  const salesById = new Map(ws.sales.map((s) => [s.id, s]));
  for (const it of ws.saleItems) {
    const s = salesById.get(it.saleId);
    if (!s || s.status === "voided" || s.source !== "import") continue;
    const k = `${toISODate(new Date(s.occurredAt))}|${normalizeKey(it.productName)}|${it.quantity}|${it.total}`;
    dbKeys.set(k, (dbKeys.get(k) ?? 0) + 1);
  }

  const rows: SalesRow[] = [];
  const fileKeys = new Map<string, Map<string, { count: number; firstRow: number }>>(); // key → sheet → count
  let aggregateSheets = 0;
  let outsideMonth = 0;

  for (const sa of salesSheets) {
    const sheet = wb.sheets.find((s) => s.name === sa.name)!;
    sheetsUsed.push(sa.name);
    const sheetMonth = monthFromName(sa.name);
    const parsed: { r: number; f: Record<string, unknown>; date: Date | null }[] = [];
    for (let r = sa.headerRowIndex + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const f = rowFields(row, sa);
      const date = toDate(f.date ?? null);
      const total = toMoney(f.total ?? null);
      const price = toMoney(f.unit_price ?? null);
      const product = squash(String(f.product ?? ""));
      if (!date && !product && total === null && price === null) {
        const t = rowText(row);
        if (t) nonDataRows.push({ sheet: sa.name, rowNumber: r + 1, text: t });
        continue;
      }
      parsed.push({ r, f, date });
    }
    // Año de referencia para hojas con nombre de mes = año mayoritario del archivo
    const sheetYear = fileYear;
    // Hoja de resúmenes mensuales: pocas filas, todas el mismo día, cantidades grandes
    const distinctDays = new Set(parsed.filter((p) => p.date).map((p) => toISODate(p.date!)));
    const maxQty = Math.max(0, ...parsed.map((p) => toNumber((p.f.quantity as never) ?? null) ?? 1));
    const isAggregate = parsed.length >= 3 && distinctDays.size === 1 && maxQty >= 5;
    if (isAggregate) aggregateSheets++;

    let sheetSum = 0;
    for (const { r, f, date: rawDate } of parsed) {
      const row = sheet.rows[r] ?? [];
      const issues: Issue[] = [];
      let status: SalesRow["status"] = "valid";
      let confidence: SalesRow["confidence"] = "high";
      const productName = squash(String(f.product ?? ""));
      const categoryName = squash(String(f.category ?? ""));
      let unitPrice = toMoney((f.unit_price as never) ?? null);
      const quantity = toNumber((f.quantity as never) ?? null) ?? 1;
      let total = toMoney((f.total as never) ?? null);
      if (total === null && unitPrice !== null) total = Math.round(unitPrice * quantity);
      if (unitPrice === null && total !== null && quantity > 0) unitPrice = Math.round(total / quantity);
      sheetSum += total ?? 0;

      let occurredAt = rawDate;
      if (!rawDate) {
        status = "error";
        issues.push({ code: "NO_DATE", severity: "error", text: "Fecha vacía o no válida" });
      }
      if (total === null) {
        status = "error";
        issues.push({ code: "NO_AMOUNT", severity: "error", text: "Sin importe ni precio" });
      }
      if (quantity <= 0) {
        status = "error";
        issues.push({ code: "BAD_QTY", severity: "error", text: "Cantidad no válida" });
      }

      // Fecha fuera del mes de la hoja
      if (rawDate && sheetMonth !== null && (rawDate.getMonth() !== sheetMonth || rawDate.getFullYear() !== sheetYear) && status !== "error") {
        outsideMonth++;
        status = "review";
        confidence = "review";
        const sheetDate = new Date(sheetYear, sheetMonth, 1, 12);
        issues.push({
          code: "DATE_OUTSIDE_SHEET",
          severity: "warning",
          text: `Fecha ${rawDate.toLocaleDateString("es-ES")} en la hoja "${sa.name}"${options.dateOutsideSheet === "sheet_month" ? ` → se usará ${capitalize(monthName(sheetMonth))} ${sheetYear}` : " → se mantiene la fecha original"}`,
        });
        if (options.dateOutsideSheet === "sheet_month") occurredAt = sheetDate;
      }

      let granularity: SalesRow["granularity"] = "transaction";
      let timePrecision: SalesRow["timePrecision"] = timeUnknown ? "day" : "exact";
      if (isAggregate) {
        granularity = "aggregate";
        timePrecision = "month";
        if (occurredAt) occurredAt = new Date(occurredAt.getFullYear(), occurredAt.getMonth(), 1, 12);
        issues.push({ code: "AGGREGATE", severity: "info", text: "Resumen mensual (no es un ticket): cuenta en facturación y unidades, no en nº de operaciones" });
        if (confidence === "high") confidence = "medium";
      } else if (occurredAt && timeUnknown) {
        occurredAt = new Date(occurredAt.getFullYear(), occurredAt.getMonth(), occurredAt.getDate(), 12);
      }

      // Producto
      let product: SalesRow["product"] = { kind: "none" };
      const candidates: SalesRow["candidates"] = [];
      if (!productName) {
        if (status !== "error") status = "review";
        confidence = "review";
        const target = unitPrice;
        for (const ref of productIndex.values()) {
          if (normalizeKey(ref.category) === normalizeKey(categoryName) && ref.price === target) {
            candidates.push({ id: ref.id, name: ref.name, reason: `${ref.category} · ${formatMoney(ref.price ?? 0)}` });
          }
        }
        issues.push({
          code: "NO_PRODUCT",
          severity: "warning",
          text: candidates.length
            ? `Sin producto. Candidatos por categoría y precio: ${candidates.map((c) => c.name).join(", ")}. Elige uno o ignórala.`
            : "Sin producto y sin candidatos claros. Elige un producto o ignórala.",
        });
      } else {
        const exact = productIndex.get(normalizeKey(productName));
        if (exact) {
          product = exact.kind === "existing" ? { kind: "existing", id: exact.id!, name: exact.name } : { kind: "new", name: exact.name };
          if (exact.price !== null && unitPrice !== null && exact.price !== unitPrice && !isAggregate) {
            issues.push({ code: "PRICE_DIFFERS", severity: "info", text: `Precio ${formatMoney(unitPrice)} distinto del catálogo (${formatMoney(exact.price)}): se conserva el precio real cobrado` });
            if (confidence === "high") confidence = "medium";
          }
        } else {
          let best: { ref: ProductRef; s: number } | null = null;
          for (const ref of productIndex.values()) {
            const s = similarity(productName, ref.name);
            if (s >= 0.82 && (!best || s > best.s)) best = { ref, s };
          }
          if (best) {
            product = best.ref.kind === "existing" ? { kind: "existing", id: best.ref.id!, name: best.ref.name } : { kind: "new", name: best.ref.name };
            issues.push({ code: "FUZZY_PRODUCT", severity: "warning", text: `"${productName}" se asocia a "${best.ref.name}" (similitud ${Math.round(best.s * 100)} %)` });
            if (confidence === "high") confidence = "medium";
          } else {
            product = { kind: "new", name: productName };
            productIndex.set(normalizeKey(productName), { kind: "new", name: productName, price: unitPrice, category: categoryName });
            issues.push({ code: "NEW_PRODUCT", severity: "info", text: `Producto nuevo: se creará "${productName}"` });
            if (confidence === "high") confidence = "medium";
          }
        }
      }

      // Importe ≠ precio × unidades
      if (unitPrice !== null && total !== null && Math.round(unitPrice * quantity) !== total && status !== "error") {
        const fixed = quantity > 0 && Number.isInteger(total / quantity) ? total / quantity : null;
        issues.push({
          code: "AMOUNT_MISMATCH",
          severity: "warning",
          text: `Importe ${formatMoney(total)} ≠ ${formatMoney(unitPrice)} × ${quantity}. Se respeta el importe cobrado${fixed !== null ? ` (${formatMoney(fixed)}/ud)` : " (diferencia como descuento)"}`,
        });
        if (fixed !== null) unitPrice = fixed;
        if (status === "valid") status = "review";
        confidence = "review";
      }

      const methodRaw = String(f.payment_method ?? "");
      const methodKey = methodRaw ? mapPaymentMethod(methodRaw) : null;
      if (methodRaw && !methodKey) issues.push({ code: "UNKNOWN_METHOD", severity: "warning", text: `Método de pago "${methodRaw}" no reconocido: se guarda como Desconocido` });

      // Duplicados (mismo día, producto, cantidad e importe en otra hoja del fichero o ya importado)
      let decision: SalesRow["decision"] = status === "error" || (status === "review" && product.kind === "none") ? "ignore" : "import";
      if (occurredAt && total !== null && status !== "error") {
        const k = `${toISODate(rawDate ?? occurredAt)}|${normalizeKey(productName)}|${quantity}|${total}`;
        const perSheet = fileKeys.get(k) ?? new Map<string, { count: number; firstRow: number }>();
        const other = [...perSheet.entries()].find(([sheetName, v]) => sheetName !== sa.name && v.count > 0);
        if (other) {
          other[1].count--;
          status = "duplicate";
          decision = "ignore";
          issues.unshift({ code: "DUP_IN_FILE", severity: "warning", text: `Posible duplicado: misma venta en la hoja "${other[0]}" (fecha, producto, unidades e importe)` });
        } else {
          const cur = perSheet.get(sa.name) ?? { count: 0, firstRow: r + 1 };
          cur.count++;
          perSheet.set(sa.name, cur);
          fileKeys.set(k, perSheet);
          const dbk = `${toISODate(occurredAt)}|${normalizeKey(product.kind === "none" ? productName : product.name)}|${quantity}|${total}`;
          const n = dbKeys.get(dbk) ?? 0;
          if (n > 0) {
            dbKeys.set(dbk, n - 1);
            status = "duplicate";
            decision = "ignore";
            issues.unshift({ code: "DUP_IN_DB", severity: "warning", text: "Posible duplicado: ya existe una venta importada idéntica" });
          }
        }
      }

      rows.push({
        type: "sale", key: `${sa.name}:${r + 1}`, sheet: sa.name, rowNumber: r + 1, raw: rawOf(row, sa), status, confidence, issues, decision,
        occurredAt, timePrecision, granularity, productName, categoryName, unitPrice, quantity, total, product, candidates, methodKey,
      });
    }

    const declared = findDeclaredTotal(sheet, sa.headerRowIndex);
    if (declared !== null) controls.push({ label: `Total declarado en "${sa.name}"`, expected: declared, actual: sheetSum, ok: declared === sheetSum });
  }

  if (aggregateSheets) insights.push(`${aggregateSheets} hoja(s) contienen resúmenes mensuales en vez de ventas diarias: se importan como agregados y no cuentan para nº de operaciones ni ticket medio.`);
  if (outsideMonth) insights.push(`${outsideMonth} fila(s) tienen una fecha que no corresponde al mes de su hoja.`);
  if (!salesSheets.some((s) => s.columns.some((c) => c.field === "payment_method"))) insights.push("El archivo no indica el método de pago: estas ventas se registran como «Desconocido (importado)» y no afectan a ningún cierre de caja.");
  if (!salesSheets.some((s) => s.columns.some((c) => c.field === "customer"))) insights.push("Sin cliente asociado: son ventas de mostrador anónimas.");
  insights.push("Cada fila se importa como una venta de una línea: el Excel no agrupa tickets, y el sistema no inventa agrupaciones.");

  return { kind: "sales", fileName: wb.fileName, sheetsUsed, catalog, rows, nonDataRows, controls, insights, options };
}
