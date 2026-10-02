import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, Copy, EyeOff, History, MoreHorizontal, Package, Pencil, Plus, RotateCcw, Tags, Upload } from "lucide-react";
import { useCtx, useSession, useWorkspace } from "@/app/session";
import {
  Badge, Button, Callout, DataTable, Drawer, Field, IconButton, Input, Menu, MenuItem, Modal, MoneyInput, Page, PageHeader, Select, Switch, Tabs,
  Textarea, useToast, type Column,
} from "@/design-system/components";
import { createCategory, createProduct, duplicateProduct, productUsage, setProductStatus, updateCategory, updateProduct, type ProductInput } from "@/data/repos/catalog";
import { CATEGORY_COLORS } from "@/data/workspace";
import { unitMargin } from "@/domain/pricing";
import { productKindsFor } from "@/domain/modules";
import type { CatalogStatus, Product, ProductCategory, ProductKind } from "@/domain/types";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatRate, splitGross, NUM } from "@/lib/money";
import { cn } from "@/lib/cn";

export const KIND_LABEL: Record<ProductKind, string> = { physical: "Producto físico", service: "Servicio", membership: "Membresía", pack: "Bono", drop_in: "Drop-In" };
const STATUS_LABEL: Record<CatalogStatus, string> = { active: "Activo", inactive: "Inactivo", archived: "Archivado" };

