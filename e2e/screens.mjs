/**
 * Business OS · revisión visual. Crea una cuenta y la empresa DEMO (datos ficticios) en el Supabase al que apunta
 * la app y captura las pantallas CORE en escritorio, tablet y móvil, en claro y oscuro.
 *   E2E_BASE_URL=http://127.0.0.1:5173 node e2e/screens.mjs [prefijo]
 * Salida: e2e/results/screens/<prefijo>-<pantalla>-<dispositivo>-<tema>.png (no se versiona).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const OUT = join(process.cwd(), "e2e", "results", "screens");
const PREFIX = process.argv[2] ?? "v2";
const ONLY = process.env.SCREENS?.split(",");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const EMAIL = `screens-${run}@empresa.test`;
const PASSWORD = "contraseña-capturas";

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true },
  ipadv: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const SCREENS = [
  ["dashboard", "/"],
  ["finanzas", "/finanzas"],
  ["flujo", "/flujo-de-caja"],
  ["impuestos", "/impuestos"],
  ["gastos", "/gastos"],
  ["proveedores", "/proveedores"],
  ["caja", "/caja"],
  ["ventas", "/ventas"],
  ["cierres", "/cierres"],
  ["clientes", "/clientes"],
  ["cliente", null],
  ["membresias", "/membresias"],
  ["seguimiento", "/seguimiento"],
  ["facturas", "/facturas"],
  ["factura", null],
  ["factura-nueva", "/facturas/nueva"],
  ["cobros", "/pagos"],
  ["importaciones", "/importaciones"],
  ["importacion", null],
  ["informes", "/informes"],
  ["informe", "/informes/revenue"],
  ["catalogo", "/catalogo"],
  ["empresa", "/ajustes?tab=empresa"],
  ["centros", "/ajustes?tab=centros"],
  ["ajustes", "/ajustes?tab=facturacion"],
  ["selector-empresa", "/"],
  ["onboarding", "/bienvenida"],
].filter(([n]) => !ONLY || ONLY.includes(n));

const browser = await chromium.launch();
const errors = [];
const setup = await browser.newContext({ ...VIEWPORTS.desktop, locale: "es-ES", timezoneId: "Europe/Madrid" });
const p0 = await setup.newPage();
await p0.goto(BASE + "/");
if (await p0.getByLabel("Nombre y apellidos").count() === 0) await p0.getByRole("button", { name: "Crear cuenta" }).first().click();
await p0.getByLabel("Nombre y apellidos").fill("Laura Méndez");
await p0.getByLabel("Email").fill(EMAIL);
await p0.getByLabel("Contraseña").fill(PASSWORD);
await p0.getByRole("button", { name: "Crear cuenta" }).last().click();
await p0.screenshot({ path: join(OUT, `${PREFIX}-onboarding-desktop-light.png`) });
// Una segunda empresa (sintética) para que el selector muestre el caso multiempresa real
if (!process.env.SINGLE_COMPANY) {
  await p0.getByLabel("Nombre comercial").fill("Estudio Pilates Mar (ejemplo)");
  await p0.getByLabel("Ciudad").fill("Ciudad Demo");
  await p0.getByRole("button", { name: "Crear empresa" }).click();
  await p0.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 60000 });
  await p0.locator('[data-testid="company-switcher"]:visible').first().click();
  await p0.getByText("Crear empresa o abrir la demo").click();
}
await p0.getByRole("button", { name: /demo/i }).first().click();
// «Hola,» también aparece en el selector de empresa: se espera a la app (indicador de sincronización)
await p0.locator('[data-testid="sync-indicator"]').first().waitFor({ state: "attached", timeout: 180000 });
// Con servidor, la demo se sube por lotes: se espera a ver el progreso y a que termine
await p0.getByText(/Preparando la empresa demo/).first().waitFor({ timeout: 10000 }).catch(() => {});
await p0.waitForFunction(() => (document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") ?? "idle") === "idle", null, { timeout: 480000 });
// Caja abierta para capturar la Caja en uso
await p0.goto(BASE + "/caja");
await p0.getByRole("button", { name: "Abrir caja" }).click().catch(() => {});
await p0.waitForTimeout(1500);
console.log("contexto guardado:", await p0.evaluate(() => JSON.stringify({ last: localStorage.getItem("bos.session"), tab: sessionStorage.getItem("bos.tab.ctx"), url: location.pathname })));
const storage = await setup.storageState({ indexedDB: true }); // modo local: la sesión vive en IndexedDB
await setup.close();

for (const [device, opts] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...opts, storageState: storage, locale: "es-ES", timezoneId: "Europe/Madrid", colorScheme: theme, reducedMotion: "reduce" });
    await ctx.addInitScript((t) => localStorage.setItem("bos.theme", t), theme);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${device}/${theme}: ${e.message}`));
    for (const [name, path] of SCREENS) {
      try {
        if (name === "cliente") {
          await page.goto(BASE + "/clientes");
          await page.locator('tbody tr, [data-testid="table-cards"] li button').first().click();
        } else if (name === "factura") {
          await page.goto(BASE + "/facturas");
          await page.locator('tbody tr, [data-testid="table-cards"] li button').first().click();
        } else if (name === "importacion") {
          await page.goto(BASE + "/importaciones");
          await page.locator('tbody tr, [data-testid="table-cards"] li button').first().click();
        } else await page.goto(BASE + path);
        if (await page.getByText("Elige empresa").count()) { await page.getByText("Atlas Training Club (demo)").first().click(); await page.goto(BASE + (path ?? "/")); }
        await page.locator('[data-testid="sync-indicator"]').first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
        await page.waitForFunction(() => (document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") ?? "idle") === "idle", null, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(2200);
        if (name === "caja" && device !== "mobile") {
          const tiles = page.locator("section button.group");
          await tiles.nth(0).click().catch(() => {});
          await tiles.nth(0).click().catch(() => {});
          await tiles.nth(4).click().catch(() => {});
          await page.getByRole("radio", { name: "Tarjeta" }).click().catch(() => {});
          await page.waitForTimeout(400);
        }
        if (name === "selector-empresa") {
          await page.waitForTimeout(400);
          await page.locator(device === "mobile" ? 'header button[aria-label^="Empresa activa"]' : '[data-testid="company-switcher"]:visible').first().click();
          await page.waitForTimeout(500);
          if (device === "mobile") await page.locator('[role="dialog"] [data-testid="company-switcher"]').first().click().catch(() => {});
          await page.waitForTimeout(400);
        }
        const overlay = name === "selector-empresa" || (name === "caja" && device !== "mobile");
        await page.screenshot({ path: join(OUT, `${PREFIX}-${name}-${device}-${theme}.jpg`), type: "jpeg", quality: 72, fullPage: !overlay });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) errors.push(`${device}/${theme}/${name}: desbordamiento horizontal de ${overflow}px`);
      } catch (e) {
        errors.push(`${device}/${theme}/${name}: ${e.message.split("\n")[0]}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `Incidencias:\n${errors.join("\n")}` : "Sin incidencias (errores JS ni desbordamiento horizontal)");
