/**
 * Business OS · E2E de persistencia (navegador real, Supabase real).
 *
 * crear cuenta → crear empresa → crear producto → crear cliente → registrar venta → cerrar caja → logout
 * → cerrar navegador → volver a entrar → verificar que todo permanece
 * → abrir la misma cuenta en OTRO navegador (perfil limpio, otro dispositivo) → verificar los mismos datos.
 *
 * Requiere la app apuntando a un Supabase (stack local o staging):
 *   E2E_BASE_URL=http://127.0.0.1:5173 node e2e/persistence.e2e.mjs
 * Usa una cuenta y una empresa sintéticas nuevas en cada ejecución.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";
import { createConsoleWatch } from "./consoleWatch.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "results");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const EMAIL = `e2e-${run}@empresa.test`;
const PASSWORD = "contraseña-e2e-segura";
const COMPANY = `Empresa E2E ${run}`;
const PRODUCT = `Agua E2E ${run}`;
const results = [];
const cw = createConsoleWatch();

const step = async (page, name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✘ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `fail-${name.replace(/\W+/g, "_")}.png`) }).catch(() => {});
  }
};
const watch = (page, label) => {
  cw.watch(page, label);
};
/** Espera a que no quede nada pendiente de guardar en el servidor. */
const saved = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") === "idle", null, { timeout: 15000 });
};
const expectText = async (page, path, texts) => {
  await page.goto(BASE + path);
  for (const t of texts) await page.getByText(t, { exact: false }).first().waitFor({ timeout: 15000 });
};
const login = async (page) => {
  await page.goto(BASE + "/");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 20000 });
  await saved(page);
};
const verifyAll = async (page, who) => {
  await step(page, `${who}: producto persistido`, () => expectText(page, "/catalogo", [PRODUCT]));
  await step(page, `${who}: cliente persistido`, () => expectText(page, "/clientes", ["Cliente Uno"]));
  await step(page, `${who}: venta persistida (importe y cliente)`, () => expectText(page, "/ventas", ["3,00", "Cliente Uno"]));
  await step(page, `${who}: cierre de caja persistido`, () => expectText(page, "/cierres", ["Cuadrada"]));
  await step(page, `${who}: dashboard calculado con los datos del servidor`, () => expectText(page, "/", ["3,00"]));
};

// ── Navegador A ───────────────────────────────────────────────────────────────────────────────────────────────
const profileA = mkdtempSync(join(tmpdir(), "bos-e2e-a-"));
let ctxA = await chromium.launchPersistentContext(profileA, { viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid" });
let page = ctxA.pages()[0] ?? (await ctxA.newPage());
watch(page, "A");
console.log("Navegador A");

await step(page, "crear cuenta", async () => {
  await page.goto(BASE + "/");
  const toRegister = page.getByRole("button", { name: "Crear cuenta" });
  if (await page.getByLabel("Nombre y apellidos").count() === 0) await toRegister.first().click();
  await page.getByLabel("Nombre y apellidos").fill("Persona E2E");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await page.getByLabel("Nombre comercial").waitFor({ timeout: 15000 });
});
await step(page, "crear empresa", async () => {
  await page.getByLabel("Nombre comercial").fill(COMPANY);
  await page.getByLabel("Ciudad").fill("Ciudad Demo");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await page.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 20000 });
  await saved(page);
});
await step(page, "crear producto", async () => {
  await page.goto(BASE + "/catalogo?nuevo=1");
  await page.getByPlaceholder("Nombre del producto o servicio").fill(PRODUCT);
  await page.getByLabel(/^Precio \(IVA incl\.\)/).fill("1,50");
  await page.getByRole("button", { name: "Crear producto" }).click();
  await page.getByText(PRODUCT).first().waitFor();
  await saved(page);
});
await step(page, "crear cliente", async () => {
  await page.goto(BASE + "/clientes?nuevo=1");
  await page.getByLabel(/^Nombre/).first().fill("Cliente");
  await page.getByLabel("Apellidos").fill("Uno");
  await page.getByLabel("Email").fill("cliente.uno@example.com");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Cliente Uno").first().waitFor();
  await saved(page);
});
await step(page, "registrar venta (2 × producto, cliente, efectivo)", async () => {
  await page.goto(BASE + "/caja");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await saved(page);
  const product = page.getByRole("button", { name: new RegExp(`^${PRODUCT}`) }).first();
  await product.click();
  await product.click();
  await page.getByText("Cliente (opcional)").click();
  await page.getByPlaceholder("Nombre, NIF, teléfono…").fill("Cliente");
  await page.getByRole("button", { name: /Cliente Uno/ }).first().click();
  await page.getByRole("radio", { name: "Efectivo" }).click();
  await page.getByRole("button", { name: /^Cobrar/ }).click();
  await page.getByText(/registrada/i).first().waitFor();
  await saved(page);
});
await step(page, "cerrar caja (cuadrada)", async () => {
  await page.goto(BASE + "/cierres");
  await page.getByRole("button", { name: "Cerrar caja" }).first().click();
  await page.getByLabel("Efectivo contado en el cajón").fill("3,00");
  await page.getByRole("button", { name: "Confirmar cierre" }).click();
  await page.getByText("Cuadrada").first().waitFor();
  await saved(page);
});
await page.screenshot({ path: join(OUT, "A-before-logout.png") }).catch(() => {});
await step(page, "logout", async () => {
  await page.getByRole("button", { name: "Cuenta" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).or(page.getByText("Cerrar sesión")).first().click();
  await page.getByRole("button", { name: "Entrar" }).waitFor();
});
await step(page, "la caché local se borra al salir", async () => {
  const keys = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("business-os");
    r.onsuccess = () => { const tx = r.result.transaction("kv"); const q = tx.objectStore("kv").getAllKeys(); q.onsuccess = () => res(q.result.map(String)); };
  }));
  if (keys.some((k) => k.startsWith("ws:"))) throw new Error(`quedan datos de empresa en el dispositivo: ${keys.join(", ")}`);
});
await ctxA.close();

