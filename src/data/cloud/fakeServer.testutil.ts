/**
 * Supabase simulado para tests (solo lo usan los *.test.ts).
 * - `sync_push`: una transacción por llamada (o entra todo o nada), clave primaria única, upsert en updates.
 * - Lecturas PostgREST mínimas (select/eq/in/order/range/single/maybeSingle) para `pullWorkspace`.
 * - Fallos programables: respuesta perdida, statement_timeout por tamaño, rechazo de negocio en la llamada N.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../store";
import { COLLECTIONS, entityToRow, settingsToRow, toRow } from "./mapping";
import type { Op } from "./sync";

export type FailurePlan = { kind: "lose" } | { kind: "timeoutOver"; n: number } | { kind: "reject"; n: number };

export function fakeServer() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const calls: number[] = [];
  const plan: FailurePlan[] = [];
  let numberSeq = 1000;
  const tbl = (t: string) => tables.get(t) ?? tables.set(t, new Map()).get(t)!;

  const rpc = async (_fn: string, args: { p_batch: { ops: Op[] } }) => {
    const ops = args.p_batch.ops;
    const rows = ops.reduce((n, o) => n + o.rows.length, 0);
    calls.push(rows);
    if (plan.some((p) => p.kind === "timeoutOver" && rows > p.n)) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    if (plan.some((p) => p.kind === "reject" && calls.length === p.n)) return { data: null, error: { code: "23514", message: "violates check constraint" } };
    for (const o of ops) if (o.op === "insert") for (const r of o.rows) if (tbl(o.table).has(String(r.id))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    for (const o of ops) if (o.op === "update") for (const r of o.rows) if (!tbl(o.table).has(String(r.id))) return { data: null, error: { code: "42501", message: `No se pudo actualizar ${o.table}` } };
    const out: { table: string; rows: Record<string, unknown>[] }[] = [];
    for (const o of ops) {
      const applied = o.rows.map((r) => {
        const merged = { ...tbl(o.table).get(String(r.id)), ...r };
        if (o.table === "sales" && o.op === "insert") merged.number = ++numberSeq;
        tbl(o.table).set(String(r.id), merged);
        return merged;
      });
      out.push({ table: o.table, rows: applied });
    }
    const lose = plan.findIndex((p) => p.kind === "lose");
    if (lose >= 0) {
      plan.splice(lose, 1);
      return { data: null, error: { message: "TypeError: Failed to fetch" } };
    }
    return { data: out, error: null };
  };

  const from = (table: string) => {
    const q = { eq: [] as [string, unknown][], in: null as null | [string, string[]], single: false, maybe: false, range: null as null | [number, number] };
    const run = () => {
      let rows = [...tbl(table).values()];
      for (const [c, v] of q.eq) rows = rows.filter((r) => r[c] === v);
      if (q.in) rows = rows.filter((r) => q.in![1].includes(String(r[q.in![0]])));
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.single || q.maybe) return { data: rows[0] ?? null, error: rows[0] || q.maybe ? null : { message: "no rows", code: "PGRST116" } };
      return { data: rows, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => (q.eq.push([c, v]), chain),
      in: (c: string, v: string[]) => ((q.in = [c, v]), chain),
      order: () => chain,
      limit: () => chain,
      range: (a: number, b: number) => ((q.range = [a, b]), chain),
      single: () => ((q.single = true), chain),
      maybeSingle: () => ((q.maybe = true), chain),
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };

  /** La empresa ya existe en el servidor (como tras create_organization). */
  const seedFrom = (ws: Workspace) => {
    tbl("organizations").set(ws.organization.id, toRow(ws.organization));
    tbl("organization_settings").set(ws.organization.id, { organization_id: ws.organization.id, ...settingsToRow(ws.settings) });
    for (const [key, table] of COLLECTIONS) for (const e of ws[key] as { id: string }[]) tbl(table).set(e.id, entityToRow(key, e));
  };

  return {
    sb: { rpc, from } as unknown as SupabaseClient,
    tables,
    calls,
    plan,
    seedFrom,
    count: (t: string, where?: (r: Record<string, unknown>) => boolean) => [...tbl(t).values()].filter(where ?? (() => true)).length,
  };
}
