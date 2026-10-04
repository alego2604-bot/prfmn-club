/**
 * SEGURIDAD POR API contra el servidor real (staging o stack local): usuarios de verdad con Auth real y la clave pública,
 * intentando por la API (sync_push, PostgREST directo y RPC) lo que su rol no debe poder hacer.
 *   BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npx vitest run src/data/cloud/security.integration.test.ts
 *
 * Las comprobaciones que dependen de la migración 0920 se ejecutan solo si el servidor la tiene (server_capabilities().schema
 * ≥ 920); si no, se avisa en consola (⚠) y quedan pendientes: este mismo fichero las valida en cuanto se aplique.
 * Las que ya deben cumplirse con 0910 (viewer no escribe, aislamiento entre empresas, equipo) corren siempre.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import type { Ctx } from "../context";
import { createCustomer } from "../repos/customers";
import { issueInvoice, saveInvoiceDraft } from "../repos/invoices";
import { addMemberByEmail, createCloudClient, createOrganization, signUp, type CloudUser } from "./account";
import { CloudSync } from "./sync";

const URL = process.env.BOS_CLOUD_URL;
const KEY = process.env.BOS_CLOUD_ANON_KEY;
const run = `${Date.now().toString(36)}s`;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}
async function device() {
  const sb: SupabaseClient = createCloudClient({ url: URL!, anonKey: KEY! }, memoryStorage());
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  return { sb, store, sync: new CloudSync(sb, kv, store) };
}
async function account(sb: SupabaseClient, who: string): Promise<CloudUser> {
  const r = await signUp(sb, { fullName: `Usuario ${who}`, email: `${who}-${run}@empresa.test`, password: "contraseña-segura" });
  if (!r.user) throw new Error("El proyecto exige confirmar email");
  return r.user;
}
const denied = (r: { error: { message: string; code?: string } | null; data?: unknown }) => !!r.error && ["42501", "23514", "P0001"].includes(String(r.error.code ?? "")) || (!!r.error && /permission|permiso|row-level security|no tienes|No se pudo actualizar/i.test(r.error.message));
const push = (sb: SupabaseClient, org: string, table: string, op: string, rows: Record<string, unknown>[]) => sb.rpc("sync_push", { p_org: org, p_batch: { ops: [{ table, op, rows }], audit: {} } });

describe.skipIf(!URL || !KEY)("API real: cada rol solo hace lo suyo", () => {
  it("permisos, equipo, cobros, datos sensibles y aislamiento entre empresas", async () => {
    const O = await device(); const owner = await account(O.sb, "own");
    const A = await device(); await account(A.sb, "adm");
    const M = await device(); const manager = await account(M.sb, "man");
    const S = await device(); const staff = await account(S.sb, "stf");
    const F = await device(); await account(F.sb, "fin");
    const V = await device(); await account(V.sb, "vie");
    const X = await device(); await account(X.sb, "out");   // otra empresa
    const orgId = await createOrganization(O.sb, { name: `Seguridad ${run}`, vertical: "fitness", locationName: "Centro A" });
    const otherOrg = await createOrganization(X.sb, { name: `Otra ${run}`, vertical: "fitness", locationName: "Centro X" });
    for (const [who, role] of [["adm", "admin"], ["man", "manager"], ["stf", "employee"], ["fin", "accountant"], ["vie", "read_only"]] as const) {
      await addMemberByEmail(O.sb, orgId, `${who}-${run}@empresa.test`, role, null);
    }
    await O.sync.open(orgId);
    const ctx: Ctx = { store: O.store, user: owner, role: "owner", locationIds: null };
    const cust = createCustomer(ctx, { firstName: "Cliente", lastName: "Fiscal", status: "active", taxId: "12345678Z", address: "Calle Falsa 1", email: "c@x.test" });
    const f = saveInvoiceDraft(ctx, { customerId: cust.id, issueDate: new Date().toISOString().slice(0, 10), dueDays: 0, lines: [{ description: "Servicio", quantity: 1, unitPrice: 10000, taxRateBp: 2100 }] } as never);
    issueInvoice(ctx, f.id);
    await O.sync.flush();
    const pm = ((await O.sb.from("payment_methods").select("id,kind").eq("organization_id", orgId).eq("key", "card")).data as { id: string; kind: string }[])[0]!;
    const caps = await O.sb.rpc("server_capabilities");
    const schema = Number((caps.data as { schema?: number } | null)?.schema ?? 0);
    const has920 = schema >= 920;
    if (!has920) console.warn(`⚠ El servidor está en el esquema ${schema || "<900"}: se omiten las comprobaciones de 0920 (cobros por API, datos sensibles, excepciones, escalada de equipo).`);
    const members = ((await O.sb.from("organization_members").select("id,user_id,role_id,roles(key)").eq("organization_id", orgId)).data ?? []) as unknown as { id: string; user_id: string; role_id: string; roles: { key: string } }[];
    const member = (id: string) => members.find((m) => m.user_id === id)!;
    const ownerRow = members.find((m) => m.roles.key === "owner")!;

    // ── VIEWER escribiendo: denegado (ya con 0910)
    {
      const r1 = await push(V.sb, orgId, "customers", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, first_name: "Intruso", status: "active", tags: [] }]);
      expect(denied(r1), `viewer insertó un cliente: ${r1.error?.message}`).toBe(true);
      const r2 = await V.sb.from("products").insert({ organization_id: orgId, name: "X", price: 1, tax_rate_bp: 2100 });
      expect(denied(r2)).toBe(true);
      const r3 = await push(V.sb, orgId, "expenses", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, issue_date: "2026-10-01", description: "X", subtotal: 1, tax_total: 0, total: 1 }]);
      expect(denied(r3)).toBe(true);
    }
    // ── MANAGER no gestiona equipo ni toca al owner (ya con 0910)
    {
      const r1 = await M.sb.rpc("update_member", { p_member: ownerRow.id, p_role: "employee" });
      expect(denied(r1)).toBe(true);
      const r2 = await M.sb.from("organization_members").update({ status: "suspended" }).eq("id", ownerRow.id).select();
      expect(r2.error || (r2.data ?? []).length === 0, "manager modificó al owner por PostgREST").toBeTruthy();
      const r3 = await M.sb.rpc("add_member_by_email", { p_org: orgId, p_email: `x-${run}@empresa.test`, p_role: "employee" });
      expect(denied(r3)).toBe(true);
    }
    // ── FINANCE no gestiona equipo (ya con 0910)
    {
      const r = await F.sb.rpc("update_member", { p_member: member(staff.id).id, p_role: "manager" });
      expect(denied(r)).toBe(true);
      const r2 = await F.sb.from("organization_members").update({ role_id: member(staff.id).role_id }).eq("id", member(manager.id).id).select();
      expect(r2.error || (r2.data ?? []).length === 0).toBeTruthy();
    }
    // ── Empresa A ↔ Empresa B (ya con 0910)
    {
      for (const t of ["customers", "invoices", "payments", "sales", "expenses", "audit_logs", "organization_members"]) {
        const r = await X.sb.from(t).select("id").eq("organization_id", orgId);
        expect((r.data ?? []).length, `X lee ${t} de A`).toBe(0);
      }
      const w = await push(X.sb, orgId, "customers", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, first_name: "X", status: "active", tags: [] }]);
      expect(denied(w)).toBe(true);
      const w2 = await push(X.sb, otherOrg, "customers", "insert", [{ id: crypto.randomUUID(), organization_id: orgId, first_name: "X", status: "active", tags: [] }]);
      expect(denied(w2)).toBe(true);
      expect((await O.sb.from("customers").select("id").eq("organization_id", otherOrg)).data ?? []).toHaveLength(0);
    }

    if (!has920) return;

    // ═════════ A partir de aquí: servidor con 0920 ═════════
    // ── STAFF registrando cobros de factura / cuota / devolución: denegado (sync_push y PostgREST)
    {
      const row = { organization_id: orgId, kind: "charge", invoice_id: f.id, payment_method_id: pm.id, method_kind: pm.kind, amount: 100, source: "manual" };
      expect(denied(await push(S.sb, orgId, "payments", "insert", [{ id: crypto.randomUUID(), ...row }])), "staff cobró factura (sync_push)").toBe(true);
      expect(denied(await S.sb.from("payments").insert(row)), "staff cobró factura (PostgREST)").toBe(true);
      const r = await S.sb.from("invoices").update({ status: "paid", amount_paid: 12100 }).eq("id", f.id).select();
      expect(r.error || (r.data ?? []).length === 0, "staff marcó factura pagada").toBeTruthy();
      const refund = { organization_id: orgId, kind: "refund", invoice_id: f.id, refund_of_payment_id: crypto.randomUUID(), payment_method_id: pm.id, method_kind: pm.kind, amount: 100 };
      expect(denied(await S.sb.from("payments").insert(refund))).toBe(true);
    }
    // ── MANAGER cobra la factura (parcial y total); no la anula ni la edita
    {
      const pay = await M.sb.from("payments").insert({ organization_id: orgId, kind: "charge", invoice_id: f.id, payment_method_id: pm.id, method_kind: pm.kind, amount: 4000, source: "manual" });
      expect(pay.error?.message ?? null).toBeNull();
      const part = await M.sb.from("invoices").update({ status: "partially_paid", amount_paid: 4000, payment_method_id: pm.id }).eq("id", f.id).select();
      expect(part.error?.message ?? null).toBeNull();
      const edit = await M.sb.from("invoices").update({ notes: "x" }).eq("id", f.id).select();
      expect(edit.error || (edit.data ?? []).length === 0, "manager editó una factura").toBeTruthy();
      const voided = await M.sb.from("invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "x" }).eq("id", f.id).select();
      expect(voided.error || (voided.data ?? []).length === 0, "manager anuló una factura").toBeTruthy();
    }
    // ── Escalada de equipo por PostgREST directo: ADMIN contra OWNER
    {
      const roles = ((await A.sb.from("roles").select("id,key").is("organization_id", null)).data ?? []) as { id: string; key: string }[];
      const adminRole = roles.find((r) => r.key === "admin")!.id;
      const ownerRole = roles.find((r) => r.key === "owner")!.id;
      const adminMember = members.find((m) => m.roles.key === "admin")!;
      const demote = await A.sb.from("organization_members").update({ role_id: adminRole }).eq("id", ownerRow.id).select();
      expect(demote.error || (demote.data ?? []).length === 0, "admin degradó al owner").toBeTruthy();
      const promote = await A.sb.from("organization_members").update({ role_id: ownerRole }).eq("id", adminMember.id).select();
      expect(promote.error || (promote.data ?? []).length === 0, "admin se hizo owner").toBeTruthy();
      const selfOv = await A.sb.from("organization_members").update({ permission_overrides: { grant: [], revoke: ["sales.void"] } }).eq("id", adminMember.id).select();
      expect(selfOv.error || (selfOv.data ?? []).length === 0, "admin cambió sus propios permisos").toBeTruthy();
      const owners = ((await O.sb.from("organization_members").select("id,roles(key)").eq("organization_id", orgId)).data ?? []) as unknown as { roles: { key: string } }[];
      expect(owners.filter((m) => m.roles.key === "owner")).toHaveLength(1);
    }
    // ── Datos sensibles: STAFF no los lee por la API; FINANCE sí (por la RPC)
    {
      expect(denied(await S.sb.from("customers").select("tax_id")), "staff leyó el NIF").toBe(true);
      expect(denied(await S.sb.from("customers").select("address,city,birth_date,company_name")), "staff leyó datos personales").toBe(true);
      expect(denied(await S.sb.from("customers").select("*")), "staff select *").toBe(true);
      const safe = await S.sb.from("customers_safe").select("*").eq("organization_id", orgId);
      expect(safe.error?.message ?? null).toBeNull();
      expect(JSON.stringify(safe.data)).not.toContain("12345678Z");
      expect((safe.data ?? []).length).toBeGreaterThan(0);
      expect((await S.sb.rpc("customers_sensitive", { p_org: orgId })).data).toEqual([]);
      const fin = (await F.sb.rpc("customers_sensitive", { p_org: orgId })).data as { id: string; tax_id: string; address: string }[];
      expect(fin.find((c) => c.id === cust.id)).toMatchObject({ tax_id: "12345678Z", address: "Calle Falsa 1" });
      expect((await X.sb.rpc("customers_sensitive", { p_org: orgId })).data).toEqual([]);
      const w = await push(S.sb, orgId, "customers", "update", [{ id: cust.id, tax_id: "A0000000A" }]);
      expect(denied(w), "staff cambió el NIF").toBe(true);
      const ok = await push(S.sb, orgId, "customers", "update", [{ id: cust.id, first_name: "Cliente2" }]);
      expect(ok.error?.message ?? null).toBeNull();
    }
    // ── Excepciones individuales: se aplican, se auditan y se validan
    {
      const mm = member(manager.id);
      expect((await O.sb.rpc("set_member_overrides", { p_member: mm.id, p_grant: ["expenses.manage", "invoices.manage"], p_revoke: ["sales.void"] })).error).toBeNull();
      expect(denied(await O.sb.rpc("set_member_overrides", { p_member: mm.id, p_grant: ["no.existe"], p_revoke: [] }))).toBe(true);
      expect(denied(await M.sb.rpc("set_member_overrides", { p_member: member(staff.id).id, p_grant: ["audit.view"], p_revoke: [] }))).toBe(true);
      expect(denied(await A.sb.rpc("set_member_overrides", { p_member: ownerRow.id, p_grant: [], p_revoke: ["team.manage"] }))).toBe(true);
      const eff = await M.sb.from("expenses").insert({ organization_id: orgId, issue_date: "2026-10-01", description: "Gasto con grant", subtotal: 100, tax_total: 21, total: 121 }).select();
      expect(eff.error?.message ?? null, "el grant expenses.manage no se aplicó").toBeNull();
      const audit = ((await O.sb.from("audit_logs").select("action,entity_id,context").eq("organization_id", orgId).eq("action", "permission_change")).data ?? []) as { entity_id: string; context: { to: { grant: string[] } } }[];
      expect(audit.find((a) => a.entity_id === mm.id)?.context.to.grant).toContain("invoices.manage");
    }
    // ── Pull de la app con 0920: el dispositivo del empleado no recibe datos sensibles; el del contable sí
    {
      await S.sync.open(orgId);
      const c = S.store.requireWorkspace().customers.find((x) => x.id === cust.id)!;
      expect(c.firstName).toBeTruthy();
      expect(c.taxId).toBeUndefined();
      expect(JSON.stringify(S.store.requireWorkspace())).not.toContain("12345678Z");
      await F.sync.open(orgId);
      expect(F.store.requireWorkspace().customers.find((x) => x.id === cust.id)!.taxId).toBe("12345678Z");
    }
  }, 240_000);
});
