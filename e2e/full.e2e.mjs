/**
 * Business OS · E2E COMPLETO del producto ampliado (requiere servidor con la migración 0900).
 *
 * A (escritorio): cuenta → empresa con «Centro A» → puesta en marcha de 10 pasos (fiscal, Centro B, equipo, cobros,
 *   producto, tarifa, IVA por defecto, importar omitido, empezar) → recarga y reentrada con el progreso intacto
 *   → gastos (proveedor, categoría nueva, con/sin centro, con/sin IVA, vencido, pago en lote, anulado con motivo,
 *   filtros, filtro de centro, CSV y Excel) → facturas (borrador, quitar línea, emitir con número de serie, sin
 *   edición tras emitir, cobro parcial y total, duplicar, anular, vencida, PDF) → membresías (versión de precio,
 *   alta con cuota, pausa, reanudar, cambio de tarifa, baja, reactivar, cobro de cuota, pendiente, cuota vencida,
 *   finalizada, MRR) con la ficha 360 tras cada estado → tareas → caja y venta por centro → finanzas e impuestos
 *   → logout/login. Multiempresa: Empresa 2 en otra pestaña con datos propios, sin mezcla.
 * B (iPad, otro navegador): todo lo anterior persistido; B crea gasto y tarea → A los ve tras recargar.
 * Móvil: puesta en marcha, gastos, facturas y membresías sin desbordamiento.
 *
 *   E2E_BASE_URL=http://127.0.0.1:5176 node e2e/full.e2e.mjs
 * Cuentas y empresas sintéticas nuevas en cada ejecución.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";
import { createConsoleWatch } from "./consoleWatch.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5176";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "results");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const EMAIL = `full-${run}@empresa.test`;
const MATE = `equipo-${run}@empresa.test`;
const PASSWORD = "contraseña-e2e-segura";
const C1 = `Empresa Uno ${run}`;
const C2 = `Empresa Dos ${run}`;
const results = [];
const cw = createConsoleWatch();
const facts = {};

const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

async function step(page, name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    const detail = e.message.split("\n").filter((l) => /waiting for|locator\(|getBy|Error|desbord|no |numeración|aparece/.test(l)).slice(0, 2).join(" | ");
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✘ ${name}: ${e.message.split("\n")[0]} ${detail}`);
    await page.screenshot({ path: join(OUT, `full-fail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`), fullPage: true }).catch(() => {});
  }
}
const watch = (page, label) => cw.watch(page, label);
const saved = (page) => page.waitForFunction(() => document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") === "idle", null, { timeout: 30000 });
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 15000 });
async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), trigger()]);
  const name = d.suggestedFilename();
  await d.saveAs(join(OUT, `full-${name}`));
  return name;
}
/** Combobox del design system: abre, escribe y Enter (elige la primera coincidencia o crea). */
async function combo(page, label, text) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("textbox", { name: "Buscar", exact: true }).fill(text);
  await page.keyboard.press("Enter");
}
async function noOverflow(page) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (o > 1) throw new Error(`desbordamiento horizontal de ${o}px`);
}
const dialog = (page) => page.locator('[role="dialog"]').last();
async function pickCenter(page, name) {
  await saved(page); // tras una recarga, la sesión restaura el centro guardado: elegir antes se pisaría
  const sw = page.locator('[data-testid="location-switcher"]:visible').first();
  await sw.click();
  await page.getByRole("menu").getByText(name).first().click();
  await page.waitForFunction((n) => document.querySelector('[data-testid="location-switcher"]')?.textContent?.includes(n), name, { timeout: 10000 });
}
async function login(page) {
  await page.goto(BASE + "/");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 30000 });
  await saved(page);
}
async function rowAction(page, rowText, action) {
  const row = page.locator("tbody tr", { hasText: rowText }).first();
  await row.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: action }).or(page.getByRole("button", { name: action })).first().click();
}

const browser = await chromium.launch();

// Cuenta auxiliar para invitar al equipo durante la puesta en marcha (debe existir antes)
{
  const ctx = await browser.newContext({ locale: "es-ES" });
  const p = await ctx.newPage();
  await p.goto(BASE + "/");
  if (await p.getByLabel("Nombre y apellidos").count() === 0) await p.getByRole("button", { name: "Crear cuenta" }).first().click();
  await p.getByLabel("Nombre y apellidos").fill("Persona Equipo");
  await p.getByLabel("Email").fill(MATE);
  await p.getByLabel("Contraseña").fill(PASSWORD);
  await p.getByRole("button", { name: "Crear cuenta" }).last().click();
  await p.getByLabel("Nombre comercial").waitFor({ timeout: 20000 });
  await ctx.close();
}

