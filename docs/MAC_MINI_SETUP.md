# Mac mini Setup — continuar PRFMN Club en la máquina de desarrollo

Esta guía asume que vas a clonar/copiar el repositorio en un Mac nuevo (el Mac mini dedicado a IA/desarrollo) donde **sí** se instalarán herramientas de desarrollo, a diferencia de la máquina usada para las fases de diseño/documentación.

## 1. Requisitos previos

- macOS reciente con acceso de administrador.
- Conexión a internet para instalar Homebrew/Node y clonar el repositorio.

## 2. Instalar Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Al terminar, el propio instalador te dirá 1-2 líneas para añadir Homebrew al `PATH` (varía entre Apple Silicon e Intel). Típicamente en Apple Silicon:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Verifica:

```bash
brew --version
```

## 3. Instalar Node.js (LTS) y Git

```bash
brew install node git
```

Verifica versiones (el proyecto se ha desarrollado asumiendo Node 20+ y npm 10+):

```bash
node -v
npm -v
git --version
```

## 4. Clonar el repositorio

Si ya existe un remoto GitHub configurado (comprobar en `docs/DEVELOPMENT_HANDOFF.md` — a la fecha de este documento **todavía no existe remoto**, ver sección 8):

```bash
git clone <URL_DEL_REPOSITORIO> prfmn-club
cd prfmn-club
```

Si todavía no hay remoto, copia la carpeta `prfmn-club/` completa (por AirDrop, disco externo, o similar) preservando el directorio `.git/` para no perder el historial de commits.

## 5. Variables de entorno

En esta fase (Fase 2/3, frontend con mock data) **no se necesita ningún archivo `.env`** — no hay Supabase ni Stripe reales conectados todavía. Cuando se conecten (Fase 4+), este documento se actualizará con las variables `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`, etc. Nunca se debe commitear un `.env` real — `.gitignore` ya lo excluye.

## 6. Instalar dependencias

```bash
npm install
```

Esto es lo primero que **no se ha podido ejecutar ni validar** desde la máquina donde se escribió el código (no tenía Node). Es el primer paso real de verificación en el Mac mini.

## 7. Verificar que compila

```bash
npm run typecheck
npm run build
```

Si aparecen errores de TypeScript, imports rotos o de Tailwind, es la primera vez que se detectan — revisar y corregir antes de continuar. Ver `docs/DEVELOPMENT_HANDOFF.md` para el detalle de qué se ha revisado solo manualmente (sin compilador) hasta ahora.

## 8. Levantar el servidor de desarrollo

```bash
npm run dev
```

Abre `http://localhost:5173`. Deberías ver el Dashboard de PRFMN Club con datos mock.

## 9. Lint

```bash
npm run lint
```

## 10. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `command not found: node` tras instalar | Homebrew no está en el `PATH` de la shell actual | Cierra y reabre la terminal, o ejecuta `eval "$(/opt/homebrew/bin/brew shellenv)"` |
| Errores de tipos en `@/...` (alias no resuelto) | `tsconfig.json` no se está usando o el editor no reconoce el alias `@` | Confirmar que `tsconfig.json` tiene `"paths": { "@/*": ["src/*"] }` y que Vite usa `vite.config.ts` (no requiere plugin adicional porque solo usamos el alias en tipos vía `baseUrl`+`paths`; si TS se queja en tiempo de build revisar si hace falta añadir `vite-tsconfig-paths` — no estaba instalado a fecha de este documento, ver nota abajo) |
| Estilos de Tailwind no se aplican | `postcss.config.js` o `tailwind.config.ts` no detectados | Verificar que ambos archivos existen en la raíz de `prfmn-club/` y que `content` en `tailwind.config.ts` incluye `./src/**/*.{ts,tsx}` |
| Puerto 5173 ocupado | Otro proceso Vite corriendo | `npm run dev -- --port 5174` o matar el proceso anterior |
| `npm install` falla por versiones | Node demasiado antiguo/nuevo respecto a lo probado | Usar Node 20 LTS (`brew install node@20` y `brew link node@20`) |

**Nota sobre el alias `@/`:** el proyecto usa `import ... from "@/lib/utils"` etc. en todo el código. `tsconfig.json` resuelve el alias para el chequeo de tipos (`baseUrl` + `paths`), y `vite.config.ts` resuelve el mismo alias para el bundler en tiempo real vía `resolve.alias` (usando `fileURLToPath(new URL("./src", import.meta.url))`, el patrón estándar de Vite — sin dependencias adicionales). Esto está configurado de forma proactiva pero **no ha sido ejecutado nunca contra un Vite real**; si `npm run dev` da un error de módulo no encontrado para algún import `@/...`, es el primer punto a revisar.

## 11. Comprobaciones iniciales una vez arrancado

1. Navegar por el sidebar: Dashboard, Clientes, Cliente 360 (clic en cualquier cliente), Leads, Reservas, TPV, Tienda, Facturación, Comunicaciones, Automatizaciones, Configuración.
2. Probar el POS: `+Venta` (la propia página) → tocar "Agua" → tocar un cliente de la lista → debe confirmar automáticamente.
3. Probar Reservas: abrir una clase → "Añadir atleta" → buscar y añadir alguien → comprobar que el contador de plazas sube.
4. Reducir la ventana a ~375px de ancho (o usar las devtools del navegador en modo responsive) y comprobar que aparece el botón de menú (hamburguesa) y la navegación funciona igual.
5. Abrir la consola del navegador y comprobar que no hay errores en rojo al navegar por todas las pantallas.

Si todo lo anterior funciona, el frontend mock está validado y se puede continuar con la Fase 4 (schema Supabase real) — **solo cuando el usuario lo apruebe explícitamente**, ver `CLAUDE.md`.
