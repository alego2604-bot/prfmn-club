import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Store } from "@/data/store";
import { createIndexedDbKV } from "@/data/persistence";
import type { Ctx } from "@/data/context";
import { can as roleCan, type Permission, type PermissionOverrides } from "@/domain/permissions";
import type { Member, RoleKey, UserAccount, Vertical } from "@/domain/types";
import * as localAuth from "@/data/repos/auth";
import { createDemoWorkspace, DEMO_ORGANIZATION, fillDemoWorkspace } from "@/data/demo";
import * as cloud from "@/data/cloud/account";
import { CloudSync, type SyncStatus } from "@/data/cloud/sync";
import { clearOrgFromUrl, readTabContext, writeTabContext, type TabContext } from "./tabContext";
import { liveTabs } from "@/data/cloud/tab";
import { workspaceFor } from "@/data/visibility";
import { resumeImports, type GroupSync } from "@/features/imports/engine/pipeline";

/**
 * Sesión de la app. Dos modos con la misma interfaz para las pantallas:
 *  - "cloud" (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY): Supabase Auth + PostgreSQL como fuente de verdad;
 *    IndexedDB solo como caché y cola offline (data/cloud/sync.ts).
 *  - "local" (sin variables): todo en este navegador. Desarrollo y demostraciones sin servidor.
 */
export type SessionUser = Pick<UserAccount, "id" | "email" | "fullName">;
export interface OrgSummary { id: string; name: string; isDemo: boolean; vertical: string }

// Contexto activo por pestaña (empresa + centro): ver tabContext.ts
const readSession = () => readTabContext();
const writeSession = (v: TabContext | null) => writeTabContext(v);

interface SessionValue {
  mode: "cloud" | "local";
  store: Store;
  status: "loading" | "anon" | "no-org" | "ready" | "error";
  bootError: string | null;
  user: SessionUser | null;
  member: Member | null;
  memberships: Member[];
  organizations: OrgSummary[];
  sync: SyncStatus | null;
  /** Envío por lotes agrupados (importaciones, demo). null en modo local. */
  groupSync: GroupSync | null;
  /** Pestaña actual (propietaria de las importaciones que lanza). */
  tabId: string | null;
  /** 'all' = consolidado de todos los centros a los que se tiene acceso */
  locationId: string | "all";
  setLocationId: (id: string | "all") => void;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { fullName: string; email: string; password: string }) => Promise<{ needsConfirmation: boolean }>;
  logout: () => Promise<void>;
  createOrganization: (input: { name: string; vertical: Vertical; locationName: string; legalName?: string; taxId?: string; city?: string }) => Promise<void>;
  createDemo: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  leaveOrganization: () => void;
  refresh: () => Promise<void>;
  retryBoot: () => void;
  addMember: (input: { fullName: string; email: string; password: string; role: RoleKey; locationIds: string[] | null }) => Promise<void>;
  updateMember: (memberId: string, patch: { role?: RoleKey; locationIds?: string[] | null; status?: Member["status"] }) => Promise<void>;
  /** Excepciones individuales (permitir/denegar permisos concretos) sobre el rol de un miembro. */
  setMemberOverrides: (memberId: string, overrides: PermissionOverrides) => Promise<void>;
  onSyncError: (l: (message: string) => void) => () => void;
  can: (p: Permission) => boolean;
  ctx: Ctx | null;
}