// ── Navegador A reabierto (mismo perfil) ──────────────────────────────────────────────────────────────────────
console.log("Navegador A (reabierto)");
ctxA = await chromium.launchPersistentContext(profileA, { viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid" });
page = ctxA.pages()[0] ?? (await ctxA.newPage());
watch(page, "A2");
await step(page, "volver a entrar", () => login(page));
await verifyAll(page, "A");
await page.screenshot({ path: join(OUT, "A-after-relogin.png") });
await ctxA.close();

// ── Navegador B: otro dispositivo (iPad, perfil limpio) ───────────────────────────────────────────────────────
console.log("Navegador B (otro dispositivo)");
const browserB = await chromium.launch();
const ctxB = await browserB.newContext({ ...devices["iPad Pro 11 landscape"], locale: "es-ES", timezoneId: "Europe/Madrid" });
const pageB = await ctxB.newPage();
watch(pageB, "B");
await step(pageB, "entrar desde otro dispositivo", () => login(pageB));
await verifyAll(pageB, "B");
await step(pageB, "B registra otra venta → A la verá", async () => {
  await pageB.goto(BASE + "/caja");
  await pageB.getByRole("button", { name: "Abrir caja" }).click();
  await saved(pageB);
  await pageB.getByRole("button", { name: new RegExp(`^${PRODUCT}`) }).first().click();
  await pageB.getByRole("radio", { name: "Tarjeta" }).click();
  await pageB.getByRole("button", { name: /^Cobrar/ }).click();
  await pageB.getByText(/registrada/i).first().waitFor();
  await saved(pageB);
});
await pageB.screenshot({ path: join(OUT, "B-ipad.png") });
await browserB.close();

console.log("Navegador A (comprobación final)");
ctxA = await chromium.launchPersistentContext(profileA, { viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid" });
page = ctxA.pages()[0] ?? (await ctxA.newPage());
watch(page, "A3");
await step(page, "A ve la venta hecha en B (sesión conservada)", async () => {
  await page.goto(BASE + "/ventas");
  await saved(page);
  await page.getByText("1,50").first().waitFor({ timeout: 15000 });
});
await ctxA.close();
rmSync(profileA, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
const unexpected = cw.report();
console.log(`\n${results.length - failed.length}/${results.length} pasos OK · errores no esperados: ${unexpected}`);
console.log(JSON.stringify({ email: EMAIL, results }, null, 1).slice(0, 0));
process.exit(failed.length || unexpected ? 1 : 0);