const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid", acceptDownloads: true });
const page = await ctxA.newPage();
watch(page, "A");
console.log("Navegador A · escritorio");

await step(page, "crear cuenta y empresa con Centro A", async () => {
  await page.goto(BASE + "/");
  if (await page.getByLabel("Nombre y apellidos").count() === 0) await page.getByRole("button", { name: "Crear cuenta" }).first().click();
  await page.getByLabel("Nombre y apellidos").fill("Persona Completa");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await page.getByLabel("Nombre comercial").fill(C1);
  await page.getByLabel("Ciudad").fill("Ciudad Demo");
  await page.getByLabel("Primer centro").fill("Centro A");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await page.getByText(`Prepara ${C1}`).waitFor({ timeout: 30000 });
  await saved(page);
  facts.org1 = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bos.tab.ctx") ?? "{}").orgId);
  if (!facts.org1) throw new Error("sin id de empresa en el contexto de la pestaña");
});

// ───────────────────────── Puesta en marcha (10 pasos)
const cont = (name = "Continuar") => page.getByRole("button", { name, exact: true }).click();
const heading = (t) => page.locator("h2:visible", { hasText: new RegExp(`^${t}$`) }).first().waitFor();
await step(page, "onboarding 1-2: empresa y datos fiscales (obligatorios antes de guardar)", async () => {
  await page.goto(BASE + "/bienvenida?paso=company");
  await heading("Tu empresa");
  await cont("Guardar y continuar");
  await heading("Datos fiscales");
  if (await page.getByRole("button", { name: "Guardar y continuar" }).isEnabled()) throw new Error("se puede guardar sin los datos fiscales obligatorios");
  await page.getByLabel("Razón social").fill(`${C1} S.L.`);
  await page.getByLabel("NIF / CIF").fill("B12345678");
  await page.getByLabel("Dirección fiscal").fill("Calle Ejemplo 1");
  await page.getByLabel("Código postal").fill("00000");
  await cont("Guardar y continuar");
  await heading("Centros");
});
await step(page, "onboarding 3: añadir Centro B", async () => {
  await page.getByLabel("Nuevo centro").fill("Centro B");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await toast(page, "Centro añadido");
  await cont();
  await heading("Equipo");
});
await step(page, "onboarding 4: invitar al equipo (empleado)", async () => {
  await page.getByLabel("Email", { exact: true }).fill(MATE);
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByText("Persona Equipo").waitFor({ timeout: 20000 });
  await cont();
  await heading("Métodos de pago");
});
await step(page, "onboarding 5-7: cobros, producto y tarifa", async () => {
  await cont();
  await heading("Productos y servicios");
  await page.getByLabel("Producto o servicio").fill("Sesión E2E");
  await page.getByLabel("Precio (IVA incl.)").fill("30,00");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByText(/Ya tienes 1 productos?/).waitFor();
  await cont();
  await heading("Tarifas de membresía");
  await page.getByLabel("Tarifa", { exact: true }).fill("Mensual E2E");
  await page.getByLabel("Precio (IVA incl.)").fill("60,50");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.locator("li", { hasText: "Mensual E2E" }).first().waitFor();
  await cont();
  await heading("Configuración");
});
await step(page, "onboarding 8: IVA por defecto 10 % (cambio de «uno vigente»)", async () => {
  const sel = page.getByLabel("IVA por defecto");
  const opt = await sel.locator("option").filter({ hasText: /10/ }).first().getAttribute("value");
  await sel.selectOption(opt);
  await toast(page, "IVA por defecto actualizado");
  await saved(page);
  await cont();
  await heading("Importar datos");
});
await step(page, "onboarding 9-10: omitir importación y terminar", async () => {
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await heading("¡Listo para empezar!");
  await page.getByText(/9 de 9 pasos/).waitFor();
  await saved(page);
  await page.reload();
  await page.getByText(/9 de 9 pasos/).waitFor({ timeout: 30000 });
  await cont("Ir al resumen");
  await page.getByText(/Hola,/).first().waitFor();
  await saved(page);
});

