import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { FilterSelect, Select, DateInput } from "@/design-system/components";
import { addDays, inPeriod, makePeriod, quarterPeriod, toISODate, type Period, type PeriodPreset } from "@/lib/dates";

export type ListPreset = PeriodPreset | "all" | "prev_quarter";

export interface PeriodFilter {
  preset: ListPreset;
  period: Period | null;
  test: (iso: string | undefined) => boolean;
}

export function usePeriodFilter(initial: ListPreset = "all") {
  const now = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<ListPreset>(initial);
  const [custom, setCustom] = useState({ start: toISODate(addDays(now, -29)), end: toISODate(now) });
  const period = useMemo<Period | null>(() => {
    if (preset === "all") return null;
    if (preset === "prev_quarter") {
      const q = Math.floor(now.getMonth() / 3);
      return q === 0 ? quarterPeriod(now.getFullYear() - 1, 4) : quarterPeriod(now.getFullYear(), q);
    }
    return makePeriod(preset, now, preset === "custom" ? { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) } : undefined);
  }, [preset, custom, now]);
  const filter: PeriodFilter = {
    preset,
    period,
    test: (iso) => !period || (!!iso && inPeriod(iso.length === 10 ? new Date(`${iso}T00:00`).toISOString() : iso, period)),
  };
  const control = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select aria-label="Periodo" value={preset} onChange={(e) => setPreset(e.target.value as ListPreset)} className="w-[170px]">
        <option value="all">Todo el histórico</option>
        <option value="today">Hoy</option>
        <option value="7d">Últimos 7 días</option>
        <option value="30d">Últimos 30 días</option>
        <option value="month">Este mes</option>
        <option value="quarter">Este trimestre</option>
        <option value="prev_quarter">Trimestre anterior</option>
        <option value="year">Este año</option>
        <option value="custom">Personalizado…</option>
      </Select>
      {preset === "custom" && (
        <>
          <DateInput aria-label="Desde" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="w-[150px]" />
          <DateInput aria-label="Hasta" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="w-[150px]" />
        </>
      )}
    </div>
  );
  /** Variante en píldora para la barra de filtros unificada (FilterBar) */
  const pill = (
    <>
      <FilterSelect
        label="Periodo"
        icon={CalendarRange}
        allLabel="Todo el histórico"
        value={preset === "all" ? "" : preset}
        onChange={(v) => setPreset((v || "all") as ListPreset)}
        options={PERIOD_OPTIONS}
      />
      {preset === "custom" && (
        <span className="flex items-center gap-1.5">
          <DateInput aria-label="Desde" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} size="sm" className="w-[140px]" />
          <DateInput aria-label="Hasta" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} size="sm" className="w-[140px]" />
        </span>
      )}
    </>
  );
  return { filter, control, pill, preset, setPreset };
}

const PERIOD_OPTIONS: { value: Exclude<ListPreset, "all">; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Este trimestre" },
  { value: "prev_quarter", label: "Trimestre anterior" },
  { value: "year", label: "Este año" },
  { value: "custom", label: "Personalizado…" },
];
