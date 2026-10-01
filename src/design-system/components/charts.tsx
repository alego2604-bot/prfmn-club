/**
 * Gráficas V2. Reglas (docs/DESIGN_SYSTEM.md · skill dataviz):
 *  - Serie principal = acento (2px, velo 10 %). Comparación = gris recesivo. Nunca doble eje ni arcoíris.
 *  - Rejilla hairline casi invisible, sin ejes dibujados. Barras ≤ 24px con extremo redondeado de 4px.
 *  - Tooltip: el valor manda (grande), la etiqueta acompaña; variación frente al periodo comparado.
 *  - Leyenda cuando hay ≥ 2 series; el texto nunca usa el color de la serie.
 *  - Animación discreta (≤ 500 ms) y desactivada con prefers-reduced-motion.
 */
import { useId, useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const axisTick = { fill: "var(--text-3)", fontSize: 11 };

export const compactMoney = (cents: number) => {
  const e = cents / 100;
  if (Math.abs(e) >= 1_000_000) return `${(e / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(e) >= 1000) return `${(e / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(e)} €`;
};

function deltaText(cur: number, prev: number | null | undefined): { text: string; tone: "up" | "down" | "flat" } | null {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur === 0 ? { text: "0 %", tone: "flat" } : null;
  const ch = (cur - prev) / Math.abs(prev);
  const v = Math.abs(ch * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 });
  return { text: `${ch > 0 ? "+" : ch < 0 ? "−" : ""}${v} %`, tone: ch > 0.0005 ? "up" : ch < -0.0005 ? "down" : "flat" };
}

export function ChartTooltip({ title, value, delta, deltaLabel, rows }: {
  title: ReactNode;
  value: string;
  delta?: { text: string; tone: "up" | "down" | "flat" } | null;
  deltaLabel?: string;
  rows?: { label: string; value: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="pointer-events-none min-w-[188px] rounded-lg border border-line bg-surface px-3 py-2.5 shadow-lg">
      <p className="text-2xs font-medium uppercase tracking-wider text-fg-3">{title}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight num">{value}</p>
      {delta && (
        <p className="mt-0.5 text-xs">
          <span className={cn("font-medium num", delta.tone === "up" ? "text-success-fg" : delta.tone === "down" ? "text-danger-fg" : "text-fg-3")}>{delta.text}</span>
          {deltaLabel && <span className="text-fg-3"> {deltaLabel}</span>}
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 py-0.5 text-xs">
              <span className="flex items-center gap-1.5 text-fg-3">
                <span className="inline-block w-3" style={{ borderTop: `2px ${r.dashed ? "dashed" : "solid"} ${r.color}` }} />
                {r.label}
              </span>
              <span className="font-medium text-fg-2 num">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean; shape?: "line" | "bar" }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3", className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === "bar" ? (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          ) : (
            <span className="inline-block w-3.5" style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface TrendPoint {
  key: string;
  label: string;
  tooltipLabel: string;
  current: number | null;
  previous?: number | null;
  previousLabel?: string;
}

/** Tendencia temporal: periodo actual (acento, área) frente al anterior (gris discontinuo). Un solo eje. */
export function TrendChart({ data, currentLabel, previousLabel, height = 260, format = formatMoney, axisFormat = compactMoney, className }: {
  data: TrendPoint[];
  currentLabel: string;
  previousLabel?: string;
  height?: number;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const hasPrev = data.some((d) => d.previous !== undefined && d.previous !== null);
  const lastIdx = useMemo(() => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i]!.current !== null) return i;
    return -1;
  }, [data]);
  return (
    <div style={{ height }} className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`trend-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} dy={6} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={axisFormat} width={52} tickCount={4} />
          <Tooltip
            cursor={{ stroke: "var(--chart-cursor)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as TrendPoint;
              if (p.current === null) return null;
              return (
                <ChartTooltip
                  title={p.tooltipLabel}
                  value={format(p.current)}
                  delta={hasPrev ? deltaText(p.current, p.previous) : null}
                  deltaLabel={hasPrev && p.previousLabel ? `vs ${p.previousLabel}` : undefined}
                  rows={hasPrev && p.previous !== null && p.previous !== undefined ? [{ label: previousLabel ?? "Anterior", value: format(p.previous), color: "var(--chart-2)", dashed: true }] : undefined}
                />
              );
            }}
          />
          {hasPrev && (
            <Area type="monotone" dataKey="previous" stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} activeDot={false} isAnimationActive={false} />
          )}
          <Area
            type="monotone"
            dataKey="current"
            name={currentLabel}
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#trend-${gid})`}
            connectNulls={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === lastIdx && props.cx !== undefined && props.cy !== undefined ? (
                <circle key="end" cx={props.cx} cy={props.cy} r={4} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
              ) : (
                <g key={`d${props.index}`} />
              )
            }
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--chart-1)" }}
            isAnimationActive={!reduced}
            animationDuration={450}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ColumnPoint {
  key: string;
  label: string;
  tooltipLabel: string;
  current: number;
  previous?: number | null;
  previousLabel?: string;
}

