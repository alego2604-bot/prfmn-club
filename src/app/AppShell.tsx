import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, Building2, Check, ChevronsUpDown, FlaskConical, LogOut, Menu as MenuIcon, Monitor, Moon, MoreHorizontal, Search, Sun, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Drawer, EmptyState, IconButton, Kbd, Menu, MenuItem, MenuLabel } from "@/design-system/components";
import { computeAlerts } from "@/domain/alerts";
import { ROLE_LABELS } from "@/domain/permissions";
import { hasModule } from "@/domain/modules";
import { ALL_ITEMS, MOBILE_TABS, NAV, SETTINGS_ITEM, type NavItem } from "./nav";
import { useLocationScope, useSession, useWorkspace } from "./session";
import { Logo, LogoMark } from "./Logo";
import { CommandPalette } from "./CommandPalette";
import { applyTheme, getThemePref, type ThemePref } from "./theme";

function useVisibleNav() {
  const { can } = useSession();
  const ws = useWorkspace();
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => (!i.perm || can(i.perm)) && (!i.module || hasModule(ws.organization, i.module))) })).filter((g) => g.items.length);
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const soon = item.status === "PLANNED" || item.status === "DESIGNED";
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
          isActive ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-line" : soon ? "text-fg-3 hover:bg-surface-sunken hover:text-fg-2" : "text-fg-2 hover:bg-surface-sunken hover:text-fg",
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="flex-1 truncate">{item.label}</span>
      {soon && <span className="rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-fg-3">Pronto</span>}
    </NavLink>
  );
}

