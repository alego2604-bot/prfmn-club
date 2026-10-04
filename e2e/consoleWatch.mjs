/**
 * Captura y clasifica lo que sale mal en el navegador durante una E2E: errores de consola (con su origen),
 * excepciones JS y respuestas HTTP ≥ 400. Así un «404 de GitHub Pages» no esconde un error real.
 *
 * Categorías:
 *  - pages-404: navegación directa a una ruta interna en GitHub Pages (sirve 404.html con la app; esperado)
 *  - sync-409: `sync_push` rechaza un lote ya aplicado (23505); la app lo resuelve, pero es un reenvío
 *  - supabase: cualquier otra respuesta ≥ 400 de Supabase (auth, RPC, REST)
 *  - network: fallo de red (net::ERR_…)
 *  - js: excepción no capturada o error de React
 *  - other: el resto
 */
export function createConsoleWatch() {
  const events = [];
  const navs = new Set();
  const watch = (page, label) => {
    page.on("response", async (r) => {
      const url = r.url();
      if (r.status() < 400) return;
      const req = r.request();
      const isDoc = req.resourceType() === "document";
      if (isDoc) navs.add(url);
      let body = "";
      if (/supabase\.co/.test(url)) body = (await r.text().catch(() => "")).slice(0, 200);
      events.push({ label, kind: "http", status: r.status(), method: req.method(), url, isDoc, body });
    });
    page.on("requestfailed", (req) => {
      const f = req.failure()?.errorText ?? "";
      if (/ERR_ABORTED/.test(f)) return; // navegación cancelada por otra: no es un fallo
      events.push({ label, kind: "network", url: req.url(), text: f });
    });
    page.on("pageerror", (e) => events.push({ label, kind: "js", text: e.message }));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/favicon|ResizeObserver/.test(text)) return;
      events.push({ label, kind: "console", text, url: m.location()?.url ?? "" });
    });
  };
  const classify = () => {
    const out = [];
    for (const e of events) {
      if (e.kind === "http") {
        if (e.status === 404 && e.isDoc && /github\.io/.test(e.url)) out.push({ cat: "pages-404", detail: `${e.url.replace(/^https?:\/\/[^/]+/, "")}` });
        else if (e.status === 409 && /sync_push/.test(e.url)) out.push({ cat: "sync-409", detail: e.body });
        else if (/supabase\.co/.test(e.url)) out.push({ cat: "supabase", detail: `${e.method} ${e.status} ${e.url.split("?")[0].replace(/^https?:\/\/[^/]+/, "")} ${e.body}` });
        else out.push({ cat: "other", detail: `${e.method} ${e.status} ${e.url}` });
      } else if (e.kind === "console") {
        // «Failed to load resource» repite una respuesta HTTP ya registrada arriba
        if (/Failed to load resource/.test(e.text)) continue;
        out.push({ cat: /Warning:|React|Uncaught/.test(e.text) ? "js" : "other", detail: `${e.text.slice(0, 220)} @ ${e.url}` });
      } else if (e.kind === "network") out.push({ cat: "network", detail: `${e.text} ${e.url}` });
      else out.push({ cat: "js", detail: e.text.slice(0, 300) });
    }
    return out;
  };
  /** Resumen por categoría. Devuelve el nº de errores que NO son esperados (todo salvo pages-404). */
  const report = () => {
    const all = classify();
    const by = new Map();
    for (const x of all) by.set(x.cat, [...(by.get(x.cat) ?? []), x.detail]);
    const consoleCount = events.filter((e) => e.kind === "console").length;
    console.log(`\nConsola: ${consoleCount} errores de consola · clasificados: ${[...by].map(([k, v]) => `${k}=${v.length}`).join(", ") || "ninguno"}`);
    for (const [k, v] of by) {
      const uniq = [...new Set(v)];
      console.log(`  [${k}] ${v.length}${k === "pages-404" ? " (esperado: GitHub Pages sirve 404.html con la app en rutas internas)" : ""}`);
      for (const d of uniq.slice(0, k === "pages-404" ? 5 : 20)) console.log(`     · ${d}`);
    }
    return all.filter((x) => x.cat !== "pages-404").length;
  };
  return { watch, report, events };
}
