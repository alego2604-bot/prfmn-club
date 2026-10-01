import { describe, expect, it } from "vitest";
import { enabledModules, hasModule, productKindsFor } from "./modules";
import { Store } from "@/data/store";
import { createMemoryKV } from "@/data/persistence";
import { login, registerAccount } from "@/data/repos/auth";
import { sha256Hex } from "@/lib/hash";

describe("Core vs verticales", () => {
  it("el módulo fitness depende del sector o de la configuración, nunca del nombre de la empresa", () => {
    expect(hasModule({ vertical: "fitness" }, "fitness")).toBe(true);
    expect(hasModule({ vertical: "restaurant" }, "fitness")).toBe(false);
    expect(hasModule({ vertical: "restaurant", modules: ["fitness"] }, "fitness")).toBe(true);
    expect(enabledModules({ vertical: "gym", modules: [] })).toEqual([]);
  });
  it("los tipos de producto del core no incluyen conceptos fitness", () => {
    expect(productKindsFor({ vertical: "retail" })).toEqual(["physical", "service", "pack"]);
    expect(productKindsFor({ vertical: "fitness" })).toContain("drop_in");
  });
});

describe("Cuentas locales tras el cambio de nombre", () => {
  it("acepta el hash anterior una vez y lo actualiza al formato nuevo", async () => {
    const store = new Store(createMemoryKV());
    await store.init();
    const u = await registerAccount(store, { fullName: "Ana", email: "ana@test.dev", password: "secreta123" });
    const legacy = await sha256Hex(`prfmn-local:ana@test.dev:secreta123`);
    await store.updateMeta((m) => ({ ...m, users: m.users.map((x) => (x.id === u.id ? { ...x, passwordHash: legacy } : x)) }));
    const logged = await login(store, "ana@test.dev", "secreta123");
    expect(logged.passwordHash).not.toBe(legacy);
    expect(store.getMeta().users[0]!.passwordHash).toBe(logged.passwordHash);
    await expect(login(store, "ana@test.dev", "mal")).rejects.toThrow();
  });
});
