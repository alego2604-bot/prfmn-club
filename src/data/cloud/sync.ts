/**
 * Sincronización con Supabase (fuente de verdad).
 *
 * Las pantallas y los repositorios no cambian: siguen escribiendo con `store.update()`, que es síncrono e
 * instantáneo. Cada escritura produce un LOTE (diferencia entre el estado anterior y el nuevo) que se guarda
 * en una cola persistente (IndexedDB) y se envía a `public.sync_push`, que lo aplica en UNA transacción con
 * RLS, triggers de integridad y auditoría. Si el servidor lo rechaza (permiso, regla de negocio…), se descarta,
 * se avisa al usuario y se recarga el estado real desde el servidor. Si no hay red, se reintenta.
 *
 * IndexedDB queda solo como caché (arranque instantáneo) y cola offline: nunca como base de datos principal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, Member, Organization, PaymentMethod, RoleKey } from "@/domain/types";
import { uid } from "@/lib/ids";
import type { KV } from "../persistence";
import { liveTabs as defaultLiveTabs, tabId as defaultTabId } from "./tab";
import { SCHEMA_VERSION, Store, type Workspace } from "../store";
import {
  auditFromRow, COLLECTIONS, DELETABLE, entityToRow, SCHEMA_900_TABLES, organizationFromRow, organizationPatch, paymentFromRow, rowToEntity, SERVER_OWNED,
  settingsFromRow, settingsToRow, type CollectionKey, type Row,
} from "./mapping";

export interface Op {
  table: string;
  op: "insert" | "update" | "delete" | "set_modules";
  rows: Row[];
}
/** Lotes que forman una única operación lógica (importación, demo…): progreso, espera y cancelación conjuntos. */
export interface BatchGroup {
  id: string;
  label: string;
  index: number;
  total: number;
}
export interface Batch {
  id: string;
  orgId: string;
  createdAt: string;
  ops: Op[];
  audit: Record<string, { action: string; label?: string; context?: unknown }>;
  group?: BatchGroup;
}
type BatchBody = Omit<Batch, "id" | "createdAt" | "group">;

// ---------------------------------------------------------------------------------------------------------------------
// Troceo de lotes grandes
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Límites por envío. `sync_push` corre con el statement_timeout de los usuarios (8 s en Supabase) e incluye triggers
 * de auditoría, stock e integridad por fila: un lote de miles de filas (demo, Excel grande) lo supera. Con estos
 * límites cada envío tarda < 1-2 s en staging; si aun así uno expira, se divide en dos y se reintenta.
 */
export const CHUNK_MAX_ROWS = 300;
export const CHUNK_MAX_BYTES = 300_000;

export const batchRows = (b: Pick<Batch, "ops">) => b.ops.reduce((n, o) => n + o.rows.length, 0);

/**
 * Divide un lote en trozos que respetan el orden de las operaciones (y por tanto las dependencias FK: cada trozo
 * se confirma antes de enviar el siguiente). La auditoría de cada entidad viaja con el trozo que contiene su fila.
 */
export function splitBatch(b: BatchBody, maxRows = CHUNK_MAX_ROWS, maxBytes = CHUNK_MAX_BYTES): BatchBody[] {
  const chunks: Op[][] = [];
  let cur: Op[] = [];
  let rows = 0;
  let bytes = 0;
  const close = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
    rows = 0;
    bytes = 0;
  };
  for (const op of b.ops) {
    for (const row of op.rows) {
      const size = JSON.stringify(row).length;
      if (rows > 0 && (rows + 1 > maxRows || bytes + size > maxBytes)) close();
      const last = cur[cur.length - 1];
      if (last && last.table === op.table && last.op === op.op) last.rows.push(row);
      else cur.push({ table: op.table, op: op.op, rows: [row] });
      rows++;
      bytes += size;
    }
  }
  close();
  if (chunks.length <= 1) return [b];
  const placed = new Set<string>();
  const out = chunks.map((ops) => {
    const ids = new Set(ops.flatMap((o) => o.rows.map((r) => String(r.id ?? ""))));
    const audit: Batch["audit"] = {};
    for (const [id, a] of Object.entries(b.audit)) if (ids.has(id)) { audit[id] = a; placed.add(id); }
    return { orgId: b.orgId, ops, audit };
  });
  for (const [id, a] of Object.entries(b.audit)) if (!placed.has(id)) out[0]!.audit[id] = a;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Diferencias
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Tablas con índice único parcial «solo uno vigente» (versión de tarifa vigente, IVA por defecto, caja abierta, cierre
 * vigente). `sync_push` aplica las filas en orden y PostgreSQL comprueba el índice fila a fila: la fila que libera el
 * hueco debe llegar antes que la que lo ocupa (cambiar el precio de una tarifa = cerrar la versión vieja + insertar la nueva).
 */
