/**
 * Tests del motor de importación.
 * - Fixture sintético (siempre): reproduce la estructura y los problemas de los Excel reales.
 * - Ficheros reales (opcional, solo en local): BOS_CAJA_XLSX y BOS_FACTURAS_XLSX apuntan a los Excel.
 *   Nunca se suben al repositorio (contienen datos personales); los asserts solo usan agregados.
 */
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "@/data/store";
import { createMemoryKV } from "@/data/persistence";
import { buildWorkspace } from "@/data/workspace";
import type { Ctx } from "@/data/context";
import { computeKpis } from "@/domain/analytics";
import { makePeriod, quarterPeriod } from "@/lib/dates";
import { analyzeWorkbook } from "./analyze";
import { readXlsx } from "./read";
import { buildSalesPlan } from "./salesPlan";
import { buildInvoicesPlan } from "./invoicesPlan";
import { commitPlan, revertBlockers, revertImport, summarizePlan } from "./commit";
import type { PlanOptions, SalesRow, WorkbookData } from "./types";

async function makeCtx(): Promise<Ctx> {
  const store = new Store(createMemoryKV());
  await store.init();
  const ws = buildWorkspace({ name: "Test Gym", vertical: "fitness", locationName: "Calonge" });
  await store.createWorkspace(ws);
  await store.openWorkspace(ws.organization.id);
  return { store, user: { id: "u1", fullName: "Alex", email: "alex@test" }, role: "owner", locationIds: null };
}

const toBuffer = async (wb: ExcelJS.Workbook): Promise<ArrayBuffer> => {
  const b = new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m, d, h));

async function cajaFixture(): Promise<WorkbookData> {
  const wb = new ExcelJS.Workbook();
  const dash = wb.addWorksheet("Dashboard Anual");
  dash.getCell("A1").value = "CAJA ANUAL · 2026";
  dash.getRow(18).values = ["Mes", "Ingresos", "Unidades", null, "Categoría", "Ingresos", null, null, "Producto", "Ingresos", "Unidades"];
  const cat = wb.addWorksheet("Catálogo");
  cat.getRow(3).values = ["Producto", "Categoría", "Precio base"];
  cat.addRow(["Agua", "BEBIDAS", 1]);
  cat.addRow(["Drop-In", "DROP-IN / BONOS", 15]);
  cat.addRow(["Calleras", "MERCHANDISING", 37]);
  cat.addRow(["Combas Saltar", "MERCHANDISING", 30]);
  cat.addRow(["Camiseta Unisex Over ", "MERCHANDISING", 30]);
  const ene = wb.addWorksheet("Enero");
  ene.getCell("I3").value = "Total mes";
  ene.getCell("I4").value = 216;
  ene.getRow(4).getCell(1).value = "Fecha";
  ["Producto", "Categoría", "Precio", "Unidades", "Importe"].forEach((h, i) => (ene.getRow(4).getCell(i + 2).value = h));
  ene.addRow([utc(2025, 11, 31, 16), "Agua", "BEBIDAS", 1, 30, 30]);
  ene.addRow([utc(2025, 11, 31, 16), "Calleras", "MERCHANDISING", 35, 3, 111]); // importe ≠ precio × uds
  ene.addRow([utc(2025, 11, 31, 16), "Drop-In", "DROP-IN / BONOS", 15, 5, 75]);
  ene.getCell("A306").value = "Las columnas azules son de entrada.";
  const sep = wb.addWorksheet("Septiembre");
  sep.getRow(4).values = ["Fecha", "Producto", "Categoría", "Precio", "Unidades", "Importe"];
  for (let d = 1; d <= 28; d++) sep.addRow([utc(2026, 8, d, 17), "Agua", "BEBIDAS", 1, 1, 1]);
  sep.addRow([utc(2026, 8, 30, 17), "Drop-In", "DROP-IN / BONOS", 15, 2, 30]);
  sep.addRow([utc(2026, 8, 30, 17), null, "MERCHANDISING", 30, 1, 30]); // sin producto
  sep.addRow([utc(2026, 8, 30, 17), "Agua Mineral", "BEBIDAS", 1, 1, 1]); // producto nuevo
  const tpv = wb.addWorksheet("TPV");
  tpv.getRow(1).values = ["Fecha", "Producto", "Categoría", "Precio", "Unidades", "Importe"];
  tpv.addRow([utc(2026, 8, 30, 17), "Drop-In", "DROP-IN / BONOS", 15, 2, 30]); // duplicado de Septiembre
  return readXlsx(await toBuffer(wb), "caja.xlsx");
}