// ───────────────────────── Gastos
await step(page, "proveedor nuevo", async () => {
  await page.goto(BASE + "/proveedores");
  await page.getByRole("button", { name: "Nuevo proveedor" }).first().click();
  await page.getByLabel("Nombre o razón social").fill("Inmuebles E2E SL");
  await page.getByLabel("NIF / CIF").fill("B87654321");
  await page.getByRole("button", { name: "Crear proveedor" }).click();
  await page.getByText("Inmuebles E2E SL").first().waitFor();
  await saved(page);
});
async function newExpense({ concept, amount, includesTax = true, supplier, category, center, issue, due, paid }) {
  await page.getByRole("button", { name: "Nuevo gasto" }).first().click();
  const d = dialog(page);
  await d.getByLabel("Concepto").fill(concept);
  await d.getByLabel("IVA", { exact: true }).selectOption({ label: "21 %" });
  if (!includesTax) await d.getByRole("switch", { name: "El importe incluye IVA" }).click();
  await page.getByLabel(includesTax ? /Importe total/ : /Base imponible/).fill(amount);
  if (supplier) await combo(page, "Proveedor", supplier);
  if (category) await combo(page, "Categoría", category);
  if (issue) await page.getByLabel("Fecha de la factura").fill(issue);
  if (due) await page.getByLabel("Vencimiento").fill(due);
  if (center) await page.getByLabel("Centro", { exact: true }).selectOption({ label: center });
  await d.getByRole("button", { name: paid ? "Pagado" : "Pendiente de pago", exact: true }).click();
  await d.getByRole("button", { name: "Registrar gasto" }).click();
  await page.locator("tbody tr", { hasText: concept }).first().waitFor();
}
await step(page, "gastos: con IVA y centro, sin IVA y vencido, general pagado, a anular", async () => {
  await page.goto(BASE + "/gastos");
  await pickCenter(page, "Todos los centros"); // el centro activo de la pestaña filtra la lista
  await newExpense({ concept: "Alquiler Centro A", amount: "1210,00", supplier: "Inmuebles", category: "Formación E2E", center: "Centro A", due: iso(10), paid: false });
  await newExpense({ concept: "Luz Centro B", amount: "100,00", includesTax: false, center: "Centro B", issue: iso(-20), due: iso(-3), paid: false });
  await newExpense({ concept: "Gestoría general", amount: "302,50", paid: true });
  await newExpense({ concept: "Duplicado E2E", amount: "50,00", paid: false });
  await saved(page);
  await page.locator("tbody tr", { hasText: "Luz Centro B" }).getByText("Vencido").waitFor();
});
await step(page, "gastos: anular con motivo y pago en lote", async () => {
  await rowAction(page, "Duplicado E2E", "Anular");
  await dialog(page).locator("textarea, input").first().fill("Registrado dos veces");
  await page.getByRole("button", { name: "Anular gasto" }).click();
  await toast(page, "Gasto anulado");
  for (const t of ["Alquiler Centro A", "Luz Centro B"]) await page.locator("tbody tr", { hasText: t }).getByRole("checkbox", { name: "Seleccionar fila" }).check();
  await page.getByRole("toolbar", { name: "Acciones sobre la selección" }).getByRole("button", { name: "Marcar pagados" }).click();
  await toast(page, "2 gastos marcados como pagados");
  await saved(page);
});
await step(page, "gastos: KPIs, filtros, export CSV y Excel", async () => {
  await page.goto(BASE + "/gastos?periodo=ytd");
  // IVA soportado: 210,00 (alquiler) + 21,00 (luz) + 52,50 (gestoría); la anulada no cuenta
  await page.getByText("283,50").first().waitFor();
  await page.getByRole("button", { name: /^Estado/ }).first().click();
  await page.getByRole("listbox", { name: "Estado" }).getByRole("option", { name: /Anulad/ }).click();
  await page.keyboard.press("Escape");
  await page.locator("tbody tr", { hasText: "Duplicado E2E" }).waitFor();
  if (await page.locator("tbody tr", { hasText: "Alquiler Centro A" }).count()) throw new Error("el filtro de estado no filtra");
  await page.goto(BASE + "/gastos?periodo=ytd"); // sin filtros
  await page.locator("tbody tr", { hasText: "Alquiler Centro A" }).waitFor();
  const x = await download(page, async () => { await page.getByRole("button", { name: "Exportar" }).click(); await page.getByText("Excel (.xlsx)").click(); });
  const c = await download(page, async () => { await page.getByRole("button", { name: "Exportar" }).click(); await page.getByText("CSV (;)").click(); });
  if (!x.endsWith(".xlsx") || !c.endsWith(".csv")) throw new Error(`${x} ${c}`);
});
await step(page, "multicentro: gastos generales solo en el consolidado", async () => {
  await pickCenter(page, "Centro B");
  await page.locator("tbody tr", { hasText: "Luz Centro B" }).waitFor();
  for (const t of ["Alquiler Centro A", "Gestoría general"]) if (await page.locator("tbody tr", { hasText: t }).count()) throw new Error(`${t} aparece en Centro B`);
  await pickCenter(page, "Todos los centros");
  await page.locator("tbody tr", { hasText: "Gestoría general" }).waitFor();
});

