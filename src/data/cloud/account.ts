/**
 * Cuenta y empresas en modo Supabase: Auth real (email + contraseña), membresías y alta de empresa.
 * Solo usa la clave pública (anon): la seguridad la imponen RLS y las funciones del servidor.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Member, RoleKey, UserAccount, Vertical } from "@/domain/types";
import { normalizeOverrides, type PermissionOverrides } from "@/domain/permissions";
import { CloudError } from "./sync";

export interface CloudConfig { url: string; anonKey: string }

export function cloudConfig(): CloudConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

export function createCloudClient(cfg: CloudConfig, storage?: Storage): SupabaseClient {
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "bos.auth", storage },
  });
}

export type CloudUser = Pick<UserAccount, "id" | "email" | "fullName">;
export interface OrgSummary { id: string; name: string; isDemo: boolean; vertical: string }

const toUser = (u: { id: string; email?: string; user_metadata?: Record<string, unknown> }): CloudUser => ({
  id: u.id,
  email: u.email ?? "",
  fullName: String(u.user_metadata?.full_name ?? u.email?.split("@")[0] ?? "Usuario"),
});

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Email o contraseña incorrectos";
  if (/already registered|already exists/i.test(message)) return "Ya existe una cuenta con ese email";
  if (/email not confirmed/i.test(message)) return "Confirma tu email antes de entrar (revisa tu bandeja de entrada)";
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return "La contraseña debe tener al menos 8 caracteres";
  if (/fetch|network/i.test(message)) return "No hay conexión con el servidor. Inténtalo de nuevo.";
  return message;
}

export async function currentUser(sb: SupabaseClient): Promise<CloudUser | null> {
  const { data } = await sb.auth.getSession();
  return data.session ? toUser(data.session.user) : null;
}

export async function signIn(sb: SupabaseClient, email: string, password: string): Promise<CloudUser> {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new CloudError(friendlyAuthError(error.message));
  return toUser(data.user);
}

export async function signUp(sb: SupabaseClient, input: { fullName: string; email: string; password: string }): Promise<{ user: CloudUser | null; needsConfirmation: boolean }> {
  if (!input.fullName.trim()) throw new CloudError("Tu nombre es obligatorio");
  if (input.password.length < 8) throw new CloudError("La contraseña debe tener al menos 8 caracteres");
  const { data, error } = await sb.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw new CloudError(friendlyAuthError(error.message));
  if (!data.session) return { user: null, needsConfirmation: true };
  return { user: toUser(data.user!), needsConfirmation: false };
}

export async function signOut(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut();
}

export async function memberships(sb: SupabaseClient, userId: string): Promise<{ members: Member[]; orgs: OrgSummary[] }> {
  const { data, error } = await sb
    .from("organization_members")
    .select("id, organization_id, user_id, location_ids, status, created_at, permission_overrides, roles(key), organizations(id, name, is_demo, vertical)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new CloudError(error.message, error.code);
  const rows = (data ?? []) as unknown as {
    id: string; organization_id: string; user_id: string; location_ids: string[] | null; status: Member["status"]; created_at: string; permission_overrides: unknown;
    roles: { key: RoleKey } | null; organizations: { id: string; name: string; is_demo: boolean; vertical: string } | null;
  }[];
  return {
    members: rows.map((r) => ({
      id: r.id, organizationId: r.organization_id, userId: r.user_id, role: r.roles?.key ?? "read_only", locationIds: r.location_ids, status: r.status, createdAt: r.created_at,
      permissionOverrides: normalizeOverrides(r.permission_overrides),
    })),
    orgs: rows.filter((r) => r.organizations).map((r) => ({ id: r.organizations!.id, name: r.organizations!.name, isDemo: r.organizations!.is_demo, vertical: r.organizations!.vertical })),
  };
}

export async function createOrganization(
  sb: SupabaseClient,
  input: { name: string; vertical: Vertical; locationName: string; legalName?: string; taxId?: string; city?: string; isDemo?: boolean },
): Promise<string> {
  if (!input.name.trim()) throw new CloudError("El nombre de la empresa es obligatorio");
  const { data, error } = await sb.rpc("create_organization", {
    p_name: input.name.trim(),
    p_vertical: input.vertical,
    p_location_name: input.locationName.trim() || "Principal",
    p_legal_name: input.legalName?.trim() || null,
    p_tax_id: input.taxId?.trim() || null,
    p_is_demo: !!input.isDemo,
  });
  if (error) throw new CloudError(error.message, error.code);
  const orgId = String(data);
  if (input.city?.trim()) await sb.from("organizations").update({ city: input.city.trim() }).eq("id", orgId);
  return orgId;
}

export async function addMemberByEmail(sb: SupabaseClient, orgId: string, email: string, role: RoleKey, locationIds: string[] | null): Promise<void> {
  const { error } = await sb.rpc("add_member_by_email", { p_org: orgId, p_email: email, p_role: role, p_location_ids: locationIds });
  if (error) throw new CloudError(error.message, error.code);
}

export async function updateMember(sb: SupabaseClient, memberId: string, patch: { role?: RoleKey; locationIds?: string[] | null; status?: Member["status"] }): Promise<void> {
  const { error } = await sb.rpc("update_member", {
    p_member: memberId,
    p_role: patch.role ?? null,
    p_location_ids: patch.locationIds ?? null,
    p_all_locations: patch.locationIds === null,
    p_status: patch.status ?? null,
  });
  if (error) throw new CloudError(error.message, error.code);
}

/** Excepciones individuales de un miembro (RPC set_member_overrides, migración 0920): el servidor valida quién puede darlas. */
export async function setMemberOverrides(sb: SupabaseClient, memberId: string, overrides: PermissionOverrides): Promise<void> {
  const { error } = await sb.rpc("set_member_overrides", { p_member: memberId, p_grant: overrides.grant, p_revoke: overrides.revoke });
  if (error) throw new CloudError(/set_member_overrides|schema cache|Could not find the function/i.test(error.message)
    ? "El servidor aún no admite permisos individuales (migración 0920 pendiente de aplicar)" : error.message, error.code);
}
