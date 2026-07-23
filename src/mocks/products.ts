import type { Product } from "@/lib/types";

export const PRODUCTS: Product[] = [
  { id: "p1", name: "Agua 500ml", sku: "DRK-001", category: "drink", costCents: 30, priceCents: 150, taxRate: 10, stock: 6, minStock: 10, active: true, imageEmoji: "💧", frequent: true },
  { id: "p2", name: "Café", sku: "DRK-002", category: "drink", costCents: 20, priceCents: 150, taxRate: 10, stock: 40, minStock: 15, active: true, imageEmoji: "☕", frequent: true },
  { id: "p3", name: "Barrita proteica", sku: "FOD-001", category: "food", costCents: 80, priceCents: 250, taxRate: 10, stock: 25, minStock: 15, active: true, imageEmoji: "🍫", frequent: true },
  { id: "p4", name: "Shake proteína", sku: "FOD-002", category: "food", costCents: 120, priceCents: 350, taxRate: 10, stock: 18, minStock: 10, active: true, imageEmoji: "🥤", frequent: true },
  { id: "p5", name: "Camiseta PRFMN", sku: "APP-001", category: "apparel", costCents: 600, priceCents: 2500, taxRate: 21, stock: 32, minStock: 10, active: true, imageEmoji: "👕" },
  { id: "p6", name: "Sudadera PRFMN", sku: "APP-002", category: "apparel", costCents: 1200, priceCents: 4500, taxRate: 21, stock: 14, minStock: 8, active: true, imageEmoji: "🧥" },
  { id: "p7", name: "Muñequeras", sku: "ACC-001", category: "accessory", costCents: 200, priceCents: 900, taxRate: 21, stock: 20, minStock: 10, active: true, imageEmoji: "🎽" },
  { id: "p8", name: "Cinturón de levantamiento", sku: "ACC-002", category: "accessory", costCents: 1500, priceCents: 4900, taxRate: 21, stock: 7, minStock: 5, active: true, imageEmoji: "🏋️" },
  { id: "p9", name: "Gorra PRFMN", sku: "MER-001", category: "merch", costCents: 400, priceCents: 1500, taxRate: 21, stock: 25, minStock: 10, active: true, imageEmoji: "🧢" },
  { id: "p10", name: "Entrada evento HYROX", sku: "EVT-001", category: "event", costCents: 0, priceCents: 3500, taxRate: 21, stock: 40, minStock: 0, active: true, imageEmoji: "🎟️" },
  { id: "p11", name: "Bono 10 drop-ins", sku: "BUN-001", category: "bundle", costCents: 0, priceCents: 12000, taxRate: 21, stock: 999, minStock: 0, active: true, imageEmoji: "🎫" },
];

export function marginPct(p: Product): number {
  if (p.priceCents === 0) return 0;
  return Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100);
}