// ───────────────────────── Facturación
let num1 = "";
await step(page, "factura: borrador con 2 líneas, quitar una, emitir con número", async () => {
  await page.goto(BASE + "/facturas/nueva");
  await page.getByRole("button", { name: "Otro destinatario" }).click();
  await page.getByLabel("Nombre o razón social").fill("Cliente Empresa E2E SL");
  await page.getByLabel("NIF / CIF").fill("B11223344");
  await page.getByLabel("Descripción de la línea 1").fill("Servicio mensual");
  await page.getByLabel("Precio (IVA incl.)").first().fill("121,00");
  await page.getByRole("button", { name: "Añadir línea" }).click();
  await page.getByLabel("Descripción de la línea 2").fill("Línea que sobra");
  await page.getByLabel("Precio (IVA incl.)").nth(1).fill("10,00");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByRole("button", { name: "Editar" }).waitFor({ timeout: 20000 });
  await saved(page);
  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByRole("button", { name: "Quitar línea" }).nth(1).click();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.getByRole("button", { name: "Editar" }).waitFor({ timeout: 20000 });
  if (await page.getByText("Línea que sobra").count()) throw new Error("la línea quitada sigue en el borrador");
  await saved(page);
  await page.getByRole("button", { name: "Emitir", exact: true }).click();
  await page.getByRole("button", { name: "Emitir ahora" }).click();
  await toast(page, "Factura emitida");
  await saved(page);
  await page.waitForFunction(() => /F\d{4}-\d{5}/.test(document.querySelector("h1")?.textContent ?? ""), null, { timeout: 30000 });
  num1 = (await page.locator("h1").first().textContent()).match(/F\d{4}-\d{5}/)[0];
  facts.invoice = num1;
});
await step(page, "factura emitida: sin edición de líneas", async () => {
  if (await page.getByRole("button", { name: "Editar" }).count()) throw new Error("una factura emitida ofrece Editar");
  await page.goto(page.url() + "/editar");
  await page.waitForTimeout(1500);
  if (await page.getByRole("button", { name: "Quitar línea" }).count()) throw new Error("el editor permite tocar líneas de una emitida");
  await page.goBack();
});
await step(page, "factura: cobro parcial y cobro completo", async () => {
  await page.getByRole("button", { name: "Registrar cobro" }).first().click();
  await dialog(page).getByLabel("Importe").fill("50,00");
  await page.getByRole("button", { name: "Registrar cobro parcial" }).click();
  await page.getByText(/Cobro parcial|Parcial/).first().waitFor();
  await page.getByRole("button", { name: "Registrar cobro" }).first().click();
  await dialog(page).getByRole("button", { name: "Registrar cobro", exact: true }).click();
  await page.getByText("Cobrada").first().waitFor();
  await saved(page);
});
await step(page, "factura: duplicar, emitir y anular con motivo; PDF", async () => {
  const name = await download(page, () => page.getByRole("button", { name: "PDF" }).click());
  if (!name.endsWith(".pdf")) throw new Error(name);
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitem", { name: "Duplicar" }).click();
  await page.getByRole("heading", { name: "Editar borrador" }).waitFor({ timeout: 20000 }); // el duplicado abre el editor
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await page.getByRole("button", { name: "Emitir ahora" }).click();
  await toast(page, "Factura emitida");
  await page.waitForFunction((n) => { const m = (document.querySelector("h1")?.textContent ?? "").match(/F\d{4}-\d{5}/); return m && m[0] !== n; }, num1, { timeout: 30000 });
  const num2 = (await page.locator("h1").first().textContent()).match(/F\d{4}-\d{5}/)[0];
  if (Number(num2.slice(-5)) !== Number(num1.slice(-5)) + 1) throw new Error(`numeración no correlativa: ${num1} → ${num2}`);
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitem", { name: "Anular factura" }).click();
  await dialog(page).locator("textarea, input").first().fill("Emitida por error");
  await dialog(page).getByRole("button", { name: "Anular factura" }).click();
  await toast(page, "Factura anulada");
  await page.getByText("Anulada").first().waitFor();
  await saved(page);
});
await step(page, "factura vencida (emitida hace 40 días a 7 días)", async () => {
  await page.goto(BASE + "/facturas/nueva");
  await page.getByRole("button", { name: "Otro destinatario" }).click();
  await page.getByLabel("Nombre o razón social").fill("Moroso E2E SL");
  await page.getByLabel("NIF / CIF").fill("B55667788");
  await page.getByLabel("Fecha de emisión").fill(iso(-40));
  await page.getByLabel("Vencimiento").selectOption({ label: "7 días" });
  await page.getByLabel("Descripción de la línea 1").fill("Servicio antiguo");
  await page.getByLabel("Precio (IVA incl.)").first().fill("200,00");
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await page.getByRole("button", { name: "Emitir ahora" }).click();
  await toast(page, "Factura emitida");
  await saved(page);
  await page.goto(BASE + "/facturas");
  await page.locator("tbody tr", { hasText: "Moroso E2E SL" }).getByText("Vencida").waitFor();
});

