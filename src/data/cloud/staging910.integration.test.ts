/**
 * Validación REAL de la migración 0910 (auditoría de equipo, empresa y configuración) contra business-os-staging o el
 * stack local. Cuentas y empresa sintéticas nuevas en cada ejecución.
 *   BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npx vitest run src/data/cloud/staging910.integration.test.ts
 *
 * Comprueba, leyendo audit_logs por la API: actor, acción, entidad, etiqueta, cambios, contexto y que cada operación deja
 * UN solo registro (sin duplicados).
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import type { Ctx } from "../context";
import { createCustomer } from "../repos/customers";
import { saveInvoiceDraft } from "../repos/invoices";
import { updateActivityRules, updateOrganization } from "../repos/settings";
import { addMemberByEmail, createCloudClient, createOrganization, memberships, signUp, updateMember, type CloudUser } from "./account";
import { CloudSync } from "./sync";
import { itemsToDraft } from "@/domain/invoicing";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const run = `${Date.now().toString(36)}z`;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}
async function device() {
  const sb: SupabaseClient = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const sync = new CloudSync(sb, kv, store);
  const errors: string[] = [];
  sync.onError((m) => errors.push(m));
  return { sb, store, sync, errors };
}
async function account(sb: SupabaseClient, who: string): Promise<CloudUser> {
  const r = await signUp(sb, { fullName: `Usuario ${who}`, email: `${who}-${run}@empresa.test`, password: "contraseña-segura" });
  if (!r.user) throw new Error("El proyecto exige confirmar email");
  return r.user;
}

interface AuditRow { id: number | string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; entity_label: string | null; changes: Record<string, unknown> | null; context: Record<string, unknown> | null }

describe.skipIf(!URL || !KEY)("Supabase 0910: auditoría de equipo, empresa, configuración y líneas de borrador", () => {
  it("cada operación deja un registro útil y único", async () => {
    const d1 = await device();
    const owner = await account(d1.sb, "own");
    const d2 = await device();
    const member = await account(d2.sb, "mem");
    const orgId = await createOrganization(d1.sb, { name: `Auditoría ${run}`, vertical: "fitness", locationName: "Centro A" });
    await d1.sync.open(orgId);
    const ctx: Ctx = { store: d1.store, user: owner, role: "owner", locationIds: null };
    const locA = d1.store.requireWorkspace().locations[0]!.id;
    const audit = async (): Promise<AuditRow[]> => {
      const { data, error } = await d1.sb.from("audit_logs").select("id, actor_id, action, entity_type, entity_id, entity_label, changes, context").eq("organization_id", orgId).order("id");
      expect(error).toBeNull();
      return (data ?? []) as AuditRow[];
    };
    const since = async (n: number) => (await audit()).slice(n);

    // ── Invitar
    let n = (await audit()).length;
    await addMemberByEmail(d1.sb, orgId, member.email, "employee", [locA]);
    const rows = (await d1.sb.from("organization_members").select("id, user_id").eq("organization_id", orgId)).data as { id: string; user_id: string }[];
    const memberRow = rows.find((r) => r.user_id === member.id)!;
    let a = await since(n);
    const invite = a.filter((x) => x.entity_type === "organization_members");
    expect(invite).toHaveLength(1);
    expect(invite[0]).toMatchObject({ action: "invite", actor_id: owner.id, entity_id: memberRow.id, entity_label: member.fullName });
    expect(invite[0]!.context).toMatchObject({ role: "employee" });

    // ── Cambiar rol (una sola entrada role_change con de/a, sin «update» genérico)
    n = (await audit()).length;
    await updateMember(d1.sb, memberRow.id, { role: "manager" });
    a = await since(n);
    expect(a.map((x) => x.action)).toEqual(["role_change"]);
    expect(a[0]).toMatchObject({ actor_id: owner.id, entity_type: "organization_members", entity_id: memberRow.id, entity_label: member.fullName });
    expect(a[0]!.context).toMatchObject({ from: "employee", to: "manager" });

    // ── Cambiar centros asignados (null = todos)
    n = (await audit()).length;
    await updateMember(d1.sb, memberRow.id, { locationIds: null });
    a = await since(n);
    expect(a.map((x) => x.action)).toEqual(["update"]);
    const loc = (a[0]!.changes as { location_ids: { from: string[]; to?: string[] | null } }).location_ids;
    expect(loc.from).toEqual([locA]);
    // BUG 0910 (corregido en 0920): jsonb_strip_nulls elimina «to: null» al pasar a «todos los centros»
    expect(loc.to ?? null).toBeNull();

    // ── Desactivar / reactivar
    n = (await audit()).length;
    await updateMember(d1.sb, memberRow.id, { status: "suspended" });
    await updateMember(d1.sb, memberRow.id, { status: "active" });
    a = await since(n);
    expect(a.map((x) => x.action)).toEqual(["update", "update"]);
    expect(a[0]!.changes).toMatchObject({ status: { from: "active", to: "suspended" } });
    expect(a[1]!.changes).toMatchObject({ status: { from: "suspended", to: "active" } });

    // ── Rol + centros en una sola llamada: un registro por tipo de cambio, ninguno repetido
    n = (await audit()).length;
    await updateMember(d1.sb, memberRow.id, { role: "accountant", locationIds: [locA] });
    a = await since(n);
    expect(a.map((x) => x.action).sort()).toEqual(["role_change", "update"]);

    // ── Sin cambios reales no se escribe nada
    n = (await audit()).length;
    await updateMember(d1.sb, memberRow.id, { role: "accountant" });
    expect(await since(n)).toHaveLength(0);

    // ── Datos de la empresa
    n = (await audit()).length;
    updateOrganization(ctx, { city: "Ciudad Demo", phone: "600000000" });
    await d1.sync.flush();
    expect(d1.errors.join(" | ")).toBe("");
    a = await since(n);
    const org = a.filter((x) => x.entity_type === "organizations");
    expect(org).toHaveLength(1);
    expect(org[0]).toMatchObject({ actor_id: owner.id, entity_id: orgId, entity_label: expect.any(String) });
    expect(Object.keys(org[0]!.changes ?? {}).sort()).toEqual(["city", "phone"]);

    // ── Configuración
    n = (await audit()).length;
    updateActivityRules(ctx, [], false);
    await d1.sync.flush();
    a = await since(n);
    const cfg = a.filter((x) => x.entity_type === "organization_settings");
    expect(cfg).toHaveLength(1);
    expect(cfg[0]).toMatchObject({ actor_id: owner.id, entity_id: orgId, entity_label: expect.any(String) });
    expect(cfg[0]!.changes).toBeTruthy();

    // ── Líneas de un borrador de factura: una entrada por línea y nunca duplicadas
    const cli = createCustomer(ctx, { firstName: "Cliente", lastName: "Sintético", status: "active" });
    await d1.sync.flush();
    const lines = [
      { description: "Línea 1", quantity: 1, unitPrice: 10000, taxRateBp: 2100 },
      { description: "Línea 2", quantity: 1, unitPrice: 5000, taxRateBp: 2100 },
      { description: "Línea 3", quantity: 1, unitPrice: 2000, taxRateBp: 2100 },
    ];
    n = (await audit()).length;
    const f = saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: new Date().toISOString().slice(0, 10), dueDays: 0, lines } as never);
    await d1.sync.flush();
    a = await since(n);
    const items = (id: string) => a.filter((x) => x.entity_type === "invoice_items" && x.entity_id === id);
    const created = a.filter((x) => x.entity_type === "invoice_items" && x.action === "insert");
    expect(created).toHaveLength(3);
    expect(new Set(created.map((x) => x.entity_id)).size).toBe(3); // ninguna línea repetida
    n = (await audit()).length;
    // Como el editor real: las líneas que se conservan llevan su id; se quita la tercera
    const current = itemsToDraft(d1.store.requireWorkspace().invoiceItems.filter((it) => it.invoiceId === f.id));
    saveInvoiceDraft(ctx, { customerId: cli.id, issueDate: new Date().toISOString().slice(0, 10), dueDays: 0, lines: current.slice(0, 2) } as never, f.id);
    await d1.sync.flush();
    expect(d1.errors.join(" | ")).toBe("");
    a = await since(n);
    const del = a.filter((x) => x.entity_type === "invoice_items" && x.action === "delete");
    expect(del).toHaveLength(1);
    expect(del[0]!.actor_id).toBe(owner.id);
    expect(del[0]!.changes).toHaveProperty("before");
    expect(items(String(del[0]!.entity_id))).toHaveLength(1);

    // ── Ningún registro del conjunto está sin actor ni sin entidad
    for (const r of await audit()) {
      expect(r.actor_id, `${r.action}/${r.entity_type}`).toBeTruthy();
      expect(r.entity_id, `${r.action}/${r.entity_type}`).toBeTruthy();
    }
    // El propio miembro (otro dispositivo) ve su empresa; la invitación no duplicó la fila de equipo
    const ms = await memberships(d2.sb, member.id);
    expect(ms.members.filter((m) => m.organizationId === orgId)).toHaveLength(1);
  }, 180_000);
});
