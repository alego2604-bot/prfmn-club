import { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border-subtle">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle bg-surface">
            {columns.map((col) => (
              <th key={col.header} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={
                "border-b border-border-subtle last:border-0 bg-surface " +
                (onRowClick ? "cursor-pointer hover:bg-white/[0.03]" : "")
              }
            >
              {columns.map((col) => (
                <td key={col.header} className={"px-4 py-3 align-middle text-text-primary " + (col.className ?? "")}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
