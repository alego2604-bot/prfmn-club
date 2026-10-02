# Seguridad y privacidad del repositorio

> Regla permanente del proyecto (también en `CLAUDE.md`, regla 10).

## 1. Código de producto ≠ datos de clientes

**NUNCA** se introducen en Git datos reales de clientes ni del negocio de un tenant:
DNI/NIF/NIE, nombres de personas, teléfonos, emails, direcciones, números de factura reales, documentos,
información bancaria (IBAN, tarjetas), ni datos financieros detallados (importes, totales, recuentos de clientes o facturas).

| El repositorio contiene | Los datos reales viven solo en |
|---|---|
| Código | Base de datos autorizada (Supabase del entorno) |
| Documentación técnica | Storage autorizado |
| Fixtures sintéticos / ficticios | Importaciones hechas por el usuario desde la app |
| Ejemplos anonimizados | Entornos seguros fuera de Git (p. ej. carpeta local `private/`, ignorada) |

- Tests: exclusivamente datos sintéticos (`Cliente Uno`, `12345678Z`, `T2600001`, `@example.com`, `*.test`).
- Verificación con ficheros reales: solo en local con `BOS_CAJA_XLSX`, `BOS_FACTURAS_XLSX` y las cifras esperadas en `BOS_REAL_EXPECT` (JSON fuera del repositorio).
- `.gitignore` bloquea `*.xlsx`, `*.xls`, `*.csv`, `*.pdf`, `real-data/`, `private/`, `expect*.json`.
- Guardia automática: `npm run check:privacy` (DNI/NIE con letra de control válida, IBAN, teléfonos, emails de dominios reales, claves y tokens, connection strings). Forma parte de la verificación obligatoria.

### 1.1 Datos sintéticos en staging (2026-10-02)

Toda prueba contra business-os-staging usa cuentas `*@empresa.test` y empresas sintéticas; la demo usa emails `@demo.invalid`, teléfonos `600 000 xxx` y ningún NIF. Las empresas demo llevan `is_demo = true` y un banner permanente. Ningún dato real interviene en tests, capturas ni semillas.

### 1.2 Contexto por pestaña y colas locales

La empresa activa es por pestaña (`sessionStorage`); el aislamiento real sigue siendo RLS en el servidor (una pestaña nunca puede leer otra empresa aunque manipule su almacenamiento). Las colas de cambios pendientes son por empresa y pestaña (`outbox:<org>:<tab>`) y se borran al cerrar sesión junto con la caché de la empresa.

## 2. Secretos

- Frontend: solo claves públicas (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). La seguridad la da RLS.
- `service_role`, Stripe, WhatsApp, IA, OCR, contraseñas de base de datos: solo en Supabase Edge Functions (`supabase secrets set`) o en el gestor de secretos del entorno. Nunca en Git, nunca en `VITE_*`.
- `integration_connections` guarda solo `secret_ref` (referencia), nunca el secreto.
- Si un secreto llega a un commit, **se rota** inmediatamente: borrarlo del código o del historial no basta.

## 3. Registro de incidentes

### 2026-10-01 — Datos personales en el historial de un repositorio público

**Qué pasó**: durante la fase inicial se usaron como ejemplos, en tests y en `docs/EXCEL_ANALYSIS.md`, identificadores fiscales,
nombres de pila y números de factura reales de clientes del primer tenant, cifras económicas reales del negocio, y en el prototipo
anterior emails de personal con el dominio real de la empresa. El repositorio era público.

**Revisión de secretos** (todo el historial, todas las ramas): `gitleaks` + búsqueda por patrones (claves Stripe/GitHub/AWS, JWT,
`service_role`, connection strings, contraseñas). **Resultado: ningún secreto real** (solo una contraseña ficticia de test).
No hay nada que rotar. `.env.example` siempre ha estado vacío.

