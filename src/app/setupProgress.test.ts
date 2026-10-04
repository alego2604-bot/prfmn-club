import { describe, expect, it } from "vitest";
import { setupPercent, setupPhase, SETUP_PHASES } from "./setupProgress";

describe("progreso de la demo", () => {
  it("nunca retrocede aunque el total crezca (un trozo dividido)", () => {
    let pct = 0;
    const seq = [{ done: 10, total: 57 }, { done: 20, total: 57 }, { done: 20, total: 58 }, { done: 21, total: 58 }, { done: 58, total: 58 }];
    const out = seq.map((p) => (pct = setupPercent(p, pct)));
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    expect(out[out.length - 1]).toBe(95);
  });

  it("traduce tablas a fases comprensibles", () => {
    expect(SETUP_PHASES[setupPhase({ tables: ["locations", "products"] })]).toBe("Configurando centros y catálogo");
    expect(SETUP_PHASES[setupPhase({ tables: ["sales", "sale_items"] })]).toBe("Generando ventas y caja");
    expect(SETUP_PHASES[setupPhase({ tables: ["payments"] })]).toBe("Preparando finanzas");
    expect(SETUP_PHASES[setupPhase({ tables: ["cash_closings", "import_records"] })]).toBe("Terminando");
  });
});
