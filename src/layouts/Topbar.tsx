import { Bell, Plus } from "lucide-react";
import { Avatar, Button } from "@/design-system/components";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-6">
      <h1 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h1>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm">
          <Plus className="h-4 w-4" />
          Nueva acción
        </Button>
        <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-text-secondary hover:text-text-primary">
          <Bell className="h-4 w-4" />
        </button>
        <Avatar name="Alex Demo" size="sm" />
      </div>
    </header>
  );
}
