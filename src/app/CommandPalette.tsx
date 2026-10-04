import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Kbd } from "@/design-system/components";
import { buildEntries, searchEntries, type Entry } from "./commandSearch";
import { applyTheme } from "./theme";
import { getPref, setPref } from "@/lib/localPrefs";
import { useSession, useWorkspace } from "./session";

function readRecent(): string[] {
  try {
    return JSON.parse(getPref("cmdk.recent") ?? "[]") as string[];
  } catch {
    return [];
  }
}
function pushRecent(to: string) {
  setPref("cmdk.recent", JSON.stringify([to, ...readRecent().filter((x) => x !== to)].slice(0, 6)));
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const { can, member } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const recent = useMemo(() => readRecent(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo<Entry[]>(() => buildEntries(ws, can, recent), [can, ws, recent]);

  const results = useMemo(() => searchEntries(ws, can, base, q, member?.locationIds ?? null), [q, base, ws, can, member?.locationIds]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const go = (e: Entry) => {
    onClose();
    if (e.to === "#theme") {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      return;
    }
    pushRecent(e.to.split("?")[0]!);
    navigate(e.to);
  };
  const groups = [...new Set(results.map((r) => r.group))];
  let idx = -1;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)]" onClick={onClose} />
      <div className="relative w-full max-w-2xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="h-[18px] w-[18px] text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter" && results[active]) go(results[active]!);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Busca clientes, productos, facturas, #ventas o escribe una acción…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[56vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-fg-3">Sin resultados para «{q}»</p>}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-fg-3">{g}</div>
              {results.filter((r) => r.group === g).map((r) => {
                idx++;
                const i = idx;
                return (
                  <button type="button"
                    key={r.id}
                    data-idx={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-75", i === active ? "bg-surface-sunken" : "", r.planned && "opacity-60")}
                  >
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", i === active ? "bg-surface text-fg shadow-xs" : "text-fg-3")}><r.icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.label}</span>
                      {r.hint && <span className="block truncate text-xs text-fg-3">{r.hint}</span>}
                    </span>
                    {i === active ? <CornerDownLeft className="h-3.5 w-3.5 text-fg-3" /> : <ArrowRight className="h-3.5 w-3.5 text-transparent" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-xs text-fg-3">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> abrir</span>
          <span className="flex items-center gap-1.5"><Kbd>esc</Kbd> cerrar</span>
          <span className="ml-auto hidden sm:inline">Escribe #123 para ir a una venta</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
