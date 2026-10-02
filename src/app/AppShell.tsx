import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, Check, ChevronDown, FlaskConical, Layers, LogOut, Menu as MenuIcon, Monitor, Moon, MoreHorizontal, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer, EmptyState, IconButton, Kbd, Menu, MenuItem, useToast } from "@/design-system/components";
import { computeAlerts } from "@/domain/alerts";
import { hasModule } from "@/domain/modules";
import { ALL_ITEMS, isPlanned, MOBILE_TABS, NAV, routePath, SETTINGS_ITEM, type NavItem } from "./nav";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { getPref, setPref } from "@/lib/localPrefs";
import { useLocationScope, useSession, useWorkspace } from "./session";
import { Logo, LogoMark } from "./Logo";
import { CommandPalette } from "./CommandPalette";
import { CompanySwitcher, LocationSwitcher, OrgAvatar } from "./CompanySwitcher";
import { applyTheme, getThemePref, type ThemePref } from "./theme";

/*
 * Estructura responsive:
 *   ≥1280 px (xl)      barra lateral completa (248 px)            · Caja: carril hasta 1536 px para dar ancho al TPV
 *   768–1279 px (md)   carril de iconos (68 px) — iPad horizontal y vertical, sin "móvil estirado"
 *   <768 px            cabecera + cajón lateral + barra inferior de 5 accesos
 */
const SOON = "Próximamente";

function useVisibleNav() {
  const { can } = useSession();
  const ws = useWorkspace();
  const visible = (i: NavItem) => (!i.perm || can(i.perm)) && (!i.module || hasModule(ws.organization, i.module));
  const groups = NAV.filter((g) => g.label !== SOON)
    .map((g) => ({ ...g, items: g.items.filter((i) => visible(i) && (!isPlanned(i) || i.inline)) }))
    .filter((g) => g.items.length);
  const planned = NAV.flatMap((g) => g.items).filter((i) => visible(i) && isPlanned(i) && !i.inline);
  return { groups, planned };
}

/** ¿Está activo? Compara ruta y, si el elemento la lleva, la pestaña (?tab=) — Equipo/Centros/Ajustes comparten ruta. */
function useIsActive() {
  const loc = useLocation();
  const tab = new URLSearchParams(loc.search).get("tab");
  return (i: NavItem) => {
    const [path, query] = i.to.split("?");
    const wanted = query ? new URLSearchParams(query).get("tab") : null;
    const onPath = i.end ? loc.pathname === path : path === "/" ? loc.pathname === "/" : loc.pathname.startsWith(path!);
    if (!onPath) return false;
    if (path === "/ajustes") return wanted ? tab === wanted : !tab || !["equipo", "centros"].includes(tab);
    return true;
  };
}

function readCollapsed(): string[] {
  try {
    return JSON.parse(getPref("nav.collapsed") ?? "[]") as string[];
  } catch {
    return [];
  }
}

function NavRow({ item, onNavigate, rail }: { item: NavItem; onNavigate?: () => void; rail?: boolean }) {
  const isActive = useIsActive()(item);
  const soon = isPlanned(item);
  if (rail) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        title={soon ? `${item.label} · Pronto` : item.label}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          isActive ? "bg-surface text-fg shadow-xs ring-1 ring-line" : soon ? "text-fg-3/70 hover:bg-surface-sunken" : "text-fg-3 hover:bg-surface-sunken hover:text-fg",
        )}
      >
        <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </Link>
    );
  }
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex h-[31px] items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-100",
        isActive ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-line" : soon ? "text-fg-3 hover:bg-surface-sunken hover:text-fg-2" : "text-fg-2 hover:bg-surface-sunken hover:text-fg",
      )}
    >
      <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-fg" : "text-fg-3 group-hover:text-fg-2")} strokeWidth={1.75} />
      <span className="flex-1 truncate">{item.label}</span>
      {soon && <span className="rounded px-1 text-[10px] font-medium uppercase tracking-wider text-fg-3 ring-1 ring-inset ring-line">Pronto</span>}
    </Link>
  );
}

