/**
 * Business OS · E2E de negocio (navegador real, Supabase real con la migración 0900).
 *
 * cuenta → empresa → puesta en marcha (datos fiscales) → tarifa → cliente → membresía con primera cuota cobrada
 * → gasto → factura (borrador → emitida con número del servidor) → PDF → exportar gastos (Excel y CSV)
 * → informe exportado → OTRO navegador: gastos, membresía, factura y finanzas persistidos.
 *
 *   E2E_BASE_URL=http://127.0.0.1:5175 node e2e/business.e2e.mjs
 * Cuenta y empresa sintéticas nuevas en cada ejecución.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5175";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "results");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const EMAIL = `biz-${run}@empresa.test`;
const PASSWORD = "contraseña-e2e-segura";
const COMPANY = `Negocio E2E ${run}`;
const results = [];
const errors = [];
let invoiceNumber = "";

const step = async (page, name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✘ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `biz-fail-${name.replace(/\W+/g, "_")}.png`) }).catch(() => {});
  }
};
const watch = (page, label) => {
  page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(`${label} console: ${m.text()}`));
};
const saved = (page) => page.waitForFunction(() => document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") === "idle", null, { timeout: 20000 });
const download = async (page, trigger) => {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), trigger()]);
  const name = d.suggestedFilename();
  await d.saveAs(join(OUT, `biz-${name}`));
  return name;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid", acceptDownloads: true });
const page = await ctx.newPage();
watch(page, "A");
console.log("Navegador A (escritorio)");

await step(page, "crear cuenta y empresa → abre la puesta en marcha", async () => {
  await page.goto(BASE + "/");
  if (await page.getByLabel("Nombre y apellidos").count() === 0) await page.getByRole("button", { name: "Crear cuenta" }).first().click();
  await page.getByLabel("Nombre y apellidos").fill("Persona Negocio");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await page.getByLabel("Nombre comercial").fill(COMPANY);
  await page.getByLabel("Ciudad").fill("Ciudad Demo");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await page.getByText(`Prepara ${COMPANY}`).waitFor({ timeout: 20000 });
  await saved(page);
});
await step(page, "puesta en marcha: datos fiscales y avanzar", async () => {
  await page.goto(BASE + "/bienvenida?paso=fiscal");
  await page.getByLabel("Razón social").fill(`${COMPANY} S.L.`);
  await page.getByLabel("NIF / CIF").fill("B12345678");
  await page.getByLabel("Dirección fiscal").fill("Calle Ejemplo 1");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await page.getByRole("heading", { name: "Centros" }).waitFor();
  await saved(page);
});
await step(page, "crear tarifa de membresía", async () => {
  await page.goto(BASE + "/membresias?tab=tarifas");
  await page.getByRole("button", { name: /Crear tarifa|Nueva tarifa/ }).first().click();
  await page.getByLabel("Nombre").fill("Mensual E2E");
  await page.getByLabel("Precio (IVA incluido)").fill("60,00");
  await page.getByRole("button", { name: "Crear tarifa" }).last().click();
  await page.getByText("Mensual E2E").first().waitFor();
  await saved(page);
});
await step(page, "crear cliente", async () => {
  await page.goto(BASE + "/clientes?nuevo=1");
  await page.getByLabel(/^Nombre/).first().fill("Socia");
  await page.getByLabel("Apellidos").fill("Negocio");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Socia Negocio").first().waitFor();
  await saved(page);
});
await step(page, "alta de membresía con primera cuota cobrada", async () => {
  await page.getByText("Socia Negocio").first().click();
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByText("Nueva membresía").click();
  await page.getByRole("button", { name: /Mensual E2E/ }).click();
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await page.getByText("Membresía dada de alta").waitFor();
  await saved(page);
  await page.getByRole("tab", { name: /Membresía/ }).click();
  await page.getByText("Cobrada").first().waitFor();
});
await step(page, "registrar gasto", async () => {
  await page.goto(BASE + "/gastos");
  await page.getByRole("button", { name: "Nuevo gasto" }).first().click();
  await page.getByLabel("Concepto").fill("Alquiler E2E");
  await page.getByLabel(/Importe total/).fill("121,00");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await page.getByText("Alquiler E2E").first().waitFor();
  await saved(page);
});
await step(page, "factura: borrador → emitida con número del servidor", async () => {
  await page.goto(BASE + "/facturas/nueva");
  await page.getByRole("button", { name: "Otro destinatario" }).click();
  await page.getByLabel("Nombre o razón social").fill("Empresa Cliente E2E SL");
  await page.getByLabel("NIF / CIF").fill("B76543210");
  await page.getByLabel("Descripción de la línea 1").fill("Servicio E2E");
  await page.getByLabel("Precio (IVA incl.)").fill("100,00");
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await page.getByRole("button", { name: "Emitir ahora" }).click();
  await page.getByText("Factura emitida").first().waitFor();
  await saved(page);
  const h = page.locator("h1").first();
  await page.waitForFunction(() => /F\d{4}-\d{5}/.test(document.querySelector("h1")?.textContent ?? ""), null, { timeout: 20000 });
  invoiceNumber = (await h.textContent()) ?? "";
  if (!/F\d{4}-00002/.test(invoiceNumber)) throw new Error(`número inesperado: ${invoiceNumber} (la cuota debería ser la 00001)`);
});
await step(page, "descargar la factura en PDF", async () => {
  const name = await download(page, () => page.getByRole("button", { name: "PDF" }).click());
  if (!name.endsWith(".pdf")) throw new Error(name);
});
await step(page, "exportar gastos a Excel y CSV", async () => {
  await page.goto(BASE + "/gastos");
  const x = await download(page, async () => { await page.getByRole("button", { name: "Exportar" }).click(); await page.getByText("Excel (.xlsx)").click(); });
  const c = await download(page, async () => { await page.getByRole("button", { name: "Exportar" }).click(); await page.getByText("CSV (;)").click(); });
  if (!x.endsWith(".xlsx") || !c.endsWith(".csv")) throw new Error(`${x} ${c}`);
});
await step(page, "exportar un informe (ingresos, PDF)", async () => {
  await page.goto(BASE + "/informes/revenue");
  const n = await download(page, async () => { await page.getByRole("button", { name: "Exportar" }).click(); await page.getByText("PDF").click(); });
  if (!n.endsWith(".pdf")) throw new Error(n);
});
await step(page, "finanzas: resultado con ingresos y gastos", async () => {
  await page.goto(BASE + "/finanzas");
  await page.getByText("Resultado del periodo").waitFor();
  await page.getByText("Por cobrar").first().waitFor();
});
await ctx.close();

console.log("Navegador B (iPad, otro dispositivo)");
const ctxB = await browser.newContext({ ...devices["iPad Pro 11 landscape"], locale: "es-ES", timezoneId: "Europe/Madrid" });
const pageB = await ctxB.newPage();
watch(pageB, "B");
await step(pageB, "entrar desde otro dispositivo", async () => {
  await pageB.goto(BASE + "/");
  await pageB.getByLabel("Email").fill(EMAIL);
  await pageB.getByLabel("Contraseña").fill(PASSWORD);
  await pageB.getByRole("button", { name: "Entrar" }).click();
  await pageB.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 20000 });
  await saved(pageB);
});
const seen = async (path, texts) => { await pageB.goto(BASE + path); for (const t of texts) await pageB.getByText(t, { exact: false }).first().waitFor({ timeout: 15000 }); };
await step(pageB, "B: gasto persistido", () => seen("/gastos", ["Alquiler E2E", "121,00"]));
await step(pageB, "B: membresía persistida", () => seen("/membresias", ["Socia Negocio", "Mensual E2E"]));
await step(pageB, "B: factura con su número", () => seen("/facturas", [invoiceNumber.trim().slice(0, 11) || "F20", "Empresa Cliente E2E SL"]));
await step(pageB, "B: datos fiscales de la empresa", () => seen("/ajustes", [`${COMPANY} S.L.`]).catch(async () => { await pageB.goto(BASE + "/ajustes"); const v = await pageB.getByLabel("Razón social").inputValue(); if (v !== `${COMPANY} S.L.`) throw new Error(v); }));
await pageB.screenshot({ path: join(OUT, "biz-B-ipad.png") });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos OK · errores de consola: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
