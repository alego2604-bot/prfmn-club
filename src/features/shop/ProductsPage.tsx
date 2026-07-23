import { PRODUCTS } from "@/mocks/products";
import { Badge, Button } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/lib/types";
import { Plus } from "lucide-react";

export default function ProductsPage() {
  const columns: Column<Product>[] = [
    { header: "Producto", render: (p) => <span className="font-medium">{p.imageEmoji} {p.name}</span> },
    { header: "SKU", render: (p) => <span className="text-text-tertiary">{p.sku}</span> },
    { header: "Coste", render: (p) => formatCurrency(p.costCents) },
    { header: "Precio", render: (p) => formatCurrency(p.priceCents) },
    { header: "IVA", render: (p) => `${p.taxRate}%` },
    { header: "Estado", render: (p) => <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "Activo" : "Inactivo"}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Productos</h2>
          <p className="mt-1 text-sm text-text-tertiary">{PRODUCTS.length} productos en catálogo.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4" /> Nuevo producto
        </Button>
      </div>
      <DataTable columns={columns} rows={PRODUCTS} rowKey={(p) => p.id} />
    </div>
  );
}
