/**
 * Workspace DEMO. Datos 100 % ficticios, en una empresa separada marcada `isDemo`.
 * Nunca se mezclan con la empresa real: viven en otro documento y la UI muestra un banner permanente.
 */
import { computeLine } from "@/domain/pricing";
import type { Customer, Invoice, Payment, Product, ProductCategory, Sale, SaleItem, UserAccount } from "@/domain/types";
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
  locationName: "Centro",
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

/** Rellena una empresa demo (vacía) con datos 100 % ficticios. Se usa igual en local y en Supabase. */
export function fillDemoWorkspace(ws: Workspace, userId: string): Workspace {
  const orgId = ws.organization.id;
  const user = { id: userId };
  const r = rng(42);
  {
    const now = new Date();
    const iso = now.toISOString();
    const loc = ws.locations[0]!;
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
    const customers: Customer[] = Array.from({ length: 48 }, (_, i) => {
      const joined = addDays(now, -Math.round(20 + r() * 400));
      const status = i % 11 === 0 ? "cancelled" : i % 13 === 0 ? "lead" : "active";
      return {
        id: uid(), organizationId: orgId, firstName: FIRST[i % FIRST.length]!, lastName: `${LAST[(i * 7) % LAST.length]} ${LAST[(i * 3 + 5) % LAST.length]}`,
        email: `cliente${i + 1}@demo.invalid`, phone: `600 000 ${String(100 + i).padStart(3, "0")}`, status, tags: [],
        joinedAt: toISODate(joined), source: ["walk_in", "instagram", "referral", "google"][i % 4], createdAt: joined.toISOString(), updatedAt: iso,
      } as Customer;
    });
    const methods = ["card", "card", "card", "cash", "cash", "bizum"] as const;
    const pmByKey = new Map(ws.paymentMethods.map((m) => [m.key, m]));
    const sales: Sale[] = [];
    const items: SaleItem[] = [];
    const payments: Payment[] = [];
    let n = 0;
    const start = addDays(startOfDay(now), -420);
    for (let d = start; d <= now; d = addDays(d, 1)) {
      const dow = d.getDay();
      const seasonal = 1 + 0.25 * Math.sin((d.getMonth() / 12) * Math.PI * 2);
      const growth = 0.75 + 0.35 * ((d.getTime() - start.getTime()) / (now.getTime() - start.getTime()));
      const count = Math.round((dow === 0 ? 1 : dow === 6 ? 4 : 9) * seasonal * growth * (0.6 + r() * 0.8));
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
        n++;
        const customerId = r() < 0.35 ? customers[Math.floor(r() * customers.length)]!.id : undefined;
        sales.push({ id: saleId, organizationId: orgId, locationId: loc.id, number: n, occurredAt: at.toISOString(), timePrecision: "exact", granularity: "transaction",
          customerId, sellerId: user.id, subtotal: base, taxTotal: tax, discountTotal: 0, total, status: "completed", source: "pos", createdAt: at.toISOString() });
        const m = pmByKey.get(methods[Math.floor(r() * methods.length)]!)!;
        payments.push({ id: uid(), organizationId: orgId, locationId: loc.id, kind: "charge", saleId, customerId, paymentMethodId: m.id, methodKey: m.key, methodKind: m.kind,
          amount: total, status: "succeeded", paidAt: at.toISOString(), source: "pos", createdAt: at.toISOString() });
      }
    }
    // Cuotas mensuales facturadas (últimos 13 meses)
    const invoices: Invoice[] = [];
    let invN = 0;
    const card = pmByKey.get("card")!;
    for (let mBack = 12; mBack >= 0; mBack--) {
      const issue = new Date(now.getFullYear(), now.getMonth() - mBack, 1);
      for (const c of customers) {
        if (c.status === "lead" || new Date(c.createdAt) > issue) continue;
        if (c.status === "cancelled" && mBack < 3) continue;
        const [planName, price] = PLANS[(c.firstName.length + (c.lastName?.length ?? 0)) % PLANS.length]!;
        const { base, tax } = splitGross(price, 2100);
        const pending = mBack === 0 && r() < 0.06;
        invN++;
        invoices.push({ id: uid(), organizationId: orgId, locationId: loc.id, number: `D${issue.getFullYear()}-${String(invN).padStart(5, "0")}`, issueDate: toISODate(issue),
          customerId: c.id, customerName: `${c.firstName} ${c.lastName}`, concept: `Cuota ${planName}`, servicePeriodStart: toISODate(issue),
          servicePeriodEnd: toISODate(new Date(issue.getFullYear(), issue.getMonth() + 1, 0)), subtotal: base, taxTotal: tax, total: price,
          amountPaid: pending ? 0 : price, status: pending ? "issued" : "paid", paymentMethodId: pending ? undefined : card.id, source: "membership", createdAt: issue.toISOString() });
      }
    }
    return { ...ws, categories, products, customers, sales, saleItems: items, payments, invoices, counters: { sale: n } };
  }
}
