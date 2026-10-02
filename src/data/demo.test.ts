import { describe, expect, it } from "vitest";
import { buildWorkspace } from "./workspace";
import { DEMO_ORGANIZATION, fillDemoWorkspace } from "./demo";
import { diffWorkspaces, splitBatch, batchRows, CHUNK_MAX_ROWS } from "./cloud/sync";
import { visibleWorkspace } from "./visibility";

const fresh = () => buildWorkspace({ ...DEMO_ORGANIZATION, vertical: "functional_training", isDemo: true });

describe("Demo sintética", () => {
  const empty = fresh();
  const ws = fillDemoWorkspace(empty, "u1");

  it("es determinista: mismas cifras en cada alta (solo cambian los ids)", () => {
    const again = fillDemoWorkspace(fresh(), "u1");
    const shape = (w: typeof ws) => ({
      sales: w.sales.length, revenue: w.sales.reduce((t, s) => t + s.total, 0), invoices: w.invoices.length, customers: w.customers.length,
      closings: w.cashClosings.length, notes: w.customerNotes.length,
    });
    expect(shape(again)).toEqual(shape(ws));
  });

  it("no contiene datos reales: emails .invalid, teléfonos 600 000 xxx, NIF de ejemplo", () => {
    expect(ws.customers.every((c) => !c.email || c.email.endsWith("@demo.invalid"))).toBe(true);
    expect(ws.customers.every((c) => !c.phone || /^600 000 \d{3}$/.test(c.phone))).toBe(true);
    expect(ws.customers.every((c) => !c.taxId)).toBe(true);
    expect(ws.organization.isDemo).toBe(true);
  });

  it("cubre lo que necesitan las pantallas: 2 centros, caja con cierres, notas, importación, facturas con línea", () => {
    expect(ws.locations).toHaveLength(2);
    for (const l of ws.locations) expect(ws.sales.some((s) => s.locationId === l.id)).toBe(true);
    expect(ws.cashSessions.filter((s) => s.status === "open")).toHaveLength(1);
    expect(ws.cashClosings.length).toBeGreaterThan(60);
    expect(ws.cashClosings.some((c) => c.status === "discrepancy" && c.notes)).toBe(true);
    for (const c of ws.cashClosings) expect(c.expectedCash).toBe(c.openingFloat + (c.totalsByMethod.cash ?? 0));
    expect(ws.customerNotes.length).toBeGreaterThan(10);
    expect(ws.imports).toHaveLength(1);
    expect(ws.importRecords.length).toBe(43);
    expect(ws.invoiceItems).toHaveLength(ws.invoices.length);
    expect(visibleWorkspace(ws).sales).toHaveLength(ws.sales.length); // la importación de la demo está completada
  });

  it("las bajas tienen fecha y no se facturan después", () => {
    const gone = ws.customers.filter((c) => c.status === "cancelled");
    expect(gone.length).toBeGreaterThan(0);
    for (const c of gone) {
      expect(c.leftAt).toBeDefined();
      expect(ws.invoices.filter((i) => i.customerId === c.id && (i.issueDate ?? "") > c.leftAt!)).toHaveLength(0);
    }
  });

  it("se envía en lotes que caben en el statement_timeout (nunca un único lote gigante)", () => {
    const d = diffWorkspaces(empty, ws)!;
    expect(batchRows(d)).toBeGreaterThan(5000);
    const parts = splitBatch(d);
    expect(parts.length).toBeGreaterThan(15);
    expect(parts.every((p) => batchRows(p) <= CHUNK_MAX_ROWS)).toBe(true);
    // Orden FK: las sesiones de caja van antes que las ventas que las referencian
    const order = parts.flatMap((p) => p.ops.filter((o) => o.op === "insert").map((o) => o.table));
    expect(order.lastIndexOf("cash_sessions")).toBeLessThan(order.indexOf("sales"));
    expect(order.lastIndexOf("locations")).toBeLessThan(order.indexOf("sales"));
  });
});