describe("Importación de caja (fixture)", () => {
  let ctx: Ctx;
  let options: PlanOptions;
  beforeEach(async () => {
    ctx = await makeCtx();
    options = { dateOutsideSheet: "sheet_month", locationId: ctx.store.requireWorkspace().locations[0]!.id };
  });

  it("detecta hojas, cabeceras y roles", async () => {
    const a = analyzeWorkbook(await cajaFixture());
    expect(a.kind).toBe("sales");
    const role = Object.fromEntries(a.sheets.map((s) => [s.name, s.role]));
    expect(role).toEqual({ "Dashboard Anual": "summary", "Catálogo": "catalog", Enero: "sales", Septiembre: "sales", TPV: "sales" });
    const ene = a.sheets.find((s) => s.name === "Enero")!;
    expect(ene.headerRowIndex).toBe(3);
    expect(ene.columns.filter((c) => c.field).map((c) => c.field)).toEqual(["date", "product", "category", "unit_price", "quantity", "total"]);
  });

  it("valida con confianza y motivos", async () => {
    const wb = await cajaFixture();
    const plan = buildSalesPlan(wb, analyzeWorkbook(wb), ctx.store.requireWorkspace(), options);
    const byCode = (code: string) => plan.rows.filter((r) => r.issues.some((i) => i.code === code));
    expect(plan.catalog.filter((c) => c.status === "valid")).toHaveLength(5);
    expect(byCode("AGGREGATE")).toHaveLength(3);
    expect(byCode("DATE_OUTSIDE_SHEET")).toHaveLength(3);
    const calleras = byCode("AMOUNT_MISMATCH")[0] as SalesRow;
    expect(calleras.unitPrice).toBe(3700);
    const noProduct = byCode("NO_PRODUCT")[0] as SalesRow;
    expect(noProduct.decision).toBe("ignore");
    expect(noProduct.candidates.map((c) => c.name).sort()).toEqual(["Camiseta Unisex Over", "Combas Saltar"]);
    expect(byCode("DUP_IN_FILE")).toHaveLength(1);
    expect(byCode("DUP_IN_FILE")[0]!.sheet).toBe("TPV");
    expect(byCode("NEW_PRODUCT")).toHaveLength(1);
    expect(plan.nonDataRows.some((n) => n.text.includes("columnas azules"))).toBe(true);
    expect(plan.controls).toEqual([{ label: 'Total declarado en "Enero"', expected: 21600, actual: 21600, ok: true }]);
    expect(plan.insights.some((i) => i.includes("hora no es real"))).toBe(true);
    const enero = plan.rows.find((r) => r.sheet === "Enero") as SalesRow;
    expect(enero.occurredAt!.getFullYear()).toBe(2026);
    expect(enero.occurredAt!.getMonth()).toBe(0);
  });

  it("importa, mide KPIs correctos, detecta reimportación y revierte sin borrar", async () => {
    const wb = await cajaFixture();
    const plan = buildSalesPlan(wb, analyzeWorkbook(wb), ctx.store.requireWorkspace(), options);
    const s = summarizePlan(plan, ctx.store.requireWorkspace());
    expect(s.toImport).toBe(3 + 28 + 1 + 1); // enero(3) + 28 aguas + drop-in + agua mineral
    const job = commitPlan(ctx, plan, { name: "caja.xlsx", sha256: "x", size: 1 });
    const ws = ctx.store.requireWorkspace();
    expect(job.summary.created).toMatchObject({ ventas: 33, productos: 6 });
    expect(ws.sales).toHaveLength(33);
    expect(ws.auditLogs.some((l) => l.action === "import")).toBe(true);
    const sepK = computeKpis({ ...ws, categories: ws.categories }, makePeriod("month", new Date(2026, 8, 10)));
    expect(sepK.salesRevenue).toBe(2800 + 3000 + 100);
    expect(sepK.operations).toBe(30);
    const eneK = computeKpis(ws, makePeriod("month", new Date(2026, 0, 10)));
    expect(eneK.salesRevenue).toBe(21600);
    expect(eneK.operations).toBe(0); // agregados

    // Reimportar el mismo fichero → todo duplicado
    const again = buildSalesPlan(wb, analyzeWorkbook(wb), ctx.store.requireWorkspace(), options);
    expect(summarizePlan(again, ctx.store.requireWorkspace()).toImport).toBe(0);

    expect(revertBlockers(ws, job.id)).toEqual([]);
    revertImport(ctx, job.id, "prueba");
    const after = ctx.store.requireWorkspace();
    expect(after.sales).toHaveLength(33);
    expect(after.sales.every((x) => x.status === "voided")).toBe(true);
    expect(after.products.filter((p) => p.importId === job.id).every((p) => p.status === "archived")).toBe(true);
    expect(computeKpis(after, makePeriod("year", new Date(2026, 5, 1))).salesRevenue).toBe(0);
  });
});

