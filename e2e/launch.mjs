/** Opciones de arranque de Chromium para las E2E. Con E2E_CHROME=/ruta/al/chrome se usa un navegador ya instalado (sin descargar el de Playwright). */
export const launchOptions = process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {};
