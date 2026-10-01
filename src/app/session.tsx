import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Store } from "@/data/store";
import { createIndexedDbKV } from "@/data/persistence";
import type { Ctx } from "@/data/context";
import { roleCan, type Permission } from "@/domain/permissions";
import type { Member, UserAccount, Vertical } from "@/domain/types";
import * as auth from "@/data/repos/auth";
import { createDemoWorkspace } from "@/data/demo";

import { getPref, setPref } from "@/lib/localPrefs";

interface Persisted {
  userId: string;
  orgId?: string;
  locationId?: string;
}

function readSession(): Persisted | null {
  try {
    const raw = getPref("session");
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}
function writeSession(s: Persisted | null) {
  setPref("session", s ? JSON.stringify(s) : null);
}

interface SessionValue {
  store: Store;
  status: "loading" | "anon" | "no-org" | "ready";
  user: UserAccount | null;
  member: Member | null;
  memberships: Member[];
  /** 'all' = consolidado de todos los centros a los que se tiene acceso */
  locationId: string | "all";
  setLocationId: (id: string | "all") => void;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { fullName: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
  createOrganization: (input: { name: string; vertical: Vertical; locationName: string; legalName?: string; taxId?: string; city?: string }) => Promise<void>;
  createDemo: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  leaveOrganization: () => void;
  can: (p: Permission) => boolean;
  ctx: Ctx | null;
}

const SessionCtx = createContext<SessionValue | null>(null);
const store = new Store(createIndexedDbKV());

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [user, setUser] = useState<UserAccount | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [locationId, setLocationIdState] = useState<string | "all">("all");
  const version = useSyncExternalStore(store.subscribe, store.getVersion);

  const enterOrg = useCallback(async (u: UserAccount, orgId: string, preferredLocation?: string) => {
    const m = auth.membershipsOf(store, u.id).find((x) => x.organizationId === orgId);
    if (!m) throw new Error("No tienes acceso a esta empresa");
    const ws = await store.openWorkspace(orgId);
    const allowed = ws.locations.filter((l) => l.status === "active" && (!m.locationIds || m.locationIds.includes(l.id)));
    const loc = preferredLocation && (preferredLocation === "all" ? !m.locationIds && allowed.length > 1 : allowed.some((l) => l.id === preferredLocation))
      ? preferredLocation
      : allowed.length === 1 || m.locationIds ? allowed[0]?.id ?? "all" : "all";
    setMember(m);
    setLocationIdState(loc);
    setStatus("ready");
    writeSession({ userId: u.id, orgId, locationId: loc });
  }, []);

  useEffect(() => {
    (async () => {
      await store.init();
      const s = readSession();
      const u = s && store.getMeta().users.find((x) => x.id === s.userId);
      if (!u) return setStatus("anon");
      setUser(u);
      const ms = auth.membershipsOf(store, u.id);
      const orgId = s.orgId && ms.some((m) => m.organizationId === s.orgId) ? s.orgId : ms.length === 1 ? ms[0]!.organizationId : null;
      if (!orgId) return setStatus("no-org");
      try {
        await enterOrg(u, orgId, s.locationId);
      } catch {
        setStatus("no-org");
      }
    })();
  }, [enterOrg]);

  // Guardar a disco antes de cerrar la pestaña
  useEffect(() => {
    const h = () => void store.flush();
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, []);

  const value = useMemo<SessionValue>(() => {
    const memberships = user ? auth.membershipsOf(store, user.id) : [];
    const ctx: Ctx | null = user && member ? { store, user, role: member.role, locationIds: member.locationIds } : null;
    return {
      store,
      status,
      user,
      member,
      memberships,
      locationId,
      setLocationId: (id) => {
        setLocationIdState(id);
        if (user) writeSession({ userId: user.id, orgId: member?.organizationId, locationId: id });
      },
      login: async (email, password) => {
        const u = await auth.login(store, email, password);
        setUser(u);
        const ms = auth.membershipsOf(store, u.id);
        if (ms.length === 1) await enterOrg(u, ms[0]!.organizationId);
        else {
          writeSession({ userId: u.id });
          setStatus("no-org");
        }
      },
      register: async (input) => {
        const u = await auth.registerAccount(store, input);
        setUser(u);
        writeSession({ userId: u.id });
        setStatus("no-org");
      },
      logout: () => {
        void store.flush().then(() => store.closeWorkspace());
        writeSession(null);
        setUser(null);
        setMember(null);
        setStatus("anon");
      },
      createOrganization: async (input) => {
        if (!user) throw new Error("Sin sesión");
        const orgId = await auth.createOrganization(store, user, input);
        await enterOrg(user, orgId);
      },
      createDemo: async () => {
        if (!user) throw new Error("Sin sesión");
        const existing = store.getMeta().organizations.find((o) => o.isDemo && auth.membershipsOf(store, user.id).some((m) => m.organizationId === o.id));
        const orgId = existing?.id ?? (await createDemoWorkspace(store, user));
        await enterOrg(user, orgId);
      },
      switchOrganization: async (orgId) => {
        if (!user) return;
        await store.flush();
        await enterOrg(user, orgId);
      },
      leaveOrganization: () => {
        void store.flush().then(() => store.closeWorkspace());
        setMember(null);
        if (user) writeSession({ userId: user.id });
        setStatus("no-org");
      },
      can: (p) => !!member && roleCan(member.role, p),
      ctx,
    };
    // version: re-render cuando cambia el store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user, member, locationId, version, enterOrg]);

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
  return ws;
}

/** Contexto para repositorios (autor + rol + centros). */
export function useCtx(): Ctx {
  const s = useSession();
  if (!s.ctx) throw new Error("Sin sesión");
  return s.ctx;
}

/** Centros visibles para el usuario y filtro actual. */
export function useLocationScope() {
  const s = useSession();
  const ws = useWorkspace();
  const all = ws.locations.filter((l) => l.status === "active" && (!s.member?.locationIds || s.member.locationIds.includes(l.id)));
  const current = s.locationId === "all" ? null : all.find((l) => l.id === s.locationId) ?? null;
  return { locations: all, current, filterId: current?.id, setLocationId: s.setLocationId, canSeeAll: !s.member?.locationIds && all.length > 1 };
}
