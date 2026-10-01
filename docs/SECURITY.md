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
4. Verificación posterior: ninguno de los valores eliminados aparece en `git log -p --all` ni en ningún blob; tests, build y tests SQL en verde sobre el historial nuevo.
5. Force-push de las ramas reescritas.
6. Repositorio pasado a **privado** y renombrado a `business-os` (acción del propietario en GitHub, ver CHANGELOG).
7. Guardia `npm run check:privacy` + reglas de `.gitignore` para que no vuelva a ocurrir.

Este registro **no** reproduce los datos eliminados.

**Riesgos residuales que no se pueden limpiar desde el repositorio**:
- Clones locales hechos antes de la reescritura (Mac mini / MacBook del propietario y entornos de agentes): conservan el historial antiguo → borrar y volver a clonar.
- GitHub puede seguir sirviendo commits antiguos **por su SHA** (caché, «dangling commits») hasta su recolección de basura. Mitigado al ser privado; para purgarlo del todo hay que abrir una solicitud a GitHub Support («remove cached views / sensitive data») indicando los SHA antiguos.
- Forks: el repositorio no tenía forks conocidos al hacer la limpieza; si los hubiera, no se limpian automáticamente.
- Mientras fue público, cualquier tercero pudo haber clonado o indexado el contenido (p. ej. archivos de código públicos, buscadores). No es reversible; el riesgo se considera bajo por el tiempo de exposición y la ausencia de secretos.
- El backup previo a la limpieza contiene los datos antiguos: se guarda fuera del repositorio y debe eliminarse cuando el propietario confirme que el resultado es correcto.
