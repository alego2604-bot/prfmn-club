/**
 * Persistencia clave-valor. Hoy: IndexedDB del navegador (modo local).
 * Fase 5: el SupabaseAdapter sustituye a esta capa por tablas reales (mismo modelo, ver supabase/migrations).
 */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const DB_NAME = "business-os";
/** Nombre usado por versiones anteriores al cambio de nombre: solo para migrar datos locales existentes. */
const LEGACY_DB_NAME = "prfmn-club";
const STORE = "kv";

function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Si existe la base local con el nombre anterior y la nueva está vacía, copia todo (cuentas, empresas, datos)
 * y solo entonces elimina la antigua. Nunca borra nada sin haberlo copiado antes.
 */
async function migrateLegacyDb(): Promise<void> {
  const list = (await indexedDB.databases?.().catch(() => [])) ?? [];
  if (!list.some((d) => d.name === LEGACY_DB_NAME)) return;
  const [legacy, current] = await Promise.all([openDb(LEGACY_DB_NAME), openDb(DB_NAME)]);
  const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const currentKeys = await req(current.transaction(STORE).objectStore(STORE).getAllKeys());
  if (currentKeys.length) {
    // Ya hay datos con el nombre nuevo: no se toca la base antigua (nunca se borra nada no copiado).
    legacy.close();
    current.close();
    return;
  }
  {
    const ro = legacy.transaction(STORE).objectStore(STORE);
    const [keys, values] = await Promise.all([req(ro.getAllKeys()), req(ro.getAll())]);
    await new Promise<void>((res, rej) => {
      const tx = current.transaction(STORE, "readwrite");
      keys.forEach((k, i) => tx.objectStore(STORE).put(values[i], k));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  legacy.close();
  current.close();
  await new Promise<void>((res) => { const d = indexedDB.deleteDatabase(LEGACY_DB_NAME); d.onsuccess = d.onerror = d.onblocked = () => res(); });
}

export function createIndexedDbKV(): KV {
  const dbp = migrateLegacyDb().catch(() => undefined).then(() => openDb());
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
    dbp.then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req.result as T);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
  return {
    get: (key) => run("readonly", (s) => s.get(key)),
    set: (key, value) => run("readwrite", (s) => s.put(value, key)),
    del: (key) => run("readwrite", (s) => s.delete(key)),
    keys: () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((k) => k.map(String)),
  };
}

export function createMemoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => structuredClone(m.get(k)) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}
