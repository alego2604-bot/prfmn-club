import { EmptyState } from "@/design-system/components";
import type { LucideIcon } from "lucide-react";

export function PlaceholderPage({ icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h2>
      <EmptyState icon={icon} title="Módulo en construcción" description={description} />
    </div>
  );
}
