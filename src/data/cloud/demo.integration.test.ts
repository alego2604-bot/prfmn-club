/**
 * Integración REAL: la empresa demo completa se sube por lotes sin errores (con o sin la migración 0900) y otro
 * dispositivo la lee igual. Es la prueba que habría detectado un orden de claves foráneas incorrecto.
 */
import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { createCloudClient, createOrganization, signIn, signUp } from "./account";
import { CloudSync } from "./sync";
import { DEMO_ORGANIZATION, fillDemoWorkspace } from "../demo";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const storage = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage; };
async function device() {
  const sb = createCloudClient({ url: URL!, anonKey: KEY! }, storage());
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const sync = new CloudSync(sb, kv, store);
  const errors: string[] = [];
  sync.onError((e) => errors.push(e));
  return { sb, store, sync, errors };
}

describe.skipIf(!URL || !KEY)("Supabase: empresa demo completa", () => {
  it("se sube por lotes sin errores y otro dispositivo ve lo mismo", async () => {
    const d1 = await device();
    const email = `demo-int-${Date.now().toString(36)}@empresa.test`;
    const r = await signUp(d1.sb, { fullName: "Demo", email, password: "contraseña-segura" });
    const orgId = await createOrganization(d1.sb, DEMO_ORGANIZATION);
    await d1.sync.open(orgId);
    d1.store.update((ws) => fillDemoWorkspace(ws, r.user!.id));
    await d1.sync.flush();
    expect(d1.errors).toEqual([]);
    expect(d1.sync.pending).toBe(0);
    const w1 = d1.store.requireWorkspace();

    const d2 = await device();
    await signIn(d2.sb, email, "contraseña-segura");
    await d2.sync.open(orgId);
    const w2 = d2.store.requireWorkspace();
    for (const k of ["sales", "saleItems", "payments", "invoices", "invoiceItems", "customers", "cashClosings", "customerMemberships", "membershipCharges", "suppliers", "expenses", "tasks"] as const) {
      expect(w2[k].length, k).toBe(w1[k].length);
    }
    // Las facturas emitidas en la app reciben número del servidor
    expect(w2.invoices.filter((i) => i.status !== "draft").every((i) => i.number)).toBe(true);
  }, 300_000);
});
