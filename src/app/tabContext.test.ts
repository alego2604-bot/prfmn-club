import { describe, expect, it } from "vitest";
import { readTabContext, urlForOrg, orgFromUrl, writeTabContext } from "./tabContext";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("Contexto por pestaña", () => {
  it("dos pestañas con empresas distintas no se cambian el contexto entre sí", () => {
    const shared = mem(); // localStorage (común al navegador)
    const tabA = mem();
    const tabB = mem();
    writeTabContext({ userId: "u", orgId: "empresa-1", locationId: "c1" }, { tab: tabA, last: shared });
    // B se abre después: arranca con la última usada…
    expect(readTabContext({ tab: tabB, last: shared, urlOrg: null })?.orgId).toBe("empresa-1");
    // …y cambia a la empresa 2
    writeTabContext({ userId: "u", orgId: "empresa-2" }, { tab: tabB, last: shared });
    // A recarga: sigue en la empresa 1 aunque la última usada del navegador sea la 2
    expect(readTabContext({ tab: tabA, last: shared, urlOrg: null })).toEqual({ userId: "u", orgId: "empresa-1", locationId: "c1" });
    expect(readTabContext({ tab: tabB, last: shared, urlOrg: null })?.orgId).toBe("empresa-2");
  });

  it("una pestaña nueva abierta con ?empresa= usa esa empresa (sin heredar el centro de otra)", () => {
    const shared = mem();
    writeTabContext({ userId: "u", orgId: "empresa-1", locationId: "c1" }, { tab: mem(), last: shared });
    const fresh = mem();
    expect(readTabContext({ tab: fresh, last: shared, urlOrg: "empresa-2" })).toEqual({ userId: "u", orgId: "empresa-2", locationId: undefined });
    expect(readTabContext({ tab: fresh, last: shared, urlOrg: "empresa-1" })?.locationId).toBe("c1");
  });

  it("cerrar sesión limpia el contexto", () => {
    const shared = mem();
    const tab = mem();
    writeTabContext({ userId: "u", orgId: "e" }, { tab, last: shared });
    writeTabContext(null, { tab, last: shared });
    expect(readTabContext({ tab, last: shared, urlOrg: null })).toBeNull();
  });

  it("URL para abrir una empresa en otra pestaña", () => {
    expect(urlForOrg("abc")).toBe("/?empresa=abc");
    expect(orgFromUrl("?empresa=abc&x=1")).toBe("abc");
    expect(orgFromUrl("")).toBeNull();
  });
});