export default function CatalogPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"products" | "categories">("products");
  const [status, setStatus] = useState<CatalogStatus | "all">("active");
  const [category, setCategory] = useState<string>("all");
  const editingId = params.get("producto");
  const creating = params.get("nuevo") === "1";

  const usage = useMemo(() => {
    const m = new Map<string, { sales: number; units: number }>();
    for (const p of ws.products) m.set(p.id, productUsage(ws, p.id));
    return m;
  }, [ws]);
  const cat = new Map(ws.categories.map((c) => [c.id, c]));
  const rows = ws.products.filter((p) => (status === "all" || p.status === status) && (category === "all" || p.categoryId === category));

  const act = (fn: () => void, msg: string) => {
    try {
      fn();
      toast.success(msg);
    } catch (e) {
      toast.fromError(e);
    }
  };

  const columns: Column<Product>[] = [
    {
      id: "name", header: "Nombre", hideable: false, sortValue: (p) => p.name.toLowerCase(), exportValue: (p) => p.name,
      cell: (p) => (
        <span className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.get(p.categoryId ?? "")?.color ?? "var(--border-strong)" }} />
          <span className="font-medium">{p.name}</span>
          {!p.posVisible && <span title="Oculto en caja"><EyeOff className="h-3.5 w-3.5 text-fg-3" /></span>}
        </span>
      ),
    },
    { id: "sku", header: "SKU", cell: (p) => <span className="font-mono text-xs text-fg-3">{p.sku ?? "—"}</span>, sortValue: (p) => p.sku ?? "", exportValue: (p) => p.sku ?? "", defaultHidden: true },
    { id: "category", header: "Categoría", cell: (p) => cat.get(p.categoryId ?? "")?.name ?? <span className="text-fg-3">Sin categoría</span>, sortValue: (p) => cat.get(p.categoryId ?? "")?.name ?? "", exportValue: (p) => cat.get(p.categoryId ?? "")?.name ?? "" },
    { id: "kind", header: "Tipo", cell: (p) => <span className="text-fg-2">{KIND_LABEL[p.kind]}</span>, sortValue: (p) => p.kind, exportValue: (p) => KIND_LABEL[p.kind] },
    { id: "price", header: "Precio", align: "right", cell: (p) => <span className="font-medium">{formatMoney(p.price)}</span>, sortValue: (p) => p.price, exportValue: (p) => p.price / 100, exportFormat: "money" },
    { id: "tax", header: "IVA", align: "right", cell: (p) => formatRate(p.taxRateBp), sortValue: (p) => p.taxRateBp, exportValue: (p) => p.taxRateBp / 10000, exportFormat: "percent" },
    { id: "cost", header: "Coste", align: "right", cell: (p) => (p.cost !== undefined ? formatMoney(p.cost) : "—"), sortValue: (p) => p.cost ?? -1, exportValue: (p) => (p.cost !== undefined ? p.cost / 100 : null), exportFormat: "money", defaultHidden: true },
    {
      id: "margin", header: "Margen", align: "right", sortValue: (p) => unitMargin(p.price, p.taxRateBp, p.cost)?.pct ?? -1, exportValue: (p) => unitMargin(p.price, p.taxRateBp, p.cost)?.pct ?? null, exportFormat: "percent",
      cell: (p) => {
        const m = unitMargin(p.price, p.taxRateBp, p.cost);
        return m ? <span className={m.pct < 0.2 ? "text-warning-fg" : ""}>{Math.round(m.pct * 100)} %</span> : <span className="text-fg-3">—</span>;
      },
    },
    {
      id: "stock", header: "Stock", align: "right", sortValue: (p) => (p.trackStock ? p.stockQuantity ?? 0 : -1), exportValue: (p) => (p.trackStock ? p.stockQuantity ?? 0 : null), exportFormat: "integer",
      cell: (p) => (p.trackStock ? <span className={cn((p.stockQuantity ?? 0) <= (p.minStock ?? -1) && "font-medium text-danger-fg")}>{p.stockQuantity ?? 0}</span> : <span className="text-fg-3">—</span>),
    },
    { id: "usage", header: "Vendidas", align: "right", cell: (p) => (usage.get(p.id)?.units ?? 0).toLocaleString("es-ES", NUM), sortValue: (p) => usage.get(p.id)?.units ?? 0, exportValue: (p) => usage.get(p.id)?.units ?? 0, exportFormat: "integer" },
    { id: "status", header: "Estado", cell: (p) => <Badge tone={p.status === "active" ? "success" : p.status === "inactive" ? "warning" : "neutral"} dot>{STATUS_LABEL[p.status]}</Badge>, sortValue: (p) => p.status, exportValue: (p) => STATUS_LABEL[p.status] },
    {
      id: "actions", header: "", hideable: false, align: "right",
      cell: (p) =>
        can("catalog.manage") ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu trigger={(_, toggle) => <IconButton icon={MoreHorizontal} label="Acciones" size="sm" onClick={toggle} />}>
              {(close) => (
                <>
                  <MenuItem icon={Pencil} onClick={() => { close(); setParams({ producto: p.id }); }}>Editar</MenuItem>
                  <MenuItem icon={Copy} onClick={() => { close(); act(() => { const d = duplicateProduct(ctx, p.id); setParams({ producto: d.id }); }, "Producto duplicado"); }}>Duplicar</MenuItem>
                  {p.status === "active" && <MenuItem icon={EyeOff} onClick={() => { close(); act(() => setProductStatus(ctx, p.id, "inactive"), `${p.name} desactivado`); }}>Desactivar</MenuItem>}
                  {p.status !== "active" && <MenuItem icon={RotateCcw} onClick={() => { close(); act(() => setProductStatus(ctx, p.id, "active"), `${p.name} activado`); }}>Activar</MenuItem>}
                  {p.status !== "archived" && <MenuItem icon={Archive} danger onClick={() => { close(); act(() => setProductStatus(ctx, p.id, "archived"), `${p.name} archivado`); }}>Archivar</MenuItem>}
                </>
              )}
            </Menu>
          </span>
        ) : null,
    },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Catálogo"
        description="Todo lo que vendes. Los precios tienen histórico: cambiarlos nunca altera ventas pasadas."
        actions={
          can("catalog.manage") && (
            <>
              <Link to="/importaciones/nueva"><Button icon={Upload}>Importar</Button></Link>
              <Button variant="primary" icon={Plus} onClick={() => (tab === "products" ? setParams({ nuevo: "1" }) : setParams({ categoria: "nueva" }))}>{tab === "products" ? "Nuevo producto" : "Nueva categoría"}</Button>
            </>
          )
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        items={[
          { value: "products", label: "Productos y servicios", count: ws.products.filter((p) => p.status !== "archived").length },
          { value: "categories", label: "Categorías", count: ws.categories.filter((c) => c.status !== "archived").length },
        ]}
      />
      {ws.membershipPlans.length > 0 && tab === "products" && (
        <Link to="/membresias?tab=tarifas" className="mb-4 flex items-center justify-between rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm transition-colors hover:border-line-strong">
          <span><span className="font-medium">Tarifas de membresía</span> <span className="text-fg-3">· {ws.membershipPlans.filter((p) => p.status !== "archived").length} tarifas con histórico de precio</span></span>
          <span className="font-medium text-fg-2">Gestionar →</span>
        </Link>
      )}
      {tab === "products" ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(p) => p.id}
          onRowClick={(p) => setParams({ producto: p.id })}
          searchText={(p) => `${p.name} ${p.sku ?? ""} ${cat.get(p.categoryId ?? "")?.name ?? ""}`}
          searchPlaceholder="Buscar producto, SKU o categoría…"
          exportName="Catalogo"
          exportCompany={ws.organization.name}
          storageKey="catalog"
          selectable={can("catalog.manage")}
          bulkActions={(sel, clear) => (
            <>
              <Button size="sm" icon={EyeOff} onClick={() => { act(() => sel.forEach((p) => setProductStatus(ctx, p.id, "inactive")), `${sel.length} desactivados`); clear(); }}>Desactivar</Button>
              <Button size="sm" icon={Archive} onClick={() => { act(() => sel.forEach((p) => setProductStatus(ctx, p.id, "archived")), `${sel.length} archivados`); clear(); }}>Archivar</Button>
            </>
          )}
          toolbar={
            <>
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-[140px]">
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
                <option value="archived">Archivados</option>
                <option value="all">Todos</option>
              </Select>
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-[180px]">
                <option value="all">Todas las categorías</option>
                {ws.categories.filter((c) => c.status !== "archived").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </>
          }
          empty={{ icon: Package, title: "Catálogo vacío", description: "Crea tu primer producto o importa el catálogo desde tu Excel.", action: can("catalog.manage") ? <Button variant="primary" icon={Plus} onClick={() => setParams({ nuevo: "1" })}>Nuevo producto</Button> : undefined }}
        />
      ) : (
        <CategoriesTab />
      )}
      {(creating || editingId) && <ProductDrawer productId={editingId ?? undefined} onClose={() => setParams({})} />}
      {params.get("categoria") && <CategoryDialog categoryId={params.get("categoria") === "nueva" ? undefined : params.get("categoria")!} onClose={() => setParams({})} />}
    </Page>
  );
}

