import { cn } from "@/lib/cn";

/**
 * Marca Business OS: bloques. Dos piezas del núcleo y un módulo en cobalto que encaja con ellas
 * (core + módulos verticales). Geométrica, legible a 16px y sin referencias a ningún tenant.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <rect x="8" y="8.5" width="9.5" height="6.5" rx="2" fill="var(--surface)" />
      <rect x="19.5" y="8.5" width="4.5" height="6.5" rx="2" fill="var(--accent)" />
      <rect x="8" y="17" width="16" height="6.5" rx="2" fill="var(--surface)" opacity="0.92" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.02em]">
          Business<span className="font-medium text-fg-3"> OS</span>
        </span>
      )}
    </span>
  );
}
