import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CornerDownLeft, FileText, Moon, Package, Plus, Receipt, Search, ShoppingBag, Upload, User, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeKey } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Kbd } from "@/design-system/components";
import { customerName } from "@/data/repos/customers";
import { ALL_ITEMS, isPlanned } from "./nav";
import { applyTheme } from "./theme";
import { getPref, setPref } from "@/lib/localPrefs";
import { useSession, useWorkspace } from "./session";

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
  keywords?: string;
  planned?: boolean;
}

function readRecent(): string[] {
  try {
    return JSON.parse(getPref("cmdk.recent") ?? "[]") as string[];
  } catch {
    return [];
  }
}
function pushRecent(to: string) {
  setPref("cmdk.recent", JSON.stringify([to, ...readRecent().filter((x) => x !== to)].slice(0, 6)));
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

  const recent = useMemo(() => readRecent(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo<Entry[]>(() => {
    const openSession = ws.cashSessions.some((x) => x.status === "open");
    const pending = ws.invoices.filter((i) => i.status === "issued" || i.status === "partially_paid").length;
    const actions: Entry[] = [
      can("pos.sell") && { id: "a-sale", group: "Acciones", label: "Nueva venta", hint: openSession ? "Caja abierta" : "Abre la caja y vende", icon: Plus, to: "/caja", keywords: "vender tpv cobrar crear venta" },
      can("cash.operate") && !openSession && { id: "a-open", group: "Acciones", label: "Abrir caja", icon: Wallet, to: "/caja", keywords: "fondo turno apertura" },
      can("imports.run") && { id: "a-import", group: "Acciones", label: "Importar datos (Excel / CSV)", icon: Upload, to: "/importaciones/nueva", keywords: "excel csv subir" },
      can("catalog.manage") && { id: "a-product", group: "Acciones", label: "Nuevo producto", icon: Package, to: "/catalogo?nuevo=1" },
      can("customers.manage") && { id: "a-customer", group: "Acciones", label: "Nuevo cliente", icon: User, to: "/clientes?nuevo=1" },
      can("cash.operate") && { id: "a-close", group: "Acciones", label: "Cerrar caja", icon: Wallet, to: "/cierres", keywords: "arqueo cuadre" },
      can("analytics.view") && { id: "a-report", group: "Acciones", label: "Generar informe para la gestoría", icon: FileText, to: "/informes", keywords: "trimestre q3 exportar excel pdf csv iva" },
      can("finance.view") && pending > 0 && { id: "a-pending", group: "Acciones", label: `Ver ${pending} factura${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"} de cobro`, icon: Receipt, to: "/facturas?estado=pendiente", keywords: "cobrar impagos" },
      { id: "a-theme", group: "Acciones", label: "Cambiar tema claro / oscuro", icon: Moon, to: "#theme", keywords: "dark modo noche apariencia" },
    ].filter(Boolean) as Entry[];
    const visibleNav = ALL_ITEMS.filter((i) => !i.perm || can(i.perm));
    const toEntry = (i: (typeof ALL_ITEMS)[number], group: string): Entry => ({ id: `${group}-${i.to}`, group, label: i.label, hint: isPlanned(i) ? `Próximamente · ${i.description}` : i.description, icon: i.icon, to: i.to, planned: isPlanned(i) });
    const recents = recent.map((to) => visibleNav.find((i) => i.to === to)).filter((i): i is (typeof ALL_ITEMS)[number] => !!i && !isPlanned(i)).slice(0, 4).map((i) => toEntry(i, "Recientes"));
    return [...actions, ...recents, ...visibleNav.map((i) => toEntry(i, "Ir a"))];
  }, [can, ws.cashSessions, ws.invoices, recent]);

  const results = useMemo(() => {
    const nq = normalizeKey(q);
    if (!nq) return base.filter((e) => !e.planned && (e.group !== "Ir a" || !base.some((x) => x.group === "Recientes" && x.to === e.to)));
    const terms = nq.split(" ");
    const match = (s: string) => {
      const t = normalizeKey(s);
      return terms.every((x) => t.includes(x));
    };
    const out: Entry[] = base.filter((e) => e.group !== "Recientes" && match(`${e.label} ${e.keywords ?? ""} ${e.hint ?? ""}`));
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
          out.push({ id: `i-${i.id}`, group: "Facturas", label: i.number ?? i.externalNumber ?? "Factura", hint: `${i.customerName ?? ""} · ${formatMoney(i.total)}`, icon: Receipt, to: `/facturas/${i.id}` });
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
    if (e.to === "#theme") {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      return;
    }
    pushRecent(e.to.split("?")[0]!);
    navigate(e.to);
  };
  const groups = [...new Set(results.map((r) => r.group))];
  let idx = -1;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={onClose} />
      <div className="relative w-full max-w-2xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="h-[18px] w-[18px] text-fg-3" />
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
            placeholder="Busca clientes, productos, facturas, #ventas o escribe una acción…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
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
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-75", i === active ? "bg-surface-sunken" : "", r.planned && "opacity-60")}
                  >
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", i === active ? "bg-surface text-fg shadow-xs" : "text-fg-3")}><r.icon className="h-4 w-4" /></span>
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
        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-xs text-fg-3">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> abrir</span>
          <span className="flex items-center gap-1.5"><Kbd>esc</Kbd> cerrar</span>
          <span className="ml-auto hidden sm:inline">Escribe #123 para ir a una venta</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
