import { useMemo, useState } from "react";
import { Button, Modal, Segmented, useToast } from "@/design-system/components";
import { ALL_PERMISSIONS, buildOverrides, PERMISSION_INFO, ROLE_LABELS, roleCan, overrideState, type OverrideState, type Permission } from "@/domain/permissions";
import type { RoleKey } from "@/domain/types";
import type { TeamMember } from "@/data/cloud/sync";
import { useSession } from "@/app/session";

/**
 * Permisos individuales de una persona: rol base + excepciones («Permitir» / «Denegar» sobre permisos concretos).
 * Solo se puede PERMITIR lo que quien lo concede ya tiene (el servidor lo vuelve a comprobar); denegar siempre se puede.
 */
export function PermissionOverridesDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { can, setMemberOverrides } = useSession();
  const toast = useToast();
  const role = member.role as RoleKey;
  const [choice, setChoice] = useState<Partial<Record<Permission, OverrideState>>>(() => Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, overrideState(member.permissionOverrides, p)])));
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => {
    const out = new Map<string, Permission[]>();
    for (const p of ALL_PERMISSIONS) out.set(PERMISSION_INFO[p].group, [...(out.get(PERMISSION_INFO[p].group) ?? []), p]);
    return [...out];
  }, []);
  const next = buildOverrides(role, choice);
  const same = JSON.stringify(next) === JSON.stringify({ grant: [...(member.permissionOverrides?.grant ?? [])].sort(), revoke: [...(member.permissionOverrides?.revoke ?? [])].sort() });
  const save = async () => {
    setSaving(true);
    try {
      await setMemberOverrides(member.id, next);
      toast.success("Permisos actualizados");
      onClose();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Permisos de ${member.fullName ?? "esta persona"}`}
      description={`Rol base: ${ROLE_LABELS[role].name}. Cada permiso puede seguir al rol, permitirse o denegarse solo a esta persona.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={same || saving} onClick={save}>Guardar permisos</Button></>}
    >
      <div className="flex flex-col gap-5">
        {groups.map(([group, perms]) => (
          <section key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-3">{group}</h3>
            <div className="divide-y divide-line rounded-lg border border-line">
              {perms.map((p) => {
                const base = roleCan(role, p);
                const state = choice[p] ?? "inherit";
                // No se puede conceder lo que uno mismo no tiene (el rol «Permitir» ya lo da quien lo tiene)
                const grantable = can(p) || state === "allow";
                return (
                  <div key={p} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm">{PERMISSION_INFO[p].label}</p>
                      <p className="text-xs text-fg-3">{base ? "El rol lo incluye" : "El rol no lo incluye"} · <span className="font-mono">{p}</span></p>
                    </div>
                    <Segmented
                      size="sm"
                      value={state}
                      onChange={(v) => setChoice({ ...choice, [p]: v })}
                      items={[
                        { value: "inherit", label: "Según rol" },
                        ...(!base && grantable ? [{ value: "allow" as const, label: "Permitir" }] : []),
                        ...(base ? [{ value: "deny" as const, label: "Denegar" }] : []),
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