function CategoriesTab() {
  const ws = useWorkspace();
  const [, setParams] = useSearchParams();
  const count = (id: string) => ws.products.filter((p) => p.categoryId === id && p.status !== "archived").length;
  const columns: Column<ProductCategory>[] = [
    { id: "name", header: "Categoría", hideable: false, sortValue: (c) => c.name, exportValue: (c) => c.name, cell: (c) => <span className="flex items-center gap-2.5"><span className="h-3 w-3 rounded" style={{ background: c.color }} /><span className="font-medium">{c.name}</span></span> },
    { id: "tax", header: "IVA por defecto", cell: (c) => (c.defaultTaxRateBp !== undefined ? formatRate(c.defaultTaxRateBp) : "—"), exportValue: (c) => (c.defaultTaxRateBp ?? 0) / 10000, exportFormat: "percent" },
    { id: "count", header: "Productos", align: "right", cell: (c) => count(c.id), sortValue: (c) => count(c.id), exportValue: (c) => count(c.id), exportFormat: "integer" },
    { id: "status", header: "Estado", cell: (c) => <Badge tone={c.status === "active" ? "success" : "neutral"} dot>{STATUS_LABEL[c.status]}</Badge>, exportValue: (c) => STATUS_LABEL[c.status] },
  ];
  return (
    <DataTable
      rows={ws.categories}
      columns={columns}
      getRowId={(c) => c.id}
      onRowClick={(c) => setParams({ categoria: c.id })}
      exportName="Categorias"
      exportCompany={ws.organization.name}
      empty={{ icon: Tags, title: "Sin categorías", description: "Agrupa tus productos y servicios para analizar el mix de ventas." }}
    />
  );
}

