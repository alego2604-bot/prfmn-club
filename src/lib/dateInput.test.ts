import { describe, expect, it } from "vitest";
import { isoToDisplay, maskDateTyping, parseDisplayDate } from "./dates";

describe("fechas en formato español", () => {
  it("muestra ISO como dd/mm/aaaa", () => {
    expect(isoToDisplay("2026-10-04")).toBe("04/10/2026");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay(undefined)).toBe("");
  });

  it("entiende lo que se escribe y devuelve ISO", () => {
    expect(parseDisplayDate("04/10/2026")).toBe("2026-10-04");
    expect(parseDisplayDate("4/10/2026")).toBe("2026-10-04");
    expect(parseDisplayDate("4-10-26")).toBe("2026-10-04");
    expect(parseDisplayDate("04.10.2026")).toBe("2026-10-04");
    expect(parseDisplayDate("04102026")).toBe("2026-10-04");
    expect(parseDisplayDate("2026-10-04")).toBe("2026-10-04"); // ISO pegado de una hoja de cálculo
    expect(parseDisplayDate("2026-02-30")).toBeNull();
  });

  it("rechaza fechas imposibles o el orden americano", () => {
    expect(parseDisplayDate("31/02/2026")).toBeNull();
    expect(parseDisplayDate("10/31/2026")).toBeNull(); // mm/dd: mes 31
    expect(parseDisplayDate("hoy")).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
  });

  it("añade las barras al escribir solo números", () => {
    expect(maskDateTyping("04", "0")).toBe("04");
    expect(maskDateTyping("041", "04")).toBe("04/1");
    expect(maskDateTyping("04/102", "04/10")).toBe("04/10/2");
    expect(maskDateTyping("04/10/20261", "04/10/2026")).toBe("04/10/2026"); // no pasa de 8 cifras
    expect(maskDateTyping("04/1", "04/10")).toBe("04/1"); // borrando
    expect(maskDateTyping("4/10/2026", "4/10/202")).toBe("4/10/2026");
    expect(maskDateTyping("4", "")).toBe("04"); // un día que empieza por 4-9 es de una cifra
    expect(maskDateTyping("04/", "04")).toBe("04/"); // la barra escrita a mano no desaparece
    expect(maskDateTyping("04/7", "04/")).toBe("04/7");
    expect(maskDateTyping("047", "04")).toBe("04/07"); // un mes que empieza por 2-9 también
    let t = "";
    for (const ch of "4071990") t = maskDateTyping(t + ch, t);
    expect(t).toBe("04/07/1990");
  });
});
