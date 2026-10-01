import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "./primitives";

export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8", wide ? "max-w-[1600px]" : "max-w-[1280px]", className)}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1", className)} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative -mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-2.5 text-sm font-medium transition-colors",
              active ? "border-ink text-fg" : "border-transparent text-fg-3 hover:text-fg",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("rounded-full px-1.5 text-2xs num", active ? "bg-ink text-fg-inverse" : "bg-surface-sunken text-fg-3")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, size = "md", className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; size?: "sm" | "md"; className?: string }) {
  return (
    <div className={cn("no-scrollbar inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-surface-sunken p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded font-medium transition-all",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
            it.value === value ? "bg-surface text-fg shadow-xs" : "text-fg-3 hover:text-fg",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
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
    <div className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4 shadow-xs", className)}>
      <div className="flex items-center gap-1.5 text-sm text-fg-3">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="truncate">{label}</span>
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <Info className="h-3 w-3 opacity-60" />
          </span>
        )}
      </div>
      <div className={cn("mt-1.5 truncate font-semibold tracking-tight num", emphasis ? "text-3xl" : "text-2xl")}>{value}</div>
      {(delta || hint) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          {delta}
          {hint && <span className="truncate">{hint}</span>}
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
      <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-3">{children}</h2>
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
          <dd className="min-w-0 text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
