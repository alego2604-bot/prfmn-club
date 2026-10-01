import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Ctx } from "../context";
import { createCategory, createProduct, duplicateProduct, setProductStatus, updateProduct } from "./catalog";
import { createSale, voidSale } from "./sales";
import { addCashMovement, closeCashSession, openCashSession, reopenCashSession, sessionSummary } from "./cash";
import { createCustomer } from "./customers";
import { computeKpis } from "@/domain/analytics";
import { makePeriod, quarterPeriod } from "@/lib/dates";
import { buildGestoriaReport } from "@/features/reports/gestoria";

let owner: Ctx;
let loc: string;
let loc2: string;
const as = (role: Ctx["role"], locationIds: string[] | null = null): Ctx => ({ ...owner, user: { id: `u-${role}`, fullName: role, email: `${role}@t` }, role, locationIds });

beforeEach(async () => {
  const store = new Store(createMemoryKV());
  await store.init();
  const ws = buildWorkspace({ name: "The Gravity Room", vertical: "fitness", locationName: "Calonge" });
  ws.locations.push({ id: "loc2", organizationId: ws.organization.id, name: "Girona", status: "active", createdAt: "" });
  await store.createWorkspace(ws);
  await store.openWorkspace(ws.organization.id);
  owner = { store, user: { id: "alex", fullName: "Alex", email: "a@t" }, role: "owner", locationIds: null };
  loc = ws.locations[0]!.id;
  loc2 = "loc2";
});

function seed() {
  const bebidas = createCategory(owner, { name: "Bebidas", defaultTaxRateBp: 1000 });
  const agua = createProduct(owner, { name: "Agua", categoryId: bebidas.id, kind: "physical", price: 100, taxRateBp: 1000, cost: 25, trackStock: true, stockQuantity: 10, minStock: 3, posVisible: true });
  const drop = createProduct(owner, { name: "Drop-In", categoryId: null, kind: "drop_in", price: 1500, taxRateBp: 2100, trackStock: false, posVisible: true });
  return { agua, drop };
}

describe("Caja → venta → cierre", () => {
  it("exige caja abierta, vende con pago dividido, descuenta stock y cuadra el cierre", () => {
    const { agua, drop } = seed();
    expect(() => createSale(owner, { locationId: loc, lines: [{ productId: agua.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 100 }] })).toThrow(/Abre la caja/);
    const s = openCashSession(owner, loc, 5000);
    expect(() => openCashSession(owner, loc, 0)).toThrow(/Ya hay una caja abierta/);

    const sale = createSale(owner, { locationId: loc, lines: [{ productId: agua.id, quantity: 2 }, { productId: drop.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 700 }, { methodKey: "card", amount: 1000 }] });
    expect(sale.number).toBe(1);
    expect(sale.total).toBe(1700);
    expect(sale.subtotal + sale.taxTotal).toBe(1700);
    const ws = owner.store.requireWorkspace();
    expect(ws.products.find((p) => p.id === agua.id)!.stockQuantity).toBe(8);

    expect(() => createSale(owner, { locationId: loc, lines: [{ productId: drop.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 1000 }] })).toThrow(/Faltan/);
    expect(() => createSale(owner, { locationId: loc, lines: [{ productId: drop.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 2000 }] })).toThrow(/superan/);
    expect(() => createSale(owner, { locationId: loc, lines: [], payments: [] })).toThrow(/vacío/);

    addCashMovement(owner, s.id, "cash_out", 300, "Hielo");
    const sum = sessionSummary(owner.store.requireWorkspace(), s);
    expect(sum.expectedCash).toBe(5000 + 700 - 300);
    expect(sum.totalsByMethod).toEqual({ cash: 700, card: 1000 });

    expect(() => closeCashSession(owner, s.id, 5300)).toThrow(/observación/);
    const c = closeCashSession(owner, s.id, 5300, "Faltan 1,00 €");
    expect(c.difference).toBe(-100);
    expect(c.status).toBe("discrepancy");

    // Venta de una caja cerrada no se anula sin reabrir
    expect(() => voidSale(owner, sale.id, "error")).toThrow(/caja cerrada/);
    reopenCashSession(owner, s.id, "Recuento");
    voidSale(owner, sale.id, "Cobrada por error");
    const after = owner.store.requireWorkspace();
    expect(after.sales[0]!.status).toBe("voided");
    expect(after.payments.filter((p) => p.kind === "refund")).toHaveLength(2);
    expect(after.products.find((p) => p.id === agua.id)!.stockQuantity).toBe(10);
    const c2 = closeCashSession(owner, s.id, 4700);
    expect(c2.version).toBe(2);
    expect(c2.status).toBe("balanced");
    expect(after.cashClosings[0]!.supersededAt).toBeTruthy();
    expect(owner.store.requireWorkspace().auditLogs.map((l) => l.action)).toEqual(expect.arrayContaining(["open", "close", "reopen", "void", "cash_out"]));
  });

  it("la venta afecta al dashboard al instante", () => {
    const { drop } = seed();
    openCashSession(owner, loc, 0);
    createSale(owner, { locationId: loc, lines: [{ productId: drop.id, quantity: 2 }], payments: [{ methodKey: "bizum", amount: 3000 }] });
    const k = computeKpis(owner.store.requireWorkspace(), makePeriod("today"));
    expect(k.revenue).toBe(3000);
    expect(k.dropIns.units).toBe(2);
    expect(k.byMethod).toEqual([{ key: "bizum", name: "Bizum", amount: 3000 }]);
  });
});

