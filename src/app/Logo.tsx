import { cn } from "@/lib/cn";

/** Marca: un punto de acento orbitando una masa (gravedad / rendimiento). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <circle cx="14" cy="18" r="6.5" fill="none" stroke="var(--surface)" strokeWidth="2.6" />
      <circle cx="23" cy="9" r="3" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight">
          Business<span className="text-fg-3"> OS</span>
        </span>
      )}
    </span>
  );
}
