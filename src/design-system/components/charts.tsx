/**
 * Gráficas. Reglas (skill dataviz): una serie = color de acento; comparación = gris recesivo;
 * nunca doble eje; leyenda cuando hay ≥2 series; tooltip en hover; texto en tokens de texto.
 */
import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

const axisTick = { fill: "var(--text-3)", fontSize: 11 };
const short = (cents: number) => {
  const e = cents / 100;
  return Math.abs(e) >= 1000 ? `${(e / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })}k` : `${Math.round(e)}`;
};

function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: string; swatch: string; dashed?: boolean }[] }) {
  return (
    <div className="min-w-[180px] rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-fg">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-fg-3">
            <span className="h-0.5 w-3 rounded" style={{ background: r.swatch, borderTop: r.dashed ? `2px dashed ${r.swatch}` : undefined, height: r.dashed ? 0 : 2 }} />
            {r.label}
          </span>
          <span className="font-medium text-fg num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-fg-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4" style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface ComparePoint {
  label: string;
  tooltipLabel: string;
  current: number;
  previous?: number | null;
}

/** Evolución del periodo vs periodo anterior (misma escala, un eje). */
export function CompareArea({ data, currentLabel, previousLabel, height = 240 }: { data: ComparePoint[]; currentLabel: string; previousLabel?: string; height?: number }) {
  const hasPrev = data.some((d) => d.previous !== undefined && d.previous !== null);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="fillCurrent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={short} width={48} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as ComparePoint;
              return (
                <TooltipBox
                  title={p.tooltipLabel}
                  rows={[
                    { label: currentLabel, value: formatMoney(p.current), swatch: "var(--chart-1)" },
                    ...(hasPrev && p.previous !== undefined && p.previous !== null ? [{ label: previousLabel ?? "Anterior", value: formatMoney(p.previous), swatch: "var(--text-3)", dashed: true }] : []),
                  ]}
                />
              );
            }}
          />
          {hasPrev && <Area type="monotone" dataKey="previous" stroke="var(--text-3)" strokeOpacity={0.6} strokeDasharray="4 4" strokeWidth={1.5} fill="none" dot={false} activeDot={false} isAnimationActive={false} />}
          <Area type="monotone" dataKey="current" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillCurrent)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={500} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras por mes: año actual (acento) vs año anterior (gris). */
export function CompareBars({ data, currentLabel, previousLabel, height = 240 }: { data: ComparePoint[]; currentLabel: string; previousLabel: string; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={short} width={48} />
          <Tooltip
            cursor={{ fill: "var(--surface-sunken)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as ComparePoint;
              return (
                <TooltipBox
                  title={p.tooltipLabel}
                  rows={[
                    { label: currentLabel, value: formatMoney(p.current), swatch: "var(--chart-1)" },
                    { label: previousLabel, value: formatMoney(p.previous ?? 0), swatch: "var(--chart-2)" },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="previous" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="current" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Lista de barras horizontales (un solo color, etiqueta y valor en texto). */
export function BarList({ rows, format = (v) => formatMoney(v), max: maxRows = 8, emptyText = "Sin datos en este periodo" }: {
  rows: { key: string; label: ReactNode; value: number; sub?: ReactNode }[];
  format?: (v: number) => string;
  max?: number;
  emptyText?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  const all = rest.length ? [...top, { key: "_other", label: `Otros (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0) }] : top;
  const max = Math.max(1, ...all.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-fg-3">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {all.map((r) => (
        <div key={r.key} className="group" title={`${format(r.value)} · ${total ? Math.round((r.value / total) * 100) : 0} %`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="shrink-0 font-medium num">
              {format(r.value)}
              <span className="ml-2 inline-block w-10 text-right text-xs font-normal text-fg-3">{total ? Math.round((r.value / total) * 100) : 0} %</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div className={cn("h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500", r.key === "_other" && "opacity-40")} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
