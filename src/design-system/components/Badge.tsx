import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  neutral: "bg-white/5 text-text-secondary",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", toneClasses[tone])}>
      {children}
    </span>
  );
}
