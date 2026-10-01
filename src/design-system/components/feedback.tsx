import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "error" ? 6000 : 3800);
  }, []);
  const icon: Record<ToastTone, LucideIcon> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const color: Record<ToastTone, string> = { success: "text-success", error: "text-danger", info: "text-accent", warning: "text-warning" };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 max-lg:bottom-20">
          {toasts.map((t) => {
            const Icon = icon[t.tone];
            return (
              <div key={t.id} className="pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-lg" role="status" aria-live="polite">
                <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", color[t.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-sm text-fg-3">{t.description}</p>}
                  {t.action && (
                    <button className="mt-1.5 text-sm font-medium text-accent-fg hover:underline" onClick={t.action.onClick}>
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button className="text-fg-3 hover:text-fg" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (title: string, description?: string, action?: Toast["action"]) => push({ tone: "success", title, description, action }),
    error: (title: string, description?: string) => push({ tone: "error", title, description }),
    info: (title: string, description?: string) => push({ tone: "info", title, description }),
    warning: (title: string, description?: string) => push({ tone: "warning", title, description }),
    /** Muestra el error de un repositorio de forma legible */
    fromError: (e: unknown, title = "No se ha podido completar") => push({ tone: "error", title, description: e instanceof Error ? e.message : String(e) }),
  };
}

/** Estado vacío con contexto y siguiente paso: nunca "No data". */
export function EmptyState({ icon: Icon, title, description, action, secondary, className, compact }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; secondary?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-16", className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-3 rounded-2xl bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] opacity-80" aria-hidden />
        <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface shadow-sm">
          <Icon className="h-5 w-5 text-fg-2" strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-3">{description}</p>}
      {(action || secondary) && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}{secondary}</div>}
    </div>
  );
}

/** Error recuperable: qué ha pasado en lenguaje claro, reintentar y detalle técnico opcional. */
export function ErrorState({ title = "No hemos podido cargar estos datos", description = "Puede ser un problema de conexión. Tus datos no se han perdido.", error, onRetry, className }: { title?: string; description?: string; error?: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)} role="alert">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-warning-soft text-warning-fg"><AlertTriangle className="h-5 w-5" /></div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-3">{description}</p>
      {onRetry && <button onClick={onRetry} className="mt-5 h-9 rounded-md bg-ink px-3.5 text-sm font-medium text-fg-inverse transition-colors hover:bg-ink-hover">Reintentar</button>}
      {error !== undefined && (
        <details className="mt-4 max-w-md text-left text-xs text-fg-3">
          <summary className="cursor-pointer select-none text-center">Detalles técnicos</summary>
          <p className="mt-2 break-words rounded-md bg-surface-sunken p-2 font-mono">{error instanceof Error ? error.message : String(error)}</p>
        </details>
      )}
    </div>
  );
}

export function Callout({ tone = "info", icon: Icon = Info, title, children, className, action }: { tone?: "info" | "warning" | "danger" | "success" | "accent"; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const styles = {
    info: "bg-surface-2 border-line text-fg-2",
    accent: "bg-accent-soft border-transparent text-accent-fg",
    warning: "bg-warning-soft border-transparent text-warning-fg",
    danger: "bg-danger-soft border-transparent text-danger-fg",
    success: "bg-success-soft border-transparent text-success-fg",
  }[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}
