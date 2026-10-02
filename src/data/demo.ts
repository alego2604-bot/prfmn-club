/**
 * Workspace DEMO. Datos 100 % ficticios, en una empresa separada marcada `isDemo`.
 * Nunca se mezclan con la empresa real: viven en otro documento y la UI muestra un banner permanente.
 */
import { computeLine } from "@/domain/pricing";
import type {
  CashClosing, CashSession, Customer, CustomerNote, ImportJob, ImportRecordRow, Invoice, InvoiceItem, Location, Payment, Product, ProductCategory, Sale, SaleItem, UserAccount,
} from "@/domain/types";
import { addDays, startOfDay, toISODate } from "@/lib/dates";
import { uid } from "@/lib/ids";
import { splitGross } from "@/lib/money";
import type { Store, Workspace } from "./store";
import { createOrganization } from "./repos/auth";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CATS: [string, string, number][] = [
  ["Bebidas", "#0ea5b7", 1000],
  ["Suplementación", "#12a150", 1000],
  ["Merchandising", "#8e4ec6", 2100],
  ["Drop-In / Bonos", "#3b5bfd", 2100],
];

const PRODUCTS: [string, number, number, Product["kind"], number, number][] = [
  // nombre, cat, precio, tipo, coste, peso de venta
  ["Agua 50cl", 0, 100, "physical", 25, 30],
  ["Bebida energética zero", 0, 200, "physical", 80, 16],
  ["Isotónica", 0, 200, "physical", 70, 6],
  ["Café", 0, 120, "physical", 20, 6],
  ["Barrita proteica", 1, 250, "physical", 110, 22],
  ["Batido proteico", 1, 300, "physical", 120, 12],
  ["Electrolitos", 1, 400, "physical", 150, 6],
  ["Creatina 300 g", 1, 2500, "physical", 1300, 3],
  ["Proteína whey 1 kg", 1, 6500, "physical", 3600, 1.5],
  ["Camiseta club", 2, 3000, "physical", 1100, 1.5],
  ["Sudadera club", 2, 5000, "physical", 2100, 0.6],
  ["Calleras", 2, 3700, "physical", 1600, 1.2],
  ["Comba speed", 2, 3000, "physical", 1000, 0.8],
  ["Muñequeras", 2, 1200, "physical", 400, 1],
  ["Drop-In", 3, 1500, "drop_in", 0, 9],
  ["Clase de prueba", 3, 1000, "service", 0, 3],
  ["Bono 5 sesiones", 3, 6000, "pack", 0, 1],
];

const FIRST = ["Lucía", "Martín", "Paula", "Hugo", "Carla", "Daniel", "Irene", "Pablo", "Nora", "Álvaro", "Elena", "Marc", "Laia", "Jordi", "Sara", "Adrià", "Marta", "Óscar", "Julia", "Iker"];
const LAST = ["Ferrer", "Soler", "Vidal", "Roca", "Puig", "Serra", "Costa", "Font", "Pons", "Vila", "Riera", "Mas", "Sala", "Camps", "Prat"];
const PLANS: [string, number][] = [["8 sesiones", 5500], ["12 sesiones", 6900], ["Ilimitada", 8900], ["Open Box", 4500]];

export const DEMO_ORGANIZATION = {
  name: "Atlas Training Club (demo)",
  vertical: "functional_training" as const,
  locationName: "Centro Norte",
  legalName: "Atlas Training Demo S.L.",
  taxId: "B00000000",
  city: "Ciudad Demo",
  isDemo: true,
};

/** Modo local: crea la empresa demo en este navegador. */
export async function createDemoWorkspace(store: Store, user: UserAccount): Promise<string> {
  const orgId = await createOrganization(store, user, DEMO_ORGANIZATION);
  await store.openWorkspace(orgId);
  store.update((ws) => fillDemoWorkspace(ws, user.id));
  await store.flush();
  return orgId;
}

/**
 * Rellena una empresa demo (vacía) con datos 100 % ficticios. Se usa igual en local y en Supabase.
 * Determinista (semilla fija): mismas proporciones y patrones en cada alta; solo cambian los ids y la fecha de hoy.
 * Sin datos reales: emails @demo.invalid, teléfonos 600 000 xxx, NIF de ejemplo B00000000.
 *
 * Contenido: 2 centros, catálogo, ~64 clientes (altas, bajas con fecha, leads), ~14 meses de ventas de caja con
 * sesión y cierre diario por centro (algún descuadre justificado), cuotas mensuales facturadas con su línea,
 * notas de clientes y una importación histórica completada con su trazabilidad.
 */
