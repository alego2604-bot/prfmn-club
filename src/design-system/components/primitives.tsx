import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/text";

// ------------------------------------------------------------------ Button
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-fg-inverse hover:bg-ink-hover shadow-xs",
  accent: "bg-accent text-white hover:bg-accent-hover shadow-xs",
  secondary: "bg-surface text-fg border border-line hover:border-line-strong hover:bg-surface-2 shadow-xs",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-sunken",
  subtle: "bg-surface-sunken text-fg hover:bg-line/70",
  danger: "bg-danger text-white hover:brightness-95 shadow-xs",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-sm gap-1.5 rounded",
  md: "h-9 px-3.5 text-sm gap-2 rounded",
  lg: "h-11 px-4 text-md gap-2 rounded-md",
  xl: "h-14 px-6 text-lg gap-2.5 rounded-lg font-semibold",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,border,color,box-shadow,transform] duration-150 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === "xl" ? "h-5 w-5" : "h-4 w-4"} strokeWidth={2} /> : null}
      {children}
      {IconRight && <IconRight className="h-4 w-4 opacity-70" />}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, size = "md", ...rest }: { icon: LucideIcon; label: string; size?: "sm" | "md" | "lg" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded text-fg-2 transition-colors hover:bg-surface-sunken hover:text-fg disabled:opacity-40",
        size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9",
        className,
      )}
      {...rest}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}

// ------------------------------------------------------------------ Badge
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-fg-2 border-line",
  accent: "bg-accent-soft text-accent-fg border-transparent",
  success: "bg-success-soft text-success-fg border-transparent",
  warning: "bg-warning-soft text-warning-fg border-transparent",
  danger: "bg-danger-soft text-danger-fg border-transparent",
  info: "bg-info-soft text-info-fg border-transparent",
};
const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-3", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info",
};

export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium", TONES[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />}
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", DOTS[tone], className)} />;
}

// ------------------------------------------------------------------ Card
export function Card({ className, children, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface shadow-xs", padded && "p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="text-md font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-fg-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Misc
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-2xs font-medium text-fg-3", className)}>{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-fg-3", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

const AVATAR_COLORS = ["#3b5bfd", "#12a150", "#d97706", "#8e4ec6", "#0ea5b7", "#d6409f", "#e5484d", "#64748b"];
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: color }}
      aria-hidden
    >
      {initials(name) || "·"}
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12.5px] tracking-tight", className)}>{children}</span>;
}
