/**
 * Selector de empresa y de centro.
 *
 * Empresa: la activa es SIEMPRE visible (barra lateral, carril de iPad y cabecera en móvil). El cambio es por
 * pestaña (tabContext.ts): cambiar aquí no afecta a otras pestañas, y «Abrir en pestaña nueva» permite trabajar con
 * dos empresas a la vez. Centro: «Todos los centros» (consolidado) o uno; KPIs y tablas respetan el filtro.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Check, ChevronsUpDown, ExternalLink, FlaskConical, Layers, MapPin, Plus, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Menu, MenuLabel, useToast } from "@/design-system/components";
import { ROLE_LABELS } from "@/domain/permissions";
import { normalizeKey } from "@/lib/text";
import { useLocationScope, useSession, useWorkspace, type OrgSummary } from "./session";
import { urlForOrg } from "./tabContext";

export function OrgAvatar({ name, logo, size = 28, demo }: { name: string; logo?: string; size?: number; demo?: boolean }) {
  if (logo) return <img src={logo} alt="" className="shrink-0 rounded-md object-cover" style={{ width: size, height: size }} />;
  const letters = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-[-0.02em]", demo ? "bg-accent-soft text-accent-fg" : "bg-ink text-fg-inverse")}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden
    >
      {letters || "·"}
    </span>
  );
}

function OrgRow({ org, active, onSwitch, onNewTab }: { org: OrgSummary; active: boolean; onSwitch: () => void; onNewTab: () => void }) {
  return (
    <div className={cn("group flex items-center gap-1 rounded-md pr-1 transition-colors", active ? "bg-surface-sunken" : "hover:bg-surface-sunken")}>
      <button type="button" onClick={onSwitch} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left" aria-current={active ? "true" : undefined}>
        <OrgAvatar name={org.name} size={24} demo={org.isDemo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{org.name}</span>
          {org.isDemo && <span className="block text-2xs text-fg-3">Datos ficticios</span>}
        </span>
        {active && <Check className="h-3.5 w-3.5 shrink-0 text-fg" />}
      </button>
      {!active && (
        <button
          type="button"
          onClick={onNewTab}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-3 opacity-0 transition-opacity hover:bg-surface hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          title="Abrir en una pestaña nueva"
          aria-label={`Abrir ${org.name} en una pestaña nueva`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Selector de empresa. `variant="rail"`: solo el avatar (carril de iPad). */
