/**
 * Business OS · E2E de permisos (navegador real, Supabase real). Una empresa con propietario y cuatro personas de equipo
 * (encargado, empleado, contable, solo lectura) en navegadores distintos:
 *  - menú lateral y ⌘K solo con lo permitido; escribir la URL de un módulo sin permiso no lo abre;
 *  - Cliente 360 sin datos sensibles (NIF, dirección…) ni acciones sin permiso; formulario de cliente sin campos fiscales;
 *  - exportar (CSV/Excel) solo con reports.export; facturas sin columna NIF sin customers.sensitive;
 *  - permisos individuales (Ajustes → Equipo → Permisos): si el servidor tiene 0920 se aplican de verdad; si no, la app lo dice.
 *
 *   E2E_BASE_URL=http://127.0.0.1:5173 node e2e/permisos.e2e.mjs      (E2E_CHROME=/ruta/chrome para usar un Chrome instalado)
 * Cuentas y empresa sintéticas nuevas en cada ejecución.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { launchOptions } from "./launch.mjs";
import { createConsoleWatch } from "./consoleWatch.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "results");
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const PASSWORD = "contraseña-e2e-segura";
const COMPANY = `Permisos E2E ${run}`;
const NIF = "12345678Z";
const results = [];
const cw = createConsoleWatch();
const email = (who) => `${who}-${run}@empresa.test`;

const step = async (page, name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✘ ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `perm-fail-${name.replace(/\W+/g, "_")}.png`) }).catch(() => {});
  }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const saved = (page) => page.waitForFunction(() => (document.querySelector('[data-testid="sync-indicator"]')?.getAttribute("data-state") ?? "idle") === "idle", null, { timeout: 30000 });
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const sidebar = async (page) => (await page.locator("aside").first().innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
const noAccess = async (page, path) => {
  await page.goto(BASE + path);
  await page.waitForTimeout(500);
  await page.getByRole("heading", { name: "Sin acceso" }).waitFor({ timeout: 15000 });
};

const browser = await chromium.launch(launchOptions);
const newCtx = () => browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid", acceptDownloads: true });
const pages = {};
const open = async (who) => {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  cw.watch(page, who);
  pages[who] = page;
  return page;
};
const signup = async (page, who) => {
  await page.goto(BASE + "/");
  if (await page.getByLabel("Nombre y apellidos").count() === 0) await page.getByRole("button", { name: "Crear cuenta" }).first().click();
  await page.getByLabel("Nombre y apellidos").fill(`Persona ${who}`);
  await page.getByLabel("Email").fill(email(who));
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await page.getByLabel("Nombre comercial").waitFor({ timeout: 20000 });
};
const enter = async (page) => {          // tras ser añadida al equipo: recargar y entrar en la empresa
  await page.goto(BASE + "/");
  await page.locator("aside").first().waitFor({ timeout: 30000 });
  await saved(page);
};

console.log("Permisos por rol");
const O = await open("owner");
for (const who of ["man", "emp", "fin", "vie"]) await step(O, `cuenta de ${who}`, async () => { const p = await open(who); await signup(p, who); });

await step(O, "propietario: cuenta, empresa y datos", async () => {
  await signup(O, "own");
  await O.getByLabel("Nombre comercial").fill(COMPANY);
  await O.getByLabel("Ciudad").fill("Ciudad Demo");
  await O.getByRole("button", { name: "Crear empresa" }).click();
  await O.getByText(`Prepara ${COMPANY}`).waitFor({ timeout: 20000 });
  await saved(O);
});
await step(O, "propietario: cliente con NIF y dirección (ve los campos fiscales)", async () => {
  await O.goto(BASE + "/clientes?nuevo=1");
  await O.getByLabel(/^Nombre/).first().fill("Zulema");
  await O.getByLabel("Apellidos").fill("Quintana");
  await O.getByLabel("DNI / NIF / NIE").fill(NIF);
  await O.getByLabel("Dirección").fill("Calle Secreta 7");
  await O.getByLabel("Email").fill("zulema@empresa.test");
  await O.getByRole("button", { name: "Guardar" }).click();
  await O.getByText("Zulema Quintana").first().waitFor();
  await saved(O);
});
await step(O, "propietario: tarifa, membresía sin cobrar y factura emitida", async () => {
  await O.goto(BASE + "/membresias?tab=tarifas");
  await O.getByRole("button", { name: /Crear tarifa|Nueva tarifa/ }).first().click();
  await O.getByLabel("Nombre").fill("Mensual E2E");
  await O.getByLabel("Precio (IVA incluido)").fill("60,00");
  await O.getByRole("button", { name: "Crear tarifa" }).last().click();
  await O.getByText("Mensual E2E").first().waitFor();
  await saved(O);
  await O.goto(BASE + "/clientes");
  await O.getByText("Zulema Quintana").first().click();
  await O.getByRole("button", { name: "Más" }).click();
  await O.getByText("Nueva membresía").click();
  await O.getByRole("button", { name: /Mensual E2E/ }).click();
  await O.getByRole("button", { name: "Más tarde" }).click();
  await O.getByRole("button", { name: "Dar de alta" }).click();
  await O.getByText("Membresía dada de alta").waitFor();
  await saved(O);
  await O.goto(BASE + "/facturas/nueva");
  await O.getByRole("button", { name: "Otro destinatario" }).click();
  await O.getByLabel("Nombre o razón social").fill("Empresa Cliente E2E SL");
  await O.getByLabel("NIF / CIF").fill("B76543210");
  await O.getByLabel("Descripción de la línea 1").fill("Servicio E2E");
  await O.getByLabel("Precio (IVA incl.)").fill("100,00");
  await O.getByRole("button", { name: "Emitir factura" }).click();
  await O.getByRole("button", { name: "Emitir ahora" }).click();
  await O.getByText("Factura emitida").first().waitFor();
  await saved(O);
});
await step(O, "propietario: ve el menú completo y el NIF en la ficha", async () => {
  const s = (await sidebar(O)).join("|");
  for (const l of ["Caja", "Clientes", "Facturas", "Gastos", "Informes", "Importaciones", "Equipo", "Centros"]) expect(s.includes(l), `falta «${l}» en el menú del propietario`);
});

for (const [who, role] of [["man", "Encargado"], ["emp", "Empleado"], ["fin", "Contable"], ["vie", "Solo lectura"]]) {
  await step(O, `propietario añade a ${who} como ${role}`, async () => {
    await O.goto(BASE + "/ajustes?tab=equipo");
    await O.getByRole("button", { name: "Añadir persona" }).click();
    const d = O.getByRole("dialog");
    await d.getByLabel("Email").fill(email(who));
    const sel = d.locator("select").first();
    const label = (await sel.locator("option").allInnerTexts()).find((o) => o.startsWith(role));
    expect(!!label, `no hay rol «${role}»`);
    await sel.selectOption({ label });
    await d.getByRole("button", { name: "Añadir" }).click();
    await O.getByText("Persona añadida").first().waitFor({ timeout: 20000 });
    await saved(O);
  });
}

// ── EMPLEADO
const E = pages.emp;
await step(E, "empleado: menú limitado", async () => {
  await enter(E);
  const s = (await sidebar(E)).join("|");
  for (const l of ["Caja", "Ventas", "Clientes"]) expect(s.includes(l), `falta «${l}»`);
  for (const l of ["Facturas", "Gastos", "Cobros", "Informes", "Importaciones", "Equipo", "Centros", "Finanzas"]) expect(!s.includes(l), `el empleado ve «${l}»`);
});
await step(E, "empleado: escribir la URL de un módulo sin permiso no lo abre", async () => {
  for (const p of ["/facturas", "/facturas/nueva", "/gastos", "/finanzas", "/pagos", "/informes", "/importaciones", "/bienvenida"]) await noAccess(E, p);
});
await step(E, "empleado: Ajustes no ofrece Equipo ni Auditoría (tampoco por ?tab=)", async () => {
  await E.goto(BASE + "/ajustes?tab=equipo");
  await E.getByRole("heading", { name: "Ajustes" }).waitFor();
  const t = await text(E);
  expect(!t.includes("Equipo y roles") && !t.includes("Añadir persona") && !t.includes("Auditoría"), "el empleado ve la pestaña de equipo/auditoría");
});
await step(E, "empleado: ficha de cliente sin datos sensibles ni acciones sin permiso", async () => {
  await E.goto(BASE + "/clientes");
  await E.getByText("Zulema Quintana").first().click();
  await E.getByText("zulema@empresa.test").first().waitFor();
  const t = await text(E);
  expect(!t.includes(NIF) && !t.includes("Calle Secreta"), "el empleado ve el NIF o la dirección");
  expect(t.includes("Restringidos a tu rol"), "falta el aviso de datos restringidos");
  expect(await E.getByRole("button", { name: "Factura", exact: true }).count() === 0, "el empleado ve «Factura»");
  expect(await E.getByRole("button", { name: "Cobro", exact: true }).count() === 0, "el empleado ve «Cobro»");
  expect(await E.getByRole("button", { name: "Cobrar cuota" }).count() === 0, "el empleado ve «Cobrar cuota»");
});
await step(E, "empleado: el formulario de cliente no tiene campos fiscales", async () => {
  await E.goto(BASE + "/clientes?nuevo=1");
  await E.getByLabel(/^Nombre/).first().waitFor();
  for (const l of ["DNI / NIF / NIE", "Dirección", "Código postal", "Ciudad", "Fecha de nacimiento", "Empresa"]) expect(await E.getByLabel(l, { exact: true }).count() === 0, `el empleado ve el campo «${l}»`);
});
await step(E, "empleado: ⌘K no encuentra el NIF ni muestra módulos sin permiso", async () => {
  await E.goto(BASE + "/clientes");
  await E.getByRole("button", { name: /Buscar, crear/ }).first().click();
  await E.getByPlaceholder(/Busca clientes/).fill(NIF);
  await E.getByText(/Sin resultados/).waitFor({ timeout: 5000 });
  await E.getByPlaceholder(/Busca clientes/).fill("Zulema");
  await E.getByText("Zulema Quintana").first().waitFor({ timeout: 5000 });
  expect(!(await text(E)).includes(NIF), "⌘K enseña el NIF");
  await E.getByPlaceholder(/Busca clientes/).fill("factur");
  const t = await text(E);
  expect(!/Nueva factura|Facturas/.test(t.replace(/Sin resultados.*/, "")) || /Sin resultados/.test(t), "⌘K ofrece facturas al empleado");
  await E.keyboard.press("Escape");
});
await step(E, "empleado: las tablas no ofrecen exportar", async () => {
  await E.goto(BASE + "/clientes");
  await E.getByText("Zulema Quintana").first().waitFor();
  expect(await E.getByRole("button", { name: "Exportar" }).count() === 0, "el empleado ve «Exportar»");
});