describe("Catálogo", () => {
  it("versiona precios sin tocar ventas pasadas y nunca borra", () => {
    const { drop } = seed();
    openCashSession(owner, loc, 0);
    createSale(owner, { locationId: loc, lines: [{ productId: drop.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 1500 }] });
    updateProduct(owner, drop.id, { ...drop, price: 1700 }, "Subida 2027");
    const ws = owner.store.requireWorkspace();
    const hist = ws.productPrices.filter((p) => p.productId === drop.id);
    expect(hist.map((h) => h.price)).toEqual([1500, 1700]);
    expect(hist[0]!.validTo).toBeTruthy();
    expect(ws.saleItems[0]!.unitPrice).toBe(1500);
    expect(ws.auditLogs.find((l) => l.action === "price_change")!.changes!.price).toEqual({ from: 1500, to: 1700 });
    setProductStatus(owner, drop.id, "archived");
    expect(owner.store.requireWorkspace().products.find((p) => p.id === drop.id)!.status).toBe("archived");
    const copy = duplicateProduct(owner, drop.id);
    expect(copy.name).toBe("Drop-In (copia)");
  });

  it("valida nombres duplicados, SKU y precios", () => {
    seed();
    expect(() => createProduct(owner, { name: "agua", categoryId: null, kind: "physical", price: 1, taxRateBp: 2100, trackStock: false, posVisible: true })).toThrow(/Ya existe/);
    expect(() => createProduct(owner, { name: "X", categoryId: null, kind: "physical", price: -1, taxRateBp: 2100, trackStock: false, posVisible: true })).toThrow(/Precio/);
  });
});

describe("Permisos y centros", () => {
  it("employee vende en su centro pero no cambia precios ni anula", () => {
    const { agua } = seed();
    const emp = as("employee", [loc2]);
    openCashSession(owner, loc, 0);
    openCashSession(owner, loc2, 0);
    expect(() => createSale(emp, { locationId: loc, lines: [{ productId: agua.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 100 }] })).toThrow(/centro/);
    const s = createSale(emp, { locationId: loc2, lines: [{ productId: agua.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 100 }] });
    expect(() => voidSale(emp, s.id, "x")).toThrow(/permiso/);
    expect(() => updateProduct(emp, agua.id, { ...agua, price: 1 })).toThrow(/permiso/);
    expect(() => updateProduct(as("manager"), agua.id, { ...agua, price: 1 })).toThrow(/catalog.prices/);
    expect(() => createSale(as("accountant"), { locationId: loc, lines: [{ productId: agua.id, quantity: 1 }], payments: [{ methodKey: "cash", amount: 100 }] })).toThrow(/permiso/);
  });

  it("clientes: NIF normalizado único", () => {
    createCustomer(owner, { firstName: "Cliente", taxId: "12345678z", status: "active" });
    expect(() => createCustomer(owner, { firstName: "Otro", taxId: "12345678-Z", status: "active" })).toThrow(/Ya existe/);
  });
});

describe("Informe gestoría", () => {
  it("genera las 10 hojas con IVA cuadrado y nombre de archivo Q3_2026", () => {
    const { agua, drop } = seed();
    openCashSession(owner, loc, 0);
    createSale(owner, { locationId: loc, lines: [{ productId: agua.id, quantity: 3 }, { productId: drop.id, quantity: 1 }], payments: [{ methodKey: "card", amount: 1800 }] });
    const now = new Date();
    const q = quarterPeriod(now.getFullYear(), Math.floor(now.getMonth() / 3) + 1);
    const r = buildGestoriaReport(owner.store.requireWorkspace(), q);
    expect(r.sheets.map((s) => s.name)).toEqual(["Resumen", "Caja diaria", "Ventas", "Facturación", "IVA", "Métodos de pago", "Categorías", "Productos", "Clientes", "Cierres"]);
    expect(r.vat.reduce((s, v) => s + v.total, 0)).toBe(1800);
    expect(r.vat.find((v) => v.rateBp === 1000)!.base + r.vat.find((v) => v.rateBp === 1000)!.tax).toBe(300);
    expect(r.fileBase).toBe(`Q${Math.floor(now.getMonth() / 3) + 1}_${now.getFullYear()}_TheGravityRoom`);
    expect(buildGestoriaReport(owner.store.requireWorkspace(), quarterPeriod(2026, 3)).fileBase).toBe("Q3_2026_TheGravityRoom");
  });
});
