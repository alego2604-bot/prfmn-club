import { describe, expect, it } from "vitest";
import { Store } from "@/data/store";
import { createMemoryKV, type KV } from "@/data/persistence";
import { buildWorkspace } from "@/data/workspace";
import type { Ctx } from "@/data/context";
import { CloudSync, type SyncStatus } from "@/data/cloud/sync";
import { fakeServer } from "@/data/cloud/fakeServer.testutil";
import { visibleWorkspace } from "@/data/visibility";
import { computeKpis } from "@/domain/analytics";
import { makePeriod } from "@/lib/dates";
import { analyzeWorkbook } from "./analyze";
import { buildSalesPlan } from "./salesPlan";
import { importState } from "./commit";
import { awaitImport, cancelImport, cleanupImport, resumeImports, runImport, STALE_AFTER_MS, type GroupSync } from "./pipeline";
import type { WorkbookData } from "./types";

/** Excel sintético grande: N ventas en una hoja (miles de filas a enviar entre ventas, líneas, pagos y trazas). */
function bigWorkbook(n: number): WorkbookData {
  const rows: WorkbookData["sheets"][number]["rows"] = [["Fecha", "Producto", "Categoría", "Precio", "Unidades", "Importe", "Método"]];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + (i % 250), 10 + (i % 8)));
    rows.push([day, i % 3 ? "Agua" : "Drop-In", i % 3 ? "BEBIDAS" : "DROP-IN", i % 3 ? 1 : 15, 1, i % 3 ? 1 : 15, i % 2 ? "Tarjeta" : "Efectivo"]);
  }
  return { fileName: "ventas-sinteticas.xlsx", format: "xlsx", sheets: [{ name: "Ventas 2026", rows }] };
}

async function setup(opts: { kv?: KV; tab?: string } = {}) {
  const server = fakeServer();
  const kv = opts.kv ?? createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const ws = buildWorkspace({ name: "Empresa Sintética", vertical: "fitness", locationName: "Centro" });
  server.seedFrom(ws);
  await store.createWorkspace(ws);
  const tab = opts.tab ?? "t1";
  const sync = new CloudSync(server.sb, kv, store, { tabId: async () => tab, liveTabs: async () => new Set([tab]) });
  const statuses: SyncStatus[] = [];
  sync.onStatus((s) => statuses.push(s));
  await sync.open(ws.organization.id);
  const ctx: Ctx = { store, user: { id: "u1", fullName: "Persona Test", email: "p@empresa.test" }, role: "owner", locationIds: null };
  const plan = (n: number) => {
    const wb = bigWorkbook(n);
    return buildSalesPlan(wb, analyzeWorkbook(wb), store.requireWorkspace(), { dateOutsideSheet: "keep", locationId: ws.locations[0]!.id });
  };
  const file = { name: "ventas-sinteticas.xlsx", sha256: "f".repeat(64), size: 1234 };
  return { server, store, sync, ctx, plan, file, statuses, orgId: ws.organization.id, kv };
}

const year = makePeriod("custom", new Date(2026, 5, 1), { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) });

