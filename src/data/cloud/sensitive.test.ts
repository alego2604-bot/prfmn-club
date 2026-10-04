import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { createMemoryKV } from "../persistence";
import { buildWorkspace } from "../workspace";
import type { Customer } from "@/domain/types";
import { CloudSync } from "./sync";
import { fakeServer } from "./fakeServer.testutil";
import { normalizeOverrides } from "@/domain/permissions";

/**
 * Lectura de clientes con la migración 0920: tabla sin columnas sensibles (customers_safe) + RPC customers_sensitive solo con
 * permiso. Y compatibilidad con un servidor anterior (0910): se sigue leyendo la tabla completa.
 */
const fiscal = (id: string, orgId: string, n: number): Customer => ({
  id, organizationId: orgId, firstName: `Cliente ${n}`, status: "active", tags: [], email: `c${n}@x.test`, phone: "600",
  taxId: `T${n}`, taxIdNormalized: `T${n}`, taxIdValid: true, address: `Calle ${n}`, postalCode: "28001", city: "Madrid", companyName: "SL", birthDate: "1990-01-01",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
}) as Customer;

async function open(server: ReturnType<typeof fakeServer>, n = 3) {
  const ws = buildWorkspace({ name: "Empresa Ejemplo", vertical: "fitness", locationName: "Centro" });
  const ids = Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  ws.customers = ids.map((id, i) => fiscal(id, ws.organization.id, i));
  server.seedFrom(ws);
  const kv = createMemoryKV();
  const store = new Store(kv);
  await store.init();
  const sync = new CloudSync(server.sb, kv, store, { tabId: async () => "t1", liveTabs: async () => new Set(["t1"]) });
  await sync.open(ws.organization.id);
  return { store, sync, ids };
}

describe("lectura de clientes: datos sensibles solo con permiso", () => {
  it("servidor 0920 + customers.sensitive: la ficha completa llega (vista + RPC)", async () => {
    const server = fakeServer();
    server.setSchema(920);
    const { store } = await open(server);
    const c = store.requireWorkspace().customers.find((x) => x.firstName === "Cliente 1")!;
    expect(c).toMatchObject({ taxId: "T1", address: "Calle 1", postalCode: "28001", city: "Madrid", companyName: "SL", birthDate: "1990-01-01", email: "c1@x.test", phone: "600" });
  });

  it("servidor 0920 sin customers.sensitive: el dispositivo nunca recibe NIF, dirección, empresa ni nacimiento (ni en la caché)", async () => {
    const server = fakeServer();
    server.setSchema(920);
    server.setCanSensitive(false);
    const { store } = await open(server);
    const c = store.requireWorkspace().customers.find((x) => x.firstName === "Cliente 1")!;
    expect(c.email).toBe("c1@x.test");
    for (const k of ["taxId", "taxIdNormalized", "taxIdValid", "address", "postalCode", "city", "companyName", "birthDate"] as const) expect(c[k], k).toBeUndefined();
    expect(JSON.stringify(store.requireWorkspace())).not.toMatch(/Calle 1|T1"|1990-01-01/);
  });

  it("servidor anterior (sin 0920): se lee la tabla completa como siempre", async () => {
    const server = fakeServer();               // schema 900
    const { store } = await open(server);
    expect(store.requireWorkspace().customers.find((x) => x.firstName === "Cliente 2")!.taxId).toBe("T2");
  });

  it("muchos clientes: la RPC pagina por id y no se pierde ni se repite ninguno", async () => {
    const server = fakeServer();
    server.setSchema(920);
    const { store } = await open(server, 2300);
    const cs = store.requireWorkspace().customers;
    expect(cs).toHaveLength(2300);
    expect(new Set(cs.map((c) => c.id)).size).toBe(2300);
    expect(cs.every((c) => c.taxId?.startsWith("T"))).toBe(true);
  }, 30_000);

  it("las excepciones de permisos del equipo viajan con cada miembro", () => {
    expect(normalizeOverrides({ grant: ["invoices.manage"], revoke: ["sales.void"] })).toEqual({ grant: ["invoices.manage"], revoke: ["sales.void"] });
  });
});
