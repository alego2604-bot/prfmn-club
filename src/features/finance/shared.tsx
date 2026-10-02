import { useMemo, useState, type ReactNode } from "react";
import { BadgePercent, CreditCard, Landmark, Receipt, ScrollText, Truck, Waves } from "lucide-react";
import { RangeSelector, SubNav } from "@/design-system/components";
import { addDays, comparablePrevious, formatDate, makePeriod, toISODate, type Period, type PeriodPreset } from "@/lib/dates";
import { useSession } from "@/app/session";

export type FinanceRange = "month" | "quarter" | "ytd" | "1y" | "custom";
export const FINANCE_RANGES: { value: Exclude<FinanceRange, "custom">; label: string; long: string }[] = [
  { value: "month", label: "Mes", long: "Mes en curso" },
  { value: "quarter", label: "Trim.", long: "Trimestre en curso" },
  { value: "ytd", label: "YTD", long: "Año en curso hasta hoy" },
  { value: "1y", label: "1A", long: "Últimos 12 meses" },
];

/** Periodo compartido por las pantallas de Finanzas (se recuerda en la pestaña mientras se navega entre ellas). */
let lastRange: FinanceRange = "ytd";
let lastCustom: { start: string; end: string } | null = null;

export function useFinancePeriod(initial: FinanceRange = lastRange) {
  const now = useMemo(() => new Date(), []);
  const [range, setRangeState] = useState<FinanceRange>(initial);
  const [custom, setCustomState] = useState(lastCustom ?? { start: toISODate(addDays(now, -89)), end: toISODate(now) });
  const setRange = (r: FinanceRange) => { lastRange = r; setRangeState(r); };
  const setCustom = (c: { start: string; end: string }) => { lastCustom = c; setCustomState(c); };
  const period: Period = useMemo(
    () => makePeriod(range as PeriodPreset, now, range === "custom" ? { start: new Date(`${custom.start}T00:00`), end: new Date(`${custom.end}T00:00`) } : undefined),
    [range, now, custom],
  );
  const prev = useMemo(() => comparablePrevious(period, now), [period, now]);
  const control = <RangeSelector value={range} onChange={setRange} options={FINANCE_RANGES} custom="custom" customValue={custom} onCustomChange={setCustom} />;
  return { now, range, period, prev, control };
}

export function periodSpan(p: Period) {
  return `${formatDate(p.start)} – ${formatDate(addDays(p.end, -1))}`;
}

export function FinanceNav() {
  const { can } = useSession();
  const items = [
    { to: "/finanzas", label: "Resumen", icon: Landmark, end: true },
    { to: "/flujo-de-caja", label: "Flujo de caja", icon: Waves },
    { to: "/gastos", label: "Gastos", icon: ScrollText },
    { to: "/proveedores", label: "Proveedores", icon: Truck },
    { to: "/facturas", label: "Facturas", icon: Receipt },
    { to: "/pagos", label: "Cobros", icon: CreditCard },
    { to: "/impuestos", label: "Impuestos", icon: BadgePercent },
  ];
  return can("finance.view") ? <SubNav items={items} /> : null;
}

/** Cabecera común de Finanzas: contexto (periodo · centro), título, selector y acciones. */
export function FinanceHeader({ title, eyebrow, actions, control }: { title: string; eyebrow?: ReactNode; actions?: ReactNode; control?: ReactNode }) {
  return (
    <>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-sm text-fg-3">{eyebrow}</p>}
          <h1 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-0.03em]">{title}</h1>
        </div>
        {(control || actions) && <div className="flex flex-wrap items-center gap-2">{control}{actions}</div>}
      </div>
      <FinanceNav />
    </>
  );
}