// ───────────────────────── Membresías
const c360 = async (name) => { await page.goto(BASE + "/clientes"); await page.getByText(name).first().click(); await page.getByRole("tab", { name: /Membresía/ }).click(); };
async function newCustomer(first) {
  await page.goto(BASE + "/clientes?nuevo=1");
  await page.getByLabel(/^Nombre/).first().fill(first);
  await page.getByLabel("Apellidos").fill("E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText(`${first} E2E`).first().waitFor();
  await saved(page); // sin recargar con el envío en vuelo
}
async function assign(first, plan, { start, charge = "Cobrar ahora" } = {}) {
  await page.goto(BASE + "/clientes");
  await page.getByText(`${first} E2E`).first().click();
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByText("Nueva membresía").click();
  await page.getByRole("button", { name: new RegExp(plan) }).click();
  if (start) await page.getByLabel("Inicio").fill(start);
  await dialog(page).getByRole("button", { name: charge, exact: true }).click();
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await toast(page, "Membresía dada de alta");
  await saved(page);
}
const badge = async (text) => { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 }); };
await step(page, "tarifas: subir precio (versión 2), trimestral y bono", async () => {
  await page.goto(BASE + "/membresias?tab=tarifas");
  await page.getByRole("button", { name: "Editar", exact: true }).first().click();
  await page.getByLabel("Precio (IVA incluido)").fill("72,60");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await saved(page);
  for (const [n, kind, per, price] of [["Trimestral E2E", "recurring", "quarter", "181,50"], ["Bono 30 E2E", "pack", null, "40,00"]]) {
    await page.getByRole("button", { name: /Nueva tarifa|Crear tarifa/ }).first().click();
    await page.getByLabel("Nombre").fill(n);
    const tipo = page.getByLabel("Tipo");
    await tipo.selectOption(kind);
    if (per) await page.getByLabel("Periodicidad").selectOption(per);
    await page.getByLabel("Precio (IVA incluido)").fill(price);
    await dialog(page).getByLabel("IVA", { exact: true }).selectOption({ label: "21 %" }).catch(async () => dialog(page).getByLabel("IVA", { exact: true }).selectOption({ index: 0 }));
    if (kind === "pack") await page.getByLabel("Validez (días)").fill("30");
    await page.getByRole("button", { name: "Crear tarifa" }).last().click();
    await page.getByText(n).first().waitFor();
  }
  await saved(page);
});
await step(page, "membresía: alta con cuota cobrada → ACTIVA en la ficha 360 (precio de la versión 2)", async () => {
  await newCustomer("Socia");
  await assign("Socia", "Mensual E2E");
  await c360("Socia E2E");
  await badge("Activa");
  await page.getByText("72,60").first().waitFor();
});
await step(page, "membresía: pausa → EN PAUSA, reanudar → ACTIVA", async () => {
  await page.getByRole("button", { name: "Gestionar" }).click();
  await page.getByRole("menuitem", { name: "Pausar" }).click();
  await dialog(page).getByLabel("Motivo").fill("Lesión");
  await dialog(page).getByRole("button", { name: "Pausar" }).click();
  await badge("En pausa");
  await page.getByRole("button", { name: "Reanudar" }).click();
  await badge("Activa");
  await saved(page);
});
await step(page, "membresía: cambio de tarifa a trimestral", async () => {
  await page.getByRole("button", { name: "Gestionar" }).click();
  await page.getByRole("menuitem", { name: "Cambiar tarifa" }).click();
  await dialog(page).getByLabel("Nueva tarifa").selectOption({ label: "Trimestral E2E" });
  await dialog(page).getByLabel("Desde").fill(iso(0));
  await dialog(page).getByRole("button", { name: "Cambiar tarifa" }).click();
  await toast(page, "Tarifa cambiada");
  await page.getByText("Trimestral E2E").first().waitFor();
  await saved(page);
});
await step(page, "membresía: baja → BAJA, reactivar → ACTIVA, cobrar cuota → factura", async () => {
  await page.getByRole("button", { name: "Gestionar" }).click();
  await page.getByRole("menuitem", { name: "Dar de baja" }).click();
  await dialog(page).getByLabel("Motivo").fill("Se muda");
  await dialog(page).getByRole("button", { name: "Confirmar baja" }).click();
  await badge("Baja");
  await page.getByRole("button", { name: "Reactivar" }).click();
  await badge("Activa");
  await page.getByRole("button", { name: "Cobrar cuota" }).click();
  await dialog(page).getByRole("button", { name: /^Cobrar / }).click();
  await toast(page, "Cuota cobrada y facturada");
  await saved(page);
});
await step(page, "membresía: PENDIENTE (inicio futuro), CUOTA VENCIDA y FINALIZADA", async () => {
  await newCustomer("Futura");
  await assign("Futura", "Mensual E2E", { start: iso(7), charge: "Más tarde" });
  await c360("Futura E2E"); await badge("Pendiente de inicio");
  await newCustomer("Vencida");
  await assign("Vencida", "Mensual E2E", { start: iso(-40), charge: "Más tarde" });
  await c360("Vencida E2E"); await badge("Cuota vencida");
  await newCustomer("Caducada");
  await assign("Caducada", "Bono 30 E2E", { start: iso(-60) });
  await c360("Caducada E2E"); await badge("Finalizada");
});
await step(page, "membresías: resumen con MRR y cuotas vencidas", async () => {
  await page.goto(BASE + "/membresias");
  // MRR sin IVA: trimestral 150/3 = 50,00 + vencida 60,00 (viva) = 110,00
  await pickCenter(page, "Todos los centros");
  await page.getByText("110,00").first().waitFor();
  await page.getByText("72,60 € sin cobrar").first().waitFor(); // cuota vencida aún sin emitir: se debe su importe
});

