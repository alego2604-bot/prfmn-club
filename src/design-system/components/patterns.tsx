/**
 * Patrones compuestos del Design System V3: navegación de sección, filtros, selección con búsqueda, importes,
 * pasos y avisos. Un solo patrón por necesidad: todas las pantallas filtran, navegan y muestran dinero igual.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Check, ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeKey } from "@/lib/text";
import { ScrollFade } from "./layout";

// ---------------------------------------------------------------------------------------------------------------------
// SubNav: pestañas de sección enlazadas a rutas (Finanzas, Clientes…). Activa = subrayado de tinta.
// ---------------------------------------------------------------------------------------------------------------------
export interface SubNavItem { to: string; label: string; icon?: LucideIcon; count?: number; end?: boolean }

export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  const loc = useLocation();
  return (
    <ScrollFade className={cn("-mx-1 mb-6 border-b border-line", className)} innerClassName="flex gap-0.5 px-1">
      <nav className="contents" aria-label="Secciones">
        {items.map((it) => {
          const [path] = it.to.split("?");
          const active = it.end ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(`${path}/`);
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                active ? "border-ink text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
              )}
            >
              {Icon && <Icon className={cn("h-4 w-4", active ? "text-accent" : "opacity-70")} strokeWidth={1.9} />}
              {it.label}
              {it.count !== undefined && it.count > 0 && (
                <span className={cn("rounded-full px-1.5 text-2xs font-semibold num", active ? "bg-accent-soft text-accent-fg" : "bg-surface-sunken text-fg-3")}>{it.count}</span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </ScrollFade>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Filtros: barra única (búsqueda + filtros en píldora + limpiar). Las píldoras muestran el valor elegido.
// ---------------------------------------------------------------------------------------------------------------------
export function FilterBar({ children, onClear, active = 0, className, trailing }: { children: ReactNode; onClear?: () => void; active?: number; className?: string; trailing?: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className ?? "mb-3")} role="search">
      <ScrollFade className="min-w-0 max-w-full flex-1" innerClassName="flex items-center gap-2 py-0.5 [&>*]:shrink-0">
        {children}
        {onClear && active > 0 && (
          <button type="button" onClick={onClear} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm text-fg-3 transition-colors hover:bg-surface-sunken hover:text-fg">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </ScrollFade>
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Buscar…", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Buscar en la lista"
        className="h-8 w-full rounded-full border border-line bg-surface pl-9 pr-8 text-sm shadow-xs outline-none transition-[border,box-shadow] placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-fg-3 hover:bg-surface-sunken hover:text-fg">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export interface FilterOption<T extends string> { value: T; label: string; count?: number; tone?: string }

/** Píldora de filtro con menú. `value` vacío ("") = sin filtrar. */
export function FilterSelect<T extends string>({ label, value, onChange, options, icon: Icon, allLabel = "Todos", searchable }: {
  label: string;
  value: T | "";
  onChange: (v: T | "") => void;
  options: FilterOption<T>[];
  icon?: LucideIcon;
  allLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const current = options.find((o) => o.value === value);
  const list = useMemo(() => {
    const k = normalizeKey(q);
    return k ? options.filter((o) => normalizeKey(o.label).includes(k)) : options;
  }, [options, q]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
          current ? "border-accent/30 bg-accent-soft text-accent-fg" : "border-dashed border-line-strong text-fg-2 hover:border-line-strong hover:bg-surface-2 hover:text-fg",
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 opacity-80" />}
        <span className={cn(current && "opacity-75")}>{label}</span>
        {current && <span className="max-w-[160px] truncate font-medium">{current.label}</span>}
        <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-60 animate-pop-in rounded-lg border border-line bg-surface p-1 shadow-md" role="listbox" aria-label={label}>
          {(searchable ?? options.length > 8) && (
            <div className="p-1">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${label.toLowerCase()}…`} className="h-8 w-full rounded-md border border-line bg-surface-2 px-2.5 text-sm outline-none focus:border-accent" />
            </div>
          )}
          <div className="scrollbar-thin max-h-72 overflow-y-auto">
            {[{ value: "" as T | "", label: allLabel } as FilterOption<T> | { value: ""; label: string; count?: number }, ...list].map((o) => {
              const sel = o.value === value;
              return (
                <button
                  key={o.value || "__all"}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => { onChange(o.value as T | ""); setOpen(false); setQ(""); }}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-sunken", sel && "font-medium")}
                >
                  <span className="flex h-4 w-4 items-center justify-center">{sel && <Check className="h-3.5 w-3.5 text-accent" />}</span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count !== undefined && <span className="text-xs text-fg-3 num">{o.count}</span>}
                </button>
              );
            })}
            {!list.length && <p className="px-3 py-3 text-sm text-fg-3">Sin coincidencias</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function useDismiss(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open, close, ref]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Combobox: selección con búsqueda (clientes, proveedores, productos). Teclado: ↑ ↓ Enter Esc.
// ---------------------------------------------------------------------------------------------------------------------
export interface ComboOption { value: string; label: string; hint?: string; keywords?: string }

export function Combobox({ value, onChange, options, placeholder = "Seleccionar…", emptyText = "Sin coincidencias", onCreate, createLabel, id, invalid, clearable = true, disabled }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  /** Crear un elemento nuevo con el texto buscado */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  id?: string;
  invalid?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQ(""); };
  useDismiss(ref, open, close);
  const current = options.find((o) => o.value === value);
  const list = useMemo(() => {
    const k = normalizeKey(q);
    const all = k ? options.filter((o) => normalizeKey(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`).includes(k)) : options;
    return all.slice(0, 60);
  }, [options, q]);
  useEffect(() => setHi(0), [q]);
  const pick = (v: string | undefined) => { onChange(v); close(); };
  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-[14px] shadow-xs outline-none transition-[border,box-shadow] hover:border-line-strong focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-sunken",
          invalid ? "border-danger" : "border-line",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-fg-3")}>{current ? current.label : placeholder}</span>
        {current?.hint && <span className="hidden shrink-0 truncate text-xs text-fg-3 sm:inline">{current.hint}</span>}
        {clearable && current && !disabled ? (
          <span role="button" tabIndex={-1} aria-label="Quitar" onClick={(e) => { e.stopPropagation(); onChange(undefined); }} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-surface-sunken hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </span>
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-3" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 min-w-[240px] animate-pop-in rounded-lg border border-line bg-surface p-1 shadow-md">
          <div className="p-1">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (list[hi]) pick(list[hi]!.value);
                  else if (onCreate && q.trim()) { onCreate(q.trim()); close(); }
                }
              }}
              className="h-8 w-full rounded-md border border-line bg-surface-2 px-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="scrollbar-thin max-h-64 overflow-y-auto" role="listbox">
            {list.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o.value)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm", i === hi && "bg-surface-sunken")}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{o.value === value && <Check className="h-3.5 w-3.5 text-accent" />}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 truncate text-xs text-fg-3">{o.hint}</span>}
              </button>
            ))}
            {!list.length && !(onCreate && q.trim()) && <p className="px-3 py-3 text-sm text-fg-3">{emptyText}</p>}
            {onCreate && q.trim() && !list.some((o) => normalizeKey(o.label) === normalizeKey(q)) && (
              <button type="button" onClick={() => { onCreate(q.trim()); close(); }} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-line px-2.5 py-2 text-left text-sm font-medium text-accent-fg hover:bg-accent-soft">
                + {createLabel ? createLabel(q.trim()) : `Crear «${q.trim()}»`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Importes: euros con céntimos atenuados (lectura rápida de magnitudes en finanzas)
// ---------------------------------------------------------------------------------------------------------------------
export function Amount({ cents, className, sign, muted, size }: { cents: number; className?: string; sign?: boolean; muted?: boolean; size?: "hero" | "lg" }) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const ints = Math.floor(abs / 100).toLocaleString("es-ES", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
  const dec = String(abs % 100).padStart(2, "0");
  return (
    <span className={cn("whitespace-nowrap num", size === "hero" && "figure", className)} aria-label={`${neg ? "-" : sign ? "+" : ""}${ints},${dec} €`}>
      {neg ? "−" : sign && cents > 0 ? "+" : ""}
      {ints}
      <span className={cn(muted !== false && "opacity-45", size === "hero" && "text-[0.55em] font-medium tracking-normal")}>,{dec}</span>
      <span className={cn("ml-[0.18em]", muted !== false && "opacity-45", size === "hero" && "text-[0.55em] font-medium")}>€</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Extracto (ledger): filas etiqueta → valor con jerarquía (total con regla superior)
// ---------------------------------------------------------------------------------------------------------------------
export function Ledger({ rows, className }: {
  rows: { label: ReactNode; value: ReactNode; hint?: ReactNode; strong?: boolean; tone?: "positive" | "negative" | "muted"; indent?: boolean; to?: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("text-sm", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4 py-2.5", r.strong ? "mt-1 border-t border-line-strong pt-3" : i > 0 && "border-t border-line")}>
          <dt className={cn("min-w-0", r.indent && "pl-4", r.strong ? "font-semibold text-fg" : "text-fg-2")}>
            {r.label}
            {r.hint && <span className="ml-2 text-xs text-fg-3">{r.hint}</span>}
          </dt>
          <dd className={cn("shrink-0 text-right num", r.strong ? "text-base font-semibold" : "font-medium", r.tone === "positive" && "text-success-fg", r.tone === "negative" && "text-danger-fg", r.tone === "muted" && "text-fg-3")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Progreso y pasos
// ---------------------------------------------------------------------------------------------------------------------
export function ProgressBar({ value, max = 1, tone = "accent", className, label }: { value: number; max?: number; tone?: "accent" | "success" | "warning" | "danger"; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Bloque de sección con título, descripción y acción (ritmo vertical uniforme entre pantallas)
// ---------------------------------------------------------------------------------------------------------------------
export function Section({ title, description, action, children, className, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-3">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Celda de entidad (avatar + nombre + detalle) para tablas y listas
// ---------------------------------------------------------------------------------------------------------------------
export function EntityCell({ title, subtitle, leading, className }: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {leading}
      <span className="min-w-0">
        <span className="block truncate font-medium text-fg">{title}</span>
        {subtitle && <span className="block truncate text-xs text-fg-3">{subtitle}</span>}
      </span>
    </span>
  );
}
