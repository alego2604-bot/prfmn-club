import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex lg:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full w-72 max-w-[80vw] flex-col border-r border-border-subtle bg-surface">
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-contrast">
              P
            </div>
            <div>
              <p className="text-sm font-semibold leading-none text-text-primary">PRFMN Club</p>
              <p className="mt-0.5 text-[11px] leading-none text-text-tertiary">The Gravity Room</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 scrollbar-thin">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