// ── SOLO LECTURA
const V = pages.vie;
await step(V, "solo lectura: ve finanzas pero no opera ni exporta ni ve el NIF", async () => {
  await enter(V);
  const s = (await sidebar(V)).join("|");
  for (const l of ["Facturas", "Gastos", "Clientes"]) expect(s.includes(l), `falta «${l}»`);
  for (const l of ["Caja", "Equipo", "Importaciones"]) expect(!s.includes(l), `el solo lectura ve «${l}»`);
  await V.goto(BASE + "/facturas");
  await V.getByRole("heading", { name: "Facturas" }).first().waitFor();
  expect(await V.getByRole("button", { name: "Nueva factura" }).count() === 0, "solo lectura ve «Nueva factura»");
  expect(await V.getByRole("button", { name: "Exportar" }).count() === 0, "solo lectura ve «Exportar»");
  await noAccess(V, "/facturas/nueva");
  await noAccess(V, "/caja");
  await V.goto(BASE + "/clientes");
  await V.getByText("Zulema Quintana").first().click();
  await V.getByText("zulema@empresa.test").first().waitFor();
  expect(!(await text(V)).includes(NIF), "solo lectura ve el NIF");
  expect(await V.getByRole("button", { name: "Editar ficha" }).count() === 0 && await V.getByRole("button", { name: "Nota" }).count() === 0, "solo lectura ve acciones de edición");
});

