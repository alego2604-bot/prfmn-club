import { useMemo, useState } from "react";
import { PRODUCTS, CLIENTS } from "@/mocks";
import { Button, Card, SearchInput } from "@/design-system/components";
import { formatCurrency, cn } from "@/lib/utils";
import type { Product, Client, ProductCategory } from "@/lib/types";
import { Check, User, X } from "lucide-react";

type Step = "product" | "client" | "payment" | "done";

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  drink: "Bebidas",
  food: "Alimentación",
  apparel: "Ropa",
  accessory: "Accesorios",
  merch: "Merchandising",
  event: "Eventos",
  bundle: "Bonos",
};

const SECONDARY_CATEGORIES: ProductCategory[] = ["apparel", "accessory", "merch", "event", "bundle"];

export default function PosPage() {
  const [step, setStep] = useState<Step>("product");
  const [product, setProduct] = useState<Product | null>(null);
  const [client, setClient] = useState<Client | "anonymous" | null>(null);
  const [activeCategory, setActiveCategory] = useState<ProductCategory | null>(null);
  const [clientQuery, setClientQuery] = useState("");

  const frequentProducts = PRODUCTS.filter((p) => p.frequent);
  const categoryProducts = activeCategory ? PRODUCTS.filter((p) => p.category === activeCategory) : [];

  const filteredClients = useMemo(
    () => CLIENTS.filter((c) => c.status === "active" && c.fullName.toLowerCase().includes(clientQuery.toLowerCase())),
    [clientQuery]
  );

  function reset() {
    setStep("product");
    setProduct(null);
    setClient(null);
    setActiveCategory(null);
    setClientQuery("");
  }

  function selectProduct(p: Product) {
    setProduct(p);
    setStep("client");
  }

  function selectClient(c: Client | "anonymous") {
    setClient(c);
    setStep("payment");
  }

  function confirmSale() {
    setStep("done");
    setTimeout(reset, 1400);
  }

  if (step === "done") {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <Check className="h-8 w-8 text-success" />
        </div>
        <div>
          <p className="text-lg font-semibold text-text-primary">Confirmado</p>
          <p className="text-sm text-text-tertiary">
            {product?.name} · {client === "anonymous" ? "Venta anónima" : client?.fullName}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">TPV — Venta rápida</h2>
          <p className="mt-1 text-sm text-text-tertiary">Objetivo: menos de 5 segundos por venta.</p>
        </div>
        {step !== "product" && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="h-4 w-4" /> Cancelar venta
          </Button>
        )}
      </div>

      {step === "product" && (
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-tertiary">Frecuentes</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {frequentProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProduct(p)}
                  className="flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-surface p-4 text-center transition-colors hover:border-accent/50 hover:bg-white/[0.03] active:scale-[0.98]"
                >
                  <span className="text-3xl">{p.imageEmoji}</span>
                  <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  <span className="text-xs text-text-tertiary">{formatCurrency(p.priceCents)}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-tertiary">Otras categorías</p>
            <div className="flex flex-wrap gap-2">
              {SECONDARY_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                    activeCategory === cat
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border-subtle bg-surface text-text-secondary hover:text-text-primary"
                  )}
                >
                  {CATEGORY_LABEL[cat]}
                </button>
              ))}
            </div>
            {activeCategory && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {categoryProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="flex min-h-[100px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border-subtle bg-surface p-4 text-center hover:border-accent/50 hover:bg-white/[0.03]"
                  >
                    <span className="text-2xl">{p.imageEmoji}</span>
                    <span className="text-sm font-medium text-text-primary">{p.name}</span>
                    <span className="text-xs text-text-tertiary">{formatCurrency(p.priceCents)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === "client" && product && (
        <div className="space-y-4">
          <Card className="flex items-center gap-3 p-4">
            <span className="text-2xl">{product.imageEmoji}</span>
            <div>
              <p className="font-medium text-text-primary">{product.name}</p>
              <p className="text-xs text-text-tertiary">{formatCurrency(product.priceCents)}</p>
            </div>
          </Card>
          <SearchInput placeholder="Buscar cliente..." value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} autoFocus />
          <button
            onClick={() => selectClient("anonymous")}
            className="flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3 text-left hover:border-accent/40"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5">
              <User className="h-4 w-4 text-text-tertiary" />
            </div>
            <span className="text-sm font-medium text-text-primary">Venta anónima</span>
          </button>
          <div className="space-y-1.5">
            {filteredClients.map((c) => (
              <button
                key={c.id}
                onClick={() => selectClient(c)}
                className="flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3 text-left hover:border-accent/40"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {c.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </div>
                <span className="text-sm font-medium text-text-primary">{c.fullName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "payment" && product && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{product.imageEmoji}</span>
              <div>
                <p className="font-medium text-text-primary">{product.name}</p>
                <p className="text-xs text-text-tertiary">{client === "anonymous" ? "Venta anónima" : client?.fullName}</p>
              </div>
              <span className="ml-auto text-lg font-semibold tabular-nums text-text-primary">{formatCurrency(product.priceCents)}</span>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Button size="lg" onClick={confirmSale}>Cobrar ahora</Button>
            <Button size="lg" variant="secondary" onClick={confirmSale} disabled={client === "anonymous"}>
              A cuenta del cliente
            </Button>
            <Button size="lg" variant="secondary" onClick={confirmSale} disabled={client === "anonymous"}>
              A próxima factura
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