function CategoryDialog({ categoryId, onClose }: { categoryId?: string; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const existing = ws.categories.find((c) => c.id === categoryId);
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? CATEGORY_COLORS[ws.categories.length % CATEGORY_COLORS.length]!);
  const [tax, setTax] = useState<string>(existing?.defaultTaxRateBp !== undefined ? String(existing.defaultTaxRateBp) : String(ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100));
  const save = () => {
    try {
      if (existing) updateCategory(ctx, existing.id, { name, color, defaultTaxRateBp: Number(tax) });
      else createCategory(ctx, { name, color, defaultTaxRateBp: Number(tax) });
      toast.success(existing ? "Categoría actualizada" : "Categoría creada");
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={existing ? "Editar categoría" : "Nueva categoría"}
      footer={
        <>
          {existing && existing.status !== "archived" && (
            <Button variant="ghost" className="mr-auto" icon={Archive} onClick={() => { try { updateCategory(ctx, existing.id, { status: "archived" }); toast.success("Categoría archivada"); onClose(); } catch (e) { toast.fromError(e); } }}>Archivar</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>Guardar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nombre" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la categoría" /></Field>
        <Field label="IVA por defecto" hint="Se propone al crear productos de esta categoría.">
          <Select value={tax} onChange={(e) => setTax(e.target.value)}>
            {ws.taxRates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.rateBp}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Color">
          <div className="flex gap-2">
            {CATEGORY_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-ink")} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function emptyInput(ws: ReturnType<typeof useWorkspace>): ProductInput {
  return { name: "", categoryId: null, kind: "physical", price: 0, taxRateBp: ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100, trackStock: false, posVisible: true };
}

function ProductDrawer({ productId, onClose }: { productId?: string; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const product = ws.products.find((p) => p.id === productId);
  const [form, setForm] = useState<ProductInput>(() => (product ? { ...product, sku: product.sku ?? "" } : emptyInput(ws)));
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [cost, setCost] = useState<number | null>(product?.cost ?? null);
  const [reason, setReason] = useState("");
  const [newCat, setNewCat] = useState<string | null>(null);
  useEffect(() => {
    if (product) {
      setForm({ ...product, sku: product.sku ?? "" });
      setPrice(product.price);
      setCost(product.cost ?? null);
    }
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = !can("catalog.manage");
  const priceChanged = product && (price !== product.price || form.taxRateBp !== product.taxRateBp);
  const history = ws.productPrices.filter((p) => p.productId === productId).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const usage = product ? productUsage(ws, product.id) : null;
  const margin = price !== null ? unitMargin(price, form.taxRateBp, cost ?? undefined) : null;
  const userName = (id?: string) => ws.auditLogs.find((l) => l.actorId === id)?.actorName ?? "—";

  const save = () => {
    try {
      let categoryId = form.categoryId;
      if (newCat !== null) categoryId = createCategory(ctx, { name: newCat, defaultTaxRateBp: form.taxRateBp }).id;
      const input = { ...form, categoryId, price: price ?? 0, cost: cost ?? undefined };
      if (product) {
        updateProduct(ctx, product.id, input, reason || undefined);
        toast.success("Producto actualizado", priceChanged ? "Nuevo precio vigente desde ahora. El histórico se conserva." : undefined);
      } else {
        createProduct(ctx, input);
        toast.success(`${input.name} creado`, "Ya aparece en Caja.");
      }
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={product ? product.name : "Nuevo producto"}
      subtitle={product ? `${KIND_LABEL[product.kind]} · creado ${formatDate(product.createdAt)}${product.importId ? " · importado" : ""}` : "Aparecerá en Caja al guardarlo"}
      footer={!readOnly && (
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!form.name.trim() || price === null}>{product ? "Guardar cambios" : "Crear producto"}</Button>
        </>
      )}
    >
      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <Field label="Nombre" required><Input autoFocus={!product} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del producto o servicio" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            {newCat === null ? (
              <Select
                value={form.categoryId ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__new") return setNewCat("");
                  const c = ws.categories.find((x) => x.id === e.target.value);
                  setForm({ ...form, categoryId: e.target.value || null, taxRateBp: !product && c?.defaultTaxRateBp !== undefined ? c.defaultTaxRateBp : form.taxRateBp });
                }}
              >
                <option value="">Sin categoría</option>
                {ws.categories.filter((c) => c.status !== "archived").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">+ Nueva categoría…</option>
              </Select>
            ) : (
              <Input autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nombre de la categoría" onBlur={() => !newCat.trim() && setNewCat(null)} />
            )}
          </Field>
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProductKind })}>
              {[...new Set([...productKindsFor(ws.organization), form.kind])].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Precio (IVA incl.)" required><MoneyInput value={price} onChange={setPrice} invalid={price === null} /></Field>
          <Field label="IVA">
            <Select value={form.taxRateBp} onChange={(e) => setForm({ ...form, taxRateBp: Number(e.target.value) })}>
              {ws.taxRates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.rateBp}>{formatRate(t.rateBp)}</option>)}
            </Select>
          </Field>
          <Field label="Coste (sin IVA)"><MoneyInput value={cost} onChange={setCost} placeholder="Opcional" /></Field>
        </div>
        {price !== null && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm num">
            <span className="text-fg-3">Base <span className="font-medium text-fg">{formatMoney(splitGross(price, form.taxRateBp).base)}</span></span>
            <span className="text-fg-3">IVA <span className="font-medium text-fg">{formatMoney(splitGross(price, form.taxRateBp).tax)}</span></span>
            {margin && <span className="text-fg-3">Margen <span className={cn("font-medium", margin.pct < 0.2 ? "text-warning-fg" : "text-fg")}>{formatMoney(margin.margin)} · {Math.round(margin.pct * 100)} %</span></span>}
          </div>
        )}
        {priceChanged && (
          <Callout tone="accent" icon={History} title="Cambio de precio">
            El nuevo precio se aplicará desde ahora. Las {usage?.sales ?? 0} ventas anteriores conservan el precio con el que se cobraron.
            <Input className="mt-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional): subida del proveedor…" />
          </Callout>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU / Referencia"><Input value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Opcional" /></Field>
          <Field label="Subcategoría"><Input value={form.subcategory ?? ""} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} placeholder="Opcional" /></Field>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <Switch checked={form.posVisible} onChange={(v) => setForm({ ...form, posVisible: v })} label="Visible en Caja" description="Aparece como botón en la pantalla de venta." />
          <Switch checked={form.trackStock} onChange={(v) => setForm({ ...form, trackStock: v })} label="Controlar stock" description="Descuenta unidades con cada venta y avisa con stock bajo." />
          {form.trackStock && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stock actual"><Input type="number" className="num" value={form.stockQuantity ?? 0} onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })} /></Field>
              <Field label="Avisar con stock ≤"><Input type="number" className="num" value={form.minStock ?? ""} onChange={(e) => setForm({ ...form, minStock: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
            </div>
          )}
        </div>
        <Field label="Descripción"><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" /></Field>
      </fieldset>

      {product && (
        <div className="mt-8">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-fg-3" />Histórico de precios</h3>
          <div className="overflow-hidden rounded-lg border border-line">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm last:border-0">
                <span>
                  <span className="font-medium num">{formatMoney(h.price)}</span>
                  <span className="ml-2 text-xs text-fg-3">IVA {formatRate(h.taxRateBp)}{h.cost !== undefined ? ` · coste ${formatMoney(h.cost)}` : ""}</span>
                  {h.reason && <span className="block text-xs text-fg-3">«{h.reason}»</span>}
                </span>
                <span className="text-right text-xs text-fg-3">
                  {formatDateTime(h.validFrom)} → {h.validTo ? formatDateTime(h.validTo) : <Badge tone="success">vigente</Badge>}
                  <span className="block">{userName(h.changedBy)}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-fg-3">Vendido {usage?.units.toLocaleString("es-ES", NUM)} uds en {usage?.sales.toLocaleString("es-ES", NUM)} ventas. Un producto con ventas no se borra: se desactiva o archiva.</p>
        </div>
      )}
    </Drawer>
  );
}
