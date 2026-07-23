import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/types";
import { Link } from "react-router-dom";

const severityConfig = {
  high: { icon: AlertTriangle, class: "text-danger bg-danger/10" },
  medium: { icon: AlertCircle, class: "text-warning bg-warning/10" },
  low: { icon: Info, class: "text-info bg-info/10" },
} as const;

export function AttentionCard({ item }: { item: AttentionItem }) {
  const { icon: Icon, class: iconClass } = severityConfig[item.severity];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{item.title}</p>
        <p className="mt-0.5 text-xs text-text-tertiary">{item.detail}</p>
      </div>
      <Link
        to={item.actionHref ?? "#"}
        className="shrink-0 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent"
      >
        {item.actionLabel}
      </Link>
    </div>
  );
}