/** Columnas por periodo: actual (acento) y, opcional, comparación (gris). ≤ 24px, extremo redondeado, 2px de aire. */
export function ColumnChart({ data, currentLabel, previousLabel, height = 220, format = formatMoney, axisFormat = compactMoney, highlightLast }: {
  data: ColumnPoint[];
  currentLabel: string;
  previousLabel?: string;
  height?: number;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** Resalta solo la última columna (periodo en curso) y atenúa el resto */
  highlightLast?: boolean;
}) {
  const hasPrev = data.some((d) => d.previous !== undefined && d.previous !== null);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap={hasPrev ? "26%" : "34%"}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} dy={6} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={axisFormat} width={52} tickCount={4} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-sunken)", radius: 6 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as ColumnPoint;
              return (
                <ChartTooltip
                  title={p.tooltipLabel}
                  value={format(p.current)}
                  delta={hasPrev ? deltaText(p.current, p.previous) : null}
                  deltaLabel={hasPrev ? `vs ${p.previousLabel ?? previousLabel ?? "anterior"}` : undefined}
                  rows={hasPrev ? [{ label: previousLabel ?? "Anterior", value: format(p.previous ?? 0), color: "var(--chart-2)" }] : undefined}
                />
              );
            }}
          />
          {hasPrev && <Bar dataKey="previous" fill="var(--chart-2-bar)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={!reduced} animationDuration={400} />}
          <Bar dataKey="current" name={currentLabel} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={hasPrev ? 18 : 24} isAnimationActive={!reduced} animationDuration={450}>
            {highlightLast && data.map((d, i) => <Cell key={d.key} fill={i === data.length - 1 ? "var(--chart-1)" : "var(--chart-1-soft)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Mini tendencia sin ejes (12 puntos típicamente). El último punto se marca. */
export function Sparkline({ values, width = 96, height = 28, className, tone = "accent" }: { values: number[]; width?: number; height?: number; className?: string; tone?: "accent" | "muted" }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <div style={{ width, height }} className={className} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  const color = tone === "accent" ? "var(--chart-1)" : "var(--chart-2)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={`${d} L${lx},${height} L${pts[0]![0]},${height} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

/** Ranking horizontal en un solo tono: etiqueta, importe, cuota y variación opcional. */
export function BarList({ rows, format = (v) => formatMoney(v), max: maxRows = 8, emptyText = "Sin datos en este periodo", showShare = true }: {
  rows: { key: string; label: ReactNode; value: number; sub?: ReactNode; delta?: ReactNode }[];
  format?: (v: number) => string;
  max?: number;
  emptyText?: string;
  showShare?: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  const all = rest.length ? [...top, { key: "_other", label: `Otros (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0) }] : top;
  const max = Math.max(1, ...all.map((r) => r.value));
  if (!rows.length) return <p className="py-8 text-center text-sm text-fg-3">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-3">
      {all.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <div key={r.key} className="group" title={`${format(r.value)} · ${share} %`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg-2 transition-colors group-hover:text-fg">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {"delta" in r && r.delta}
                <span className="font-medium text-fg num">{format(r.value)}</span>
                {showShare && <span className="w-9 text-right text-xs text-fg-3 num">{share} %</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={cn("h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-700 ease-out", r.key === "_other" && "bg-[var(--chart-2)]")}
                style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