const RELEASES: Partial<Record<string, (r: Row) => boolean>> = {
  membership_plan_versions: (r) => r.valid_to != null,
  tax_rates: (r) => r.is_default === false || (r.status != null && r.status !== "active"),
  cash_sessions: (r) => r.status != null && r.status !== "open",
  cash_closings: (r) => r.superseded_at != null,
};

export function diffWorkspaces(prev: Workspace, next: Workspace): Omit<Batch, "id" | "createdAt"> | null {
  const orgId = next.organization.id;
  const ops: Op[] = [];

  if (prev.organization !== next.organization) {
    const p = organizationPatch(prev.organization, next.organization);
    if (p.org) ops.push({ table: "organizations", op: "update", rows: [{ id: orgId, ...p.org }] });
    if (p.modules !== null) ops.push({ table: "organization_modules", op: "set_modules", rows: [{ module: "fitness", enabled: p.modules }] });
  }
  if (prev.settings !== next.settings && JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) {
    ops.push({ table: "organization_settings", op: "update", rows: [{ organization_id: orgId, ...settingsToRow(next.settings) }] });
  }

  const updates: Op[] = [];
  const deletes: Op[] = [];
  for (const [key, table] of COLLECTIONS) {
    const a = prev[key] as { id: string }[];
    const b = next[key] as { id: string }[];
    if (a === b) continue;
    const before = new Map(a.map((e) => [e.id, e]));
    const inserted: Row[] = [];
    const updated: Row[] = [];
    for (const e of b) {
      const old = before.get(e.id);
      if (!old) {
        inserted.push(entityToRow(key, e));
        continue;
      }
      if (old === e) continue;
      const ro = entityToRow(key, old);
      const rn = entityToRow(key, e);
      const owned = SERVER_OWNED[key] ?? [];
      const changed: Row = {};
      for (const k of new Set([...Object.keys(ro), ...Object.keys(rn)])) {
        if (owned.includes(k) || k === "raw") continue;
        if (JSON.stringify(ro[k] ?? null) !== JSON.stringify(rn[k] ?? null)) changed[k] = rn[k] ?? null;
      }
      const keys = Object.keys(changed);
      if (!keys.length) continue;
      // Stock derivado de ventas: lo calcula el servidor (trigger), no se envía como edición del producto.
      if (key === "products" && keys.every((k) => k === "stock_quantity")) continue;
      updated.push({ id: e.id, ...changed });
    }
    const release = RELEASES[table];
    const early = release ? updated.filter(release) : [];
    const late = release ? updated.filter((r) => !release(r)) : updated;
    if (early.length) ops.push({ table, op: "update", rows: early });
    if (inserted.length) ops.push({ table, op: "insert", rows: inserted });
    if (late.length) updates.push({ table, op: "update", rows: late });
    if (DELETABLE[key]) {
      const kept = new Set(b.map((e) => e.id));
      const removed = a.filter((e) => !kept.has(e.id)).map((e) => ({ id: e.id }));
      if (removed.length) deletes.push({ table, op: "delete", rows: removed });
    }
  }
  ops.push(...updates, ...deletes);
  if (!ops.length) return null;

  const known = new Set(prev.auditLogs.map((l) => l.id));
  const audit: Batch["audit"] = {};
  for (const l of next.auditLogs) {
    if (known.has(l.id) || !l.entityId) continue;
    audit[l.entityId] = { action: l.action, label: l.entityLabel, context: l.context };
  }
  return { orgId, ops, audit };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura completa de una empresa
// ---------------------------------------------------------------------------------------------------------------------
const PAGE = 1000;

async function fetchAll(sb: SupabaseClient, table: string, orgId: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").eq("organization_id", orgId).order("id").range(from, from + PAGE - 1);
    if (error) throw new CloudError(error.message, error.code);
    out.push(...(data as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Versión del esquema del servidor: 900+ con `server_capabilities()`; 810 si la función aún no existe. */
async function serverSchema(sb: SupabaseClient): Promise<number> {
  try {
    const caps = await sb.rpc("server_capabilities");
    return caps.error ? 810 : Number((caps.data as { schema?: number } | null)?.schema ?? 810);
  } catch {
    return 810;
  }
}

export interface Person { id: string; fullName: string }
export interface TeamMember extends Member { fullName?: string; email?: string }

export async function pullWorkspace(sb: SupabaseClient, orgId: string): Promise<Workspace> {
  const [orgRes, modRes, setRes] = await Promise.all([
    sb.from("organizations").select("*").eq("id", orgId).single(),
    sb.from("organization_modules").select("module_key, enabled").eq("organization_id", orgId),
    sb.from("organization_settings").select("*").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (orgRes.error) throw new CloudError(orgRes.error.message, orgRes.error.code);
  const organization: Organization = organizationFromRow(orgRes.data as Row, (modRes.data ?? []) as { module_key: string; enabled: boolean }[]);

  const schema = await serverSchema(sb);
  // Las tablas de 0900 ya existían (lectura con RLS) en servidores anteriores: se leen siempre que se pueda
  const results = await Promise.all(COLLECTIONS.map(([, table]) => fetchAll(sb, table, orgId).catch((e) => {
    if (SCHEMA_900_TABLES.has(table) && schema < 900) return [] as Row[];
    throw e;
  })));
  const [prices, audit, team, people] = await Promise.all([
    fetchAll(sb, "product_prices", orgId),
    sb.from("audit_logs").select("*").eq("organization_id", orgId).order("id", { ascending: false }).limit(1000),
    sb.from("organization_members").select("id, organization_id, user_id, location_ids, status, created_at, invited_email, roles(key)").eq("organization_id", orgId),
    sb.from("profiles").select("id, full_name"),
  ]);

  const ws = {} as Record<CollectionKey, unknown[]>;
  let methods: PaymentMethod[] = [];
  COLLECTIONS.forEach(([key], i) => {
    const rows = results[i]!;
    if (key === "paymentMethods") methods = rows.map((r) => rowToEntity<PaymentMethod>("paymentMethods", r));
  });
  COLLECTIONS.forEach(([key], i) => {
    const rows = results[i]!;
    ws[key] = key === "payments" ? rows.map((r) => paymentFromRow(r, methods)) : rows.map((r) => rowToEntity(key, r));
  });

  const names = new Map(((people.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Usuario"]));
  const sales = ws.sales as { number: number; occurredAt: string }[];
  const byDate = <T extends Record<string, unknown>>(arr: T[], k: string) => arr.sort((x, y) => String(x[k] ?? "").localeCompare(String(y[k] ?? "")));

  return {
    schemaVersion: SCHEMA_VERSION,
    organization,
    settings: setRes.data ? settingsFromRow(setRes.data as Row) : { organizationId: orgId, activityRules: [], renewalNoticeDays: 7, requireCashSession: true },
    ...(ws as unknown as Pick<Workspace, CollectionKey>),
    sales: byDate(ws.sales as Record<string, unknown>[], "occurredAt") as unknown as Workspace["sales"],
    productPrices: prices.map((r) => rowToEntity<Workspace["productPrices"][number]>("products", r)),
    auditLogs: ((audit.data ?? []) as Row[]).map((r) => auditFromRow(r, names)).reverse() as AuditLog[],
    counters: { sale: sales.reduce((m, s) => Math.max(m, s.number ?? 0), 0) },
    people: [...names].map(([id, fullName]) => ({ id, fullName })),
    server: { schema },
    team: ((team.data ?? []) as unknown as (Row & { roles: { key: string } | null })[]).map((m) => ({
      id: String(m.id), organizationId: String(m.organization_id), userId: String(m.user_id), role: (m.roles?.key ?? "read_only") as RoleKey,
      locationIds: (m.location_ids as string[] | null) ?? null, status: m.status as Member["status"], createdAt: String(m.created_at),
      fullName: names.get(String(m.user_id)), email: (m.invited_email as string | null) ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cola y envío
// ---------------------------------------------------------------------------------------------------------------------
export class CloudError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "CloudError";
  }
}

/** Error de red/servidor transitorio (se reintenta) frente a un rechazo de negocio o permisos (no). */
function isTransient(error: { code?: string; message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  // 40P01 interbloqueo y 40001 serialización: PostgreSQL aborta la transacción entera; reenviarla es seguro (antes se
  // trataban como rechazo definitivo y se descartaba el resto del grupo)
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST")) return ["57P01", "53300", "08006", "40P01", "40001"].includes(code);
  return true;
}

export type SyncState = "idle" | "syncing" | "offline" | "error";
export interface SyncProgress {
  groupId: string;
  label: string;
  done: number;
  total: number;
  /** Tablas del próximo trozo del grupo (permite contar en qué fase va una operación larga). */
  tables: string[];
}
export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt?: string;
  error?: string;
  /** Operación larga en curso (importación, demo): trozos confirmados de los totales. */
  progress?: SyncProgress;
}
export type GroupEvent = { groupId: string; state: "done" } | { groupId: string; state: "failed"; error: string } | { groupId: string; state: "cancelled" };

/** Cola de cambios pendientes: una por empresa y pestaña (`outbox:<org>` es el formato anterior, sin pestaña). */
export const outboxPrefix = (orgId: string) => `outbox:${orgId}`;
const outboxKey = (orgId: string, tab: string) => `${outboxPrefix(orgId)}:${tab}`;
/**
 * Lotes enviados cuya confirmación aún no se ha guardado en la cola (respuesta en camino, perdida o pestaña cerrada
 * justo después de que el servidor los aplicara). Al reabrir, esos lotes se comprueban ANTES de reenviarlos en vez
 * de chocar con la clave primaria (409). La idempotencia del servidor sigue siendo la última barrera.
 */
export const inflightPrefix = (orgId: string) => `inflight:${orgId}`;
const inflightKey = (orgId: string, tab: string) => `${inflightPrefix(orgId)}:${tab}`;

interface SyncOptions {
  /** Id de la pestaña (por defecto, el de data/cloud/tab). */
  tabId?: () => Promise<string>;
  /** Pestañas vivas, para adoptar colas huérfanas de pestañas cerradas (null = no se puede saber). */
  liveTabs?: () => Promise<Set<string> | null>;
}

export class CloudSync {
  private outbox: Batch[] = [];
  private orgId: string | null = null;
  private tab: string | null = null;
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  /** Escrituras locales encoladas: una descarga iniciada antes de la última es una foto vieja. */
  private writes = 0;
  /** Trozos confirmados por el servidor: si alguno se confirma durante una descarga, la foto puede ser anterior. */
  private acks = 0;
  /** Grupo al que pertenecerá el próximo lote encolado (importación, demo…). */
  private nextGroup: { id: string; label: string } | null = null;
  private cancelled = new Set<string>();
  private waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }[]>();
  /** Lotes que pudieron aplicarse sin que llegara (o se guardara) la confirmación: se comprueban antes de reenviar. */
  private maybeApplied = new Set<string>();
  private inflight = new Set<string>();
  /** Descarga en curso (una sola a la vez por empresa: la de la demo y la del temporizador coincidían). */
  private pulling: { orgId: string; p: Promise<void> } | null = null;
  /** Hubo una escritura mientras el bucle de envío terminaba: se relanza al acabar (si no, esperaría al próximo aviso). */
  private kick = false;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private groupListeners = new Set<(e: GroupEvent) => void>();
  /** Empresas que se dejaron con cambios pendientes: se siguen enviando en segundo plano. */
  private drainers = new Map<string, { sync: CloudSync; done: Promise<void> }>();
  status: SyncStatus = { state: "idle", pending: 0 };

  constructor(private sb: SupabaseClient, private kv: KV, readonly store: Store, private opts: SyncOptions = {}) {
    store.onCommit = (prev, next) => this.enqueue(prev, next);
  }

  onStatus(l: (s: SyncStatus) => void) { this.statusListeners.add(l); return () => void this.statusListeners.delete(l); }
  onError(l: (m: string) => void) { this.errorListeners.add(l); return () => void this.errorListeners.delete(l); }
  onGroup(l: (e: GroupEvent) => void) { this.groupListeners.add(l); return () => void this.groupListeners.delete(l); }

  private progress(): SyncProgress | undefined {
    const g = this.outbox[0]?.group;
    if (!g) return undefined;
    const mine = this.outbox.filter((b) => b.group?.id === g.id);
    return { groupId: g.id, label: g.label, done: g.total - mine.length, total: g.total, tables: mine[0]!.ops.map((o) => o.table) };
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, pending: this.outbox.length, ...patch, progress: this.progress() };
    for (const l of this.statusListeners) l(this.status);
  }

  /** Abre una empresa: caché inmediata si existe, cola pendiente enviada y estado real descargado. */
  async open(orgId: string): Promise<void> {
    // Si esta empresa se estaba vaciando en segundo plano, se recupera su cola (sin envíos dobles)
    const drainer = this.drainers.get(orgId);
    if (drainer) {
      await drainer.sync.stop();
      this.drainers.delete(orgId);
    }
    // Nada de la empresa anterior puede escribirse con la clave de esta: cola vacía hasta cargar la suya
    this.orgId = null;
    this.outbox = [];
    this.tab = await (this.opts.tabId ?? defaultTabId)();
    this.outbox = await this.loadOutbox(orgId);
    this.maybeApplied = await this.loadInflight(orgId);
    this.inflight = new Set(this.maybeApplied);
    this.orgId = orgId;
    let cached = false;
    try {
      await this.store.openWorkspace(orgId);
      cached = true;
    } catch {
      /* sin caché en este dispositivo */
    }
    const refresh = async () => {
      await this.flush();
      if (!this.outbox.length) await this.pull();
    };
    if (cached) void refresh().catch((e) => this.setStatus({ state: isTransient(e) ? "offline" : "error", error: String(e?.message ?? e) }));
    else await refresh();
  }

  /**
   * Cola de esta pestaña + colas huérfanas (pestañas cerradas con cambios sin enviar, o el formato anterior sin
   * pestaña). Las colas de otras pestañas vivas no se tocan: cada una envía lo suyo.
   */
  private async loadOutbox(orgId: string): Promise<Batch[]> {
    const own = outboxKey(orgId, this.tab!);
    const mine = (await this.kv.get<Batch[]>(own)) ?? [];
    const prefix = outboxPrefix(orgId);
    const others = (await this.kv.keys()).filter((k) => k !== own && (k === prefix || k.startsWith(`${prefix}:`)));
    if (!others.length) return mine;
    const live = await (this.opts.liveTabs ?? defaultLiveTabs)();
    const adopted: Batch[] = [];
    const adoptedKeys: string[] = [];
    for (const k of others) {
      const tab = k.slice(prefix.length + 1);
      const orphan = k === prefix || (live !== null && !live.has(tab));
      if (!orphan) continue;
      adopted.push(...((await this.kv.get<Batch[]>(k)) ?? []));
      adoptedKeys.push(k);
      if (k !== prefix) {
        const ik = inflightKey(orgId, tab);
        const marks = (await this.kv.get<string[]>(ik)) ?? [];
        if (marks.length) await this.kv.set(inflightKey(orgId, this.tab!), [...((await this.kv.get<string[]>(inflightKey(orgId, this.tab!))) ?? []), ...marks]);
        await this.kv.del(ik);
      }
    }
    if (!adopted.length && !adoptedKeys.length) return mine;
    // Orden de creación (estable: los trozos de un mismo grupo comparten fecha y conservan su orden)
    const merged = [...adopted, ...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    await this.kv.set(own, merged);
    for (const k of adoptedKeys) await this.kv.del(k);
    return merged;
  }

  /** Marcas «en vuelo» de esta pestaña que siguen en la cola (las demás ya se confirmaron). */
  private async loadInflight(orgId: string): Promise<Set<string>> {
    const marks = (await this.kv.get<string[]>(inflightKey(orgId, this.tab!))) ?? [];
    const queued = new Set(this.outbox.map((b) => b.id));
    return new Set(marks.filter((id) => queued.has(id)));
  }

  private saveInflight() {
    return this.orgId && this.tab ? this.kv.set(inflightKey(this.orgId, this.tab), [...this.inflight]) : Promise.resolve();
  }

  close() {
    this.orgId = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Detiene el envío tras el lote en curso (que siempre termina y queda confirmado o en la cola). */
  async stop(): Promise<void> {
    const inflight = this.flushing;
    this.close();
    if (inflight) await inflight.catch(() => undefined);
  }

  /**
   * Deja la empresa actual SIN esperar a que se envíe lo pendiente (cambiar de empresa es instantáneo). Lo pendiente
   * sigue enviándose en segundo plano con la misma cola de esta pestaña; si se vuelve a abrir la empresa, `open` lo
   * recupera. Los errores se siguen notificando.
   */
  release(): void {
    const org = this.orgId;
    if (!org || !this.tab) return this.close();
    const inflight = this.flushing ?? Promise.resolve();
    const pending = this.outbox.length > 0;
    this.close();
    if (!pending) return;
    const tab = this.tab;
    const d = new CloudSync(this.sb, this.kv, new Store(this.kv), { ...this.opts, tabId: async () => tab });
    d.store.onCommit = null;
    d.onError((m) => this.errorListeners.forEach((l) => l(m)));
    const done = (async () => {
      await inflight.catch(() => undefined);
      d.orgId = org;
      d.tab = tab;
      d.outbox = (await this.kv.get<Batch[]>(outboxKey(org, tab))) ?? [];
      d.maybeApplied = await d.loadInflight(org);
      d.inflight = new Set(d.maybeApplied);
      await d.flush();
    })().finally(() => {
      if (!d.pending && this.drainers.get(org)?.sync === d) this.drainers.delete(org);
    });
    this.drainers.set(org, { sync: d, done });
  }

  /** Elimina la caché local de cambios de una empresa (al cerrar sesión, tras comprobar que no queda nada). */
  async discardLocal(orgId: string): Promise<void> {
    const prefix = outboxPrefix(orgId);
    const iprefix = inflightPrefix(orgId);
    for (const k of await this.kv.keys()) if (k === prefix || k.startsWith(`${prefix}:`) || k.startsWith(`${iprefix}:`)) await this.kv.del(k);
  }

  /** Descarga el estado real (no pisa cambios locales aún no enviados ni hechos durante la descarga). */
  pull(): Promise<void> {
    const orgId = this.orgId;
    if (!orgId) return Promise.resolve();
    if (this.pulling?.orgId === orgId) return this.pulling.p;
    const p = this.pullOnce().finally(() => {
      if (this.pulling?.p === p) this.pulling = null;
    });
    this.pulling = { orgId, p };
    return p;
  }

  private async pullOnce(): Promise<void> {
    const orgId = this.orgId;
    if (!orgId) return;
    this.setStatus({ state: "syncing" });
    const writes = this.writes;
    const acks = this.acks;
    const ws = await pullWorkspace(this.sb, orgId);
    if (this.orgId !== orgId) return;
    if (this.outbox.length) return this.setStatus({ state: "idle" });
    // Una escritura hecha o confirmada mientras se descargaba: la foto puede no incluirla. Se vuelve a pedir.
    if (this.writes !== writes || this.acks !== acks) return this.pullOnce();
    this.store.setWorkspace(ws);
    this.setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: undefined });
  }

  /**
   * Agrupa la próxima escritura (p. ej. `store.update` de una importación) bajo un id: sus trozos comparten
   * progreso, se pueden esperar con `waitGroup` y cancelar con `cancelGroup`.
   */
  tagNext(group: { id: string; label: string }) {
    this.nextGroup = group;
  }

  private enqueue(prev: Workspace, next: Workspace) {
    const d = diffWorkspaces(prev, next);
    const tag = this.nextGroup;
    this.nextGroup = null;
    if (!d) {
      if (tag) queueMicrotask(() => this.settleGroup(tag.id, { groupId: tag.id, state: "done" }));
      return;
    }
    this.writes++;
    const createdAt = new Date().toISOString();
    const parts = splitBatch(d);
    const groupId = tag?.id ?? (parts.length > 1 ? uid() : undefined);
    const label = tag?.label ?? "Guardando cambios";
    parts.forEach((p, index) => {
      this.outbox.push({ ...p, id: uid(), createdAt, group: groupId ? { id: groupId, label, index, total: parts.length } : undefined });
    });
    this.setStatus({});
    void this.persist().then(() => {
      if (this.flushing) this.kick = true;
      return this.flush();
    });
  }

  private persist() {
    return this.orgId && this.tab ? this.kv.set(outboxKey(this.orgId, this.tab), this.outbox) : Promise.resolve();
  }

  get pending() {
    return this.outbox.length;
  }

  /** Pestaña propietaria de la cola (disponible tras `open`). */
  get tabId(): string | null {
    return this.tab;
  }

  /** Envía lo pendiente y, si no queda nada, descarga el estado real del servidor. */
  async settle(): Promise<void> {
    await this.flush();
    if (!this.outbox.length) await this.pull();
  }

  /** ¿Quedan trozos del grupo por enviar? */
  hasGroup(groupId: string): boolean {
    return this.outbox.some((b) => b.group?.id === groupId);
  }

  /** Resuelve cuando todos los trozos del grupo están confirmados; rechaza si el servidor rechaza alguno o se cancela. */
  waitGroup(groupId: string): Promise<void> {
    if (!this.hasGroup(groupId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(groupId) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(groupId, list);
    });
  }

  /**
   * Cancela los trozos de un grupo que aún no se han enviado. Lo ya confirmado queda en el servidor identificado
   * por el grupo (p. ej. `import_id`) para poder limpiarlo. Devuelve cuántos trozos se descartaron.
   */
  async cancelGroup(groupId: string): Promise<number> {
    this.cancelled.add(groupId);
    // El trozo en vuelo (si lo hay) termina; el resto se descarta
    if (this.flushing) await this.flushing.catch(() => undefined);
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((b) => b.group?.id !== groupId);
    const dropped = before - this.outbox.length;
    await this.persist();
    this.cancelled.delete(groupId);
    this.settleGroup(groupId, { groupId, state: "cancelled" });
    this.setStatus({});
    return dropped;
  }

  private settleGroup(groupId: string, e: GroupEvent) {
    const list = this.waiters.get(groupId) ?? [];
    this.waiters.delete(groupId);
    for (const w of list) {
      if (e.state === "done") w.resolve();
      else w.reject(new CloudError(e.state === "failed" ? e.error : "Operación cancelada", e.state === "cancelled" ? "CANCELLED" : undefined));
    }
    for (const l of this.groupListeners) l(e);
  }

  /** Envía la cola en orden. Resuelve cuando está vacía o cuando no hay conexión. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = async () => {
      while (this.outbox.length && this.orgId) {
        const batch = this.outbox[0]!;
        if (batch.group && this.cancelled.has(batch.group.id)) return; // cancelGroup lo retira
        this.setStatus({ state: "syncing" });
        // Pudo aplicarse sin que llegara la confirmación: se mira qué existe antes de reenviar (evita el 409)
        if (this.maybeApplied.has(batch.id)) {
          this.maybeApplied.delete(batch.id);
          const pruned = await this.pruneExisting(batch).catch(() => null);
          if (pruned === "done") {
            await this.confirm(batch, []);
            continue;
          }
          if (pruned) {
            this.outbox[0] = pruned;
            await this.persist();
          }
        }
        await this.markInflight([batch.id]);
        const { data, error } = await this.sb.rpc("sync_push", { p_org: batch.orgId, p_batch: { ops: batch.ops, audit: batch.audit } });
        if (error) {
          // Reintento tras una respuesta perdida: el trozo ya entró. Se quitan las filas existentes y se reenvía el resto.
          if (error.code === "23505") {
            const pruned = await this.pruneExisting(batch).catch(() => null);
            if (pruned === "done") {
              await this.confirm(batch, []);
              continue;
            }
            if (pruned) {
              this.outbox[0] = pruned;
              await this.persist();
              continue;
            }
          }
          // Trozo demasiado lento para el statement_timeout: se divide en dos y se reintenta
          if (error.code === "57014" && batchRows(batch) > 20) {
            const halves = splitBatch(batch, Math.ceil(batchRows(batch) / 2), Number.MAX_SAFE_INTEGER);
            this.outbox.splice(0, 1, ...halves.map((h, i) => ({ ...h, id: i === 0 ? batch.id : uid(), createdAt: batch.createdAt, group: batch.group })));
            this.regroup(batch.group?.id, halves.length - 1);
            await this.persist();
            await this.clearInflight([batch.id]); // rechazado entero: no se aplicó nada
            continue;
          }
          if (isTransient(error)) {
            // La respuesta pudo perderse después de aplicarse: el próximo intento comprueba primero
            if (batch.ops.some((o) => o.op === "insert")) this.maybeApplied.add(batch.id);
            this.setStatus({ state: "offline", error: error.message });
            this.scheduleRetry();
            return;
          }
          // Rechazo de negocio o permisos: se descarta el trozo (y el resto de su grupo, que depende de él)
          const groupId = batch.group?.id;
          this.outbox = this.outbox.filter((b, i) => i !== 0 && (!groupId || b.group?.id !== groupId));
          await this.persist();
          await this.clearInflight([batch.id]);
          this.setStatus({ state: "error", error: error.message });
          if (groupId) this.settleGroup(groupId, { groupId, state: "failed", error: humanize(error.message) });
          for (const l of this.errorListeners) l(humanize(error.message));
          await this.pull().catch(() => undefined);
          continue;
        }
        await this.confirm(batch, data as { table: string; rows: Row[] }[]);
      }
    };
    // .finally() se ejecuta siempre después de la asignación (aunque la cola esté vacía y run() termine en el acto)
    const p = run().finally(() => {
      if (this.flushing === p) this.flushing = null;
      // Sin red (reintento programado) no se relanza: lo hará el temporizador
      if (this.kick && !this.flushing && this.outbox.length && this.orgId && !this.retryTimer) {
        this.kick = false;
        void this.flush();
      }
    });
    this.flushing = p;
    return p;
  }

  private async markInflight(ids: string[]) {
    for (const id of ids) this.inflight.add(id);
    await this.saveInflight();
  }

  private async clearInflight(ids: string[]) {
    let changed = false;
    for (const id of ids) changed = this.inflight.delete(id) || changed;
    if (changed) await this.saveInflight();
  }

  private async confirm(batch: Batch, result: { table: string; rows: Row[] }[]) {
    this.outbox = this.outbox.filter((b) => b.id !== batch.id);
    this.acks++;
    await this.persist();
    await this.clearInflight([batch.id]);
    this.applyServerValues(result);
    this.retryDelay = 2000;
    this.setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: undefined });
    const g = batch.group;
    if (g && !this.hasGroup(g.id)) this.settleGroup(g.id, { groupId: g.id, state: "done" });
  }

  /**
   * Tras dividir un trozo en `extra + 1`, el grupo tiene `extra` trozos más: hechos = total − pendientes sigue siendo
   * exacto y nunca retrocede.
   */
  private regroup(groupId: string | undefined, extra: number) {
    if (!groupId) return;
    for (const b of this.outbox) if (b.group?.id === groupId) b.group = { ...b.group, total: b.group.total + extra };
  }

  /**
   * Idempotencia: si un trozo ya se confirmó (respuesta perdida) y se reenvía, las inserciones chocan por clave
   * primaria. Se consultan los ids que ya existen y se quitan del trozo. Devuelve "done" si no queda nada, el trozo
   * reducido si quedaba algo, o null si ninguna fila existía (el duplicado es real: otra restricción única).
   */
  private async pruneExisting(batch: Batch): Promise<Batch | "done" | null> {
    let total = 0;
    let existingCount = 0;
    const ops: Op[] = [];
    for (const op of batch.ops) {
      if (op.op !== "insert") {
        ops.push(op);
        continue;
      }
      const ids = op.rows.map((r) => String(r.id));
      const existing = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await this.sb.from(op.table).select("id").in("id", ids.slice(i, i + 100));
        if (error) throw error;
        for (const r of (data ?? []) as { id: string }[]) existing.add(String(r.id));
      }
      total += ids.length;
      existingCount += existing.size;
      const rows = op.rows.filter((r) => !existing.has(String(r.id)));
      if (rows.length) ops.push({ ...op, rows });
    }
    if (!existingCount) return null;
    // Cada trozo es una transacción: si todas sus inserciones existen, entró entero (actualizaciones incluidas)
    if (existingCount === total) return "done";
    return { ...batch, ops };
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  /** Números asignados por la base de datos (tickets, facturas). */
  private applyServerValues(result: { table: string; rows: Row[] }[]) {
    const numbers = new Map<string, number>();
    const invoiceNumbers = new Map<string, string>();
    for (const r of result ?? []) {
      if (r.table === "sales") for (const row of r.rows) numbers.set(String(row.id), Number(row.number));
      if (r.table === "invoices") for (const row of r.rows) if (row.number) invoiceNumbers.set(String(row.id), String(row.number));
    }
    if (!numbers.size && !invoiceNumbers.size) return;
    this.store.patch((ws) => ({
      ...ws,
      sales: numbers.size ? ws.sales.map((s) => (numbers.has(s.id) ? { ...s, number: numbers.get(s.id)! } : s)) : ws.sales,
      invoices: invoiceNumbers.size ? ws.invoices.map((i) => (invoiceNumbers.has(i.id) ? { ...i, number: invoiceNumbers.get(i.id) } : i)) : ws.invoices,
      counters: { ...ws.counters, sale: Math.max(ws.counters.sale ?? 0, ...numbers.values()) },
    }));
  }
}

/** Mensajes de la base de datos → texto para el usuario. */
export function humanize(message: string): string {
  if (/row-level security/i.test(message)) return "No tienes permiso para guardar este cambio. Se ha restaurado el último estado guardado.";
  if (/duplicate key/i.test(message)) return "Ese registro ya existe. Se ha restaurado el último estado guardado.";
  return `${message}. Se ha restaurado el último estado guardado.`;
}
