/**
 * Acceso en MODO LOCAL. No es seguridad real (los datos viven en este navegador): evita el uso accidental
 * y modela el flujo definitivo. En Fase 5 se sustituye por Supabase Auth sin cambiar las pantallas.
 */
import type { Member, RoleKey, UserAccount, Vertical } from "@/domain/types";
import { sha256Hex } from "@/lib/hash";
import { nowISO, uid } from "@/lib/ids";
import { ValidationError } from "../context";
import type { Store } from "../store";
import { buildWorkspace } from "../workspace";

const hashPassword = (email: string, password: string) => sha256Hex(`bos-local:${email.toLowerCase()}:${password}`);
/** Hash de cuentas locales creadas antes del cambio de nombre: se acepta una vez y se actualiza al nuevo formato. */
const legacyHash = (email: string, password: string) => sha256Hex(`prfmn-local:${email.toLowerCase()}:${password}`);

export async function registerAccount(store: Store, input: { fullName: string; email: string; password: string }): Promise<UserAccount> {
  const email = input.email.trim().toLowerCase();
  if (!input.fullName.trim()) throw new ValidationError("Tu nombre es obligatorio");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Email no válido");
  if (input.password.length < 8) throw new ValidationError("La contraseña debe tener al menos 8 caracteres");
  if (store.getMeta().users.some((u) => u.email === email)) throw new ValidationError("Ya existe una cuenta con ese email");
  const user: UserAccount = { id: uid(), email, fullName: input.fullName.trim(), passwordHash: await hashPassword(email, input.password), createdAt: nowISO() };
  await store.updateMeta((m) => ({ ...m, users: [...m.users, user] }));
  return user;
}

export async function login(store: Store, email: string, password: string): Promise<UserAccount> {
  const e = email.trim().toLowerCase();
  const user = store.getMeta().users.find((u) => u.email === e);
  if (!user) throw new ValidationError("Email o contraseña incorrectos");
  const current = await hashPassword(e, password);
  if (user.passwordHash === current) return user;
  if (user.passwordHash === (await legacyHash(e, password))) {
    const upgraded = { ...user, passwordHash: current };
    await store.updateMeta((m) => ({ ...m, users: m.users.map((u) => (u.id === user.id ? upgraded : u)) }));
    return upgraded;
  }
  throw new ValidationError("Email o contraseña incorrectos");
}

export function membershipsOf(store: Store, userId: string): Member[] {
  return store.getMeta().members.filter((m) => m.userId === userId && m.status === "active");
}

export async function createOrganization(
  store: Store,
  user: UserAccount,
  input: { name: string; vertical: Vertical; locationName: string; legalName?: string; taxId?: string; city?: string; isDemo?: boolean },
): Promise<string> {
  if (!input.name.trim()) throw new ValidationError("El nombre de la empresa es obligatorio");
  const ws = buildWorkspace(input);
  ws.auditLogs.push({
    id: uid(), organizationId: ws.organization.id, actorId: user.id, actorName: user.fullName, action: "insert",
    entityType: "organizations", entityId: ws.organization.id, entityLabel: ws.organization.name, createdAt: nowISO(),
  });
  await store.createWorkspace(ws);
  const member: Member = { id: uid(), organizationId: ws.organization.id, userId: user.id, role: "owner", locationIds: null, status: "active", createdAt: nowISO() };
  await store.updateMeta((m) => ({
    ...m,
    members: [...m.members, member],
    organizations: [...m.organizations, { id: ws.organization.id, name: ws.organization.name, isDemo: ws.organization.isDemo, vertical: ws.organization.vertical }],
  }));
  return ws.organization.id;
}

/** Añadir un miembro del equipo (crea cuenta local si no existe). */
export async function addTeamMember(
  store: Store,
  orgId: string,
  input: { fullName: string; email: string; password: string; role: RoleKey; locationIds: string[] | null },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  let user = store.getMeta().users.find((u) => u.email === email);
  if (!user) user = await registerAccount(store, { fullName: input.fullName, email, password: input.password });
  if (store.getMeta().members.some((m) => m.userId === user!.id && m.organizationId === orgId)) throw new ValidationError("Esa persona ya forma parte del equipo");
  if (input.role === "owner") throw new ValidationError("Solo puede haber un owner por empresa");
  const member: Member = { id: uid(), organizationId: orgId, userId: user.id, role: input.role, locationIds: input.locationIds, status: "active", createdAt: nowISO() };
  await store.updateMeta((m) => ({ ...m, members: [...m.members, member] }));
}

export async function updateMember(store: Store, memberId: string, patch: Partial<Pick<Member, "role" | "status" | "locationIds">>): Promise<void> {
  const target = store.getMeta().members.find((m) => m.id === memberId);
  if (!target) throw new ValidationError("Miembro no encontrado");
  if (target.role === "owner") throw new ValidationError("El owner no se puede modificar desde aquí");
  if (patch.role === "owner") throw new ValidationError("Solo puede haber un owner por empresa");
  await store.updateMeta((m) => ({ ...m, members: m.members.map((x) => (x.id === memberId ? { ...x, ...patch } : x)) }));
}
