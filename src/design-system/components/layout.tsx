import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "./primitives";

export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-fg-3">{eyebrow}</div>}
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full animate-fade-in px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-14 lg:pt-8", wide ? "max-w-[1560px]" : "max-w-[1280px]", className)}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <ScrollFade className={cn("-mx-1 border-b border-line", className)} innerClassName="flex gap-1 px-1">
    <div className="contents" role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button type="button"
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative -mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
              active ? "border-ink text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("rounded-md px-1.5 text-2xs font-semibold num", active ? "bg-surface-sunken text-fg" : "bg-surface-sunken text-fg-3")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
    </ScrollFade>
  );
}

/**
 * Fila con scroll horizontal y pista visual: se difuminan los bordes por los que queda contenido (pestañas, filtros,
 * segmentos en móvil). El elemento activo (`[aria-selected=true]`, `[aria-pressed=true]`, `[data-active]`) se
 * desplaza a la vista al montar.
 */
export function ScrollFade({ children, className, innerClassName }: { children: ReactNode; className?: string; innerClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "left" | "right" | "both">("none");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setFade(left && right ? "both" : left ? "left" : right ? "right" : "none");
    };
    const active = el.querySelector<HTMLElement>('[aria-selected="true"],[aria-pressed="true"],[data-active="true"]');
    if (active && (active.offsetLeft + active.offsetWidth > el.clientWidth)) el.scrollLeft = active.offsetLeft - 24;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className={cn("relative min-w-0", className)}>
      <div ref={ref} className={cn("no-scrollbar overflow-x-auto", fade !== "none" && `fade-x-${fade}`, innerClassName)}>{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, size = "md", className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; size?: "sm" | "md"; className?: string }) {
  return (
    <ScrollFade className={cn("inline-block max-w-full rounded-lg bg-surface-sunken", className)} innerClassName="flex p-0.5">
      {items.map((it) => (
        <button type="button"
          key={it.value}
          aria-pressed={it.value === value}
          onClick={() => onChange(it.value)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md font-medium transition-all duration-150",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
            it.value === value ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-fg-3 hover:text-fg",
          )}
        >
          {it.label}
        </button>
      ))}
    </ScrollFade>
  );
}

/** Chip de variación: +12,4 % vs periodo anterior. Verde si sube (o si baja y `invert`). */
export function Delta({ value, label, invert, className }: { value: number | null; label?: string; invert?: boolean; className?: string }) {
  if (value === null) return <span className={cn("inline-flex items-center gap-1 text-xs text-fg-3", className)} title="Sin datos comparables">— {label}</span>;
  const up = value > 0.0005;
  const down = value < -0.0005;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)}>
      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium num", good ? "bg-success-soft text-success-fg" : bad ? "bg-danger-soft text-danger-fg" : "bg-surface-sunken text-fg-3")}>
        <Icon className="h-3 w-3" />
        {`${Math.abs(value * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`}
      </span>
      {label && <span className="text-fg-3">{label}</span>}
    </span>
  );
}

export function Kpi({ label, value, hint, delta, icon: Icon, className, tooltip, emphasis, footer }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  delta?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  tooltip?: string;
  emphasis?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className={cn("surface-card flex min-w-0 flex-col rounded-xl p-4 sm:p-5", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="truncate">{label}</span>
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <Info className="h-3 w-3 opacity-60" />
          </span>
        )}
      </div>
      <div data-kpi-value className={cn("mt-1.5 truncate font-semibold tracking-[-0.025em] num", emphasis ? "text-3xl" : "text-xl sm:text-2xl")}>{value}</div>
      {(delta || hint) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          {delta}
          {hint && <span className="line-clamp-2 sm:truncate">{hint}</span>}
        </div>
      )}
      {footer && <div className="mt-3 border-t border-line pt-3">{footer}</div>}
    </div>
  );
}

export type ModuleStatus = "PLANNED" | "DESIGNED" | "FRONTEND ONLY" | "FUNCTIONAL" | "TESTED" | "PRODUCTION READY";
const STATUS_TONE: Record<ModuleStatus, Tone> = {
  PLANNED: "neutral",
  DESIGNED: "info",
  "FRONTEND ONLY": "warning",
  FUNCTIONAL: "accent",
  TESTED: "success",
  "PRODUCTION READY": "success",
};
export function StatusPill({ status }: { status: ModuleStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{status}</Badge>;
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">{children}</h2>
      {action}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 text-sm">
          <dt className="shrink-0 text-fg-3">{it.label}</dt>
          <dd className="min-w-0 break-words text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Agrupa KPIs en una sola pieza con divisores (evita filas de tarjetas idénticas). Reparto sin huérfanos:
 *   móvil: 2 columnas (si son impares, el primero ocupa la fila) · tablet: ≤4 en fila, 5 → 2+3, 6 → 3+3 ·
 *   escritorio (≥1280): todos en una fila. Máximo recomendado: 5 (lo demás, como texto secundario).
 */
const STRIP_LAYOUT: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 [&>*:first-child]:col-span-2 md:grid-cols-3 md:[&>*:first-child]:col-span-1",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 [&>*:first-child]:col-span-2 md:grid-cols-6 md:[&>*]:col-span-2 md:[&>*:nth-child(-n+2)]:col-span-3 xl:grid-cols-5 xl:[&>*]:col-span-1 xl:[&>*:nth-child(-n+2)]:col-span-1",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
};

export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  const n = Children.toArray(children).filter(Boolean).length;
  return (
    <div
      className={cn(
        "surface-card grid overflow-hidden rounded-xl [&>*]:-ml-px [&>*]:-mt-px [&>*]:rounded-none [&>*]:border-0 [&>*]:border-l [&>*]:border-t [&>*]:border-line [&>*]:bg-transparent [&>*]:shadow-none",
        STRIP_LAYOUT[n] ?? "grid-cols-2 md:grid-cols-4",
        n >= 5 && "[&_[data-kpi-value]]:text-xl xl:[&_[data-kpi-value]]:text-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
