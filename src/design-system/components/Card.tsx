import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-border-subtle bg-surface", className)}
      {...props}
    />
  );
}

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  positive = true,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaLabel?: string;
  positive?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm text-text-tertiary">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-text-primary">{value}</p>
      {delta && (
        <p className={cn("mt-1 text-xs font-medium", positive ? "text-success" : "text-danger")}>
          {delta} <span className="text-text-tertiary font-normal">{deltaLabel}</span>
        </p>
      )}
    </Card>
  );
}