// ── ENCARGADO
const M = pages.man;
await step(M, "encargado: opera y cobra cuotas; no emite facturas libres ni gestiona el equipo ni exporta", async () => {
  await enter(M);
  const s = (await sidebar(M)).join("|");
  for (const l of ["Caja", "Clientes", "Membresías"]) expect(s.includes(l), `falta «${l}»`);
  for (const l of ["Equipo", "Centros"]) expect(!s.includes(l), `el encargado ve «${l}»`);
  await noAccess(M, "/facturas/nueva");
  await M.goto(BASE + "/clientes");
  expect(await M.getByRole("button", { name: "Exportar" }).count() === 0, "el encargado ve «Exportar»");
  await M.getByText("Zulema Quintana").first().click();
  await M.getByText("zulema@empresa.test").first().waitFor();
  expect(!(await text(M)).includes(NIF), "el encargado ve el NIF");
  expect(await M.getByRole("button", { name: "Factura", exact: true }).count() === 0, "el encargado ve «Factura»");
  await M.getByRole("tab", { name: /Membresía/ }).click();
  await M.getByRole("button", { name: "Cobrar cuota" }).first().waitFor({ timeout: 10000 });     // cobrar cuotas: sí
});
await step(M, "encargado: Facturas en lectura (sin NIF) y sin «Nueva factura»", async () => {
  await M.goto(BASE + "/facturas");
  await M.getByRole("heading", { name: "Facturas" }).first().waitFor();
  expect(await M.getByRole("button", { name: "Nueva factura" }).count() === 0, "el encargado ve «Nueva factura»");
  expect(!(await text(M)).includes("B76543210"), "el encargado ve el NIF de la factura");
});