const SessionCtx = createContext<SessionValue | null>(null);
const kv = createIndexedDbKV();
const store = new Store(kv);
const cfg = cloud.cloudConfig();
const sb = cfg ? cloud.createCloudClient(cfg) : null;
const sync = sb ? new CloudSync(sb, kv, store) : null;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberships, setMemberships] = useState<Member[]>([]);
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [locationId, setLocationIdState] = useState<string | "all">("all");
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(sync?.status ?? null);
  const [bootKey, setBootKey] = useState(0);
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const openOrg = useRef<string | null>(null);

  useEffect(() => sync?.onStatus(setSyncStatus), []);

  const loadMemberships = useCallback(async (u: SessionUser) => {
    if (sb) {
      const r = await cloud.memberships(sb, u.id);
      setMemberships(r.members);
      setOrganizations(r.orgs);
      return r.members;
    }
    const ms = localAuth.membershipsOf(store, u.id);
    setMemberships(ms);
    setOrganizations(store.getMeta().organizations.filter((o) => ms.some((m) => m.organizationId === o.id)));
    return ms;
  }, []);

  const enterOrg = useCallback(async (u: SessionUser, ms: Member[], orgId: string, preferredLocation?: string) => {
    const m = ms.find((x) => x.organizationId === orgId);
    if (!m) throw new Error("No tienes acceso a esta empresa");
    if (sync) {
      // Cambio instantáneo: lo pendiente de la empresa anterior se sigue enviando en segundo plano
      if (openOrg.current && openOrg.current !== orgId) sync.release();
      await sync.open(orgId);
    } else {
      await store.openWorkspace(orgId);
    }
    openOrg.current = orgId;
    const ws = store.requireWorkspace();
    const allowed = ws.locations.filter((l) => l.status === "active" && (!m.locationIds || m.locationIds.includes(l.id)));
    const loc = preferredLocation && (preferredLocation === "all" ? !m.locationIds && allowed.length > 1 : allowed.some((l) => l.id === preferredLocation))
      ? preferredLocation
      : allowed.length === 1 || m.locationIds ? allowed[0]?.id ?? "all" : "all";
    setMember(m);
    setLocationIdState(loc);
    setStatus("ready");
    writeSession({ userId: u.id, orgId, locationId: loc });
    clearOrgFromUrl();
    // Importaciones que quedaron a medias (pestaña cerrada, conexión perdida): se reanudan o se cierran.
    // Siempre después de enviar la cola y descargar el estado real: nunca se juzga con una caché vieja.
    if (sync && roleCan(m.role, m.permissionOverrides, "imports.run")) {
      const resumeCtx: Ctx = { store, user: u, role: m.role, locationIds: m.locationIds, overrides: m.permissionOverrides };
      void (async () => {
        await sync.settle().catch(() => undefined);
        if (openOrg.current !== orgId) return;
        await resumeImports(resumeCtx, sync, await liveTabs());
      })().catch(() => undefined);
    }
  }, []);

  const afterLogin = useCallback(async (u: SessionUser, preferredOrg?: string, preferredLocation?: string) => {
    setUser(u);
    const ms = await loadMemberships(u);
    const orgId = preferredOrg && ms.some((m) => m.organizationId === preferredOrg) ? preferredOrg : ms.length === 1 ? ms[0]!.organizationId : null;
    if (!orgId) {
      writeSession({ userId: u.id });
      return setStatus("no-org");
    }
    await enterOrg(u, ms, orgId, preferredLocation);
  }, [enterOrg, loadMemberships]);

  // Arranque: sesión existente (Supabase Auth o local)
  useEffect(() => {
    (async () => {
      setBootError(null);
      try {
        await store.init();
        const s = readSession();
        const u = sb ? await cloud.currentUser(sb) : s && store.getMeta().users.find((x) => x.id === s.userId);
        if (!u) return setStatus("anon");
        await afterLogin(u, s?.userId === u.id ? s.orgId : undefined, s?.locationId);
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
  }, [afterLogin, bootKey]);

  // Guardar caché y enviar cambios pendientes al ocultar la pestaña; refrescar al volver
  useEffect(() => {
    const hide = () => {
      void store.flush();
      void sync?.flush();
    };
    const show = () => {
      if (document.visibilityState === "visible" && sync && openOrg.current) void sync.flush().then(() => sync.pull()).catch(() => undefined);
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", show);
    window.addEventListener("online", show);
    const timer = sync ? window.setInterval(show, 60_000) : 0;
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", show);
      window.removeEventListener("online", show);
      window.clearInterval(timer);
    };
  }, []);

  const value = useMemo<SessionValue>(() => {
    // El rol, las excepciones y el estado vigentes salen del equipo ya descargado (si cambian mientras la sesión está abierta,
    // la interfaz lo refleja en la siguiente sincronización); el servidor impone lo mismo en cada escritura.
    const ws0 = store.getWorkspace();
    const liveRow = member ? (sb ? ws0?.team?.find((t) => t.id === member.id) : store.getMeta().members.find((x) => x.id === member.id)) : undefined;
    const live: Member | null = member ? { ...member, ...(liveRow ? { role: liveRow.role, locationIds: liveRow.locationIds, status: liveRow.status, permissionOverrides: liveRow.permissionOverrides ?? member.permissionOverrides } : {}) } : null;
    const active = !!live && live.status === "active";
    const ctx: Ctx | null = user && live && active ? { store, user, role: live.role, locationIds: live.locationIds, overrides: live.permissionOverrides } : null;
    const requireUser = () => {
      if (!user) throw new Error("Sin sesión");
      return user;
    };
    return {
      mode: sb ? "cloud" : "local",
      store,
      status,
      bootError,
      user,
      member: live,
      memberships,
      organizations,
      sync: syncStatus,
      groupSync: sync,
      tabId: sync?.tabId ?? null,
      locationId,
      setLocationId: (id) => {
        setLocationIdState(id);
        if (user) writeSession({ userId: user.id, orgId: member?.organizationId, locationId: id });
      },
      login: async (email, password) => {
        const u = sb ? await cloud.signIn(sb, email, password) : await localAuth.login(store, email, password);
        const s = readSession();
        await afterLogin(u, s?.userId === u.id ? s.orgId : undefined, s?.locationId);
      },
      register: async (input) => {
        if (sb) {
          const r = await cloud.signUp(sb, input);
          if (r.needsConfirmation || !r.user) return { needsConfirmation: true };
          setUser(r.user);
          setMemberships([]);
          setOrganizations([]);
          writeSession({ userId: r.user.id });
          setStatus("no-org");
          return { needsConfirmation: false };
        }
        const u = await localAuth.registerAccount(store, input);
        setUser(u);
        setMemberships([]);
        setOrganizations([]);
        writeSession({ userId: u.id });
        setStatus("no-org");
        return { needsConfirmation: false };
      },
      logout: async () => {
        if (sync) {
          await sync.flush();
          if (sync.pending) throw new Error(`Hay ${sync.pending} cambio(s) sin guardar en el servidor. Comprueba la conexión antes de cerrar sesión.`);
          const orgId = openOrg.current;
          sync.close();
          await sb!.auth.signOut();
          // Privacidad en dispositivos compartidos: la caché local de la empresa se elimina al salir.
          if (orgId) await Promise.all([store.deleteWorkspace(orgId), sync.discardLocal(orgId)]);
        } else {
          await store.flush();
        }
        openOrg.current = null;
        writeSession(null);
        setUser(null);
        setMember(null);
        setMemberships([]);
        setOrganizations([]);
        setStatus("anon");
        store.closeWorkspace();
      },
      createOrganization: async (input) => {
        const u = requireUser();
        const orgId = sb ? await cloud.createOrganization(sb, input) : await localAuth.createOrganization(store, u as UserAccount, input);
        const ms = await loadMemberships(u);
        await enterOrg(u, ms, orgId);
        // Primera entrada en una empresa nueva: el resumen abre la puesta en marcha guiada
        try { sessionStorage.setItem("bos.welcome", orgId); } catch { /* modo privado */ }
      },
      createDemo: async () => {
        const u = requireUser();
        const existing = organizations.find((o) => o.isDemo);
        if (existing) return enterOrg(u, memberships, existing.id);
        if (sb && sync) {
          const orgId = await cloud.createOrganization(sb, DEMO_ORGANIZATION);
          const ms = await loadMemberships(u);
          await enterOrg(u, ms, orgId);
          sync.tagNext({ id: `demo:${orgId}`, label: "Preparando la empresa demo" });
          store.update((ws) => fillDemoWorkspace(ws, u.id));
          await sync.flush();
          await sync.pull();
          return;
        }
        const orgId = await createDemoWorkspace(store, u as UserAccount);
        const ms = await loadMemberships(u);
        await enterOrg(u, ms, orgId);
      },
      switchOrganization: async (orgId) => {
        const u = requireUser();
        await store.flush();
        await enterOrg(u, memberships, orgId);
      },
      leaveOrganization: () => {
        void store.flush();
        void sync?.flush();
        setMember(null);
        if (user) writeSession({ userId: user.id });
        setStatus("no-org");
      },
      refresh: async () => {
        if (sync && openOrg.current) {
          await sync.flush();
          await sync.pull();
        }
      },
      retryBoot: () => {
        setStatus("loading");
        setBootKey((k) => k + 1);
      },
      addMember: async (input) => {
        const orgId = member?.organizationId;
        if (!orgId) throw new Error("Sin empresa activa");
        if (sb && sync) {
          await cloud.addMemberByEmail(sb, orgId, input.email, input.role, input.locationIds);
          await sync.pull();
        } else {
          await localAuth.addTeamMember(ctx!, orgId, input);
        }
      },
      updateMember: async (memberId, patch) => {
        if (sb && sync) {
          await cloud.updateMember(sb, memberId, patch);
          await sync.pull();
        } else {
          await localAuth.updateMember(ctx!, memberId, patch);
        }
      },
      setMemberOverrides: async (memberId, overrides) => {
        if (sb && sync) {
          await cloud.setMemberOverrides(sb, memberId, overrides);
          await sync.pull();
        } else {
          await localAuth.setMemberOverrides(ctx!, memberId, overrides);
        }
      },
      onSyncError: (l) => sync?.onError(l) ?? (() => undefined),
      can: (p) => !!live && active && roleCan(live.role, live.permissionOverrides, p),
      ctx,
    };
    // version: re-render cuando cambia el store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, bootError, user, member, memberships, organizations, syncStatus, locationId, version, enterOrg, afterLogin, loadMemberships]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession fuera de SessionProvider");
  return v;
}

/** Workspace activo (re-renderiza en cada cambio). Solo usar dentro de rutas autenticadas. */
export function useWorkspace() {
  const s = useSession();
  const ws = s.store.getWorkspace();
  if (!ws) throw new Error("Sin empresa activa");
  // Importaciones no completadas fuera; sin customers.sensitive, sin datos fiscales/personales de clientes
  return workspaceFor(ws, s.can("customers.sensitive"));
}

/** Contexto para repositorios (autor + rol + centros). */
export function useCtx(): Ctx {
  const s = useSession();
  if (!s.ctx) throw new Error("Sin sesión");
  return s.ctx;
}

/** Nombre de una persona de la empresa (autor de ventas, notas, importaciones…). */
export function usePersonName(): (id?: string) => string {
  const s = useSession();
  const ws = s.store.getWorkspace();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const u of s.store.getMeta().users) names.set(u.id, u.fullName);
    for (const p of ws?.people ?? []) names.set(p.id, p.fullName);
    if (s.user) names.set(s.user.id, s.user.fullName);
    return (id?: string) => (id ? names.get(id) ?? "—" : "—");
  }, [s.store, s.user, ws?.people]);
}

/** Equipo de la empresa activa (Supabase: desde el servidor; local: desde este navegador). */
export function useTeam(): (Member & { fullName?: string; email?: string })[] {
  const s = useSession();
  const ws = useWorkspace();
  if (s.mode === "cloud") return ws.team ?? [];
  const users = s.store.getMeta().users;
  return s.store.getMeta().members
    .filter((m) => m.organizationId === ws.organization.id)
    .map((m) => ({ ...m, fullName: users.find((u) => u.id === m.userId)?.fullName, email: users.find((u) => u.id === m.userId)?.email }));
}

/** Centros visibles para el usuario y filtro actual. */
export function useLocationScope() {
  const s = useSession();
  const ws = useWorkspace();
  const all = ws.locations.filter((l) => l.status === "active" && (!s.member?.locationIds || s.member.locationIds.includes(l.id)));
  const current = s.locationId === "all" ? null : all.find((l) => l.id === s.locationId) ?? null;
  return { locations: all, current, filterId: current?.id, setLocationId: s.setLocationId, canSeeAll: !s.member?.locationIds && all.length > 1 };
}