function OrgSwitcher() {
  const s = useSession();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const orgs = s.store.getMeta().organizations.filter((o) => s.memberships.some((m) => m.organizationId === o.id));
  return (
    <Menu
      align="start"
      width={260}
      trigger={(open, toggle) => (
        <button onClick={toggle} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken", open && "bg-surface-sunken")}>
          {ws.organization.logoDataUrl ? (
            <img src={ws.organization.logoDataUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-xs font-bold text-accent-fg">{ws.organization.name.slice(0, 2).toUpperCase()}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{ws.organization.name}</span>
            <span className="block truncate text-2xs text-fg-3">{s.member ? ROLE_LABELS[s.member.role].name : ""}{ws.organization.isDemo ? " · Demo" : ""}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-fg-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Empresas</MenuLabel>
          {orgs.map((o) => (
            <MenuItem key={o.id} icon={o.isDemo ? FlaskConical : Building2} onClick={async () => { close(); await s.switchOrganization(o.id); navigate("/"); }} hint={o.id === ws.organization.id ? <Check className="h-3.5 w-3.5" /> : undefined}>
              {o.name}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={Building2} onClick={() => { close(); s.leaveOrganization(); }}>Crear o cambiar de empresa…</MenuItem>
        </>
      )}
    </Menu>
  );
}

function Sidebar({ compact }: { compact?: boolean }) {
  const groups = useVisibleNav();
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface-2", compact ? "xl:flex" : "lg:flex")}>
      <div className="flex h-14 items-center px-4">
        <Link to="/"><Logo /></Link>
      </div>
      <div className="px-3 pb-2"><OrgSwitcher /></div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g, i) => (
          <div key={i} className={cn(g.label && "mt-5")}>
            {g.label && <div className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-fg-3">{g.label}</div>}
            <div className="flex flex-col gap-0.5">{g.items.map((it) => <NavRow key={it.to} item={it} />)}</div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-3 py-3">
        <NavRow item={SETTINGS_ITEM} />
      </div>
    </aside>
  );
}

function ThemeMenu() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const Icon = pref === "dark" ? Moon : pref === "system" ? Monitor : Sun;
  return (
    <Menu width={180} trigger={(_, toggle) => <IconButton icon={Icon} label="Tema" onClick={toggle} />}>
      {(close) => (
        <>
          {([["light", "Claro", Sun], ["dark", "Oscuro", Moon], ["system", "Sistema", Monitor]] as const).map(([v, l, I]) => (
            <MenuItem key={v} icon={I} hint={pref === v ? <Check className="h-3.5 w-3.5" /> : undefined} onClick={() => { setPref(v); applyTheme(v); close(); }}>
              {l}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function LocationSwitcher() {
  const { locations, current, setLocationId, canSeeAll } = useLocationScope();
  if (locations.length <= 1) return locations[0] ? <span className="hidden items-center gap-1.5 rounded-md px-2 text-sm text-fg-2 md:inline-flex"><Building2 className="h-3.5 w-3.5 text-fg-3" />{locations[0].name}</span> : null;
  return (
    <Menu
      width={220}
      align="start"
      trigger={(_, toggle) => (
        <Button variant="ghost" size="sm" icon={Building2} iconRight={ChevronsUpDown} onClick={toggle}>
          {current?.name ?? "Todos los centros"}
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Centro</MenuLabel>
          {canSeeAll && <MenuItem onClick={() => { setLocationId("all"); close(); }} hint={!current ? <Check className="h-3.5 w-3.5" /> : undefined}>Todos (consolidado)</MenuItem>}
          {locations.map((l) => (
            <MenuItem key={l.id} onClick={() => { setLocationId(l.id); close(); }} hint={current?.id === l.id ? <Check className="h-3.5 w-3.5" /> : undefined}>{l.name}</MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function UserMenu() {
  const s = useSession();
  return (
    <Menu
      width={240}
      trigger={(_, toggle) => (
        <button onClick={toggle} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-fg-inverse" aria-label="Cuenta">
          {s.user?.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{s.user?.fullName}</p>
            <p className="truncate text-xs text-fg-3">{s.user?.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={LogOut} onClick={() => { close(); s.logout(); }}>Cerrar sesión</MenuItem>
        </>
      )}
    </Menu>
  );
}

function Notifications() {
  const ws = useWorkspace();
  const { filterId } = useLocationScope();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const alerts = useMemo(() => computeAlerts(ws, new Date(), filterId), [ws, filterId]);
  const important = alerts.filter((a) => a.severity !== "info").length;
  const tone = { danger: "bg-danger", warning: "bg-warning", info: "bg-accent" };
  return (
    <>
      <div className="relative">
        <IconButton icon={Bell} label="Notificaciones" onClick={() => setOpen(true)} />
        {important > 0 && <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="Notificaciones" subtitle="Calculadas en tiempo real a partir de tus datos" width={420}>
        {alerts.length === 0 ? (
          <EmptyState icon={Bell} title="Todo en orden" description="No hay nada que requiera tu atención ahora mismo." />
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((a) => (
              <button key={a.id} onClick={() => { setOpen(false); navigate(a.to); }} className="flex items-start gap-3 rounded-lg border border-line p-3.5 text-left transition-colors hover:bg-surface-2">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone[a.severity])} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-fg-3">{a.reason}</span>
                  <span className="mt-2 inline-block text-sm font-medium text-accent-fg">{a.cta} →</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
}

function MobileMenu({ open, onClose, compact }: { open: boolean; onClose: () => void; compact?: boolean }) {
  const groups = useVisibleNav();
  if (!open) return null;
  return (
    <div className={cn("fixed inset-0 z-50", compact ? "xl:hidden" : "lg:hidden")}>
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] animate-slide-in flex-col bg-surface-2 shadow-lg">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </div>
        <div className="px-3 pb-2"><OrgSwitcher /></div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-6">
          {groups.map((g, i) => (
            <div key={i} className={cn(g.label && "mt-5")}>
              {g.label && <div className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-fg-3">{g.label}</div>}
              <div className="flex flex-col gap-0.5">{g.items.map((it) => <NavRow key={it.to} item={it} onNavigate={onClose} />)}</div>
            </div>
          ))}
          <div className="mt-5 border-t border-line pt-3"><NavRow item={SETTINGS_ITEM} onNavigate={onClose} /></div>
        </nav>
      </div>
    </div>
  );
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { can } = useSession();
  const items = MOBILE_TABS.map((to) => ALL_ITEMS.find((i) => i.to === to)!).filter((i) => !i.perm || can(i.perm));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 backdrop-blur safe-bottom lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length + 1}, 1fr)` }}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cn("flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium", isActive ? "text-fg" : "text-fg-3")}>
          <it.icon className="h-5 w-5" strokeWidth={1.8} />
          {it.label}
        </NavLink>
      ))}
      <button onClick={onMore} className="flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium text-fg-3">
        <MoreHorizontal className="h-5 w-5" />
        Más
      </button>
    </nav>
  );
}

export function AppShell() {
  const ws = useWorkspace();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isPos = location.pathname.startsWith("/caja");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const current = ALL_ITEMS.filter((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))).sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="min-h-screen">
      <Sidebar compact={isPos} />
      <div className={isPos ? "xl:pl-[248px]" : "lg:pl-[248px]"}>
        {ws.organization.isDemo && (
          <div className="flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-center text-xs font-medium text-fg-inverse">
            <FlaskConical className="h-3.5 w-3.5" />
            Estás en la empresa DEMO · datos ficticios, separados de tus datos reales
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md sm:px-5">
          <IconButton icon={MenuIcon} label="Menú" className={isPos ? "xl:hidden" : "lg:hidden"} onClick={() => setMobileOpen(true)} />
          <Link to="/" className={isPos ? "xl:hidden" : "lg:hidden"}><LogoMark size={26} /></Link>
          <div className={cn("hidden items-center gap-2 text-sm", isPos ? "xl:flex" : "lg:flex")}>
            {current && <span className="font-medium text-fg">{current.label}</span>}
          </div>
          <div className="ml-1"><LocationSwitcher /></div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 w-64 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-fg-3 shadow-xs transition-colors hover:border-line-strong md:flex"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Buscar o ir a…</span>
              <Kbd>⌘</Kbd><Kbd>K</Kbd>
            </button>
            <IconButton icon={Search} label="Buscar" className="md:hidden" onClick={() => setPaletteOpen(true)} />
            <Notifications />
            <ThemeMenu />
            <UserMenu />
          </div>
        </header>
        <main className={cn(isPos && "lg:h-[calc(100vh-56px)]")}>
          <Outlet />
        </main>
      </div>
      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} compact={isPos} />
      {!isPos && <MobileTabBar onMore={() => setMobileOpen(true)} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
