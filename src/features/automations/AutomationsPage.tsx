import { useState } from "react";
import { AUTOMATION_RULES } from "@/mocks/automations";
import { Badge, Card } from "@/design-system/components";
import type { AutomationRule } from "@/lib/types";

function RuleRow({ rule }: { rule: AutomationRule }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-text-primary">{rule.name}</p>
          <Badge tone="neutral">{rule.triggerLabel}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-text-tertiary">{rule.description}</p>
        <p className="mt-1 text-xs text-text-tertiary">→ {rule.actionLabel} · {rule.timesTriggeredLast30Days} veces en 30 días</p>
      </div>
      <button
        onClick={() => setEnabled((e) => !e)}
        className={
          "relative h-6 w-11 shrink-0 rounded-full transition-colors " + (enabled ? "bg-accent" : "bg-white/10")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform " +
            (enabled ? "translate-x-5" : "translate-x-0.5")
          }
        />
      </button>
    </Card>
  );
}

export default function AutomationsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Automatizaciones</h2>
        <p className="mt-1 text-sm text-text-tertiary">Motor de reglas evento/condición → acción. Toda ejecución queda registrada.</p>
      </div>
      <div className="space-y-2">
        {AUTOMATION_RULES.map((rule) => (
          <RuleRow key={rule.id} rule={rule} />
        ))}
      </div>
    </div>
  );
}
