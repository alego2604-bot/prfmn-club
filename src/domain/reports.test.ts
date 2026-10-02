import { describe, expect, it } from "vitest";
import { buildWorkspace } from "@/data/workspace";
import { DEMO_ORGANIZATION, fillDemoWorkspace } from "@/data/demo";
import { buildReport, kpiDelta, previousOf, REPORTS, reportPeriod } from "./reports";

const ws = fillDemoWorkspace(buildWorkspace({ ...DEMO_ORGANIZATION, vertical: "functional_training", isDemo: true }), "u1");

describe("Informes", () => {
  it("los 10 informes se construyen para cualquier periodo, con tabla y totales coherentes", () => {
    for (const preset of ["today", "month", "prev_quarter", "year"] as const) {
      const period = reportPeriod(preset);
      for (const r of REPORTS) {
        const rep = buildReport(ws, r.key, { period, compare: previousOf(period, "previous") });
        expect(rep.kpis.length).toBeGreaterThan(0);
        expect(rep.table.columns.length).toBeGreaterThan(1);
        for (const row of rep.table.rows) expect(row).toHaveLength(rep.table.columns.length);
      }
    }
  });

  it("ventas: el total de la tabla coincide con la suma de filas", () => {
    const period = reportPeriod("prev_quarter");
    const rep = buildReport(ws, "sales", { period, compare: null });
    const sum = rep.table.rows.reduce((t, r) => t + Number(r[2]), 0);
    expect(rep.table.totals![2]).toBe(sum);
  });

  it("comparación honesta: sin datos en el periodo de comparación no hay variación", () => {
    const period = reportPeriod("year");
    const rep = buildReport(ws, "expenses", { period, compare: previousOf(previousOf(period, "year"), "year") });
    expect(kpiDelta(rep.kpis[0]!)).toBeNull();
    expect(rep.notes.join(" ")).toMatch(/no se muestran variaciones/);
  });

  it("centros: la suma por centro no inventa reparto de gastos generales", () => {
    const rep = buildReport(ws, "locations", { period: reportPeriod("year"), compare: null });
    expect(rep.table.rows).toHaveLength(2);
    expect(rep.notes.join(" ")).toMatch(/Gastos generales/);
  });
});

describe("Periodos en curso", () => {
  it("se miden hasta hoy y se comparan con los mismos días del periodo anterior", async () => {
    const { toDate, comparableOf } = await import("./reports");
    const now = new Date(2026, 9, 2, 12);
    const q = { preset: "quarter" as const, start: new Date(2026, 9, 1), end: new Date(2027, 0, 1), label: "T4 2026" };
    const { period, partial } = toDate(q, now);
    expect(partial).toBe(true);
    expect(period.end).toEqual(new Date(2026, 9, 3));
    const c = comparableOf(q, period, "previous");
    expect(c.start).toEqual(new Date(2026, 6, 1));
    expect(c.end.getTime() - c.start.getTime()).toBe(period.end.getTime() - period.start.getTime());
    expect(comparableOf(q, period, "year").end).toEqual(new Date(2025, 9, 3));
    const closed = toDate({ ...q, start: new Date(2026, 3, 1), end: new Date(2026, 6, 1) }, now);
    expect(closed.partial).toBe(false);
  });
});
