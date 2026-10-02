/**
 * Business OS · E2E multiempresa (navegador real; modo local o Supabase).
 *
 * Una persona con DOS empresas: «Empresa Uno» (vacía) y la demo (2 centros, miles de ventas sintéticas).
 *  1. Pestaña A en Empresa Uno; pestaña B abierta con «Abrir en pestaña nueva» en la demo.
 *  2. Cada pestaña mantiene su empresa, también tras recargar las dos.
 *  3. Nunca se mezclan datos: Ventas de A vacía, Ventas de B con la demo.
 *  4. En B, filtro de centro: Centro Sur ≠ consolidado; A no se entera.
 *
 *   E2E_BASE_URL=http://127.0.0.1:5173 node e2e/multiempresa.e2e.mjs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "results");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const results = [];
const errors = [];

const step = async (page, name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✘ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `multi-fail-${name.replace(/\W+/g, "_")}.png`) }).catch(() => {});
  }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const idle = (page) => page.waitForFunction(() => (document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") ?? "idle") === "idle", null, { timeout: 180000 });
const company = async (page) => (await page.locator('[data-testid="company-switcher"]').first().getAttribute("aria-label")) ?? "";
const registros = async (page) => {
  await page.goto(BASE + "/ventas");
  await idle(page);
  const empty = page.getByText("Aún no hay ventas");
  const count = page.getByText(/[\d.]+ registros?/).first();
  await Promise.race([empty.waitFor({ timeout: 20000 }), count.waitFor({ timeout: 20000 })]);
  if (await empty.isVisible().catch(() => false)) return 0;
  return Number((await count.innerText()).replace(/\D/g, ""));
};
const revenue = async (page) => {
  await page.goto(BASE + "/");
  await page.getByText("Facturación").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return (await page.getByText(/^[\d.]+,\d{2}\s€$/).first().innerText()).trim();
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid" });
const A = await ctx.newPage();
A.on("pageerror", (e) => errors.push(`A: ${e.message}`));
let B = null;
console.log("Multiempresa");

await step(A, "cuenta + Empresa Uno", async () => {
  await A.goto(BASE + "/");
  if (await A.getByLabel("Nombre y apellidos").count() === 0) await A.getByRole("button", { name: "Crear cuenta" }).first().click();
  await A.getByLabel("Nombre y apellidos").fill("Persona Multiempresa");
  await A.getByLabel("Email").fill(`multi-${run}@empresa.test`);
  await A.getByLabel("Contraseña").fill("contraseña-multi-segura");
  await A.getByRole("button", { name: "Crear cuenta" }).last().click();
  await A.getByLabel("Nombre comercial").fill(`Empresa Uno ${run}`);
  await A.getByLabel("Ciudad").fill("Ciudad Demo");
  await A.getByRole("button", { name: "Crear empresa" }).click();
  await A.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 30000 });
  await idle(A);
});

await step(A, "segunda empresa (demo) desde el selector", async () => {
  await A.locator('[data-testid="company-switcher"]').first().click();
  await A.getByText("Crear empresa o abrir la demo").click();
  await A.getByRole("button", { name: /demo/i }).first().click();
  await A.getByText(/Hola,/).first().waitFor({ timeout: 120000 });
  // Con servidor, la demo se sube por lotes: se espera a que el indicador muestre el progreso y termine
  await A.getByText(/Preparando la empresa demo/).first().waitFor({ timeout: 10000 }).catch(() => {});
  await idle(A);
  expect((await company(A)).includes("Atlas"), "la pestaña A debería estar en la demo");
});

await step(A, "A vuelve a Empresa Uno (aviso de cambio)", async () => {
  await A.locator('[data-testid="company-switcher"]').first().click();
  await A.getByRole("button", { name: new RegExp(`Empresa Uno ${run}`) }).first().click();
  await A.getByText(/Ahora estás en Empresa Uno/).waitFor({ timeout: 20000 });
  expect((await company(A)).includes("Empresa Uno"), "A debería estar en Empresa Uno");
});

await step(A, "B se abre con la demo en otra pestaña", async () => {
  await A.locator('[data-testid="company-switcher"]').first().click();
  const [popup] = await Promise.all([ctx.waitForEvent("page"), A.getByRole("button", { name: /Abrir Atlas.* en una pestaña nueva/ }).click()]);
  B = popup;
  B.on("pageerror", (e) => errors.push(`B: ${e.message}`));
  await B.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 60000 });
  expect((await company(B)).includes("Atlas"), "B debería abrir la demo");
  expect(!B.url().includes("empresa="), "la URL de B debería limpiarse");
  expect((await company(A)).includes("Empresa Uno"), "abrir B no debe cambiar A");
});

await step(A, "cada pestaña conserva su empresa tras recargar las dos", async () => {
  await A.reload();
  await B.reload();
  await A.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 60000 });
  await B.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 60000 });
  expect((await company(A)).includes("Empresa Uno"), `A tras recargar: ${await company(A)}`);
  expect((await company(B)).includes("Atlas"), `B tras recargar: ${await company(B)}`);
  expect((await A.title()).includes("Empresa Uno") && (await B.title()).includes("Atlas"), "el título de cada pestaña nombra su empresa");
});

await step(A, "datos aislados: Ventas de A vacía, de B con la demo", async () => {
  const a = await registros(A);
  const b = await registros(B);
  expect(a === 0, `A tiene ${a} ventas`);
  expect(b > 1000, `B tiene ${b} ventas`);
});

await step(A, "filtro de centro en B (consolidado vs Centro Sur) sin afectar a A", async () => {
  const all = await registros(B);
  const revAll = await revenue(B);
  await B.locator('[data-testid="location-switcher"]').first().click();
  await B.getByRole("button", { name: "Centro Sur" }).click();
  const south = await registros(B);
  const revSouth = await revenue(B);
  expect(south > 0 && south < all, `Centro Sur ${south} vs todos ${all}`);
  expect(revSouth !== revAll, `facturación Centro Sur ${revSouth} = consolidado ${revAll}`);
  await A.reload();
  await A.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 60000 });
  expect((await company(A)).includes("Empresa Uno"), "A no cambia");
  await B.screenshot({ path: join(OUT, "multi-B-centro-sur.png") });
  await A.screenshot({ path: join(OUT, "multi-A-empresa-uno.png") });
});

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} pasos OK · errores de consola: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(ok === results.length && !errors.length ? 0 : 1);