export function fillDemoWorkspace(ws: Workspace, userId: string): Workspace {
  const orgId = ws.organization.id;
  const user = { id: userId };
  const r = rng(42);
  const now = new Date();
  const iso = now.toISOString();
  const north = ws.locations[0]!;
  const south: Location = { id: uid(), organizationId: orgId, name: "Centro Sur", code: "SUR", city: "Ciudad Demo", status: "active", createdAt: iso };

  const categories: ProductCategory[] = CATS.map(([name, color, tax], i) => ({
    id: uid(), organizationId: orgId, name, color, defaultTaxRateBp: tax, sortOrder: i, status: "active", createdAt: iso, updatedAt: iso,
  }));
  const products: Product[] = PRODUCTS.map(([name, ci, price, kind, cost], i) => ({
    id: uid(), organizationId: orgId, categoryId: categories[ci]!.id, name, kind, price, taxRateBp: CATS[ci]![2], cost: cost || undefined,
    trackStock: kind === "physical", stockQuantity: kind === "physical" ? Math.round(10 + r() * 40) : undefined,
    minStock: kind === "physical" ? 6 : undefined, posVisible: true, sortOrder: i, status: "active", createdAt: iso, updatedAt: iso,
  }));
  const weights = PRODUCTS.map((p) => p[5]);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let x = r() * wsum;
    for (let i = 0; i < weights.length; i++) if ((x -= weights[i]!) <= 0) return i;
    return weights.length - 1;
  };

  // Clientes: altas repartidas en ~14 meses; algunas bajas (con fecha) y algunos leads
  const SOURCES = ["walk_in", "instagram", "referral", "google", "web"];
  const customers: Customer[] = Array.from({ length: 64 }, (_, i) => {
    const joined = addDays(now, -Math.round(15 + r() * 410));
    const status = i % 11 === 0 ? "cancelled" : i % 13 === 0 ? "lead" : "active";
    const leftAt = status === "cancelled" ? toISODate(new Date(now.getFullYear(), now.getMonth() - 2 - (i % 3), 0)) : undefined;
    return {
      id: uid(), organizationId: orgId, firstName: FIRST[i % FIRST.length]!, lastName: `${LAST[(i * 7) % LAST.length]} ${LAST[(i * 3 + 5) % LAST.length]}`,
      email: `cliente${i + 1}@demo.invalid`, phone: `600 000 ${String(100 + i).padStart(3, "0")}`, status, tags: [],
      joinedAt: toISODate(joined), leftAt, source: SOURCES[i % SOURCES.length], createdAt: joined.toISOString(), updatedAt: iso,
    } as Customer;
  });
  const members = customers.filter((c) => c.status !== "lead");

  const methods = ["card", "card", "card", "cash", "cash", "bizum"] as const;
  const pmByKey = new Map(ws.paymentMethods.map((m) => [m.key, m]));
  const sales: Sale[] = [];
  const items: SaleItem[] = [];
  const payments: Payment[] = [];
  const cashSessions: CashSession[] = [];
  const cashClosings: CashClosing[] = [];
  const OPENING = 10000; // 100 € de fondo de caja

  const sellDay = (d: Date, loc: Location, volume: number, session?: CashSession) => {
    const dow = d.getDay();
    const start = addDays(startOfDay(now), -420);
    const seasonal = 1 + 0.25 * Math.sin((d.getMonth() / 12) * Math.PI * 2);
    const growth = 0.75 + 0.35 * ((d.getTime() - start.getTime()) / (now.getTime() - start.getTime()));
    const count = Math.round((dow === 0 ? 1 : dow === 6 ? 4 : 9) * seasonal * growth * volume * (0.6 + r() * 0.8));
    const out: Sale[] = [];
    for (let k = 0; k < count; k++) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), [7, 8, 9, 12, 13, 17, 18, 19, 20][Math.floor(r() * 9)]!, Math.floor(r() * 60));
      if (at > now) continue;
      const saleId = uid();
      const lines = 1 + (r() < 0.3 ? 1 : 0) + (r() < 0.08 ? 1 : 0);
      let total = 0, base = 0, tax = 0;
      for (let l = 0; l < lines; l++) {
        const p = products[pick()]!;
        const q = r() < 0.15 ? 2 : 1;
        const a = computeLine({ unitPrice: p.price, quantity: q, taxRateBp: p.taxRateBp });
        const cat = categories.find((c) => c.id === p.categoryId)!;
        items.push({ id: uid(), organizationId: orgId, saleId, productId: p.id, productName: p.name, productKind: p.kind, categoryId: cat.id, categoryName: cat.name,
          quantity: q, unitPrice: p.price, discount: 0, taxRateBp: p.taxRateBp, baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total });
        total += a.total; base += a.baseAmount; tax += a.taxAmount;
      }
      const customerId = r() < 0.35 ? members[Math.floor(r() * members.length)]!.id : undefined;
      const sale: Sale = { id: saleId, organizationId: orgId, locationId: loc.id, number: 0, occurredAt: at.toISOString(), timePrecision: "exact", granularity: "transaction",
        customerId, sellerId: user.id, cashSessionId: session?.id, subtotal: base, taxTotal: tax, discountTotal: 0, total, status: "completed", source: "pos", createdAt: at.toISOString() };
      sales.push(sale);
      out.push(sale);
      const m = pmByKey.get(methods[Math.floor(r() * methods.length)]!)!;
      payments.push({ id: uid(), organizationId: orgId, locationId: loc.id, kind: "charge", saleId, customerId, paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind,
        amount: total, status: "succeeded", paidAt: at.toISOString(), source: "pos", createdAt: at.toISOString() });
    }
    return out;
  };

  // Ventas de caja: ~14 meses por centro. Los últimos 45 días, con sesión de caja y cierre diario.
  const start = addDays(startOfDay(now), -420);
  const sessionsFrom = addDays(startOfDay(now), -45);
  for (let d = start; d <= now; d = addDays(d, 1)) {
    for (const [loc, volume] of [[north, 1], [south, 0.55]] as const) {
      const today = toISODate(d) === toISODate(now);
      if (d < sessionsFrom) {
        sellDay(d, loc, volume);
        continue;
      }
      const openedAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 50);
      if (openedAt > now) continue;
      const session: CashSession = { id: uid(), organizationId: orgId, locationId: loc.id, openedBy: user.id, openedAt: openedAt.toISOString(), openingFloat: OPENING, status: today && loc === north ? "open" : "closed" };
      cashSessions.push(session);
      const daySales = sellDay(d, loc, volume, session);
      if (session.status === "open") continue;
      const closedAt = today ? now : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 35);
      session.closedAt = closedAt.toISOString();
      const ids = new Set(daySales.map((x) => x.id));
      const byMethod: Record<string, number> = {};
      for (const p of payments) if (p.saleId && ids.has(p.saleId)) byMethod[p.methodKey] = (byMethod[p.methodKey] ?? 0) + p.amount;
      const expected = OPENING + (byMethod.cash ?? 0);
      const off = r() < 0.08 ? (r() < 0.5 ? -1 : 1) * (50 + Math.round(r() * 250)) : 0;
      cashClosings.push({
        id: uid(), organizationId: orgId, cashSessionId: session.id, version: 1, salesCount: daySales.length, salesTotal: daySales.reduce((t, x) => t + x.total, 0),
        totalsByMethod: byMethod, openingFloat: OPENING, cashIn: 0, cashOut: 0, expectedCash: expected, countedCash: expected + off, difference: off,
        status: off ? "discrepancy" : "balanced", notes: off ? (off < 0 ? "Cambio mal dado en una venta en efectivo" : "Propina dejada en el cajón") : undefined,
        closedBy: user.id, closedAt: closedAt.toISOString(),
      });
    }
  }

  // Histórico importado (completado): ventas agregadas de hace ~14 meses, con su trazabilidad fila a fila
  const importId = uid();
  const importedAt = addDays(now, -30).toISOString();
  const importRecords: ImportRecordRow[] = [];
  const histStart = new Date(now.getFullYear(), now.getMonth() - 15, 1);
  let importedTotal = 0;
  for (let i = 0; i < 40; i++) {
    const at = new Date(histStart.getFullYear(), histStart.getMonth(), 1 + (i % 28), 12);
    const p = products[pick()]!;
    const cat = categories.find((c) => c.id === p.categoryId)!;
    const q = 1 + Math.floor(r() * 3);
    const a = computeLine({ unitPrice: p.price, quantity: q, taxRateBp: p.taxRateBp });
    const saleId = uid();
    sales.push({ id: saleId, organizationId: orgId, locationId: north.id, number: 0, occurredAt: at.toISOString(), timePrecision: "day", granularity: "transaction",
      subtotal: a.baseAmount, taxTotal: a.taxAmount, discountTotal: 0, total: a.total, status: "completed", source: "import", importId, createdAt: importedAt });
    items.push({ id: uid(), organizationId: orgId, saleId, productId: p.id, productName: p.name, productKind: p.kind, categoryId: cat.id, categoryName: cat.name,
      quantity: q, unitPrice: p.price, discount: 0, taxRateBp: p.taxRateBp, baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total });
    const m = pmByKey.get(i % 3 ? "card" : "cash")!;
    payments.push({ id: uid(), organizationId: orgId, locationId: north.id, kind: "charge", saleId, paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind,
      amount: a.total, status: "succeeded", paidAt: at.toISOString(), source: "import", importId, createdAt: importedAt });
    importRecords.push({ id: uid(), organizationId: orgId, importId, sheet: "Histórico", rowNumber: i + 2, status: "imported", confidence: "high", messages: [], entityType: "sales", entityId: saleId, action: "created" });
    importedTotal += a.total;
  }
  for (let i = 0; i < 3; i++) importRecords.push({ id: uid(), organizationId: orgId, importId, sheet: "Histórico", rowNumber: 42 + i, status: i ? "ignored" : "duplicate", messages: [i ? "Fila de totales del mes" : "Misma fecha, producto e importe que la fila 7"], action: "skipped" });
  const job: ImportJob = {
    id: importId, organizationId: orgId, locationId: north.id, kind: "sales", fileName: "historico-caja-demo.xlsx", fileSha256: "d".repeat(64), fileSize: 48_213,
    status: "completed",
    summary: { found: 43, valid: 40, review: 0, duplicates: 1, errors: 0, ignored: 3, created: { ventas: 40 }, linked: 0, totalAmount: importedTotal },
    pipeline: {
      state: "COMPLETED", expected: { main: 40, records: 43 }, updatedAt: importedAt,
      events: (["UPLOADING", "ANALYZING", "MAPPING", "VALIDATING", "IMPORTING", "COMPLETED"] as const).map((state, i) => ({ state, at: new Date(new Date(importedAt).getTime() + i * 20_000).toISOString() })),
    },
    createdBy: user.id, createdAt: importedAt, completedAt: importedAt,
  };

  // Cuotas mensuales facturadas (últimos 13 meses), con su línea. Las bajas dejan de facturarse al darse de baja.
  const invoices: Invoice[] = [];
  const invoiceItems: InvoiceItem[] = [];
  let invN = 0;
  const card = pmByKey.get("card")!;
  for (let mBack = 12; mBack >= 0; mBack--) {
    const issue = new Date(now.getFullYear(), now.getMonth() - mBack, 1);
    for (const [ci, c] of members.entries()) {
      if (new Date(c.createdAt) > issue) continue;
      if (c.leftAt && toISODate(issue) > c.leftAt) continue;
      const [planName, price] = PLANS[(c.firstName.length + (c.lastName?.length ?? 0)) % PLANS.length]!;
      const { base, tax } = splitGross(price, 2100);
      const pending = mBack === 0 && r() < 0.06;
      const loc = ci % 3 === 2 ? south : north;
      invN++;
      const invoiceId = uid();
      invoices.push({ id: invoiceId, organizationId: orgId, locationId: loc.id, number: `D${issue.getFullYear()}-${String(invN).padStart(5, "0")}`, issueDate: toISODate(issue),
        customerId: c.id, customerName: `${c.firstName} ${c.lastName}`, concept: `Cuota ${planName}`, servicePeriodStart: toISODate(issue),
        servicePeriodEnd: toISODate(new Date(issue.getFullYear(), issue.getMonth() + 1, 0)), subtotal: base, taxTotal: tax, total: price,
        amountPaid: pending ? 0 : price, status: pending ? "issued" : "paid", paymentMethodId: pending ? undefined : card.id, paidAt: pending ? undefined : issue.toISOString(),
        source: "membership", createdAt: issue.toISOString() });
      invoiceItems.push({ id: uid(), organizationId: orgId, invoiceId, description: `Cuota ${planName} · ${issue.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}`,
        quantity: 1, unitPrice: price, taxRateBp: 2100, baseAmount: base, taxAmount: tax, total: price });
    }
  }

  // Notas de seguimiento (ficticias)
  const NOTES = [
    "Prefiere entrenar a primera hora. Interesada en el plan ilimitado.",
    "Lesión de hombro en recuperación: adaptar los ejercicios por encima de la cabeza.",
    "Ha preguntado por el bono familiar.",
    "Pago de la cuota por Bizum este mes.",
    "Viene con un amigo la semana que viene a la clase de prueba.",
    "Quiere factura a nombre de su empresa a partir del mes que viene.",
  ];
  const customerNotes: CustomerNote[] = Array.from({ length: 16 }, (_, i) => {
    const c = members[(i * 5) % members.length]!;
    const at = addDays(now, -Math.round(2 + r() * 120));
    return { id: uid(), organizationId: orgId, customerId: c.id, authorId: user.id, body: NOTES[i % NOTES.length]!, pinned: i % 7 === 0, createdAt: at.toISOString() };
  });

  sales.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  sales.forEach((s, i) => (s.number = i + 1));
  return {
    ...ws,
    locations: [...ws.locations.filter((l) => l.id !== south.id), south],
    categories, products, customers, customerNotes, cashSessions, cashClosings, sales, saleItems: items, payments, invoices, invoiceItems,
    imports: [...ws.imports, job], importRecords: [...ws.importRecords, ...importRecords],
    counters: { sale: sales.length },
  };
}
