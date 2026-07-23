import { PRODUCTS, marginPct } from "@/mocks/products";
import { Badge } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/lib/types";

export default function InventoryPage() {
  const lowStock = PRODUCTS.filter((p) => p.stock <= p.minStock);

  const columns: Column<Product>[] = [
    { header: "Producto", render: (p) => <span className="font-medium">{p.imageEmoji} {p.name}</span> },
    { header: "SKU", render: (p) => <span className="text-text-tertiary">{p.sku}</span> },
    { header: "Precio", render: (p) => formatCurrency(p.priceCents) },
    { header: "Margen", render: (p) => `${marginPct(p)}%` },
    { header: "Stock", render: (p) => <span className={p.stock <= p.minStock ? "text-danger font-medium" : ""}>{p.stock}</span> },
    { header: "Stock mínimo", render: (p) => p.minStock },
    {
      header: "Estado",
      render: (p) =>
        p.stock <= p.minStock ? (
          <Badge tone="danger">Reponer</Badge>
        ) : (
          <Badge tone="success">OK</Badge>
        ),
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
      <DataTable columns={columns} rows={PRODUCTS} rowKey={(p) => p.id} />
    </div>
  );
}
