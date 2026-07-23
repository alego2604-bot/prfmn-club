import { Bell, Menu } from "lucide-react";
import { Avatar } from "@/design-system/components";

export function Topbar({ title, onMenuClick }: { title: string; onMenuClick: () => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-subtle text-text-secondary hover:text-text-primary lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="truncate text-lg font-semibold tracking-tight text-text-primary">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle text-text-secondary hover:text-text-primary">
          <Bell className="h-4 w-4" />
        </button>
        <Avatar name="Alex Demo" size="sm" />
      </div>
    </header>
  );
}
