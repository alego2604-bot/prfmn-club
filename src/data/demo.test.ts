import { describe, expect, it, vi } from "vitest";
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
      closings: w.cashClosings.length, notes: w.customerNotes.length, expenses: w.expenses.reduce((t, e) => t + e.total, 0), memberships: w.customerMemberships.length,
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
    for (const i of ws.invoices) expect(ws.invoiceItems.some((it) => it.invoiceId === i.id)).toBe(true);
    expect(visibleWorkspace(ws).sales).toHaveLength(ws.sales.length); // la importación de la demo está completada
  });

  it("mantiene una caja abierta con ejecución temprana, sin alterar los cierres históricos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 10, 3, 0));
    try {
      const early = fillDemoWorkspace(fresh(), "u1");
      const openSessions = early.cashSessions.filter((s) => s.status === "open");
      expect(openSessions).toHaveLength(1);
      expect(openSessions[0]!.locationId).toBe(early.locations[0]!.id);
      expect(new Date(openSessions[0]!.openedAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect(early.cashClosings.length).toBeGreaterThan(60);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finanzas y membresías coherentes: gastos con proveedor, cuotas con cargo, estados variados", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(ws.suppliers.length).toBeGreaterThanOrEqual(8);
    expect(ws.expenses.length).toBeGreaterThan(100);
    for (const e of ws.expenses) {
      expect(e.total).toBe(e.subtotal + e.taxTotal);
      expect(e.supplierId && e.categoryId).toBeTruthy();
      expect(e.issueDate <= today).toBe(true);
    }
    expect(ws.expenses.some((e) => e.status === "pending" && e.dueDate && e.dueDate < today)).toBe(true);
    expect(new Set(ws.expenses.map((e) => e.supplierInvoiceNumber)).size).toBe(ws.expenses.length);
    // Una membresía por cliente con alta; las bajas sin próxima renovación
    expect(ws.customerMemberships).toHaveLength(ws.customers.filter((c) => c.status !== "lead").length);
    for (const m of ws.customerMemberships.filter((x) => x.status === "cancelled")) expect(m.nextRenewalDate).toBeUndefined();
    // Restricciones de la base de datos: fin ≥ inicio; bajas posteriores al alta
    for (const m of ws.customerMemberships) if (m.endDate) expect(m.endDate >= m.startDate, `${m.startDate} → ${m.endDate}`).toBe(true);
    for (const c of ws.customers) if (c.leftAt && c.joinedAt) expect(c.leftAt > c.joinedAt).toBe(true);
    for (const ch of ws.membershipCharges) expect(ch.periodEnd >= ch.periodStart).toBe(true);
    expect(ws.customerMemberships.some((m) => m.status === "paused")).toBe(true);
    expect(ws.membershipCharges.some((c) => c.status === "failed")).toBe(true);
    for (const ch of ws.membershipCharges) expect(ws.invoices.some((i) => i.id === ch.invoiceId && i.customerMembershipId === ch.customerMembershipId)).toBe(true);
    expect(ws.invoices.filter((i) => i.status === "draft")).toHaveLength(1);
    expect(ws.tasks.length).toBeGreaterThan(3);
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

describe("Demo con un servidor anterior a 0900", () => {
  it("no siembra tablas que el servidor aún no sincroniza", () => {
    const base = { ...fresh(), server: { schema: 810 } };
    const w = fillDemoWorkspace(base, "u1");
    expect(w.expenses).toHaveLength(0);
    expect(w.customerMemberships).toHaveLength(0);
    expect(w.tasks).toHaveLength(0);
    expect(w.invoices.every((i) => !i.customerMembershipId)).toBe(true);
    const d = diffWorkspaces(base, w)!;
    for (const t of ["expenses", "suppliers", "customer_memberships", "membership_charges", "tasks", "expense_categories"]) expect(d.ops.some((o) => o.table === t)).toBe(false);
  });
});
