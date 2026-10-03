import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, Search, X } from "lucide-react";
import { ScrollFade } from "./layout";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/money";
import { normalizeKey } from "@/lib/text";
import { getPref, setPref } from "@/lib/localPrefs";
import { downloadCsv, downloadXlsx, type ExportColumn, type ExportValue } from "@/lib/export";
import { Button, IconButton } from "./primitives";
import { Checkbox, Input } from "./form";
import { Menu, MenuItem, MenuLabel } from "./overlay";
import { EmptyState } from "./feedback";
import type { LucideIcon } from "lucide-react";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  exportValue?: (row: T) => ExportValue;
  exportFormat?: ExportColumn["format"];
  align?: "left" | "right" | "center";
  className?: string;
  /** Columnas ocultas por defecto (el usuario puede mostrarlas) */
  defaultHidden?: boolean;
  /** false = siempre visible */
  hideable?: boolean;
  width?: number | string;
  /**
   * Importancia en pantallas medias: "medium" se oculta por debajo de 1024 px y "low" por debajo de 1280 px
   * (iPad: menos columnas, sin scroll horizontal). Por defecto, siempre visible.
   */
  priority?: "high" | "medium" | "low";
}

/** Fila en formato tarjeta para móvil (<768 px): nombre claro, valor principal, estado y una segunda línea. */
export interface MobileCard<T> {
  title: (row: T) => ReactNode;
  value?: (row: T) => ReactNode;
  subtitle?: (row: T) => ReactNode;
  status?: (row: T) => ReactNode;
  leading?: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  selectable?: boolean;
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  pageSize?: number;
  exportName?: string;
  exportCompany?: string;
  empty?: { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
  storageKey?: string;
  initialSort?: { id: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  dense?: boolean;
  /** Presentación en móvil. Si no se indica, se deduce de las columnas (primera = título, importe = valor, estado). */
  mobile?: MobileCard<T>;
  /** Barra de filtros (FilterBar) en la misma fila que el recuento, columnas y exportar */
  filters?: ReactNode;
}

const PRIORITY_CLASS = { high: "", medium: "hidden lg:table-cell", low: "hidden xl:table-cell" } as const;

/** true cuando la ventana cumple la consulta (se actualiza al girar el iPad o redimensionar). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

function readHidden(key: string | undefined, cols: { id: string; defaultHidden?: boolean }[]): Set<string> {
  if (key) {
    try {
      const raw = getPref(`table.${key}`);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* valor corrupto */
    }
  }
  return new Set(cols.filter((c) => c.defaultHidden).map((c) => c.id));
}

