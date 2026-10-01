import { useMemo, useState } from "react";
import { Input, Select } from "@/design-system/components";
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
      <Select value={preset} onChange={(e) => setPreset(e.target.value as ListPreset)} className="w-[170px]">
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
          <Input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="w-[150px]" />
          <Input type="date" value={custom.end} min={custom.start} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="w-[150px]" />
        </>
      )}
    </div>
  );
  return { filter, control };
}
