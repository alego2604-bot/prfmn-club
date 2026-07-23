import type { Role } from "./types";

// Modelo de capacidades — ver docs/ARCHITECTURE.md#autorización.
// La UI pregunta can(capability), nunca compara role === "owner" directamente,
// para que permission_overrides por usuario (Fase 6) no requieran tocar componentes.

export type Capability =
  | "dashboard.financial"
  | "dashboard.operational"
  | "clients.view"
  | "clients.edit"
  | "leads.manage"
  | "bookings.manage"
  | "pos.sell"
  | "inventory.manage"
  | "billing.view"
  | "billing.manage"
  | "communications.send"
  | "automations.manage"
  | "settings.manage"
  | "settings.billing_integration";

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: [
    "dashboard.financial",
    "dashboard.operational",
    "clients.view",
    "clients.edit",
    "leads.manage",
    "bookings.manage",
    "pos.sell",
    "inventory.manage",
    "billing.view",
    "billing.manage",
    "communications.send",
    "automations.manage",
    "settings.manage",
    "settings.billing_integration",
  ],
  manager: [
    "dashboard.financial",
    "dashboard.operational",
    "clients.view",
    "clients.edit",
    "leads.manage",
    "bookings.manage",
    "pos.sell",
    "inventory.manage",
    "billing.view",
    "billing.manage",
    "communications.send",
    "automations.manage",
    "settings.manage",
  ],
  coach: ["dashboard.operational", "clients.view", "bookings.manage", "pos.sell"],
  reception: ["dashboard.operational", "clients.view", "bookings.manage", "pos.sell", "leads.manage"],
  athlete: [],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export const CURRENT_ROLE: Role = "owner"; // Fase 2: sesión simulada, ver docs/CHANGELOG.md
