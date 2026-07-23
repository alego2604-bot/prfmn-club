import { useMemo, useState } from "react";
import { PRODUCTS } from "@/mocks/products";
import { Badge, Card, SearchInput, Tabs } from "@/design-system/components";
import { formatCurrency } from "@/lib/utils";
import type { ProductCategory } from "@/lib/types";

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  drink: "Bebidas",
  food: "Alimentación",
  apparel: "Ropa",
  accessory: "Accesorios",
  merch: "Merchandising",
  event: "Eventos",
  bundle: "Bonos",
};

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "drink", label: "Bebidas" },
  { value: "food", label: "Alimentación" },
  { value: "apparel", label: "Ropa" },
  { value: "accessory", label: "Accesorios" },
  { value: "merch", label: "Merch" },
  { value: "event", label: "Eventos" },
  { value: "bundle", label: "Bonos" },
] as const;

export default function ShopPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const filtered = useMemo(
    () =>
      PRODUCTS.filter(
        (p) => (filter === "all" || p.category === filter) && p.name.toLowerCase().includes(query.toLowerCase())
      ),
    [query, filter]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Tienda</h2>
          <p className="mt-1 text-sm text-text-tertiary">Catálogo disponible también desde la app del atleta.</p>
        </div>
        <SearchInput placeholder="Buscar producto..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
      </div>

      <Tabs value={filter} onChange={setFilter} options={FILTERS as unknown as { value: typeof filter; label: string }[]} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filtered.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-3xl">{p.imageEmoji}</span>
              {p.stock <= p.minStock && <Badge tone="danger">Stock bajo</Badge>}
            </div>
            <p className="mt-3 font-medium text-text-primary">{p.name}</p>
            <p className="text-xs text-text-tertiary">{CATEGORY_LABEL[p.category]}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(p.priceCents)}</span>
              <span className="text-xs text-text-tertiary">Stock: {p.stock}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
