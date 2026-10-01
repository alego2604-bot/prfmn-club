/**
 * CORE vs VERTICALES. El core (ventas, caja, catálogo, clientes, finanzas, datos, analytics) no conoce ningún sector.
 * Un vertical añade capacidades sobre el core; se activa por empresa (espejo de public.organization_modules).
 * Nunca se decide por el nombre de una empresa concreta.
 */
import type { Organization, ProductKind, Vertical } from "./types";

export type VerticalModule = "fitness";

/** Módulos que se activan por defecto según el tipo de negocio elegido al crear la empresa. */
const DEFAULT_MODULES: Record<Vertical, VerticalModule[]> = {
  fitness: ["fitness"],
  gym: ["fitness"],
  functional_training: ["fitness"],
  restaurant: [],
  retail: [],
  services: [],
  beauty: [],
  clinic: [],
  other: [],
};

export const MODULE_INFO: Record<VerticalModule, { name: string; description: string }> = {
  fitness: { name: "Fitness", description: "Membresías con créditos, bonos, drop-ins, asistencia y seguimiento por asistencia." },
};

export function enabledModules(org: Pick<Organization, "vertical" | "modules">): VerticalModule[] {
  return org.modules ?? DEFAULT_MODULES[org.vertical] ?? [];
}

export function hasModule(org: Pick<Organization, "vertical" | "modules">, m: VerticalModule): boolean {
  return enabledModules(org).includes(m);
}

/** Tipos de producto del core + los que aporta cada vertical. */
export function productKindsFor(org: Pick<Organization, "vertical" | "modules">): ProductKind[] {
  const core: ProductKind[] = ["physical", "service", "pack"];
  return hasModule(org, "fitness") ? [...core, "membership", "drop_in"] : core;
}
