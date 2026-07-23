import type { RiskLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

const riskColor: Record<RiskLevel, string> = {
  low: "var(--success)",
  medium: "var(--warning)",
  high: "var(--danger)",
};

const riskLabel: Record<RiskLevel, string> = {
  low: "Riesgo de baja bajo",
  medium: "Riesgo de baja medio",
  high: "Riesgo de baja alto",
};

export function HealthScoreRing({ score, riskLevel, size = 96 }: { score: number; riskLevel: RiskLevel; size?: number }) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = riskColor[riskLevel];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border-default)" strokeWidth={8} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={8}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 300ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-text-primary">{score}</span>
          <span className="text-[10px] text-text-tertiary">/ 100</span>
        </div>
      </div>
      <span className={cn("text-xs font-medium")} style={{ color }}>
        {riskLabel[riskLevel]}
      </span>
    </div>
  );
}
