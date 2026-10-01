#!/usr/bin/env node
/**
 * Business OS · guardia de privacidad (docs/SECURITY.md).
 * Revisa los ficheros versionados en busca de datos personales o secretos que nunca deben estar en Git:
 * DNI/NIE con letra de control válida, números de factura con serie, IBAN, teléfonos, emails de dominios reales, claves y tokens.
 * Los valores sintéticos permitidos se declaran en ALLOW. Sale con código 1 si encuentra algo.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW = new Set([
  // Fixtures sintéticos (no corresponden a ninguna persona).
  "12345678Z", "87654321X", "X1234567L", "AB1234567",
]);
const ALLOWED_EMAIL = /@(example\.(com|org)|[a-z0-9-]+\.test|test\.dev|empresa\.com|anthropic\.com)$/i;
const SKIP = [/^package-lock\.json$/, /^docs\/archive\//, /^scripts\/check-privacy\.mjs$/, /\.(png|jpg|jpeg|gif|webp|ico|woff2?)$/];
const LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

const dniValid = (raw) => {
  const v = raw.toUpperCase();
  const n = v.replace(/^X/, "0").replace(/^Y/, "1").replace(/^Z/, "2");
  return /^\d{8}[A-Z]$/.test(n) && LETTERS[Number(n.slice(0, 8)) % 23] === n[8];
};

const RULES = [
  { name: "DNI/NIE válido", re: /\b[XYZxyz]?\d{7,8}[A-Za-z]\b/g, check: (m) => dniValid(m.length === 8 ? "0" + m : m) && !ALLOW.has(m.toUpperCase()) },
  { name: "Nº de factura real", re: /\b[A-Z]{1,2}\d{7}\b/g, check: (m) => !/^(T|U)26000\d\d$/.test(m) && !ALLOW.has(m) },
  { name: "IBAN", re: /\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){4,7}\b/g },
  { name: "Teléfono", re: /(?:\+34[ ]?)?\b[67]\d{2}[ ]?\d{3}[ ]?\d{3}\b/g, check: (m) => !/^(\+34 ?)?6(\d)\2 ?\d{3} ?\d{3}$/.test(m) && !/(000|111|222|333|444|555|666|777|888|999) ?\d{3}$/.test(m) && !/^(\+34 ?)?600 ?000 ?000$/.test(m) },
  { name: "Email real", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, check: (m) => !ALLOWED_EMAIL.test(m) },
  { name: "Clave/secreto", re: /\b(sk_live_[0-9A-Za-z]{8,}|sk_test_[0-9A-Za-z]{8,}|rk_live_[0-9A-Za-z]{8,}|whsec_[0-9A-Za-z]{8,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g },
  { name: "Connection string con contraseña", re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!localhost|127\.0\.0\.1)[^\s/]+/g },
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f && !SKIP.some((r) => r.test(f)));
const findings = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (!rule.check || rule.check(m[0])) findings.push(`${f}:${i + 1}  [${rule.name}]  ${m[0].slice(0, 6)}…`);
      }
    }
  });
}
if (findings.length) {
  console.error(`✗ Posibles datos sensibles en ${findings.length} sitio(s). Sustitúyelos por datos sintéticos (docs/SECURITY.md):\n` + findings.join("\n"));
  process.exit(1);
}
console.log(`✓ Privacidad: ${files.length} ficheros versionados sin datos personales ni secretos detectados.`);