**Acciones**:
1. Backup completo (`git bundle --all` + mirror) antes de tocar nada, guardado fuera del repositorio.
2. Árbol actual anonimizado: fixtures sintéticos, `EXCEL_ANALYSIS.md` sin cifras ni identificadores (se conservan las conclusiones técnicas), tests de ficheros reales con cifras esperadas fuera del repositorio, nombres de tenant y centro ficticios en tests.
3. **Reescritura controlada del historial** (`git filter-repo --replace-text`) en todas las ramas: cada valor sensible sustituido por un marcador neutro en todos los commits; el contenido final del proyecto es idéntico al estado anonimizado.
4. Verificación posterior: ninguno de los valores eliminados aparece en `git log -p --all` ni en ningún blob; tests, build y tests SQL en verde sobre el historial nuevo. El único cambio en el árbol final respecto al estado anonimizado fue un número de factura real que quedaba en un comentario de una migración nunca aplicada.
5. Force-push (con *lease*) de `main` y de la rama de desarrollo; verificado desde un clon nuevo de GitHub: 0 coincidencias, gitleaks sin hallazgos, ningún Excel/CSV/PDF en ningún commit. Objetos antiguos purgados del clon de trabajo (`reflog expire` + `gc --prune=now`).
6. Repositorio pasado a **privado** y renombrado a `business-os` (acción del propietario en GitHub, ver CHANGELOG).
7. Guardia `npm run check:privacy` + reglas de `.gitignore` para que no vuelva a ocurrir.

Este registro **no** reproduce los datos eliminados.

**Riesgos residuales que no se pueden limpiar desde el repositorio**:
- Clones locales hechos antes de la reescritura (Mac mini / MacBook del propietario y entornos de agentes): conservan el historial antiguo → borrar y volver a clonar.
- GitHub puede seguir sirviendo commits antiguos **por su SHA** (caché, «dangling commits») hasta su recolección de basura. Mitigado al ser privado; para purgarlo del todo hay que abrir una solicitud a GitHub Support («remove cached views / sensitive data») indicando los SHA antiguos.
- Forks: **0** según la API de GitHub en el momento de la limpieza.
- Comprobado tras el push: GitHub **seguía sirviendo los commits antiguos por su SHA** (`/commit/<sha>`). Al pasar a privado dejan de ser públicos; para eliminarlos de los servidores de GitHub hay que solicitarlo a GitHub Support.
- Mientras fue público, cualquier tercero pudo haber clonado o indexado el contenido (p. ej. archivos de código públicos, buscadores). No es reversible; el riesgo se considera bajo por el tiempo de exposición y la ausencia de secretos.
- El backup previo a la limpieza contiene los datos antiguos: se guarda fuera del repositorio y debe eliminarse cuando el propietario confirme que el resultado es correcto.

## 4. Funciones SECURITY DEFINER y avisos del Security Advisor (revisión 2026-10-01)

| Aviso | Estado | Motivo |
|---|---|---|
| `create_organization` ejecutable por `anon` | **Corregido** (0800) | Supabase concede EXECUTE a `anon` por defecto; `revoke … from public` no bastaba |
| `search_path` mutable en helpers internos | **Corregido** (0800) | `search_path = public, pg_temp` |
| `normalize_tax_id` sin EXECUTE para clientes | **Corregido** (0810) | Regresión de 0800 en columnas generadas |
| SECURITY DEFINER `create_organization` | Intencionado | Exige `auth.uid()`; crea empresa + centro + owner atómicamente (el usuario aún no es miembro, RLS no le dejaría) |
| SECURITY DEFINER `add_member_by_email` | Intencionado | Exige `team.manage` en `p_org`; no permite `owner`; valida rol de sistema y que los centros sean de esa empresa; necesita leer `auth.users` |
| SECURITY DEFINER `update_member` | Intencionado | Exige `team.manage` en la empresa del miembro; no toca al owner ni asciende a owner |
| `organization_counters` con RLS y sin políticas | Intencionado | Solo la escribe `app.next_counter` (definer) desde los triggers de numeración; inaccesible por API |

**Endurecimiento adicional recomendado (no aplicado; no rompe flujos, decisión del propietario):**
1. `add_member_by_email` revela si un email tiene cuenta (mensaje distinto). Solo a quien tiene `team.manage`; aceptable en staging. En producción: invitación por email con aceptación en vez de alta directa.
2. `create_organization`: el cliente decide `p_is_demo` y no hay límite de empresas por usuario. Recomendado: límite por usuario y forzar `is_demo = false` salvo flujo demo.
3. `update_member.p_status` sin lista blanca en la función (la protege el CHECK de la tabla). Recomendado validarlo y registrar la auditoría con el autor.
4. `app.next_counter` es ejecutable por `authenticated` (lo necesita `assign_sale_number`, que no es definer). No es invocable vía API porque el esquema `app` no está expuesto en PostgREST; mantener `app` fuera de "Exposed schemas".