export function CompanySwitcher({ variant = "full", onNavigate }: { variant?: "full" | "rail"; onNavigate?: () => void }) {
  const s = useSession();
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const orgs = s.organizations;
  const filtered = useMemo(() => {
    const k = normalizeKey(q);
    return k ? orgs.filter((o) => normalizeKey(o.name).includes(k)) : orgs;
  }, [orgs, q]);
  const current = ws.organization;
  const role = s.member ? ROLE_LABELS[s.member.role].name : "";

  const switchTo = async (o: OrgSummary, close: () => void) => {
    close();
    if (o.id === current.id) return;
    setSwitching(o.id);
    try {
      await s.switchOrganization(o.id);
      navigate("/");
      onNavigate?.();
      toast.success(`Ahora estás en ${o.name}`, "Solo en esta pestaña. Las demás pestañas mantienen su empresa.");
    } catch (e) {
      toast.fromError(e, "No se ha podido cambiar de empresa");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <Menu
      align="start"
      width={300}
      trigger={(open, toggle) =>
        variant === "rail" ? (
          <button onClick={toggle} className={cn("flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-surface-sunken", open && "bg-surface-sunken")} title={`${current.name} · cambiar de empresa`} aria-label={`Empresa activa: ${current.name}. Cambiar de empresa`} data-testid="company-switcher">
            <OrgAvatar name={current.name} logo={current.logoDataUrl} demo={current.isDemo} size={30} />
          </button>
        ) : (
          <button
            onClick={() => { toggle(); setTimeout(() => searchRef.current?.focus(), 30); }}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken", open && "bg-surface-sunken")}
            aria-label={`Empresa activa: ${current.name}. Cambiar de empresa`}
            data-testid="company-switcher"
          >
            <OrgAvatar name={current.name} logo={current.logoDataUrl} demo={current.isDemo} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight">{switching ? "Cambiando…" : current.name}</span>
              <span className="block truncate text-2xs text-fg-3">{role}{current.isDemo ? " · Demo" : ""}{orgs.length > 1 ? ` · ${orgs.length} empresas` : ""}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-3" />
          </button>
        )
      }
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col">
          {orgs.length > 4 && (
            <div className="relative mb-1 px-1 pt-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar empresa…"
                className="h-8 w-full rounded-md border border-line bg-surface-2 pl-8 pr-2 text-sm outline-none focus:border-line-strong"
                aria-label="Buscar empresa"
              />
            </div>
          )}
          <MenuLabel>Empresas{orgs.length > 1 ? ` · ${orgs.length}` : ""}</MenuLabel>
          <div className="scrollbar-thin -mx-1 overflow-y-auto px-1">
            {filtered.map((o) => (
              <OrgRow key={o.id} org={o} active={o.id === current.id} onSwitch={() => void switchTo(o, close)} onNewTab={() => { close(); window.open(urlForOrg(o.id), "_blank", "noopener"); }} />
            ))}
            {!filtered.length && <p className="px-2.5 py-3 text-sm text-fg-3">Ninguna empresa coincide con «{q}».</p>}
          </div>
          <div className="my-1 h-px bg-line" />
          <button type="button" onClick={() => { close(); onNavigate?.(); s.leaveOrganization(); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-sunken">
            <Plus className="h-4 w-4 text-fg-3" />Crear empresa o abrir la demo
          </button>
          {s.can("settings.manage") && (
            <button type="button" onClick={() => { close(); onNavigate?.(); navigate("/ajustes?tab=centros"); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-sunken">
              <Settings2 className="h-4 w-4 text-fg-3" />Gestionar centros
            </button>
          )}
          <p className="px-2.5 pb-1.5 pt-2 text-2xs leading-4 text-fg-3">El cambio solo afecta a esta pestaña. Puedes tener cada empresa abierta en una pestaña distinta.</p>
        </div>
      )}
    </Menu>
  );
}

/** Selector de centro: consolidado o un centro. */
export function LocationSwitcher({ compact }: { compact?: boolean }) {
  const { locations, current, setLocationId, canSeeAll } = useLocationScope();
  const toast = useToast();
  if (locations.length <= 1) {
    return locations[0] ? (
      <span className="hidden h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-2 md:inline-flex" title="Centro">
        <MapPin className="h-3.5 w-3.5 text-fg-3" />{locations[0].name}
      </span>
    ) : null;
  }
  const label = current?.name ?? "Todos los centros";
  return (
    <Menu
      width={240}
      align="start"
      trigger={(open, toggle) => (
        <button
          onClick={toggle}
          className={cn("inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors", open ? "border-line-strong bg-surface" : "border-line bg-surface/60 hover:border-line-strong hover:bg-surface")}
          aria-label={`Centro: ${label}. Cambiar de centro`}
          data-testid="location-switcher"
        >
          {current ? <MapPin className="h-3.5 w-3.5 shrink-0 text-fg-3" /> : <Layers className="h-3.5 w-3.5 shrink-0 text-fg-3" />}
          <span className={cn("truncate", compact && "max-w-[110px]")}>{label}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-fg-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Centro</MenuLabel>
          {canSeeAll && (
            <button type="button" onClick={() => { setLocationId("all"); close(); toast.info("Todos los centros", "Cifras consolidadas de la empresa."); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-sunken">
              <Layers className="h-4 w-4 text-fg-3" />
              <span className="flex-1">Todos los centros</span>
              <span className="text-2xs text-fg-3 num">{locations.length}</span>
              {!current && <Check className="h-3.5 w-3.5" />}
            </button>
          )}
          {locations.map((l) => (
            <button key={l.id} type="button" onClick={() => { setLocationId(l.id); close(); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-sunken">
              <Building2 className="h-4 w-4 text-fg-3" />
              <span className="flex-1 truncate">{l.name}</span>
              {current?.id === l.id && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

export function DemoMark() {
  return <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-2xs font-semibold text-accent-fg"><FlaskConical className="h-3 w-3" />Demo</span>;
}