async function invoicesFixture(): Promise<WorkbookData> {
  const wb = new ExcelJS.Workbook();
  const header = ["Nº", "Factura", "Fecha Factura", "NIF", "Cliente", "Concepto", "Periodo / Concepto", "Descripción", "Base Imp. (€)", "Total (€)", "Método de Pago", "Estado", "IVA 21% Base", "IVA 21% Cuota"];
  const jul = wb.addWorksheet("JULIO");
  jul.addRow(header);
  jul.addRow([3, "T2600001", "29/06/2026", "12345678z", "Cliente Uno", "11 CREDITOS-Precio mensual", "Cuota july      11 CREDITOS", "9 CLASES / 2 OPEN BOX", 51.24, 62, "Tarjeta de crédito", "Cobrada", 51.24, 10.76]);
  jul.addRow([2, "T2600002", "01/07/2026", "1234@678Z", "Cliente Dos", "16 CREDITOS -  (73.00€)", "Cuota july   16 CREDITOS", "13 CLASE / 3 OPEN", 60.33, 73, "En efectivo", "Cobrada", 60.33, 12.67]);
  jul.addRow([1, "U2600001", "25/07/2026", null, "Cliente Tres", "Drop In", "Drop In", null, 138.43, 167.5, "Domiciliación bancaria", "Pendiente", 138.43, 29.07]);
  jul.addRow([null, null, null, null, null, null, null, "TOTAL COBRADO →", 111.57, 135, null, null, null, 23.43]);
  jul.addRow(["Total registros: 3"]);
  const ago = wb.addWorksheet("AGOSTO");
  ago.addRow(header);
  ago.addRow([1, "T2600003", "31/07/2026", "12345678Z", "Cliente Uno", "11 CREDITOS-Precio mensual", "Cuota august    11 CREDITOS", "9 CLASES / 2 OPEN BOX", 51.24, 62, "Tarjeta de crédito", "Cobrada", 51.24, 10.76]);
  ago.addRow([1, "T2600002", "01/07/2026", "1234@678Z", "Cliente Dos", "16 CREDITOS", "Cuota july", null, 60.33, 73, "Tarjeta", "Cobrada", 60.33, 12.67]); // duplicada
  return readXlsx(await toBuffer(wb), "facturas.xlsx");
}

describe("Importación de facturas (fixture)", () => {
  it("analiza, deduplica clientes por NIF normalizado, controla totales y separa periodo de emisión", async () => {
    const ctx = await makeCtx();
    const wb = await invoicesFixture();
    const a = analyzeWorkbook(wb);
    expect(a.kind).toBe("invoices");
    const plan = buildInvoicesPlan(wb, a, ctx.store.requireWorkspace(), { dateOutsideSheet: "keep", locationId: ctx.store.requireWorkspace().locations[0]!.id });
    expect(plan.rows).toHaveLength(5);
    expect(plan.rows.filter((r) => r.status === "duplicate")).toHaveLength(1);
    expect(plan.rows.find((r) => r.issues.some((i) => i.code === "BAD_TAX_ID"))).toBeTruthy();
    expect(plan.controls.every((c) => c.ok)).toBe(true);
    expect(plan.insights.some((i) => i.includes("Q2 2026"))).toBe(true);
    const first = plan.rows[0]!;
    expect(first.type === "invoice" && first.planName).toBe("11 CREDITOS");
    expect(first.type === "invoice" && first.servicePeriod?.start.getMonth()).toBe(6);

    const job = commitPlan(ctx, plan, { name: "facturas.xlsx", sha256: "y", size: 1 });
    const ws = ctx.store.requireWorkspace();
    expect(job.summary.created).toMatchObject({ facturas: 4, clientes: 3 });
    expect(ws.invoices.filter((i) => i.status === "issued")).toHaveLength(1);
    const q3 = computeKpis(ws, quarterPeriod(2026, 3));
    expect(q3.invoiceRevenue).toBe(7300 + 16750 + 6200);
    expect(q3.pendingInvoices).toEqual({ count: 1, amount: 16750 });
  });
});