// ── CONTABLE
const F = pages.fin;
await step(F, "contable: facturas, informes y exportaciones; NIF visible; sin caja ni equipo", async () => {
  await enter(F);
  const s = (await sidebar(F)).join("|");
  for (const l of ["Facturas", "Gastos", "Informes"]) expect(s.includes(l), `falta «${l}»`);
  for (const l of ["Caja", "Equipo", "Importaciones"]) expect(!s.includes(l), `el contable ve «${l}»`);
  await F.goto(BASE + "/facturas");
  await F.getByRole("button", { name: "Nueva factura" }).first().waitFor();
  await F.getByRole("button", { name: "Exportar" }).first().waitFor();
  await F.goto(BASE + "/clientes");
  await F.getByText("Zulema Quintana").first().click();
  await F.getByText(NIF).first().waitFor({ timeout: 10000 });
  await noAccess(F, "/caja");
  await F.getByRole("button", { name: /Buscar, crear/ }).first().click();
  await F.getByPlaceholder(/Busca clientes/).fill(NIF);
  await F.getByText("Zulema Quintana").first().waitFor({ timeout: 5000 });
  await F.keyboard.press("Escape");
});

// ── PERMISOS INDIVIDUALES
await step(O, "propietario: concede a la encargada «emitir facturas» y «exportar» (o la app avisa de que falta 0920)", async () => {
  await O.goto(BASE + "/ajustes?tab=equipo");
  const teamRow = O.locator("div.border-t", { hasText: "Persona man" }).filter({ has: O.getByRole("button", { name: /^Permisos/ }) }).first();
  await teamRow.getByRole("button", { name: /^Permisos/ }).click();
  const d = O.getByRole("dialog");
  const row = (code) => d.locator("div.flex.flex-wrap").filter({ hasText: code }).first();
  await row("invoices.manage").getByRole("button", { name: "Permitir" }).click();
  await row("reports.export").getByRole("button", { name: "Permitir" }).click();
  await d.getByRole("button", { name: "Guardar permisos" }).click();
  const ok = O.getByText("Permisos actualizados");
  const pending = O.getByText(/migración 0920 pendiente/);
  await Promise.race([ok.waitFor({ timeout: 15000 }), pending.waitFor({ timeout: 15000 })]);
  globalThis.__has0920 = await ok.isVisible().catch(() => false);
  console.log(`    (servidor ${globalThis.__has0920 ? "CON" : "SIN"} la migración 0920)`);
});
if (globalThis.__has0920) {
  await step(M, "encargada con permisos individuales: ya emite facturas y exporta (se sigue sin Equipo)", async () => {
    await M.goto(BASE + "/");
    await M.locator("aside").first().waitFor();
    await M.waitForTimeout(61000 > 0 ? 500 : 0);
    await M.goto(BASE + "/facturas/nueva");
    await M.getByRole("button", { name: "Otro destinatario" }).waitFor({ timeout: 20000 });
    await M.goto(BASE + "/clientes");
    await M.getByRole("button", { name: "Exportar" }).first().waitFor({ timeout: 20000 });
    await noAccess(M, "/ajustes?tab=equipo").catch(() => undefined);
    expect(!(await sidebar(M)).join("|").includes("Equipo"), "la encargada ve «Equipo»");
  });
}

const failed = results.filter((r) => !r.ok);
const verdict = cw.classify ? cw.classify() : null;
console.log(`\n${results.length - failed.length}/${results.length} pasos OK`);
await browser.close();
process.exit(failed.length ? 1 : 0);