function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const { groups, planned } = useVisibleNav();
  const location = useLocation();
  const isActive = useIsActive();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [soonOpen, setSoonOpen] = useState(() => planned.some((p) => location.pathname.startsWith(routePath(p))));
  const toggle = (label: string) => {
    const next = collapsed.includes(label) ? collapsed.filter((x) => x !== label) : [...collapsed, label];
    setCollapsed(next);
    setPref("nav.collapsed", JSON.stringify(next));
  };
  return (
    <>
      {groups.map((g, i) => {
        const isCollapsed = !!g.label && collapsed.includes(g.label) && !g.items.some((it) => isActive(it));
        return (
          <div key={i} className={cn(g.label && "mt-3.5")}>
            {g.label && (
              <button onClick={() => toggle(g.label!)} className="group mb-0.5 flex h-6 w-full items-center gap-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3 hover:text-fg-2" aria-expanded={!isCollapsed}>
                {g.label}
                <ChevronDown className={cn("h-3 w-3 opacity-0 transition-all group-hover:opacity-100", isCollapsed && "-rotate-90 opacity-100")} />
              </button>
            )}
            {!isCollapsed && <div className="flex flex-col gap-px">{g.items.map((it) => <NavRow key={it.to} item={it} onNavigate={onNavigate} />)}</div>}
          </div>
        );
      })}
      {planned.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setSoonOpen((o) => !o)} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-3 transition-colors hover:bg-surface-sunken hover:text-fg-2" aria-expanded={soonOpen}>
            <Layers className="h-4 w-4" strokeWidth={1.75} />
            <span className="flex-1 text-left">{SOON}</span>
            <span className="rounded-md bg-surface-sunken px-1.5 text-[11px] font-medium num">{planned.length}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !soonOpen && "-rotate-90")} />
          </button>
          {soonOpen && <div className="ml-[18px] mt-0.5 flex flex-col gap-px border-l border-line pl-1.5">{planned.map((it) => <NavRow key={it.to} item={it} onNavigate={onNavigate} />)}</div>}
        </div>
      )}
    </>
  );
}

function Sidebar({ pos }: { pos: boolean }) {
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-canvas", pos ? "2xl:flex" : "xl:flex")} aria-label="Navegación">
      <div className="flex h-14 items-center px-4">
        <Link to="/" aria-label="Resumen"><Logo /></Link>
      </div>
      <div className="px-3 pb-3"><CompanySwitcher /></div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="Principal">
        <NavTree />
      </nav>
      <div className="border-t border-line px-3 py-3">
        <NavRow item={SETTINGS_ITEM} />
      </div>
    </aside>
  );
}

