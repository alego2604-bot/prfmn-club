import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border-subtle bg-surface lg:flex">
      <div className="flex h-16 items-center gap-2 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-contrast">
          P
        </div>
        <div>
          <p className="text-sm font-semibold leading-none text-text-primary">PRFMN Club</p>
          <p className="text-[11px] leading-none text-text-tertiary mt-0.5">The Gravity Room</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 scrollbar-thin">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