export function DataTable<T>({
  rows, columns, getRowId, onRowClick, searchText, searchPlaceholder = "Buscar…", toolbar, selectable, bulkActions, pageSize = 50,
  exportName, exportCompany = "Business OS", empty, storageKey, initialSort, rowClassName, footer, dense, mobile, filters,
}: DataTableProps<T>) {
  const [compact, setCompact] = useState<boolean>(() => dense ?? getPref(`table.density.${storageKey ?? "default"}`) === "compact");
  // Una sola vista en el DOM: tarjetas en móvil, tabla desde 768 px
  const wide = useMediaQuery("(min-width: 768px)");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(storageKey, columns));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!storageKey) return;
    setPref(`table.${storageKey}`, JSON.stringify([...hidden]));
  }, [hidden, storageKey]);

  const visible = columns.filter((c) => !hidden.has(c.id));
  const card: MobileCard<T> = mobile ?? {
    title: (r) => visible[0]?.cell(r),
    subtitle: visible[1] && visible[1].align !== "right" && visible[1].id !== "status" ? (r) => visible[1]!.cell(r) : undefined,
    value: (() => { const v = [...visible].reverse().find((c) => c.align === "right"); return v ? (r: T) => v.cell(r) : undefined; })(),
    status: (() => { const st = visible.find((c) => c.id === "status"); return st ? (r: T) => st.cell(r) : undefined; })(),
  };
  const setDensity = (c: boolean) => {
    setCompact(c);
    setPref(`table.density.${storageKey ?? "default"}`, c ? "compact" : "comfortable");
  };

  const filtered = useMemo(() => {
    const q = normalizeKey(query);
    if (!q || !searchText) return rows;
    const terms = q.split(" ");
    return rows.filter((r) => {
      const t = normalizeKey(searchText(r));
      return terms.every((x) => t.includes(x));
    });
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es")) * dir;
    });
  }, [filtered, sort, columns]);

  useEffect(() => setPage(0), [query, rows.length, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(getRowId(r))), [rows, selected, getRowId]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(getRowId(r)));

  const exportRows = (format: "csv" | "xlsx") => {
    const cols = visible.filter((c) => c.exportValue);
    const source = selectedRows.length ? sorted.filter((r) => selected.has(getRowId(r))) : sorted;
    const sheet = {
      name: exportName ?? "Datos",
      columns: cols.map((c) => ({ header: c.header, format: c.exportFormat })),
      rows: source.map((r) => cols.map((c) => c.exportValue!(r))),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${(exportName ?? "export").replace(/\s+/g, "_")}_${stamp}`;
    if (format === "csv") downloadCsv(name, sheet);
    else void downloadXlsx(name, [sheet], { company: exportCompany });
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {filters && <div className="min-w-0 flex-1 basis-full sm:basis-0">{filters}</div>}
        {searchText && (
          <Input
            leading={<Search className="h-4 w-4" />}
            className="w-full sm:w-72"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {toolbar && (
          <ScrollFade className="w-full sm:w-auto sm:max-w-full" innerClassName="flex items-center gap-2 [&>*]:shrink-0">
            {toolbar}
          </ScrollFade>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-sm text-fg-3 md:inline num">{formatNumber(sorted.length)} {sorted.length === 1 ? "registro" : "registros"}</span>
          <Menu
            width={240}
            trigger={(_, toggle) => <IconButton icon={Columns3} label="Columnas" onClick={toggle} />}
          >
            {() => (
              <>
                <MenuLabel>Densidad</MenuLabel>
                <div className="flex gap-1 px-1.5 pb-1">
                  {([[false, "Cómoda"], [true, "Compacta"]] as const).map(([v, l]) => (
                    <button key={l} type="button" onClick={() => setDensity(v)} className={cn("h-7 flex-1 rounded-md text-xs font-medium transition-colors", compact === v ? "bg-ink text-fg-inverse" : "bg-surface-sunken text-fg-2 hover:text-fg")}>{l}</button>
                  ))}
                </div>
                <MenuLabel>Columnas visibles</MenuLabel>
                {columns.filter((c) => c.hideable !== false).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 text-sm hover:bg-surface-sunken">
                    <Checkbox
                      checked={!hidden.has(c.id)}
                      onChange={(v) => setHidden((h) => { const n = new Set(h); if (v) n.delete(c.id); else n.add(c.id); return n; })}
                    />
                    {c.header}
                  </label>
                ))}
              </>
            )}
          </Menu>
          {exportName && (
            <Menu trigger={(_, toggle) => <Button size="md" icon={Download} onClick={toggle}>Exportar</Button>}>
              {(close) => (
                <>
                  <MenuLabel>{selectedRows.length ? `${selectedRows.length} seleccionados` : `${sorted.length} registros filtrados`}</MenuLabel>
                  <MenuItem icon={FileSpreadsheet} onClick={() => { exportRows("xlsx"); close(); }}>Excel (.xlsx)</MenuItem>
                  <MenuItem icon={Download} onClick={() => { exportRows("csv"); close(); }}>CSV (;)</MenuItem>
                </>
              )}
            </Menu>
          )}
        </div>
      </div>

      {selectable && selectedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6" role="toolbar" aria-label="Acciones sobre la selección">
          <div className="flex animate-slide-up items-center gap-3 rounded-xl bg-surface-inverse py-2 pl-4 pr-2 text-sm text-fg-inverse shadow-lg">
            <span className="font-medium num">{selectedRows.length} seleccionado{selectedRows.length === 1 ? "" : "s"}</span>
            <span className="h-4 w-px bg-fg-inverse/20" />
            <div className="flex items-center gap-1.5 [&_button]:border-transparent [&_button]:bg-fg-inverse/10 [&_button]:text-fg-inverse [&_button:hover]:bg-fg-inverse/20">{bulkActions?.(selectedRows, () => setSelected(new Set()))}</div>
            {exportName && <button type="button" className="h-8 rounded-md px-2.5 text-fg-inverse/80 hover:bg-fg-inverse/10 hover:text-fg-inverse" onClick={() => exportRows("xlsx")}>Exportar</button>}
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-inverse/70 hover:bg-fg-inverse/10 hover:text-fg-inverse" onClick={() => setSelected(new Set())} aria-label="Limpiar selección">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="surface-card overflow-hidden rounded-xl">
        {/* Móvil: lista de tarjetas */}
        {!wide && <ul className="divide-y divide-line" data-testid="table-cards">
          {pageRows.map((r) => {
            const id = getRowId(r);
            const Tag = onRowClick ? "button" : "div";
            return (
              <li key={id} className={cn(rowClassName?.(r))}>
                <Tag type={onRowClick ? "button" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left", onRowClick && "active:bg-surface-sunken")}>
                  {card.leading?.(r)}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[15px] font-medium leading-6 [&_*]:truncate">{card.title(r)}</span>
                      {card.value && <span className="shrink-0 text-[15px] font-semibold num">{card.value(r)}</span>}
                    </span>
                    {(card.subtitle || card.status) && (
                      <span className="mt-0.5 flex items-center justify-between gap-3 text-[13px] text-fg-3">
                        <span className="min-w-0 truncate [&_*]:truncate">{card.subtitle?.(r)}</span>
                        {card.status && <span className="shrink-0">{card.status(r)}</span>}
                      </span>
                    )}
                  </span>
                  {onRowClick && <ChevronRight className="h-4 w-4 shrink-0 text-fg-3" />}
                </Tag>
              </li>
            );
          })}
        </ul>}
        {/* Tablet / escritorio: tabla con cabecera fija (scroll interno cuando hay muchas filas) */}
        {wide && <div className={cn("scrollbar-thin overflow-x-auto", pageRows.length > 14 && "max-h-[calc(100dvh-210px)] overflow-y-auto")}>
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 shadow-[0_1px_0_var(--border)]">
              <tr>
                {selectable && (
                  <th className="w-10 px-3">
                    <Checkbox
                      label="Seleccionar página"
                      checked={allPageSelected}
                      indeterminate={!allPageSelected && pageRows.some((r) => selected.has(getRowId(r)))}
                      onChange={(v) => setSelected((s) => { const n = new Set(s); pageRows.forEach((r) => (v ? n.add(getRowId(r)) : n.delete(getRowId(r)))); return n; })}
                    />
                  </th>
                )}
                {visible.map((c) => {
                  const active = sort?.id === c.id;
                  return (
                    <th
                      key={c.id}
                      style={{ width: c.width }}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-xs font-medium text-fg-3 first:pl-4 last:pr-4",
                        PRIORITY_CLASS[c.priority ?? "high"],
                        c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      )}
                    >
                      {c.sortValue ? (
                        <button type="button"
                          className={cn("group/sort inline-flex items-center gap-1 rounded transition-colors hover:text-fg", active && "text-fg")}
                          onClick={() => setSort(active && sort!.dir === "desc" ? { id: c.id, dir: "asc" } : active && sort!.dir === "asc" ? null : { id: c.id, dir: "desc" })}
                        >
                          {c.header}
                          {active ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowDown className="h-3 w-3 opacity-0 transition-opacity group-hover/sort:opacity-40" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const id = getRowId(r);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(r); } } : undefined}
                    className={cn(
                      "group border-t border-line transition-colors duration-100",
                      onRowClick && "cursor-pointer outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-[inset_3px_0_0_var(--accent)] active:bg-surface-sunken",
                      selected.has(id) && "bg-accent-soft/60",
                      rowClassName?.(r),
                    )}
                  >
                    {selectable && (
                      <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox label="Seleccionar fila" checked={selected.has(id)} onChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; })} />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          compact ? "h-9" : "h-11",
                          "px-3 align-middle first:pl-4 last:pr-4",
                          PRIORITY_CLASS[c.priority ?? "high"],
                          c.align === "right" ? "text-right num" : c.align === "center" ? "text-center" : "text-left",
                          c.className,
                        )}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
        {sorted.length === 0 && empty && (
          <EmptyState compact icon={empty.icon} title={query ? "Sin resultados" : empty.title} description={query ? `Nada coincide con «${query}».` : empty.description} action={query ? <Button onClick={() => setQuery("")}>Limpiar búsqueda</Button> : empty.action} />
        )}
        {footer}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between pt-3 text-sm text-fg-3">
          <span className="num">
            {formatNumber(page * pageSize + 1)}–{formatNumber(Math.min(sorted.length, (page + 1) * pageSize))} de {formatNumber(sorted.length)}
          </span>
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Anterior" disabled={page === 0} onClick={() => setPage((p) => p - 1)} />
            <span className="px-2 num">{page + 1} / {pages}</span>
            <IconButton icon={ChevronRight} label="Siguiente" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} />
          </div>
        </div>
      )}
    </div>
  );
}
