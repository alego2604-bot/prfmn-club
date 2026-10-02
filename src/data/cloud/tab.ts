/**
 * Identidad de la pestaña. Cada pestaña tiene su propia cola de cambios pendientes (outbox) y su propia
 * empresa activa: dos pestañas con la misma empresa nunca se pisan la cola, y dos pestañas con empresas
 * distintas nunca se cambian el contexto entre sí.
 *
 * - El id vive en sessionStorage (sobrevive a recargas de la misma pestaña).
 * - Mientras la pestaña está abierta mantiene un Web Lock con su id: así otra pestaña sabe si una cola
 *   pertenece a una pestaña viva o a una cerrada (huérfana, que se adopta para no perder cambios).
 * - «Duplicar pestaña» copia sessionStorage: si el lock ya está cogido, esta pestaña genera un id nuevo.
 */
import { uid } from "@/lib/ids";

const KEY = "bos.tab";
const LOCK_PREFIX = "bos-tab:";

type LockManagerLike = {
  request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | void) => Promise<unknown>;
  query: () => Promise<{ held?: { name?: string }[] }>;
};

function locks(): LockManagerLike | null {
  const l = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return l && typeof l.request === "function" ? l : null;
}

function readId(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeId(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* almacenamiento bloqueado */
  }
}

let current: Promise<string> | null = null;

/** Id estable de esta pestaña (con su lock de vida adquirido cuando el navegador lo soporta). */
export function tabId(): Promise<string> {
  if (current) return current;
  current = (async () => {
    const lm = locks();
    let id = readId() ?? uid();
    if (!lm) {
      writeId(id);
      return id;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await new Promise<boolean>((resolve) => {
        void lm.request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
          if (!lock) return resolve(false);
          resolve(true);
          return new Promise<void>(() => undefined); // se mantiene mientras viva la pestaña
        });
      });
      if (got) break;
      id = uid(); // pestaña duplicada: el id ya pertenece a otra pestaña viva
    }
    writeId(id);
    return id;
  })();
  return current;
}

/** Ids de pestañas vivas (null si el navegador no permite saberlo). */
export async function liveTabs(): Promise<Set<string> | null> {
  const lm = locks();
  if (!lm) return null;
  try {
    const q = await lm.query();
    return new Set((q.held ?? []).map((h) => h.name ?? "").filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
  } catch {
    return null;
  }
}
