import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CornerDownLeft, FileText, Package, Plus, Receipt, Search, ShoppingBag, Upload, User, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeKey } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Kbd } from "@/design-system/components";
import { customerName } from "@/data/repos/customers";
import { ALL_ITEMS } from "./nav";
import { useSession, useWorkspace } from "./session";

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
  keywords?: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const { can } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const base = useMemo<Entry[]>(() => {
    const actions: Entry[] = [
      can("pos.sell") && { id: "a-sale", group: "Acciones", label: "Nueva venta", icon: Plus, to: "/caja", keywords: "vender tpv cobrar" },
      can("imports.run") && { id: "a-import", group: "Acciones", label: "Importar datos (Excel / CSV)", icon: Upload, to: "/importaciones/nueva", keywords: "excel csv subir" },
      can("catalog.manage") && { id: "a-product", group: "Acciones", label: "Nuevo producto", icon: Package, to: "/catalogo?nuevo=1" },
      can("customers.manage") && { id: "a-customer", group: "Acciones", label: "Nuevo cliente", icon: User, to: "/clientes?nuevo=1" },
      can("cash.operate") && { id: "a-close", group: "Acciones", label: "Cerrar caja", icon: Wallet, to: "/cierres", keywords: "arqueo cuadre" },
      can("analytics.view") && { id: "a-report", group: "Acciones", label: "Informe para la gestoría", icon: FileText, to: "/informes", keywords: "trimestre q3 exportar excel pdf" },
    ].filter(Boolean) as Entry[];
    const nav: Entry[] = ALL_ITEMS.filter((i) => !i.perm || can(i.perm)).map((i) => ({ id: `n-${i.to}`, group: "Ir a", label: i.label, hint: i.description, icon: i.icon, to: i.to }));
    return [...actions, ...nav];
  }, [can]);

  const results = useMemo(() => {
    const nq = normalizeKey(q);
    if (!nq) return base;
    const terms = nq.split(" ");
    const match = (s: string) => {
      const t = normalizeKey(s);
      return terms.every((x) => t.includes(x));
    };
    const out: Entry[] = base.filter((e) => match(`${e.label} ${e.keywords ?? ""} ${e.hint ?? ""}`));
    if (can("customers.view")) {
      for (const c of ws.customers) {
        if (c.deletedAt) continue;
        if (match(`${customerName(c)} ${c.taxId ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`)) {
          out.push({ id: `c-${c.id}`, group: "Clientes", label: customerName(c), hint: [c.taxId, c.email].filter(Boolean).join(" · "), icon: User, to: `/clientes/${c.id}` });
          if (out.filter((x) => x.group === "Clientes").length >= 6) break;
        }
      }
    }
    if (can("catalog.view")) {
      for (const p of ws.products) {
        if (p.status === "archived") continue;
        if (match(`${p.name} ${p.sku ?? ""}`)) out.push({ id: `p-${p.id}`, group: "Productos", label: p.name, hint: formatMoney(p.price), icon: Package, to: `/catalogo?producto=${p.id}` });
        if (out.filter((x) => x.group === "Productos").length >= 5) break;
      }
    }
    if (can("sales.view")) {
      const num = /^#?(\d+)$/.exec(q.trim());
      if (num) {
        const s = ws.sales.find((x) => x.number === Number(num[1]));
        if (s) out.push({ id: `s-${s.id}`, group: "Ventas", label: `Venta #${s.number}`, hint: `${formatDate(s.occurredAt)} · ${formatMoney(s.total)}`, icon: ShoppingBag, to: `/ventas?venta=${s.id}` });
      }
    }
    if (can("finance.view")) {
      for (const i of ws.invoices) {
        if (match(`${i.number ?? ""} ${i.externalNumber ?? ""} ${i.customerName ?? ""}`)) {
          out.push({ id: `i-${i.id}`, group: "Facturas", label: i.number ?? i.externalNumber ?? "Factura", hint: `${i.customerName ?? ""} · ${formatMoney(i.total)}`, icon: Receipt, to: `/facturas?factura=${i.id}` });
          if (out.filter((x) => x.group === "Facturas").length >= 5) break;
        }
      }
    }
    return out;
  }, [q, base, ws, can]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const go = (e: Entry) => {
    onClose();
    navigate(e.to);
  };
  const groups = [...new Set(results.map((r) => r.group))];
  let idx = -1;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={onClose} />
      <div className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter" && results[active]) go(results[active]!);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Busca clientes, productos, facturas, #ventas o acciones…"
            className="h-12 flex-1 bg-transparent text-md outline-none placeholder:text-fg-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[56vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-fg-3">Sin resultados para «{q}»</p>}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-fg-3">{g}</div>
              {results.filter((r) => r.group === g).map((r) => {
                idx++;
                const i = idx;
                return (
                  <button
                    key={r.id}
                    data-idx={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cn("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left", i === active ? "bg-surface-sunken" : "")}
                  >
                    <r.icon className="h-4 w-4 shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.label}</span>
                      {r.hint && <span className="block truncate text-xs text-fg-3">{r.hint}</span>}
                    </span>
                    {i === active ? <CornerDownLeft className="h-3.5 w-3.5 text-fg-3" /> : <ArrowRight className="h-3.5 w-3.5 text-transparent" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