/** Carril de iconos (iPad): todo el ancho para el contenido, con la empresa activa siempre visible arriba. */
function Rail({ pos }: { pos: boolean }) {
  const { groups } = useVisibleNav();
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden w-[68px] flex-col items-center border-r border-line bg-canvas py-3", pos ? "md:flex 2xl:hidden" : "md:flex xl:hidden")} aria-label="Navegación">
      <CompanySwitcher variant="rail" />
      <div className="my-2 h-px w-8 bg-line" />
      <nav className="no-scrollbar flex flex-1 flex-col items-center gap-1 overflow-y-auto" aria-label="Principal">
        {groups.map((g, i) => (
          <div key={i} className={cn("flex flex-col items-center gap-1", i > 0 && "mt-1.5 border-t border-line pt-2.5")}>
            {g.items.filter((it) => !isPlanned(it)).map((it) => <NavRow key={it.to} item={it} rail />)}
          </div>
        ))}
      </nav>
      <div className="mt-2 border-t border-line pt-2"><NavRow item={SETTINGS_ITEM} rail /></div>
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

function UserMenu() {
  const s = useSession();
  const toast = useToast();
  return (
    <Menu
      width={240}
      trigger={(_, toggle) => (
        <button onClick={toggle} className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-fg-inverse ring-2 ring-canvas transition-transform active:scale-95" aria-label="Cuenta">
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
          <MenuItem icon={LogOut} onClick={async () => { close(); try { await s.logout(); } catch (e) { toast.fromError(e); } }}>Cerrar sesión</MenuItem>
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

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Menú">
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] animate-slide-in flex-col bg-surface-2 shadow-lg">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </div>
        <div className="px-3 pb-2"><CompanySwitcher onNavigate={onClose} /></div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-6">
          <NavTree onNavigate={onClose} />
          <div className="mt-5 border-t border-line pt-3"><NavRow item={SETTINGS_ITEM} onNavigate={onClose} /></div>
        </nav>
      </div>
    </div>
  );
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { can } = useSession();
  const isActive = useIsActive();
  const items = MOBILE_TABS.map((to) => ALL_ITEMS.find((i) => i.to === to)!).filter((i) => !i.perm || can(i.perm));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 backdrop-blur safe-bottom md:hidden" style={{ gridTemplateColumns: `repeat(${items.length + 1}, 1fr)` }} aria-label="Accesos rápidos">
      {items.map((it) => {
        const active = isActive(it);
        return (
          <Link key={it.to} to={it.to} aria-current={active ? "page" : undefined} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium", active ? "text-fg" : "text-fg-3")}>
            <it.icon className="h-5 w-5" strokeWidth={active ? 2 : 1.75} />
            {it.label}
          </Link>
        );
      })}
      <button onClick={onMore} className="flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium text-fg-3">
        <MoreHorizontal className="h-5 w-5" />
        Más
      </button>
    </nav>
  );
}

/** Estado de guardado en el servidor: discreto cuando todo va bien, claro cuando no. */
function SyncIndicator() {
  const s = useSession();
  const toast = useToast();
  useEffect(() => s.onSyncError((m) => toast.error("No se ha podido guardar", m)), [s, toast]);
  if (s.mode !== "cloud" || !s.sync) return null;
  const { state, pending, progress } = s.sync;
  const label =
    state === "offline" ? `Sin conexión · ${pending} pendiente${pending === 1 ? "" : "s"}`
    : progress && progress.total > 1 ? `${progress.label} · ${progress.done}/${progress.total}`
    : state === "syncing" || pending ? "Guardando…"
    : state === "error" ? "Error al guardar"
    : "Guardado";
  const dot = state === "offline" || state === "error" ? "bg-warning" : state === "syncing" || pending ? "bg-accent animate-pulse" : "bg-success";
  return (
    <button
      onClick={() => void s.refresh().catch(() => undefined)}
      title={s.sync.lastSyncedAt ? `Última sincronización: ${new Date(s.sync.lastSyncedAt).toLocaleTimeString("es-ES")}` : "Sincronizar"}
      className="hidden h-8 max-w-[280px] items-center gap-2 truncate rounded-md px-2.5 text-xs font-medium text-fg-3 transition-colors hover:bg-surface-sunken hover:text-fg sm:flex"
      data-testid="sync-indicator"
      data-state={pending ? "pending" : state}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </button>
  );
}

export function AppShell() {
  const ws = useWorkspace();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isPos = location.pathname.startsWith("/caja");
  const isActive = useIsActive();
  const { locations } = useLocationScope();
  const current = [...ALL_ITEMS, SETTINGS_ITEM].filter(isActive).sort((a, b) => b.to.length - a.to.length)[0];

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

  // Pestaña del navegador: pantalla · empresa (con varias empresas abiertas, cada pestaña se distingue)
  useEffect(() => {
    document.title = `${current?.label ?? "Business OS"} · ${ws.organization.name}`;
  }, [current?.label, ws.organization.name]);

  return (
    <div className="min-h-screen">
      <Sidebar pos={isPos} />
      <Rail pos={isPos} />
      <div className={cn(isPos ? "flex h-[100dvh] flex-col md:pl-[68px] 2xl:pl-[248px]" : "md:pl-[68px] xl:pl-[248px]")}>
        {ws.organization.isDemo && (
          <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 border-b border-accent/15 bg-accent-soft px-4 text-center text-2xs font-medium text-accent-fg" data-testid="demo-banner">
            <FlaskConical className="h-3 w-3" />
            <span className="sm:hidden">Empresa demo · datos ficticios</span>
            <span className="hidden sm:inline">Empresa de demostración · datos ficticios, separados de tus empresas reales</span>
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/80 px-3 backdrop-blur-xl backdrop-saturate-150 sm:px-5">
          <IconButton icon={MenuIcon} label="Menú" className="md:hidden" onClick={() => setMobileOpen(true)} />
          <Link to="/" className="md:hidden" aria-label="Resumen"><LogoMark size={26} /></Link>
          <button onClick={() => setMobileOpen(true)} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left md:hidden" aria-label={`Empresa activa: ${ws.organization.name}`}>
            <OrgAvatar name={ws.organization.name} logo={ws.organization.logoDataUrl} demo={ws.organization.isDemo} size={22} />
            <span className="max-w-[34vw] truncate text-sm font-semibold">{ws.organization.name}</span>
          </button>
          <div className="hidden md:block"><LocationSwitcher /></div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-fg-3 shadow-xs transition-colors hover:border-line-strong hover:text-fg-2 lg:flex"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Buscar, crear o ir a…</span>
              <Kbd>⌘</Kbd><Kbd>K</Kbd>
            </button>
            <IconButton icon={Search} label="Buscar" className="lg:hidden" onClick={() => setPaletteOpen(true)} />
            <SyncIndicator />
            <Notifications />
            <ThemeMenu />
            <UserMenu />
          </div>
        </header>
        {locations.length > 1 && <div className="flex items-center gap-2 border-b border-line px-3 py-2 md:hidden"><LocationSwitcher compact /></div>}
        <main className={cn(isPos && "min-h-0 flex-1")}>
          <RouteErrorBoundary resetKey={location.pathname}><Outlet /></RouteErrorBoundary>
        </main>
      </div>
      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
      {!isPos && <MobileTabBar onMore={() => setMobileOpen(true)} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
