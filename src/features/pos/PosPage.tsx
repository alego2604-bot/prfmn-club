import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PRODUCTS, CLIENTS } from "@/mocks";
import { Button, Card, SearchInput } from "@/design-system/components";
import { formatCurrency, cn } from "@/lib/utils";
import type { Product, Client, ProductCategory } from "@/lib/types";
import { Check, User, X, UserRound } from "lucide-react";

type Step = "product" | "client" | "done";
type PaymentMode = "now" | "account" | "invoice";

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

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "now", label: "Ahora" },
  { value: "account", label: "A cuenta" },
  { value: "invoice", label: "Próxima factura" },
];

const PAYMENT_MODE_CONFIRMATION: Record<PaymentMode, string> = {
  now: "Cobrado",
  account: "Cargado a cuenta del cliente",
  invoice: "Añadido a la próxima factura",
};

const RECENT_CLIENTS = [...CLIENTS]
  .filter((c) => c.status === "active" && c.lastVisitAt)
  .sort((a, b) => new Date(b.lastVisitAt!).getTime() - new Date(a.lastVisitAt!).getTime())
  .slice(0, 4);

export default function PosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const presetClientId = searchParams.get("clientId");
  const presetClient = presetClientId ? CLIENTS.find((c) => c.id === presetClientId) ?? null : null;

  const [step, setStep] = useState<Step>("product");
  const [product, setProduct] = useState<Product | null>(null);
  const [client, setClient] = useState<Client | "anonymous" | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("now");
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
    setPaymentMode("now");
    setActiveCategory(null);
    setClientQuery("");
  }

  function clearPresetClient() {
    searchParams.delete("clientId");
    setSearchParams(searchParams, { replace: true });
  }

  function finalizeSale(chosenClient: Client | "anonymous", mode: PaymentMode) {
    setClient(chosenClient);
    setPaymentMode(mode);
    setStep("done");
    setTimeout(reset, 1400);
  }

  function selectProduct(p: Product) {
    setProduct(p);
    if (presetClient) {
      finalizeSale(presetClient, "now");
    } else {
      setStep("client");
    }
  }

  if (step === "done") {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <Check className="h-8 w-8 text-success" />
        </div>
        <div>
          <p className="text-lg font-semibold text-text-primary">{PAYMENT_MODE_CONFIRMATION[paymentMode]}</p>
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

      {presetClient && step === "product" && (
        <Card className="flex items-center justify-between p-3">
          <span className="inline-flex items-center gap-2 text-sm text-text-primary">
            <UserRound className="h-4 w-4 text-accent" /> Vendiendo a <strong>{presetClient.fullName}</strong>
          </span>
          <button onClick={clearPresetClient} className="text-xs font-medium text-text-tertiary hover:text-text-primary">
            Cambiar cliente
          </button>
        </Card>
      )}

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

          <div>
            <p className="mb-1.5 text-xs font-medium text-text-tertiary">Cobro</p>
            <div className="inline-flex gap-1 rounded-xl border border-border-subtle bg-surface p-1">
              {PAYMENT_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPaymentMode(m.value)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    paymentMode === m.value ? "bg-accent text-accent-contrast" : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {!clientQuery && RECENT_CLIENTS.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-tertiary">Clientes recientes</p>
              <div className="flex flex-wrap gap-2">
                {RECENT_CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => finalizeSale(c, paymentMode)}
                    className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
                      {c.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </span>
                    {c.fullName.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <SearchInput placeholder="Buscar cliente..." value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />

          <button
            onClick={() => finalizeSale("anonymous", "now")}
            className="flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3 text-left hover:border-accent/40"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5">
              <User className="h-4 w-4 text-text-tertiary" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Venta anónima</p>
              <p className="text-xs text-text-tertiary">Siempre cobro inmediato</p>
            </div>
          </button>

          <div className="space-y-1.5">
            {filteredClients.map((c) => (
              <button
                key={c.id}
                onClick={() => finalizeSale(c, paymentMode)}
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
    </div>
  );
}
