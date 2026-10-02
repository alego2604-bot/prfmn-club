import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight, Banknote, Building2, Check, ChevronUp, CreditCard, Globe, Landmark, Minus, MoreHorizontal, Package, Plus, Search,
  ShoppingBasket, Smartphone, Split, Trash2, UserRound, Wallet, X, type LucideIcon,
} from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Button, Callout, EmptyState, Field, IconButton, Input, Modal, MoneyInput, useToast } from "@/design-system/components";
import { createSale, openSessionFor } from "@/data/repos/sales";
import { openCashSession } from "@/data/repos/cash";
import { customerName } from "@/data/repos/customers";
import { computeLine, computeTotals } from "@/domain/pricing";
import type { PaymentKind, Product } from "@/domain/types";
import { formatMoney, formatRate } from "@/lib/money";
import { normalizeKey } from "@/lib/text";
import { cn } from "@/lib/cn";

interface CartLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

const METHOD_ICON: Record<PaymentKind, LucideIcon> = {
  cash: Banknote, card: CreditCard, bizum: Smartphone, online: Globe, transfer: Landmark, direct_debit: ArrowLeftRight, voucher: Wallet, other: MoreHorizontal, unknown: MoreHorizontal,
};

export default function PosPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { locations, current } = useLocationScope();
  // Centro de venta: el filtrado; si no, el único; si no, el único con la caja abierta (lo habitual al empezar el día)
  const [locationId, setLocationId] = useState<string | undefined>(() => {
    if (current) return current.id;
    if (locations.length === 1) return locations[0]!.id;
    const open = locations.filter((l) => openSessionFor(ws, l.id));
    return open.length === 1 ? open[0]!.id : undefined;
  });
  useEffect(() => {
    if (current) setLocationId(current.id);
  }, [current]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [method, setMethod] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, number | null>>({});
  const [received, setReceived] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; total: number; change: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bumped, setBumped] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const products = useMemo(() => ws.products.filter((p) => p.status === "active" && p.posVisible), [ws.products]);
  const categories = useMemo(() => ws.categories.filter((c) => c.status === "active" && products.some((p) => p.categoryId === c.id)), [ws.categories, products]);
  const catColor = useMemo(() => new Map(ws.categories.map((c) => [c.id, c.color])), [ws.categories]);
  const methods = ws.paymentMethods.filter((m) => m.status === "active").sort((a, b) => a.sortOrder - b.sortOrder);
  const session = locationId ? openSessionFor(ws, locationId) : undefined;
  const needsSession = ws.settings.requireCashSession && !session;

  // Más vendidos primero (últimos 60 días): lo habitual queda arriba sin configurar nada
  const popularity = useMemo(() => {
    const since = Date.now() - 60 * 86_400_000;
    const saleIds = new Set(ws.sales.filter((s) => s.status !== "voided" && s.granularity === "transaction" && new Date(s.occurredAt).getTime() > since).map((s) => s.id));
    const m = new Map<string, number>();
    for (const it of ws.saleItems) if (it.productId && saleIds.has(it.saleId)) m.set(it.productId, (m.get(it.productId) ?? 0) + it.quantity);
    return m;
  }, [ws.sales, ws.saleItems]);

  const visibleProducts = useMemo(() => {
    const q = normalizeKey(query);
    return products
      .filter((p) => (category === "all" || p.categoryId === category) && (!q || normalizeKey(`${p.name} ${p.sku ?? ""}`).includes(q)))
      .sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0) || a.sortOrder - b.sortOrder);
  }, [products, category, query, popularity]);

  const productById = useMemo(() => new Map(ws.products.map((p) => [p.id, p])), [ws.products]);
  const lines = cart.map((l) => ({ ...l, product: productById.get(l.productId)! })).filter((l) => l.product);
  const totals = computeTotals(lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, taxRateBp: l.product.taxRateBp })));
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const qtyOf = (id: string) => cart.filter((l) => l.productId === id).reduce((s, l) => s + l.quantity, 0);
  const selectedMethod = methods.find((m) => m.key === method);
  const change = selectedMethod?.kind === "cash" && received !== null ? received - totals.total : 0;
  const splitTotal = Object.values(splitAmounts).reduce<number>((s, v) => s + (v ?? 0), 0);

  const add = (p: Product) => {
    setDone(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id && l.unitPrice === p.price && l.discount === 0);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { productId: p.id, quantity: 1, unitPrice: p.price, discount: 0 }];
    });
    setBumped(p.id);
    setTimeout(() => setBumped((b) => (b === p.id ? null : b)), 180);
  };
  const setQty = (i: number, q: number) => setCart((c) => (q <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => (j === i ? { ...l, quantity: q } : l))));
  const reset = () => {
    setCart([]);
    setCustomerId(undefined);
    setMethod(null);
    setSplit(false);
    setSplitAmounts({});
    setReceived(null);
    setSheetOpen(false);
  };

  const charge = async () => {
    if (!locationId) return toast.error("Elige el centro");
    const payments = split
      ? Object.entries(splitAmounts).filter(([, v]) => v).map(([methodKey, amount]) => ({ methodKey, amount: amount! }))
      : method ? [{ methodKey: method, amount: totals.total }] : [];
    setBusy(true);
    try {
      const sale = createSale(ctx, { locationId, lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })), payments, customerId });
      setDone({ number: sale.number, total: sale.total, change: Math.max(0, change) });
      toast.success(`Venta #${sale.number} · ${formatMoney(sale.total)}`, split ? "Pago dividido registrado" : `Cobrado con ${selectedMethod?.name}`);
      reset();
      searchRef.current?.blur();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  // Atajos: "/" busca, Escape limpia
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const canCharge = lines.length > 0 && !needsSession && (split ? splitTotal === totals.total : !!method && (selectedMethod?.kind !== "cash" || received === null || received >= totals.total));

  if (!products.length) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20">
        <EmptyState
          icon={Package}
          title="Aún no hay productos para vender"
          description="Crea tu catálogo o impórtalo desde tu Excel de caja (detecta la hoja «Catálogo» automáticamente)."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/importaciones/nueva"><Button variant="primary">Importar Excel</Button></Link>
              <Link to="/catalogo?nuevo=1"><Button>Crear producto</Button></Link>
            </div>
          }
        />
      </div>
    );
  }

  const primaryMethods = methods.filter((m) => ["cash", "card", "bizum"].includes(m.kind)).slice(0, 3);
  const otherMethods = methods.filter((m) => !primaryMethods.includes(m) && m.kind !== "unknown" && m.kind !== "direct_debit");
  const customer = customerId ? ws.customers.find((c) => c.id === customerId) : undefined;

  const cartPanel = (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.01em]">Venta actual</p>
          <p className="text-xs text-fg-3 num">{itemCount ? `${itemCount} ${itemCount === 1 ? "artículo" : "artículos"}` : "Toca un producto para añadirlo"}</p>
        </div>
        {lines.length > 0 && <Button variant="ghost" size="sm" icon={Trash2} onClick={reset}>Vaciar</Button>}
      </div>

      <div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-3">
        {done && !lines.length && (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center" data-testid="sale-done">
            <div className="flex h-14 w-14 animate-check-pop items-center justify-center rounded-full bg-success text-white shadow-md"><Check className="h-7 w-7" strokeWidth={2.5} /></div>
            <p className="mt-4 text-sm font-medium text-fg-2">Venta #{done.number} registrada</p>
            <p className="figure mt-1 text-4xl">{formatMoney(done.total)}</p>
            {done.change > 0 && (
              <div className="mt-4 rounded-xl bg-success-soft px-5 py-3">
                <p className="text-xs font-medium uppercase tracking-wider text-success-fg">Cambio</p>
                <p className="figure text-3xl text-success-fg">{formatMoney(done.change)}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-fg-3">Toca un producto para empezar la siguiente venta</p>
          </div>
        )}
        {!lines.length && !done && (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-line-strong text-fg-3"><ShoppingBasket className="h-5 w-5" /></div>
            <p className="mt-3 text-sm font-medium">Carrito vacío</p>
            <p className="mt-1 text-xs text-fg-3">Toca los productos de la izquierda. Pulsa una línea para cambiar cantidad, precio o descuento.</p>
          </div>
        )}
        {lines.map((l, i) => {
          const a = computeLine({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, taxRateBp: l.product.taxRateBp });
          return (
            <div key={`${l.productId}-${i}`} className="flex animate-rise items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(i)}>
                <p className="truncate text-sm font-medium">{l.product.name}</p>
                <p className="text-xs text-fg-3 num">
                  {formatMoney(l.unitPrice)}
                  {l.unitPrice !== l.product.price && <span className="ml-1 text-warning-fg">· precio modificado</span>}
                  {l.discount > 0 && <span className="ml-1 text-accent-fg">· −{formatMoney(l.discount)}</span>}
                </p>
              </button>
              <div className="flex items-center rounded-lg bg-surface-sunken">
                <button className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface hover:text-fg active:scale-90" onClick={() => setQty(i, l.quantity - 1)} aria-label="Restar"><Minus className="h-4 w-4" /></button>
                <span className="w-7 text-center text-sm font-semibold num">{l.quantity}</span>
                <button className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface hover:text-fg active:scale-90" onClick={() => setQty(i, l.quantity + 1)} aria-label="Sumar"><Plus className="h-4 w-4" /></button>
              </div>
              <span className="w-[76px] text-right text-sm font-semibold num">{formatMoney(a.total)}</span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-5 pb-4 pt-3 safe-bottom">
        <div className="flex items-center gap-2">
          <button onClick={() => setPickCustomer(true)} className={cn("flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors", customer ? "bg-accent-soft text-accent-fg" : "border border-dashed border-line-strong text-fg-3 hover:bg-surface-2 hover:text-fg-2")}>
            <UserRound className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{customer ? customerName(customer) : "Cliente (opcional)"}</span>
            {customer && <X className="h-4 w-4 shrink-0" onClick={(e) => { e.stopPropagation(); setCustomerId(undefined); }} />}
          </button>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="text-xs text-fg-3 num" title={totals.byRate.map((r) => `IVA ${formatRate(r.rateBp)}: base ${formatMoney(r.base)}, cuota ${formatMoney(r.tax)}`).join("\n")}>
            {totals.byRate.length ? `IVA incluido · ${formatMoney(totals.byRate.reduce((s, r) => s + r.tax, 0))}` : "IVA incluido"}
          </p>
          <div className="text-right">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-fg-3">Total</p>
            <p className="figure text-5xl leading-none" data-testid="pos-total">{formatMoney(totals.total)}</p>
          </div>
        </div>

        {!split ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Método de pago">
              {primaryMethods.map((m) => {
                const Icon = METHOD_ICON[m.kind];
                const active = method === m.key;
                return (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={active}
                    disabled={!lines.length || needsSession}
                    onClick={() => { setMethod(m.key); setReceived(null); }}
                    className={cn(
                      "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-40",
                      active ? "border-ink bg-ink text-fg-inverse shadow-md" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    {m.name}
                  </button>
                );
              })}
            </div>
            {otherMethods.length > 0 && (
              <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                {otherMethods.map((m) => (
                  <button
                    key={m.id}
                    disabled={!lines.length || needsSession}
                    onClick={() => { setMethod(m.key); setReceived(null); }}
                    className={cn("h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-40", method === m.key ? "border-ink bg-ink text-fg-inverse" : "border-line text-fg-2 hover:bg-surface-2")}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {methods.filter((m) => m.kind !== "unknown" && m.kind !== "direct_debit").map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-28 text-sm">{m.name}</span>
                <MoneyInput value={splitAmounts[m.key] ?? null} onChange={(v) => setSplitAmounts((s) => ({ ...s, [m.key]: v }))} className="flex-1" />
              </div>
            ))}
            <p className={cn("text-right text-xs num", splitTotal === totals.total ? "text-success-fg" : "text-fg-3")}>
              {splitTotal === totals.total ? "Cuadra con el total ✓" : `Faltan ${formatMoney(totals.total - splitTotal)}`}
            </p>
          </div>
        )}

        {selectedMethod?.kind === "cash" && !split && lines.length > 0 && (
          <div className="mt-3 animate-fade-in">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-fg-3">Entregado</span>
              {[totals.total, ...[500, 1000, 2000, 5000].filter((v) => v > totals.total)].slice(0, 4).map((v, i) => (
                <button key={v} onClick={() => setReceived(v)} className={cn("h-9 rounded-lg border px-3 text-sm font-medium transition-colors num", received === v ? "border-ink bg-ink text-fg-inverse" : "border-line hover:bg-surface-2")}>
                  {i === 0 ? "Exacto" : formatMoney(v, { compact: true })}
                </button>
              ))}
              <MoneyInput value={received} onChange={setReceived} className="w-24" placeholder="Otro" />
            </div>
            {received !== null && received >= totals.total && <p className="mt-2 text-sm font-semibold text-success-fg num">Cambio: {formatMoney(received - totals.total)}</p>}
            {received !== null && received < totals.total && <p className="mt-2 text-sm text-danger-fg num">Faltan {formatMoney(totals.total - received)}</p>}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <IconButton icon={Split} label={split ? "Pago único" : "Dividir pago"} size="lg" className={cn("h-14 w-14 rounded-xl border border-line", split && "bg-ink text-fg-inverse hover:bg-ink hover:text-fg-inverse")} onClick={() => { setSplit(!split); setMethod(null); setSplitAmounts({}); }} />
          <Button variant="accent" size="xl" className="h-14 flex-1" disabled={!canCharge} loading={busy} onClick={charge}>
            {lines.length ? `Cobrar ${formatMoney(totals.total)}` : "Cobrar"}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-w-0 flex-col lg:flex-row">
      {/* Productos */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-center gap-2">
            <Input ref={searchRef} leading={<Search className="h-4 w-4" />} placeholder="Buscar producto o SKU" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 flex-1 text-[15px]" />
            {locations.length > 1 && (
              <select value={locationId ?? ""} onChange={(e) => setLocationId(e.target.value || undefined)} className="h-11 rounded-lg border border-line bg-surface px-3 text-sm">
                <option value="">Centro…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <span className={cn("hidden h-11 items-center gap-2 rounded-lg px-3 text-xs font-semibold sm:inline-flex", session ? "bg-success-soft text-success-fg" : "bg-warning-soft text-warning-fg")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", session ? "bg-success" : "bg-warning")} />
              {session ? `Caja abierta · ${new Date(session.openedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Caja cerrada"}
            </span>
          </div>
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist">
            {[{ id: "all", name: "Todo", color: "" }, ...categories].map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
                  category === c.id ? "bg-ink text-fg-inverse" : "bg-surface text-fg-2 shadow-xs ring-1 ring-line hover:text-fg",
                )}
              >
                {c.name}
                <span className={cn("text-xs num", category === c.id ? "text-fg-inverse/60" : "text-fg-3")}>{c.id === "all" ? products.length : products.filter((p) => p.categoryId === c.id).length}</span>
              </button>
            ))}
          </div>
        </div>

        {needsSession && locationId && <OpenSessionBar locationId={locationId} />}
        {!locationId && <div className="px-4 pb-3 sm:px-5"><Callout tone="warning" icon={Building2}>Elige el centro en el que estás vendiendo.</Callout></div>}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-1 sm:px-5 lg:pb-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleProducts.map((p) => {
              const q = qtyOf(p.id);
              const low = p.trackStock && p.minStock !== undefined && (p.stockQuantity ?? 0) <= p.minStock;
              const cat = ws.categories.find((c) => c.id === p.categoryId);
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  disabled={needsSession || !locationId}
                  className={cn(
                    "group relative flex h-[112px] flex-col justify-between rounded-2xl bg-surface p-4 text-left shadow-xs ring-1 transition-all duration-150 hover:shadow-sm active:scale-[0.97] disabled:opacity-45",
                    q ? "ring-2 ring-accent" : "ring-line hover:ring-line-strong",
                    bumped === p.id && "animate-bump",
                  )}
                >
                  <span className="min-w-0">
                    <span className="line-clamp-2 pr-7 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{p.name}</span>
                    {category === "all" && cat && <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-3"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: catColor.get(cat.id) }} />{cat.name}</span>}
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <span className="text-lg font-semibold tracking-[-0.02em] num">{formatMoney(p.price)}</span>
                    {low && <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning-fg">Quedan {Math.max(0, p.stockQuantity ?? 0)}</span>}
                  </span>
                  {q > 0 && <span className="absolute right-3 top-3 flex h-6 min-w-6 animate-pop-in items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white num">{q}</span>}
                </button>
              );
            })}
          </div>
          {!visibleProducts.length && <p className="py-16 text-center text-sm text-fg-3">Ningún producto coincide con «{query}».</p>}
        </div>
      </section>

      {/* Carrito: lateral desde 1024 px (iPad horizontal y escritorio) */}
      <aside className="hidden w-[360px] shrink-0 border-l border-line bg-surface lg:flex xl:w-[400px] 2xl:w-[440px]">{cartPanel}</aside>

      {/* Carrito: hoja inferior en móvil e iPad vertical */}
      <div className="lg:hidden">
        {!sheetOpen && (
          <button
            onClick={() => setSheetOpen(true)}
            className="fixed inset-x-3 bottom-3 z-30 flex h-14 items-center justify-between rounded-2xl bg-ink px-4 text-fg-inverse shadow-lg safe-bottom md:left-[84px] md:right-4 md:h-16 md:px-6"
          >
            <span className="flex items-center gap-2 text-sm font-medium"><ChevronUp className="h-4 w-4" />{itemCount ? `${itemCount} artículos` : done ? `Venta #${done.number} ✓` : "Carrito vacío"}</span>
            <span className="text-lg font-semibold num">{formatMoney(totals.total)}</span>
          </button>
        )}
        {sheetOpen && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={() => setSheetOpen(false)} />
            <div className="absolute inset-x-0 bottom-0 mx-auto flex h-[90dvh] max-w-[640px] animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-surface shadow-lg md:h-[86dvh]">
              <div className="flex justify-center pt-2"><button className="h-1.5 w-10 rounded-full bg-line-strong" onClick={() => setSheetOpen(false)} aria-label="Cerrar" /></div>
              {cartPanel}
            </div>
          </div>
        )}
      </div>

      <LineEditor
        line={editing !== null ? lines[editing] : undefined}
        onClose={() => setEditing(null)}
        onSave={(patch) => { setCart((c) => c.map((l, j) => (j === editing ? { ...l, ...patch } : l))); setEditing(null); }}
        onRemove={() => { setCart((c) => c.filter((_, j) => j !== editing)); setEditing(null); }}
      />
      <CustomerPicker open={pickCustomer} onClose={() => setPickCustomer(false)} onPick={(id) => { setCustomerId(id); setPickCustomer(false); }} />
    </div>
  );
}

function OpenSessionBar({ locationId }: { locationId: string }) {
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const ws = useWorkspace();
  const [float, setFloat] = useState<number | null>(0);
  const last = [...ws.cashClosings].filter((c) => !c.supersededAt && ws.cashSessions.find((s) => s.id === c.cashSessionId)?.locationId === locationId).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
  return (
    <div className="mx-4 mb-3 rounded-xl bg-warning-soft px-4 py-3 sm:mx-5">
      <div className="flex flex-wrap items-center gap-3">
        <Wallet className="h-5 w-5 text-warning-fg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning-fg">Abre la caja para empezar a vender</p>
          <p className="text-xs text-warning-fg/80">Indica el fondo de cambio con el que empiezas{last ? ` (último cierre: ${formatMoney(last.countedCash)} contados)` : ""}.</p>
        </div>
        <MoneyInput value={float} onChange={setFloat} className="w-32" />
        <Button
          variant="primary"
          disabled={!can("cash.operate") || float === null}
          onClick={() => {
            try {
              openCashSession(ctx, locationId, float ?? 0);
              toast.success("Caja abierta", `Fondo inicial ${formatMoney(float ?? 0)}`);
            } catch (e) {
              toast.fromError(e);
            }
          }}
        >
          Abrir caja
        </Button>
      </div>
    </div>
  );
}

function LineEditor({ line, onClose, onSave, onRemove }: {
  line?: CartLine & { product: Product };
  onClose: () => void;
  onSave: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  const [discount, setDiscount] = useState<number | null>(0);
  useEffect(() => {
    if (line) {
      setQty(line.quantity);
      setPrice(line.unitPrice);
      setDiscount(line.discount);
    }
  }, [line]);
  if (!line) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={line.product.name}
      description={`Precio de catálogo ${formatMoney(line.product.price)} · IVA ${formatRate(line.product.taxRateBp)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" icon={Trash2} className="mr-auto text-danger-fg" onClick={onRemove}>Quitar</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={price === null || qty <= 0} onClick={() => onSave({ quantity: qty, unitPrice: price ?? line.unitPrice, discount: discount ?? 0 })}>Aplicar</Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Cantidad"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value)))} className="num" /></Field>
        <Field label="Precio unidad"><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Descuento"><MoneyInput value={discount} onChange={setDiscount} /></Field>
      </div>
      <p className="mt-3 text-xs text-fg-3">El precio modificado solo afecta a esta venta y queda registrado en la línea. El catálogo no cambia.</p>
    </Modal>
  );
}

function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const n = normalizeKey(q);
    return ws.customers.filter((c) => !c.deletedAt && c.status !== "blocked" && (!n || normalizeKey(`${customerName(c)} ${c.taxId ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`).includes(n))).slice(0, 40);
  }, [ws.customers, q]);
  return (
    <Modal open={open} onClose={onClose} title="Asociar cliente" description="Opcional: la venta aparecerá en su ficha." size="sm">
      <Input autoFocus leading={<Search className="h-4 w-4" />} placeholder="Nombre, NIF, teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 flex max-h-[50vh] flex-col overflow-y-auto">
        {list.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="flex items-center justify-between rounded-md px-2.5 py-2.5 text-left hover:bg-surface-2">
            <span className="text-sm font-medium">{customerName(c)}</span>
            <span className="text-xs text-fg-3">{c.taxId ?? c.phone ?? ""}</span>
          </button>
        ))}
        {!list.length && <p className="py-6 text-center text-sm text-fg-3">Sin coincidencias. Crea el cliente desde Clientes.</p>}
      </div>
    </Modal>
  );
}
