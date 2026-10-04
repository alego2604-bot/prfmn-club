/**
 * Métricas V2: jerarquía en tres niveles.
 *  1. HeroMetric — la cifra que manda en la vista (una por pantalla, ≥ 48px, proporcional).
 *  2. StatStrip  — indicadores secundarios en una sola pieza separada por hairlines (no 5 tarjetas iguales).
 *  3. Alertas/insights — lo que requiere atención y la lectura de los datos.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Calendar, Check, Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sparkline } from "./charts";
import { DateInput } from "./form";

export function DeltaChip({ value, label, invert, size = "sm", className }: { value: number | null; label?: ReactNode; invert?: boolean; size?: "sm" | "md"; className?: string }) {
  if (value === null) return <span className={cn("text-xs text-fg-3", className)}>Sin comparación</span>;
  const up = value > 0.0005;
  const down = value < -0.0005;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const pct = Math.abs(value * 100).toLocaleString("es-ES", { maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 });
  return (
    <span className={cn("inline-flex items-center gap-1.5", size === "md" ? "text-sm" : "text-xs", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium num",
          good ? "bg-success-soft text-success-fg" : bad ? "bg-danger-soft text-danger-fg" : "bg-surface-sunken text-fg-3",
        )}
      >
        <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={2.25} />
        {up ? "+" : down ? "−" : ""}
        {pct} %
      </span>
      {label && <span className="text-fg-3">{label}</span>}
    </span>
  );
}

export function HeroMetric({ label, value, delta, sub, tooltip, className }: { label: ReactNode; value: string; delta?: ReactNode; sub?: ReactNode; tooltip?: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1.5 text-sm font-medium text-fg-2">
        {label}
        {tooltip && <span title={tooltip} className="cursor-help text-fg-3"><Info className="h-3.5 w-3.5" /></span>}
      </p>
      <p className="figure mt-2 truncate text-5xl leading-none text-fg sm:text-6xl" data-testid="hero-value">{value}</p>
      {(delta || sub) && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">{delta}{sub}</div>}
    </div>
  );
}

export interface StatItem {
  key: string;
  label: string;
  value: string;
  delta?: number | null;
  invert?: boolean;
  hint?: ReactNode;
  spark?: number[];
  tooltip?: string;
  onClick?: () => void;
}

/** Franja de indicadores: una sola tarjeta, celdas separadas por hairlines; se reorganiza en tablet y móvil. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cn("surface-card grid overflow-hidden rounded-xl", className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(176px, 1fr))` }}>
      {items.map((it) => {
        const Comp = it.onClick ? "button" : "div";
        return (
          <Comp
            key={it.key}
            onClick={it.onClick}
            className={cn(
              "relative -ml-px -mt-px flex min-w-0 flex-col border-l border-t border-line px-5 py-4 text-left",
              it.onClick && "transition-colors hover:bg-surface-2",
            )}
          >
            <span className="flex items-center gap-1 truncate text-xs font-medium text-fg-3" title={it.tooltip}>
              {it.label}
              {it.tooltip && <Info className="h-3 w-3 opacity-60" />}
            </span>
            <span className="mt-1.5 flex items-end justify-between gap-2">
              <span className="truncate text-2xl font-semibold tracking-[-0.025em]">{it.value}</span>
              {it.spark && <Sparkline values={it.spark} width={72} height={26} className="mb-1 shrink-0" />}
            </span>
            <span className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
              {it.delta !== undefined && <DeltaChip value={it.delta} invert={it.invert} />}
              {it.hint && <span className="truncate">{it.hint}</span>}
            </span>
          </Comp>
        );
      })}
    </div>
  );
}

export function InsightList({ items, className }: { items: { id: string; tone: "up" | "down" | "neutral"; text: string }[]; className?: string }) {
  if (!items.length) return <p className={cn("text-sm text-fg-3", className)}>Aún no hay suficientes datos para comparar. Las conclusiones aparecerán cuando haya actividad en dos periodos.</p>;
  return (
    <ul className={cn("flex flex-col", className)}>
      {items.map((i) => {
        const Icon = i.tone === "up" ? TrendingUp : TrendingDown;
        return (
          <li key={i.id} className="flex items-start gap-3 border-b border-line py-3 last:border-0 first:pt-0">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                i.tone === "up" ? "bg-success-soft text-success-fg" : i.tone === "down" ? "bg-warning-soft text-warning-fg" : "bg-surface-sunken text-fg-2",
              )}
            >
              {i.tone === "neutral" ? <span className="h-1.5 w-1.5 rounded-full bg-fg-3" /> : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span className="text-sm leading-relaxed text-fg-2">{i.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface RangeOption<T extends string> { value: T; label: string; long?: string }

/** Selector de periodo: atajos 7D/30D/90D/YTD/1Y en una pieza + personalizado en un panel. Afecta a toda la vista. */
export function RangeSelector<T extends string>({ value, onChange, options, custom, onCustomChange, customValue }: {
  value: T;
  onChange: (v: T) => void;
  options: RangeOption<T>[];
  custom?: T;
  customValue?: { start: string; end: string };
  onCustomChange?: (v: { start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const [draft, setDraft] = useState(customValue ?? { start: "", end: "" });
  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      <div className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-0.5 shadow-xs" role="radiogroup" aria-label="Periodo">
        {options.map((o) => (
          <button type="button"
            key={o.value}
            role="radio"
            aria-checked={o.value === value}
            title={o.long}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold tracking-wide transition-all num",
              o.value === value ? "bg-ink text-fg-inverse shadow-xs" : "text-fg-3 hover:bg-surface-sunken hover:text-fg",
            )}
          >
            {o.label}
          </button>
        ))}
        {custom && (
          <button type="button"
            role="radio"
            aria-checked={value === custom}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all",
              value === custom ? "bg-ink text-fg-inverse" : "text-fg-3 hover:bg-surface-sunken hover:text-fg",
            )}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Personalizado</span>
          </button>
        )}
      </div>
      {open && custom && (
        <div className="absolute right-0 top-10 z-30 w-[290px] animate-pop-in rounded-xl border border-line bg-surface p-4 shadow-lg">
          <p className="text-sm font-semibold">Periodo personalizado</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs text-fg-3">Desde<DateInput value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="mt-1 w-full" /></label>
            <label className="text-xs text-fg-3">Hasta<DateInput value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="mt-1 w-full" /></label>
          </div>
          <button type="button"
            disabled={!draft.start || !draft.end || draft.end < draft.start}
            onClick={() => { onCustomChange?.(draft); onChange(custom); setOpen(false); }}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-sm font-medium text-fg-inverse disabled:opacity-40"
          >
            <Check className="h-4 w-4" /> Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

/** Esqueleto con la forma real de la vista (sin saltos de layout al cargar). */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface-card rounded-xl p-6 lg:col-span-2"><div className="skeleton h-4 w-28" /><div className="skeleton mt-4 h-12 w-64" /><div className="skeleton mt-8 h-56 w-full" /></div>
        <div className="surface-card rounded-xl p-6"><div className="skeleton h-4 w-20" /><div className="skeleton mt-4 h-8 w-40" /><div className="skeleton mt-8 h-24 w-full" /></div>
      </div>
      <div className="surface-card grid grid-cols-2 rounded-xl lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="p-5"><div className="skeleton h-3 w-20" /><div className="skeleton mt-3 h-6 w-24" /></div>)}</div>
    </div>
  );
}
