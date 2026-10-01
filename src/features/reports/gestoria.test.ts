import { describe, expect, it } from "vitest";
import { buildWorkspace } from "@/data/workspace";
import { quarterPeriod } from "@/lib/dates";
import { buildGestoriaReport, inferRateBp } from "./gestoria";

describe("IVA de facturas sin líneas de detalle", () => {
  it("deduce el tipo legal a partir de base y cuota", () => {
    expect(inferRateBp(5124, 1076)).toBe(2100);
    expect(inferRateBp(1591, 159)).toBe(1000);
    expect(inferRateBp(1000, 0)).toBe(0);
  });

  it("incluye en el informe el IVA de facturas que solo tienen cabecera", () => {
    const ws = buildWorkspace({ name: "Empresa Ejemplo", vertical: "services", locationName: "Centro" });
    ws.invoices.push({
      id: "i1", organizationId: ws.organization.id, issueDate: "2026-07-01", externalNumber: "T2600001", subtotal: 5124, taxTotal: 1076, total: 6200,
      amountPaid: 6200, status: "paid", source: "import", createdAt: "2026-07-01T00:00:00Z",
    });
    const r = buildGestoriaReport(ws, quarterPeriod(2026, 3));
    expect(r.vat).toEqual([{ source: "Facturas emitidas", rateBp: 2100, base: 5124, tax: 1076, total: 6200 }]);
  });
});
