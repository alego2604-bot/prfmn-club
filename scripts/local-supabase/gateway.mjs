// Pasarela mínima equivalente a la de Supabase: /auth/v1 → GoTrue, /rest/v1 → PostgREST (+ CORS). Solo desarrollo.
import http from "node:http";
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", Number(process.env.AUTH_PORT ?? 9999)],
  ["/rest/v1", Number(process.env.REST_PORT ?? 3000)],
];
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,x-supabase-api-version",
  "access-control-expose-headers": "content-range,x-total-count",
};
http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const route = routes.find(([p]) => req.url.startsWith(p));
  if (!route) { res.writeHead(404, cors); return res.end("not found"); }
  const [prefix, port] = route;
  const up = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url.slice(prefix.length) || "/", headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
}).listen(PORT, () => console.log(`gateway :${PORT}`));
