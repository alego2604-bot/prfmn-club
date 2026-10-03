/**
 * Workspace DEMO. Datos 100 % ficticios, en una empresa separada marcada `isDemo`.
 * Nunca se mezclan con la empresa real: viven en otro documento y la UI muestra un banner permanente.
 */
import { computeLine } from "@/domain/pricing";
import type {
  CashClosing, CashSession, Customer, CustomerMembership, CustomerNote, Expense, ImportJob, ImportRecordRow, Invoice, InvoiceItem, Location, MembershipCharge,
  MembershipPlan, MembershipPlanVersion, Payment, Product, ProductCategory, Sale, SaleItem, Supplier, Task, UserAccount,
} from "@/domain/types";
import { addDays, startOfDay, toISODate } from "@/lib/dates";
import { uid } from "@/lib/ids";
import { splitGross } from "@/lib/money";
import type { Store, Workspace } from "./store";
import { createOrganization } from "./repos/auth";
import { DEFAULT_EXPENSE_CATEGORIES } from "./workspace";

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
 * sesión y cierre diario por centro (algún descuadre justificado), tarifas con versiones de precio, una membresía por
 * cliente (bajas, pausas, cuotas devueltas), cuotas mensuales facturadas con su línea y su cargo, facturas a empresas
 * (emitida y borrador), 10 proveedores con 13 meses de gastos (pagados, pendientes y uno vencido), tareas de
 * seguimiento, notas de clientes y una importación histórica completada con su trazabilidad.
 */