const CAJA = process.env.BOS_CAJA_XLSX;
const FACTURAS = process.env.BOS_FACTURAS_XLSX;
const asAB = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe.skipIf(!CAJA || !existsSync(CAJA ?? ""))("Excel real de caja (local)", () => {
  it("cuadra al céntimo con el Excel y detecta los problemas documentados", async () => {
    const ctx = await makeCtx();
    const wb = await readXlsx(asAB(CAJA!), "caja-real.xlsx");
    const plan = buildSalesPlan(wb, analyzeWorkbook(wb), ctx.store.requireWorkspace(), { dateOutsideSheet: "sheet_month", locationId: ctx.store.requireWorkspace().locations[0]!.id });
    const s = summarizePlan(plan, ctx.store.requireWorkspace());
    const codes = (c: string) => plan.rows.filter((r) => r.issues.some((i) => i.code === c)).length;
    console.log("CAJA", JSON.stringify({ s, controls: plan.controls.map((c) => `${c.label}:${c.ok}`), insights: plan.insights }, null, 1));
    expect(plan.catalog.filter((c) => c.status === "valid").length).toBeGreaterThan(0);
    expect(s.found).toBeGreaterThan(0);
    expect(codes("DUP_IN_FILE")).toBe(12);
    expect(codes("NO_PRODUCT")).toBe(1);
    expect(codes("DATE_OUTSIDE_SHEET")).toBe(11);
    expect(codes("AMOUNT_MISMATCH")).toBe(1);
    expect(plan.controls.filter((c) => c.ok)).toHaveLength(plan.controls.length);
    commitPlan(ctx, plan, { name: "caja", sha256: "z", size: 1 });
    const ws = ctx.store.requireWorkspace();
    const year = computeKpis(ws, makePeriod("year", new Date(2026, 5, 1)));
    expect(year.salesRevenue).toBeGreaterThan(0);
  });
});

describe.skipIf(!FACTURAS || !existsSync(FACTURAS ?? ""))("Excel real de facturas (local)", () => {
  it("importa todas las facturas y cuadra con los pies de cada hoja", async () => {
    const ctx = await makeCtx();
    const wb = await readXlsx(asAB(FACTURAS!), "facturas-real.xlsx");
    const plan = buildInvoicesPlan(wb, analyzeWorkbook(wb), ctx.store.requireWorkspace(), { dateOutsideSheet: "keep", locationId: ctx.store.requireWorkspace().locations[0]!.id });
    const s = summarizePlan(plan, ctx.store.requireWorkspace());
    console.log("FACTURAS", JSON.stringify({ s, controls: plan.controls.map((c) => `${c.label}:${c.expected}/${c.actual}`), insights: plan.insights }, null, 1));
    expect(s.found).toBeGreaterThan(0);
    expect(plan.controls.every((c) => c.ok)).toBe(true);
    const job = commitPlan(ctx, plan, { name: "f", sha256: "f", size: 1 });
    expect(job.summary.created.facturas).toBe(s.found);
    expect(job.summary.created.clientes).toBeGreaterThan(0);
    const ws = ctx.store.requireWorkspace();
    expect(ws.invoices.reduce((a, i) => a + i.total, 0)).toBeGreaterThan(0);
    expect(ws.invoices.reduce((a, i) => a + i.taxTotal, 0)).toBeGreaterThan(0);
  });
});