describe("Pipeline de importación por lotes", () => {
  it("importación grande: lotes trazables, oculta mientras está en curso y COMPLETED al final", async () => {
    const { server, store, sync, ctx, plan, file, statuses } = await setup();
    const p = plan(900);
    let hiddenDuring: number | null = null;
    sync.onStatus((s) => {
      if (s.progress && hiddenDuring === null) hiddenDuring = visibleWorkspace(store.requireWorkspace()).sales.length;
    });
    const r = await runImport(ctx, p, file, sync, { stages: [{ state: "ANALYZING", at: new Date().toISOString() }] });
    expect(r.state).toBe("COMPLETED");
    expect(hiddenDuring).toBe(0); // mientras se enviaba, nada visible
    expect(server.calls.length).toBeGreaterThan(5);
    expect(Math.max(...server.calls)).toBeLessThanOrEqual(300);
    expect(server.count("sales")).toBe(900);
    const job = store.requireWorkspace().imports.find((j) => j.id === r.job.id)!;
    expect(job.status).toBe("completed");
    expect(job.pipeline!.events.map((e) => e.state)).toEqual(["ANALYZING", "IMPORTING", "COMPLETED"]);
    expect(server.tables.get("imports")!.get(job.id)!.status).toBe("completed");
    expect((server.tables.get("imports")!.get(job.id)!.options as { state: string }).state).toBe("COMPLETED");
    expect(visibleWorkspace(store.requireWorkspace()).sales.length).toBe(900);
    expect(computeKpis(visibleWorkspace(store.requireWorkspace()), year).revenue).toBeGreaterThan(0);
    const labels = statuses.map((s) => s.progress?.label).filter(Boolean);
    expect(labels[0]).toBe("Importando ventas-sinteticas.xlsx");
  });

  it("fallo a mitad: PARTIAL, datos ocultos e identificados; limpiar los anula sin borrar nada", async () => {
    const { server, store, sync, ctx, plan, file } = await setup();
    server.plan.push({ kind: "reject", n: 4 });
    const r = await runImport(ctx, plan(900), file, sync);
    expect(r.state).toBe("PARTIAL");
    const ws = store.requireWorkspace();
    const partial = ws.sales.filter((s) => s.importId === r.job.id).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(900);
    expect(visibleWorkspace(ws).sales.filter((s) => s.importId === r.job.id)).toHaveLength(0);
    expect(server.tables.get("imports")!.get(r.job.id)!.status).toBe("failed");
    cleanupImport(ctx, r.job.id);
    await sync.settle();
    const after = store.requireWorkspace();
    const job = after.imports.find((j) => j.id === r.job.id)!;
    expect(importState(job)).toBe("FAILED");
    expect(after.sales.filter((s) => s.importId === r.job.id).every((s) => s.status === "voided")).toBe(true);
    expect(server.count("sales", (s) => s.import_id === r.job.id && s.status !== "voided")).toBe(0);
    expect(server.count("sales", (s) => s.import_id === r.job.id)).toBe(partial); // trazabilidad: nada borrado
  });

  it("cancelar: descarta lo pendiente, anula lo que entró y queda CANCELLED", async () => {
    const { server, store, sync, ctx, plan, file } = await setup();
    server.plan.push({ kind: "lose" }); // el primer lote entra pero la conexión se corta
    const running = runImport(ctx, plan(900), file, sync);
    await sync.flush();
    expect(sync.status.state).toBe("offline");
    const job = store.requireWorkspace().imports.at(-1)!;
    const state = await cancelImport(ctx, job, sync);
    expect(state).toBe("CANCELLED");
    expect((await running).state).toBe("CANCELLED");
    const ws = store.requireWorkspace();
    expect(importState(ws.imports.find((j) => j.id === job.id)!)).toBe("CANCELLED");
    expect(server.count("sales", (s) => s.import_id === job.id && s.status !== "voided")).toBe(0);
    expect(visibleWorkspace(ws).sales.some((s) => s.importId === job.id)).toBe(false);
  });

  it("reanudar: la pestaña se cierra a mitad; al volver, la cola sigue y el job se completa", async () => {
    const kv = createMemoryKV();
    const a = await setup({ kv, tab: "t1" });
    a.server.plan.push({ kind: "lose" });
    void runImport(a.ctx, a.plan(700), a.file, a.sync);
    await a.sync.flush(); // se corta tras el primer lote
    const jobId = a.store.requireWorkspace().imports.at(-1)!.id;
    expect(a.sync.pending).toBeGreaterThan(0);
    a.sync.close(); // "cierra la pestaña": la cola queda en IndexedDB

    // Nueva sesión en la misma pestaña (misma cola) contra el mismo servidor
    const store2 = new Store(kv);
    await store2.init();
    const sync2 = new CloudSync(a.server.sb, kv, store2, { tabId: async () => "t1", liveTabs: async () => new Set(["t1"]) });
    const ctx2: Ctx = { ...a.ctx, store: store2 };
    await sync2.open(a.orgId);
    const group: GroupSync = sync2;
    const results = await resumeImports(ctx2, group, new Set(["t1"]));
    expect(results.map((r) => r.state)).toEqual(["COMPLETED"]);
    expect(a.server.count("sales", (s) => s.import_id === jobId)).toBe(700); // reintento idempotente: ni una de más
    expect(importState(store2.requireWorkspace().imports.find((j) => j.id === jobId)!)).toBe("COMPLETED");
  });

  it("reanudar sin cola: se verifica contra el servidor; incompleto y sin avances → PARTIAL", async () => {
    const { server, store, sync, ctx, plan, file } = await setup();
    server.plan.push({ kind: "lose" });
    void runImport(ctx, plan(700), file, sync);
    await sync.flush();
    const job = store.requireWorkspace().imports.at(-1)!;
    await sync.cancelGroup(job.id).catch(() => undefined); // simula una cola perdida (otro dispositivo / caché borrada)
    await sync.settle();
    expect(await resumeImports(ctx, sync, new Set(["t1"]))).toEqual([]); // reciente: puede seguir en otro sitio
    const later = Date.now() + STALE_AFTER_MS + 1000;
    const res = await resumeImports(ctx, sync, new Set(["t1"]), later);
    expect(res.map((r) => r.state)).toEqual(["PARTIAL"]);
  });

  it("modo local (sin servidor): se completa en el acto", async () => {
    const { ctx, plan, file } = await setup();
    const r = await runImport(ctx, plan(50), file, null);
    expect(r.state).toBe("COMPLETED");
    expect(r.job.pipeline!.events.map((e) => e.state)).toEqual(["IMPORTING", "COMPLETED"]);
  });

  it("awaitImport sobre un job sin lotes pendientes lo da por completado", async () => {
    const { store, sync, ctx, plan, file } = await setup();
    const r = await runImport(ctx, plan(10), file, sync);
    const again = await awaitImport(ctx, store.requireWorkspace().imports.find((j) => j.id === r.job.id)!, sync);
    expect(again.state).toBe("COMPLETED");
  });
});