export function fillDemoWorkspace(ws: Workspace, userId: string): Workspace {
  const orgId = ws.organization.id;
  // Servidor sin la migración 0900: no admite gastos, proveedores, membresías ni tareas. Se siembra lo demás.
  const v900 = !ws.server || ws.server.schema >= 900;
  const user = { id: userId };
  const r = rng(42);
  const now = new Date();
  const iso = now.toISOString();
  const north: Location = { ...ws.locations[0]!, city: ws.locations[0]!.city ?? "Ciudad Demo" };
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
    const status = i % 11 === 0 ? "cancelled" : i % 13 === 0 ? "lead" : "active";
    const leftAt = status === "cancelled" ? toISODate(new Date(now.getFullYear(), now.getMonth() - 2 - (i % 3), 0)) : undefined;
    // Una baja siempre es posterior al alta (y con al menos dos meses de relación)
    const joined = leftAt
      ? addDays(new Date(`${leftAt}T00:00:00`), -Math.round(70 + r() * 300))
      : addDays(now, -Math.round(i % 8 === 3 ? 6 + r() * 70 : 15 + Math.pow(r(), 0.7) * 470));
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
      const scheduledOpenAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 50);
      // La caja abierta de hoy debe existir aunque la demo se genere antes de su hora habitual.
      const openedAt = today && scheduledOpenAt > now ? now : scheduledOpenAt;
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

  // Tarifas (con versión de precio) y membresías: una por cliente con alta; bajas con fecha, algunas pausas y cuotas vencidas
  const PLAN_DEFS: { name: string; price: number; description: string }[] = [
    { name: "8 sesiones / mes", price: 5500, description: "Dos sesiones por semana" },
    { name: "12 sesiones / mes", price: 6900, description: "Tres sesiones por semana" },
    { name: "Ilimitada", price: 8900, description: "Acceso ilimitado a clases y sala" },
    { name: "Open Box", price: 4500, description: "Sala libre sin clases dirigidas" },
  ];
  const planStart = toISODate(addDays(now, -480));
  const membershipPlans: MembershipPlan[] = [
    ...PLAN_DEFS.map((d) => ({ id: uid(), organizationId: orgId, name: d.name, kind: "recurring" as const, billingPeriod: "month" as const, isFounder: false, openToNew: true, description: d.description, locationIds: null, status: "active" as const, createdAt: iso })),
    { id: uid(), organizationId: orgId, name: "Anual Ilimitada", kind: "recurring", billingPeriod: "year", isFounder: false, openToNew: true, description: "Pago anual con dos meses de ahorro", locationIds: null, status: "active", createdAt: iso },
    { id: uid(), organizationId: orgId, name: "Bono 10 sesiones", kind: "pack", billingPeriod: "none", isFounder: false, openToNew: true, description: "Válido 60 días", locationIds: null, status: "active", createdAt: iso },
  ];
  const planVersions: MembershipPlanVersion[] = membershipPlans.map((pl, i) => ({
    id: uid(), organizationId: orgId, planId: pl.id, version: 1, price: i < PLAN_DEFS.length ? PLAN_DEFS[i]!.price : i === 4 ? 89000 : 12000,
    taxRateBp: 2100, sessions: i === 5 ? 10 : undefined, durationDays: i === 5 ? 60 : undefined, validFrom: planStart,
  }));
  // Subida de precio de la Ilimitada hace 3 meses: quien ya la tenía conserva su precio pactado
  const ilimitada = planVersions[2]!;
  const raiseFrom = toISODate(new Date(now.getFullYear(), now.getMonth() - 3, 1));
  ilimitada.validTo = toISODate(addDays(new Date(`${raiseFrom}T00:00`), -1));
  planVersions.push({ id: uid(), organizationId: orgId, planId: ilimitada.planId, version: 2, price: 9500, taxRateBp: 2100, validFrom: raiseFrom });

  const invoices: Invoice[] = [];
  const invoiceItems: InvoiceItem[] = [];
  const customerMemberships: CustomerMembership[] = [];
  const membershipCharges: MembershipCharge[] = [];
  let invN = 0;
  const card = pmByKey.get("card")!;
  const firstOfMonth = (back: number) => new Date(now.getFullYear(), now.getMonth() - back, 1);
  const thisMonth = toISODate(firstOfMonth(0));
  const nextMonth = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  for (const [ci, c] of members.entries()) {
    const pi = (c.firstName.length + (c.lastName?.length ?? 0)) % PLAN_DEFS.length;
    const plan = membershipPlans[pi]!;
    const joinedMonth = new Date(new Date(c.createdAt).getFullYear(), new Date(c.createdAt).getMonth() + 1, 1);
    const version = pi === 2 && toISODate(joinedMonth) >= raiseFrom ? planVersions[planVersions.length - 1]! : planVersions[pi]!;
    const price = version.price;
    const loc = ci % 3 === 2 ? south : north;
    const paused = c.status === "active" && ci % 17 === 4;
    const pastDue = c.status === "active" && !paused && ci % 19 === 7;
    const membershipId = uid();
    const startDate = toISODate(joinedMonth > now ? firstOfMonth(0) : joinedMonth);
    const m: CustomerMembership = {
      id: membershipId, organizationId: orgId, customerId: c.id, planId: plan.id, planVersionId: version.id, locationId: loc.id, price, startDate,
      autoRenew: c.status === "active", status: c.status === "cancelled" ? "cancelled" : paused ? "paused" : "active",
      nextRenewalDate: c.status === "cancelled" ? undefined : pastDue ? thisMonth : paused ? thisMonth : nextMonth,
      cancelledAt: c.leftAt ? new Date(`${c.leftAt}T10:00:00`).toISOString() : undefined, cancelReason: c.leftAt ? ["Cambio de ciudad", "Motivos económicos", "Lesión"][ci % 3] : undefined,
      endDate: c.leftAt, pausedAt: paused ? addDays(now, -9).toISOString() : undefined, resumeOn: paused ? toISODate(addDays(now, 21)) : undefined,
      notes: paused ? "Pausa por viaje de trabajo" : undefined, createdBy: user.id, createdAt: new Date(`${startDate}T09:00:00`).toISOString(), updatedAt: iso,
    };
    customerMemberships.push(m);
    for (let mBack = 12; mBack >= 0; mBack--) {
      const issue = firstOfMonth(mBack);
      const issueIso = toISODate(issue);
      if (issueIso < startDate) continue;
      if (c.leftAt && issueIso > c.leftAt) continue;
      if (mBack === 0 && (paused || pastDue)) continue;
      const failed = pastDue && mBack === 1;
      const pending = failed || (mBack === 0 && r() < 0.06);
      const { base, tax } = splitGross(price, 2100);
      invN++;
      const invoiceId = uid();
      const periodEnd = toISODate(new Date(issue.getFullYear(), issue.getMonth() + 1, 0));
      const month = issue.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
      invoices.push({ id: invoiceId, organizationId: orgId, locationId: loc.id, number: `D${issue.getFullYear()}-${String(invN).padStart(5, "0")}`, issueDate: issueIso, dueDate: issueIso,
        customerId: c.id, customerName: `${c.firstName} ${c.lastName}`, concept: `Cuota ${plan.name}`, servicePeriodStart: issueIso,
        servicePeriodEnd: periodEnd, subtotal: base, taxTotal: tax, discountTotal: 0, total: price,
        amountPaid: pending ? 0 : price, status: pending ? "issued" : "paid", paymentMethodId: pending ? undefined : card.id, paidAt: pending ? undefined : issue.toISOString(),
        planVersionId: version.id, customerMembershipId: membershipId, source: "membership", createdAt: issue.toISOString() });
      if (!pending) payments.push({ id: uid(), organizationId: orgId, locationId: loc.id, kind: "charge", invoiceId, customerId: c.id, paymentMethodId: card.id, methodKey: card.key, methodKind: card.kind, amount: price, status: "succeeded", paidAt: issue.toISOString(), source: "manual", createdAt: issue.toISOString() });
      invoiceItems.push({ id: uid(), organizationId: orgId, invoiceId, description: `Cuota ${plan.name} · ${month}`, quantity: 1, unitPrice: price, discount: 0, taxRateBp: 2100, baseAmount: base, taxAmount: tax, total: price, planVersionId: version.id, sortOrder: 0 });
      membershipCharges.push({ id: uid(), organizationId: orgId, customerMembershipId: membershipId, periodStart: issueIso, periodEnd, amount: price, status: failed ? "failed" : pending ? "invoiced" : "paid", invoiceId, createdAt: issue.toISOString() });
    }
  }

  // Facturación a empresas: una emitida pendiente (con serie propia) y un borrador
  const local = !ws.server;
  const fSeries = ws.documentSeries.find((x) => x.documentType === "invoice" && x.year === now.getFullYear() && x.status === "active");
  let documentSeries = ws.documentSeries;
  const corpLines = [
    { description: "Sesiones de entrenamiento para equipo (10 personas)", quantity: 4, unitPrice: 30000, taxRateBp: 2100, discount: 12000 },
    { description: "Evaluación física inicial", quantity: 10, unitPrice: 3500, taxRateBp: 2100, discount: 0 },
  ];
  const corp = (id: string) => corpLines.map((l, i) => {
    const a = computeLine({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, taxRateBp: l.taxRateBp });
    return { id: uid(), organizationId: orgId, invoiceId: id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRateBp: l.taxRateBp, baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total, sortOrder: i } as InvoiceItem;
  });
  if (fSeries) {
    const issuedId = uid();
    const its = corp(issuedId);
    const sum = (k: "baseAmount" | "taxAmount" | "total") => its.reduce((t, x) => t + x[k], 0);
    const issueDate = toISODate(addDays(now, -6));
    invoices.push({ id: issuedId, organizationId: orgId, locationId: north.id, seriesId: fSeries.id, number: local ? `${fSeries.prefix}${String(fSeries.nextNumber).padStart(fSeries.padding, "0")}` : undefined,
      issueDate, dueDate: toISODate(addDays(now, 24)), customerName: "Empresa Cliente Demo S.L.", customerTaxId: "B00000001", customerAddress: "Calle Ejemplo 1, 00000 Ciudad Demo",
      concept: "Programa de bienestar para empresas", subtotal: sum("baseAmount"), taxTotal: sum("taxAmount"), discountTotal: 12000, total: sum("total"), amountPaid: 0, status: "issued",
      notes: "Pago por transferencia a 30 días.", source: "manual", createdAt: new Date(`${issueDate}T11:00:00`).toISOString() });
    invoiceItems.push(...its);
    if (local) documentSeries = documentSeries.map((x) => (x.id === fSeries.id ? { ...x, nextNumber: x.nextNumber + 1 } : x));
    const draftId = uid();
    const dits = corp(draftId).slice(1).map((x) => ({ ...x, quantity: 6, baseAmount: 0, taxAmount: 0, total: 0 }));
    for (const it of dits) { const a = computeLine({ unitPrice: it.unitPrice, quantity: it.quantity, taxRateBp: it.taxRateBp }); Object.assign(it, { baseAmount: a.baseAmount, taxAmount: a.taxAmount, total: a.total }); }
    invoices.push({ id: draftId, organizationId: orgId, seriesId: fSeries.id, issueDate: toISODate(now), dueDate: toISODate(addDays(now, 15)), customerName: "Otra Empresa Demo S.L.", customerTaxId: "B00000002",
      concept: "Evaluaciones físicas", subtotal: dits.reduce((t, x) => t + x.baseAmount, 0), taxTotal: dits.reduce((t, x) => t + x.taxAmount, 0), discountTotal: 0, total: dits.reduce((t, x) => t + x.total, 0),
      amountPaid: 0, status: "draft", source: "manual", createdAt: iso });
    invoiceItems.push(...dits);
  }

  // Proveedores y gastos (13 meses): alquiler y suministros por centro; software, gestoría, seguros y marketing generales
  const expenseCategories = ws.expenseCategories.length
    ? ws.expenseCategories
    : DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ id: uid(), organizationId: orgId, name: c.name, defaultTaxRateBp: c.taxBp, status: "active" as const }));
  const catId = (name: string) => expenseCategories.find((c) => c.name === name)?.id;
  const SUP: [string, string, string][] = [
    ["Inmuebles Ejemplo S.L.", "Alquiler", "B00000010"], ["Energía Demo S.A.", "Suministros", "A00000011"], ["Aguas Demo", "Suministros", "A00000012"],
    ["Limpiezas Demo S.L.", "Mantenimiento y limpieza", "B00000013"], ["Software Demo S.L.", "Software y servicios", "B00000014"], ["Asesoría Ejemplo", "Asesoría y gestoría", "B00000015"],
    ["Seguros Demo", "Seguros", "A00000016"], ["Distribuciones Deportivas Demo", "Material y equipamiento", "B00000017"], ["Nutrición Demo S.L.", "Compras para venta", "B00000018"],
    ["Publicidad Local Demo", "Marketing", "B00000019"],
  ];
  const suppliers: Supplier[] = SUP.map(([name, cat, tax], i) => ({
    id: uid(), organizationId: orgId, name, taxId: tax, email: `facturacion${i + 1}@proveedor.invalid`, phone: `910 000 ${String(100 + i).padStart(3, "0")}`,
    defaultCategoryId: catId(cat), status: "active", createdAt: addDays(now, -470).toISOString(), updatedAt: iso,
  }));
  const sup = (i: number) => suppliers[i]!;
  const expenses: Expense[] = [];
  const addExpense = (s: Supplier, desc: string, issue: Date, base: number, rate: number, opts: { loc?: Location; dueDays?: number; n: string; pendingIfRecent?: boolean } ) => {
    const tax = Math.round((base * rate) / 10000);
    const issueIso = toISODate(issue);
    if (issue > now) return;
    const due = opts.dueDays !== undefined ? toISODate(addDays(issue, opts.dueDays)) : undefined;
    const recent = (now.getTime() - issue.getTime()) / 86_400_000 < 12;
    const pending = opts.pendingIfRecent !== false && recent;
    expenses.push({
      id: uid(), organizationId: orgId, locationId: opts.loc?.id, supplierId: s.id, categoryId: s.defaultCategoryId, supplierInvoiceNumber: opts.n, issueDate: issueIso, dueDate: due,
      description: desc, subtotal: base, taxRateBp: rate, taxTotal: tax, total: base + tax, paymentMethodId: pmByKey.get(opts.dueDays ? "transfer" : "direct_debit")?.id,
      status: pending ? "pending" : "paid", paidAt: pending ? undefined : addDays(issue, opts.dueDays ?? 2).toISOString(), source: "manual", createdBy: user.id,
      createdAt: issue.toISOString(), updatedAt: issue.toISOString(),
    });
  };
  for (let mBack = 12; mBack >= 0; mBack--) {
    const mDate = firstOfMonth(mBack);
    const tag = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}`;
    const month = mDate.toLocaleDateString("es-ES", { month: "long" });
    addExpense(sup(0), `Alquiler ${month} · Centro Norte`, mDate, 145000, 2100, { loc: north, dueDays: 5, n: `ALQ-N-${tag}` });
    addExpense(sup(0), `Alquiler ${month} · Centro Sur`, mDate, 80000, 2100, { loc: south, dueDays: 5, n: `ALQ-S-${tag}` });
    const light = 1 + 0.3 * Math.cos((mDate.getMonth() / 12) * Math.PI * 2);
    addExpense(sup(1), `Electricidad ${month} · Centro Norte`, addDays(mDate, 7), Math.round(21000 * light + r() * 3000), 2100, { loc: north, dueDays: 20, n: `LUZ-N-${tag}` });
    addExpense(sup(1), `Electricidad ${month} · Centro Sur`, addDays(mDate, 7), Math.round(12000 * light + r() * 2000), 2100, { loc: south, dueDays: 20, n: `LUZ-S-${tag}` });
    if (mDate.getMonth() % 2 === 0) addExpense(sup(2), `Agua ${month}`, addDays(mDate, 10), 7400 + Math.round(r() * 1500), 1000, { loc: north, dueDays: 15, n: `AGU-${tag}` });
    addExpense(sup(3), `Limpieza ${month}`, addDays(mDate, 27), 22000, 2100, { loc: north, dueDays: 10, n: `LIM-${tag}` });
    addExpense(sup(4), `Software de gestión ${month}`, addDays(mDate, 1), 7400, 2100, { n: `SW-${tag}`, pendingIfRecent: false });
    addExpense(sup(5), `Asesoría ${month}`, addDays(mDate, 3), 12000, 2100, { dueDays: 10, n: `ASE-${tag}` });
    if (mDate.getMonth() % 3 === 0) addExpense(sup(6), `Seguro trimestral`, addDays(mDate, 4), 36000, 0, { n: `SEG-${tag}`, pendingIfRecent: false });
    if (r() < 0.55) addExpense(sup(7), "Material de entrenamiento", addDays(mDate, 12 + Math.floor(r() * 10)), 15000 + Math.round(r() * 45000), 2100, { loc: r() < 0.7 ? north : south, dueDays: 30, n: `MAT-${tag}` });
    addExpense(sup(8), "Reposición bebidas y suplementos", addDays(mDate, 14), 38000 + Math.round(r() * 30000), 1000, { dueDays: 30, n: `NUT-${tag}` });
    if (mDate.getMonth() % 2 === 1) addExpense(sup(9), "Campaña en redes sociales", addDays(mDate, 18), 18000 + Math.round(r() * 20000), 2100, { n: `PUB-${tag}` });
  }
  // Una factura de luz del mes pasado, vencida sin pagar (para que «Vencidos» muestre algo real)
  const lastLight = expenses.filter((e) => e.supplierInvoiceNumber?.startsWith("LUZ-S-")).at(-2);
  if (lastLight) Object.assign(lastLight, { status: "pending", paidAt: undefined });

  // Seguimiento: tareas con motivo (renovaciones, cuotas vencidas, leads)
  const leads = customers.filter((c) => c.status === "lead");
  const pastDueMembers = customerMemberships.filter((m) => membershipCharges.some((ch) => ch.customerMembershipId === m.id && ch.status === "failed"));
  const pausedMembers = customerMemberships.filter((m) => m.status === "paused");
  const tasks: Task[] = [
    ...pastDueMembers.map((m, i) => ({ id: uid(), organizationId: orgId, customerId: m.customerId, title: "Llamar por la cuota devuelta", reason: "El cargo de la cuota del mes pasado fue rechazado", status: "pending" as const, dueDate: toISODate(addDays(now, i - 1)), createdBy: user.id, createdAt: iso, updatedAt: iso })),
    ...pausedMembers.map((m) => ({ id: uid(), organizationId: orgId, customerId: m.customerId, title: "Confirmar fecha de vuelta tras la pausa", reason: "Membresía en pausa", status: "pending" as const, dueDate: m.resumeOn, createdBy: user.id, createdAt: iso, updatedAt: iso })),
    ...leads.slice(0, 3).map((c, i) => ({ id: uid(), organizationId: orgId, customerId: c.id, title: "Ofrecer clase de prueba", reason: "Lead sin convertir", status: (i === 2 ? "done" : "pending") as Task["status"], dueDate: toISODate(addDays(now, i)), completedAt: i === 2 ? iso : undefined, createdBy: user.id, createdAt: iso, updatedAt: iso })),
    { id: uid(), organizationId: orgId, title: "Revisar facturas de proveedores del mes", status: "pending", dueDate: toISODate(addDays(now, 3)), createdBy: user.id, createdAt: iso, updatedAt: iso },
  ];

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
    locations: [...ws.locations.filter((l) => l.id !== south.id && l.id !== north.id), north, south],
    categories, products, customers, customerNotes, cashSessions, cashClosings, sales, saleItems: items, payments, invoices, invoiceItems,
    membershipPlans, planVersions, documentSeries,
    ...(v900
      ? { customerMemberships, membershipCharges, expenseCategories, suppliers, expenses, tasks }
      : { invoices: invoices.map((i) => ({ ...i, customerMembershipId: undefined })) }),
    imports: [...ws.imports, job], importRecords: [...ws.importRecords, ...importRecords],
    counters: { sale: sales.length },
  };
}
