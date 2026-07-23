import { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
        <Icon className="h-6 w-6 text-text-tertiary" />
      </div>
      <div>
        <p className="font-medium text-text-primary">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-text-tertiary">{description}</p>}
      </div>
    </div>
  );
}
