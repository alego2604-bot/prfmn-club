/**
 * Contexto activo (empresa + centro) POR PESTAÑA.
 *
 * - sessionStorage: el contexto de esta pestaña. Dos pestañas pueden tener empresas distintas y ninguna cambia la
 *   otra (sessionStorage no se comparte entre pestañas y nadie escucha cambios de otra pestaña).
 * - localStorage: solo «la última empresa usada», como valor inicial de una pestaña NUEVA.
 * - `?empresa=<id>` en la URL (abrir en pestaña nueva) tiene prioridad y se retira de la barra de direcciones.
 *
 * La autenticación sí es común a todo el navegador (misma persona): cerrar sesión cierra todas las pestañas.
 */
export interface TabContext {
  userId: string;
  orgId?: string;
  locationId?: string;
}

const TAB_KEY = "bos.tab.ctx";
const LAST_KEY = "bos.session"; // mismo nombre que la preferencia anterior (getPref("session")): compatible
export const ORG_PARAM = "empresa";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function read(s: StorageLike | undefined, key: string): TabContext | null {
  try {
    const raw = s?.getItem(key);
    return raw ? (JSON.parse(raw) as TabContext) : null;
  } catch {
    return null;
  }
}

function write(s: StorageLike | undefined, key: string, v: TabContext | null) {
  try {
    if (!s) return;
    if (v) s.setItem(key, JSON.stringify(v));
    else s.removeItem(key);
  } catch {
    /* almacenamiento bloqueado */
  }
}

const tabStore = (): StorageLike | undefined => (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
const lastStore = (): StorageLike | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/** Empresa pedida en la URL (`?empresa=`), si la hay. */
export function orgFromUrl(search = typeof location === "undefined" ? "" : location.search): string | null {
  return new URLSearchParams(search).get(ORG_PARAM);
}

/** Retira `?empresa=` de la barra de direcciones (sin recargar) una vez aplicado. */
export function clearOrgFromUrl() {
  if (typeof location === "undefined" || !orgFromUrl()) return;
  const u = new URL(location.href);
  u.searchParams.delete(ORG_PARAM);
  history.replaceState(history.state, "", u.pathname + u.search + u.hash);
}

/**
 * Contexto con el que arranca esta pestaña: el suyo propio si ya lo tenía (recarga), si no el de la URL y, si no,
 * la última empresa usada en el navegador.
 */
export function readTabContext(opts: { tab?: StorageLike; last?: StorageLike; urlOrg?: string | null } = {}): TabContext | null {
  const tab = read(opts.tab ?? tabStore(), TAB_KEY);
  const last = read(opts.last ?? lastStore(), LAST_KEY);
  const base = tab ?? last;
  const urlOrg = opts.urlOrg === undefined ? orgFromUrl() : opts.urlOrg;
  if (urlOrg && base) return { userId: base.userId, orgId: urlOrg, locationId: base.orgId === urlOrg ? base.locationId : undefined };
  return base;
}

/** Guarda el contexto de esta pestaña (y lo recuerda como «último usado» para pestañas nuevas). */
export function writeTabContext(v: TabContext | null, opts: { tab?: StorageLike; last?: StorageLike } = {}) {
  write(opts.tab ?? tabStore(), TAB_KEY, v);
  write(opts.last ?? lastStore(), LAST_KEY, v);
}

/** URL para abrir una empresa en otra pestaña sin tocar esta. */
export function urlForOrg(orgId: string, path = "/"): string {
  return `${path}?${ORG_PARAM}=${encodeURIComponent(orgId)}`;
}
