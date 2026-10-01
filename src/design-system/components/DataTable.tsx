import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeKey } from "@/lib/text";
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
}

function readHidden(key: string | undefined, cols: { id: string; defaultHidden?: boolean }[]): Set<string> {
  if (key) {
    try {
      const raw = localStorage.getItem(`prfmn.table.${key}`);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* almacenamiento no disponible */
    }
  }
  return new Set(cols.filter((c) => c.defaultHidden).map((c) => c.id));
}

export function DataTable<T>({
  rows, columns, getRowId, onRowClick, searchText, searchPlaceholder = "Buscar…", toolbar, selectable, bulkActions, pageSize = 50,
  exportName, exportCompany = "PRFMN Club", empty, storageKey, initialSort, rowClassName, footer, dense,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(storageKey, columns));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`prfmn.table.${storageKey}`, JSON.stringify([...hidden]));
    } catch {
      /* ignorar */
    }
  }, [hidden, storageKey]);

  const visible = columns.filter((c) => !hidden.has(c.id));

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
        {searchText && (
          <Input
            leading={<Search className="h-4 w-4" />}
            className="w-full sm:w-72"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {toolbar}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-sm text-fg-3 md:inline num">{sorted.length.toLocaleString("es-ES")} {sorted.length === 1 ? "registro" : "registros"}</span>
          <Menu
            width={240}
            trigger={(_, toggle) => <IconButton icon={Columns3} label="Columnas" onClick={toggle} />}
          >
            {() => (
              <>
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
        <div className="mb-2 flex animate-fade-in items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-fg">
          <span className="font-medium num">{selectedRows.length} seleccionados</span>
          <div className="flex items-center gap-2">{bulkActions?.(selectedRows, () => setSelected(new Set()))}</div>
          <button className="ml-auto inline-flex items-center gap-1 hover:underline" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="border-b border-line">
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
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-xs font-medium text-fg-3",
                        c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      )}
                    >
                      {c.sortValue ? (
                        <button
                          className={cn("inline-flex items-center gap-1 rounded hover:text-fg", active && "text-fg")}
                          onClick={() => setSort(active && sort!.dir === "desc" ? { id: c.id, dir: "asc" } : active && sort!.dir === "asc" ? null : { id: c.id, dir: "desc" })}
                        >
                          {c.header}
                          {active && (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
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
                    className={cn(
                      "group border-b border-line last:border-0 transition-colors",
                      onRowClick && "cursor-pointer hover:bg-surface-2",
                      selected.has(id) && "bg-accent-soft/60",
                      rowClassName?.(r),
                    )}
                  >
                    {selectable && (
                      <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(id)} onChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; })} />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          dense ? "h-10" : "h-12",
                          "px-3 align-middle",
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
        </div>
        {sorted.length === 0 && empty && (
          <EmptyState compact icon={empty.icon} title={query ? "Sin resultados" : empty.title} description={query ? `Nada coincide con «${query}».` : empty.description} action={query ? <Button onClick={() => setQuery("")}>Limpiar búsqueda</Button> : empty.action} />
        )}
        {footer}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between pt-3 text-sm text-fg-3">
          <span className="num">
            {page * pageSize + 1}–{Math.min(sorted.length, (page + 1) * pageSize)} de {sorted.length.toLocaleString("es-ES")}
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
