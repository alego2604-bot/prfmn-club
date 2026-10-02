/**
 * Siembra la empresa DEMO en un Supabase (staging) con datos 100 % sintéticos. Reintentable e idempotente:
 *  - reutiliza la cuenta sintética si existe (si no, la crea);
 *  - si la empresa demo ya está sembrada, no hace nada; si se quedó a medias, reanuda la cola pendiente;
 *  - envía por lotes (nunca un único lote gigante) y verifica el resultado desde un segundo cliente.
 *
 *   BOS_SEED=1 BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npm run seed:demo
 *   (opcional) BOS_SEED_EMAIL=demo-xyz@empresa.test BOS_SEED_PASSWORD=…
 *
 * Solo con la clave pública: la seguridad la imponen Auth + RLS. Nunca datos reales.
 */
import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { DEMO_ORGANIZATION, fillDemoWorkspace } from "../demo";
import { createCloudClient, createOrganization, memberships, signIn, signUp } from "./account";
import { CloudSync } from "./sync";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const EMAIL = process.env.BOS_SEED_EMAIL ?? "demo-seed@empresa.test";
const PASSWORD = process.env.BOS_SEED_PASSWORD ?? "demo-sintetica-staging";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe.skipIf(!process.env.BOS_SEED || !URL || !KEY)("Siembra de la demo sintética", () => {
  it("crea o reanuda la empresa demo y verifica que todo está en el servidor", async () => {
    const sb = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
    const user = await signIn(sb, EMAIL, PASSWORD).catch(async () => {
      const r = await signUp(sb, { fullName: "Demo Sintética", email: EMAIL, password: PASSWORD });
      if (!r.user) throw new Error("El proyecto exige confirmar email: desactívalo en staging");
      return r.user;
    });
    let org = (await memberships(sb, user.id)).orgs.find((o) => o.isDemo);
    const orgId = org?.id ?? (await createOrganization(sb, { ...DEMO_ORGANIZATION, isDemo: true }));
    org = { id: orgId, name: DEMO_ORGANIZATION.name, isDemo: true, vertical: DEMO_ORGANIZATION.vertical };

    const kv = createMemoryKV();
    const store = new Store(kv);
    await store.init();
    const sync = new CloudSync(sb, kv, store, { tabId: async () => "seed", liveTabs: async () => new Set(["seed"]) });
    const progress: string[] = [];
    sync.onStatus((s) => s.progress && progress.push(`${s.progress.done}/${s.progress.total}`));
    await sync.open(orgId);
    const before = store.requireWorkspace();
    if (before.sales.length === 0) {
      sync.tagNext({ id: `demo:${orgId}`, label: "Sembrando demo" });
      store.update((ws) => fillDemoWorkspace(ws, user.id));
      await sync.waitGroup(`demo:${orgId}`);
    }
    await sync.settle();

    // Verificación desde un cliente limpio (otro "dispositivo")
    const sb2 = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
    await signIn(sb2, EMAIL, PASSWORD);
    const store2 = new Store(createMemoryKV());
    await store2.init();
    const sync2 = new CloudSync(sb2, createMemoryKV(), store2, { tabId: async () => "verify", liveTabs: async () => null });
    await sync2.open(orgId);
    const ws = store2.requireWorkspace();
    console.log(`Demo «${org.name}» (${orgId}) · cuenta ${EMAIL} · ${before.sales.length ? "ya estaba sembrada" : `sembrada en ${progress.length ? progress.at(-1) : "1"} lotes`}`);
    console.log(`  ${ws.locations.length} centros · ${ws.customers.length} clientes · ${ws.sales.length} ventas · ${ws.invoices.length} facturas · ${ws.cashClosings.length} cierres · ${ws.customerNotes.length} notas · ${ws.imports.length} importación`);
    expect(ws.organization.isDemo).toBe(true);
    expect(ws.locations.length).toBe(2);
    expect(ws.sales.length).toBeGreaterThan(3000);
    expect(ws.cashClosings.length).toBeGreaterThan(60);
    expect(ws.customers.every((c) => !c.email || c.email.endsWith("@demo.invalid"))).toBe(true);
  }, 600_000);
});
