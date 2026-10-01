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
import { SCHEMA_VERSION, type Store, type Workspace } from "../store";
import {
  auditFromRow, COLLECTIONS, entityToRow, organizationFromRow, organizationPatch, paymentFromRow, rowToEntity, SERVER_OWNED,
  settingsFromRow, settingsToRow, type CollectionKey, type Row,
} from "./mapping";

export interface Op {
  table: string;
  op: "insert" | "update" | "set_modules";
  rows: Row[];
}
export interface Batch {
  id: string;
  orgId: string;
  createdAt: string;
  ops: Op[];
  audit: Record<string, { action: string; label?: string; context?: unknown }>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Diferencias
// ---------------------------------------------------------------------------------------------------------------------
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
    if (inserted.length) ops.push({ table, op: "insert", rows: inserted });
    if (updated.length) updates.push({ table, op: "update", rows: updated });
  }
  ops.push(...updates);
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

  const results = await Promise.all(COLLECTIONS.map(([, table]) => fetchAll(sb, table, orgId)));
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
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST")) return code === "57P01" || code === "53300" || code === "08006";
  return true;
}

export type SyncState = "idle" | "syncing" | "offline" | "error";
export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt?: string;
  error?: string;
}

const outboxKey = (orgId: string) => `outbox:${orgId}`;

export class CloudSync {
  private outbox: Batch[] = [];
  private orgId: string | null = null;
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private errorListeners = new Set<(message: string) => void>();
  status: SyncStatus = { state: "idle", pending: 0 };

  constructor(private sb: SupabaseClient, private kv: KV, private store: Store) {
    store.onCommit = (prev, next) => this.enqueue(prev, next);
  }

  onStatus(l: (s: SyncStatus) => void) { this.statusListeners.add(l); return () => void this.statusListeners.delete(l); }
  onError(l: (m: string) => void) { this.errorListeners.add(l); return () => void this.errorListeners.delete(l); }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, pending: this.outbox.length, ...patch };
    for (const l of this.statusListeners) l(this.status);
  }

  /** Abre una empresa: caché inmediata si existe, cola pendiente enviada y estado real descargado. */
  async open(orgId: string): Promise<void> {
    this.orgId = orgId;
    this.outbox = (await this.kv.get<Batch[]>(outboxKey(orgId))) ?? [];
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

  close() {
    this.orgId = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  /** Descarga el estado real (no pisa cambios locales aún no enviados). */
  async pull(): Promise<void> {
    const orgId = this.orgId;
    if (!orgId) return;
    this.setStatus({ state: "syncing" });
    const ws = await pullWorkspace(this.sb, orgId);
    if (this.orgId !== orgId) return;
    if (this.outbox.length) return this.setStatus({ state: "idle" });
    this.store.setWorkspace(ws);
    this.setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: undefined });
  }

  private enqueue(prev: Workspace, next: Workspace) {
    const d = diffWorkspaces(prev, next);
    if (!d) return;
    this.outbox.push({ ...d, id: uid(), createdAt: new Date().toISOString() });
    this.setStatus({});
    void this.persist().then(() => this.flush());
  }

  private persist() {
    return this.orgId ? this.kv.set(outboxKey(this.orgId), this.outbox) : Promise.resolve();
  }

  get pending() {
    return this.outbox.length;
  }

  /** Envía la cola en orden. Resuelve cuando está vacía o cuando no hay conexión. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = async () => {
        while (this.outbox.length && this.orgId) {
          const batch = this.outbox[0]!;
          this.setStatus({ state: "syncing" });
          const { data, error } = await this.sb.rpc("sync_push", { p_org: batch.orgId, p_batch: { ops: batch.ops, audit: batch.audit } });
          if (error) {
            if (isTransient(error)) {
              this.setStatus({ state: "offline", error: error.message });
              this.scheduleRetry();
              return;
            }
            this.outbox.shift();
            await this.persist();
            this.setStatus({ state: "error", error: error.message });
            for (const l of this.errorListeners) l(humanize(error.message));
            await this.pull().catch(() => undefined);
            continue;
          }
          this.outbox.shift();
          await this.persist();
          this.applyServerValues(data as { table: string; rows: Row[] }[]);
          this.retryDelay = 2000;
          this.setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: undefined });
        }
    };
    // .finally() se ejecuta siempre después de la asignación (aunque la cola esté vacía y run() termine en el acto)
    const p = run().finally(() => {
      if (this.flushing === p) this.flushing = null;
    });
    this.flushing = p;
    return p;
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