// ───────────────────────── Tareas
await step(page, "tarea: crear con cliente, fecha y responsable; completar", async () => {
  await page.goto(BASE + "/seguimiento");
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  await dialog(page).getByLabel("Tarea").fill("Llamar por la cuota E2E");
  await combo(page, "Cliente", "Vencida");
  await dialog(page).getByLabel("Fecha").fill(iso(1));
  const para = dialog(page).getByLabel("Para");
  if (await para.count()) await para.selectOption({ index: 1 }).catch(() => {});
  await dialog(page).getByRole("button", { name: "Crear tarea" }).click();
  await page.getByText("Llamar por la cuota E2E").first().waitFor();
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  await dialog(page).getByLabel("Tarea").fill("Enviar contrato E2E");
  await dialog(page).getByRole("button", { name: "Crear tarea" }).click();
  await page.locator("li", { hasText: "Enviar contrato E2E" }).getByRole("button", { name: "Marcar como hecha" }).click();
  await toast(page, "Tarea completada");
  await saved(page);
});

// ───────────────────────── Caja por centro + finanzas
await step(page, "caja y venta en Centro B", async () => {
  await pickCenter(page, "Centro B");
  await page.goto(BASE + "/caja");
  await page.getByRole("button", { name: "Abrir caja", exact: true }).first().click();
  await toast(page, "Caja abierta");
  await page.locator("section button.group", { hasText: "Sesión E2E" }).first().click();
  await page.getByRole("radio", { name: "Tarjeta" }).click();
  await page.getByRole("button", { name: /^Cobrar/ }).last().click();
  await page.getByText(/Venta #\d+/).first().waitFor({ timeout: 20000 }); // número asignado por el servidor
  await saved(page);
  await pickCenter(page, "Todos los centros");
});
await step(page, "finanzas, flujo de caja e impuestos coherentes", async () => {
  await page.goto(BASE + "/finanzas");
  await page.getByText("Resultado del periodo").waitFor();
  await page.getByText("Por cobrar").first().waitFor();
  await page.goto(BASE + "/flujo-de-caja");
  await page.getByText(/Entradas/).first().waitFor();
  await page.goto(BASE + "/impuestos");
  await page.getByText("IVA soportado").first().waitFor();
});
await step(page, "logout y login: todo sigue ahí", async () => {
  await page.getByRole("button", { name: "Cuenta" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.getByLabel("Contraseña").waitFor();
  await login(page);
  await page.goto(BASE + "/gastos?periodo=ytd");
  await page.getByText("283,50").first().waitFor({ timeout: 30000 });
});

// ───────────────────────── Multiempresa por pestaña
await step(page, "multiempresa: Empresa 2 con sus propios datos, sin mezcla", async () => {
  await page.locator('[data-testid="company-switcher"]:visible').first().click();
  await page.getByText("Crear empresa o abrir la demo").click();
  await page.getByRole("button", { name: "Crear nueva empresa" }).click();
  await page.getByLabel("Nombre comercial").fill(C2);
  await page.getByLabel("Ciudad").fill("Otra Ciudad");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await page.locator('[data-testid="company-switcher"]').first().waitFor({ timeout: 30000 });
  await page.goto(BASE + "/bienvenida");
  await page.getByRole("button", { name: "Terminar más tarde" }).click();
  await page.goto(BASE + "/gastos");
  await newExpense({ concept: "Gasto solo Empresa 2", amount: "99,00", paid: true });
  await saved(page);
  if (await page.locator("tbody tr", { hasText: "Alquiler Centro A" }).count()) throw new Error("Empresa 2 ve gastos de Empresa 1");
  const tab2 = await ctxA.newPage();
  watch(tab2, "A2");
  await tab2.goto(`${BASE}/?empresa=${facts.org1}`);
  await saved(tab2);
  await tab2.goto(BASE + "/gastos?periodo=ytd");
  await tab2.locator("tbody tr", { hasText: "Alquiler Centro A" }).waitFor({ timeout: 30000 });
  if (await tab2.locator("tbody tr", { hasText: "Gasto solo Empresa 2" }).count()) throw new Error("Empresa 1 ve gastos de Empresa 2");
  await page.reload();
  await page.locator("tbody tr", { hasText: "Gasto solo Empresa 2" }).waitFor({ timeout: 30000 });
  if (await page.locator("tbody tr", { hasText: "Alquiler Centro A" }).count()) throw new Error("la pestaña de Empresa 2 cambió de empresa");
  await tab2.close();
});
await ctxA.close();

// ───────────────────────── Navegador B (iPad)
console.log("Navegador B · iPad (otro dispositivo)");
const ctxB = await browser.newContext({ ...devices["iPad Pro 11 landscape"], locale: "es-ES", timezoneId: "Europe/Madrid" });
const pb = await ctxB.newPage();
watch(pb, "B");
const seen = async (path, texts) => { await pb.goto(BASE + path); for (const t of texts) await pb.getByText(t, { exact: false }).first().waitFor({ timeout: 20000 }); };
await step(pb, "B: entrar y abrir Empresa 1", async () => {
  await pb.goto(BASE + "/");
  await pb.getByLabel("Email").fill(EMAIL);
  await pb.getByLabel("Contraseña").fill(PASSWORD);
  await pb.getByRole("button", { name: "Entrar" }).click();
  // Dispositivo nuevo con dos empresas: se elige (en un dispositivo ya usado se recuerda la última)
  await pb.getByText("Elige empresa").or(pb.locator('[data-testid="sync-indicator"]')).first().waitFor({ timeout: 30000 });
  if (await pb.getByText("Elige empresa").count()) await pb.getByText(C1).first().click();
  await pb.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 30000 });
  await saved(pb);
});
await step(pb, "B: gastos, proveedor y categoría persistidos (pagados y anulado)", () => seen("/gastos?periodo=ytd", ["Alquiler Centro A", "Luz Centro B", "Gestoría general", "Duplicado E2E", "283,50"]));
await step(pb, "B: facturas con número, cobrada, anulada y vencida", () => seen("/facturas", [facts.invoice ?? "F20", "Cobrada", "Anulada", "Vencida"]));
await step(pb, "B: membresías y MRR", () => seen("/membresias", ["Socia E2E", "Futura E2E", "Vencida E2E", "110,00"]));
await step(pb, "B: tareas", async () => { await seen("/seguimiento", ["Llamar por la cuota E2E"]); });
await step(pb, "B: puesta en marcha completada y IVA por defecto 10 %", async () => {
  await seen("/bienvenida", ["9 de 9 pasos"]);
  await pb.goto(BASE + "/ajustes?tab=impuestos");
  await pb.getByText(/10/).first().waitFor();
});
await step(pb, "B: registra gasto y tarea", async () => {
  await pb.goto(BASE + "/gastos");
  await pb.getByRole("button", { name: "Nuevo gasto" }).first().click();
  await pb.getByLabel("Concepto").fill("Gasto desde iPad");
  await pb.getByLabel(/Importe total/).fill("12,10");
  await pb.getByRole("button", { name: "Registrar gasto" }).click();
  await pb.getByText("Gasto desde iPad").first().waitFor();
  await saved(pb);
  await pb.goto(BASE + "/seguimiento");
  await pb.getByRole("button", { name: "Nueva tarea" }).first().click();
  await pb.locator('[role="dialog"]').last().getByLabel("Tarea").fill("Tarea desde iPad");
  await pb.locator('[role="dialog"]').last().getByRole("button", { name: "Crear tarea" }).click();
  await pb.getByText("Tarea desde iPad").first().waitFor();
  await saved(pb);
});
await ctxB.close();

// A vuelve y ve lo de B
const ctxA2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid" });
const pa = await ctxA2.newPage();
watch(pa, "A'");
await step(pa, "A (nueva sesión): ve el gasto y la tarea creados en el iPad", async () => {
  await pa.goto(BASE + "/");
  await pa.getByLabel("Email").fill(EMAIL);
  await pa.getByLabel("Contraseña").fill(PASSWORD);
  await pa.getByRole("button", { name: "Entrar" }).click();
  await pa.getByText("Elige empresa").or(pa.locator('[data-testid="sync-indicator"]')).first().waitFor({ timeout: 30000 });
  if (await pa.getByText("Elige empresa").count()) await pa.getByText(C1).first().click();
  await pa.locator('[data-testid="sync-indicator"]').waitFor({ timeout: 30000 });
  await saved(pa);
  await pa.goto(BASE + "/gastos"); await pa.getByText("Gasto desde iPad").first().waitFor({ timeout: 20000 });
  await pa.goto(BASE + "/seguimiento"); await pa.getByText("Tarea desde iPad").first().waitFor({ timeout: 20000 });
});
await ctxA2.close();

// ───────────────────────── Móvil e iPad vertical: puesta en marcha y pantallas nuevas sin desbordamiento
for (const [label, dev] of [["móvil", devices["iPhone 13"]], ["iPad vertical", devices["iPad Pro 11"]]]) {
  const ctx = await browser.newContext({ ...dev, locale: "es-ES", timezoneId: "Europe/Madrid" });
  const p = await ctx.newPage();
  watch(p, label);
  await step(p, `${label}: puesta en marcha, gastos, facturas y membresías`, async () => {
    await p.goto(BASE + "/");
    await p.getByLabel("Email").fill(EMAIL);
    await p.getByLabel("Contraseña").fill(PASSWORD);
    await p.getByRole("button", { name: "Entrar" }).click();
    await p.getByText("Elige empresa").or(p.locator('[data-testid="sync-indicator"]')).first().waitFor({ state: "attached", timeout: 30000 });
    if (await p.getByText("Elige empresa").count()) await p.getByText(C1).first().click();
    await p.locator('[data-testid="sync-indicator"]').first().waitFor({ state: "attached", timeout: 30000 });
    await saved(p);
    for (const path of ["/bienvenida", "/gastos", "/facturas", "/membresias", "/finanzas", "/seguimiento"]) {
      await p.goto(BASE + path);
      await p.waitForTimeout(1200);
      await noOverflow(p).catch((e) => { throw new Error(`${path}: ${e.message}`); });
    }
  });
  await ctx.close();
}
await browser.close();

const failed = results.filter((r) => !r.ok);
const unexpected = cw.report();
console.log(`\n${results.length - failed.length}/${results.length} pasos OK · errores no esperados: ${unexpected}`);
process.exit(failed.length || unexpected ? 1 : 0);
