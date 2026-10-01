#!/usr/bin/env node
/**
 * Business OS · aplica las migraciones a business-os-STAGING vía la Management API de Supabase (HTTPS).
 *
 *   SUPABASE_ACCESS_TOKEN=… BOS_STAGING_PROJECT_REF=hjuoddtsdavbatepexsz node scripts/staging/apply.mjs [--dry-run] [--status]
 *
 * Seguridad:
 *  - Solo acepta el proyecto de STAGING de Business OS (ref fijo abajo). Nunca producción ni ningún proyecto de PRFMN.
 *  - Registra lo aplicado en supabase_migrations.schema_migrations (compatible con la CLI de Supabase): cada
 *    migración se aplica una sola vez y en orden. Nunca reaplica ni edita una migración ya aplicada.
 *  - El token se lee del entorno; nunca se imprime ni se escribe en disco.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STAGING_REF = "hjuoddtsdavbatepexsz"; // business-os-staging (eu-west-1)
const ref = process.env.BOS_STAGING_PROJECT_REF ?? STAGING_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const dry = process.argv.includes("--dry-run");
const statusOnly = process.argv.includes("--status");

if (ref !== STAGING_REF) {
  console.error(`✗ Proyecto ${ref} no autorizado. Este script solo opera sobre business-os-staging (${STAGING_REF}).`);
  process.exit(1);
}
if (!token) {
  console.error("✗ Falta SUPABASE_ACCESS_TOKEN en el entorno.");
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

await sql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

console.log(`business-os-staging (${ref}) · ${applied.size} migraciones aplicadas de ${files.length}`);
for (const f of files) {
  const version = f.split("_")[0];
  const name = f.slice(version.length + 1, -4);
  if (applied.has(version)) {
    console.log(`  ✔ ${f}`);
    continue;
  }
  if (statusOnly || dry) {
    console.log(`  · ${f} (pendiente)`);
    continue;
  }
  process.stdout.write(`  → ${f} … `);
  const body = readFileSync(join(dir, f), "utf8");
  // Migración + registro en la misma transacción: o se aplica entera o no se aplica nada
  await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name.replace(/'/g, "''")}');\ncommit;`);
  console.log("aplicada");
}
if (!statusOnly && !dry) await sql("notify pgrst, 'reload schema';");

// Comprobaciones posteriores: RLS activa en todas las tablas de negocio y funciones clave presentes
const noRls = await sql(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity and tablename <> 'local_schema_migrations'`);
const fns = await sql(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('create_organization','sync_push','add_member_by_email','update_member')`);
const tables = await sql(`select count(*)::int as n from pg_tables where schemaname = 'public'`);
console.log(`\nTablas en public: ${tables[0].n} · sin RLS: ${noRls.length ? noRls.map((t) => t.tablename).join(", ") : "ninguna"} · funciones: ${fns.map((f) => f.proname).sort().join(", ")}`);
if (noRls.length) process.exit(2);
