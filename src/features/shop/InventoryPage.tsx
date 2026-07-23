import { useState } from "react";
import { PRODUCTS as INITIAL_PRODUCTS, marginPct } from "@/mocks/products";
import { Badge, Button } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/lib/types";
import { Check } from "lucide-react";

const RESTOCK_QTY = 20;

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [justRestockedId, setJustRestockedId] = useState<string | null>(null);

  const lowStock = products.filter((p) => p.stock <= p.minStock);

  function restock(id: string) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, stock: p.stock + RESTOCK_QTY } : p)));
    setJustRestockedId(id);
    setTimeout(() => setJustRestockedId((current) => (current === id ? null : current)), 1800);
  }

  const columns: Column<Product>[] = [
    { header: "Producto", render: (p) => <span className="font-medium">{p.imageEmoji} {p.name}</span> },
    { header: "SKU", render: (p) => <span className="text-text-tertiary">{p.sku}</span> },
    { header: "Precio", render: (p) => formatCurrency(p.priceCents) },
    { header: "Margen", render: (p) => `${marginPct(p)}%` },
    { header: "Stock", render: (p) => <span className={p.stock <= p.minStock ? "text-danger font-medium" : ""}>{p.stock}</span> },
    { header: "Stock mínimo", render: (p) => p.minStock },
    {
      header: "Estado",
      render: (p) => {
        if (justRestockedId === p.id) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" /> Repuesto (+{RESTOCK_QTY})
            </span>
          );
        }
        if (p.stock <= p.minStock) {
          return (
            <div className="flex items-center gap-2">
              <Badge tone="danger">Reponer</Badge>
              <Button size="sm" variant="secondary" onClick={() => restock(p.id)}>
                +{RESTOCK_QTY}
              </Button>
            </div>
          );
        }
        return <Badge tone="success">OK</Badge>;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Inventario</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          {lowStock.length > 0 ? `${lowStock.length} productos por debajo del stock mínimo.` : "Todo el stock está en niveles correctos."}
        </p>
      </div>
      <DataTable columns={columns} rows={products} rowKey={(p) => p.id} />
    </div>
  );
}
