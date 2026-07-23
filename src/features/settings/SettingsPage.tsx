import { useState } from "react";
import { STAFF } from "@/mocks/staff";
import { Badge, Card, Tabs } from "@/design-system/components";

const SECTIONS = [
  { value: "general", label: "General" },
  { value: "tarifas", label: "Tarifas" },
  { value: "equipo", label: "Equipo / Roles" },
  { value: "integraciones", label: "Integraciones" },
] as const;

const ROLE_LABEL = { owner: "Owner", manager: "Manager", coach: "Coach", reception: "Reception", athlete: "Athlete" };

export default function SettingsPage() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["value"]>("general");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Configuración</h2>
        <p className="mt-1 text-sm text-text-tertiary">The Gravity Room — ajustes del gimnasio.</p>
      </div>

      <Tabs value={section} onChange={setSection} options={SECTIONS as unknown as { value: typeof section; label: string }[]} />

      {section === "general" && (
        <Card className="max-w-xl space-y-4 p-5">
          <div>
            <p className="text-xs text-text-tertiary">Nombre del gimnasio</p>
            <p className="mt-1 font-medium text-text-primary">The Gravity Room</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Zona horaria</p>
            <p className="mt-1 font-medium text-text-primary">Europe/Madrid</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Datos fiscales</p>
            <p className="mt-1 font-medium text-text-primary">Pendiente de completar (requerido antes de emitir facturas reales)</p>
          </div>
        </Card>
      )}

      {section === "tarifas" && (
        <Card className="max-w-xl divide-y divide-border-subtle p-0">
          {["Unlimited", "3x semana", "2x semana", "Drop-in Pack 10"].map((r) => (
            <div key={r} className="flex items-center justify-between p-4">
              <span className="text-sm font-medium text-text-primary">{r}</span>
              <Badge tone="success">Activa</Badge>
            </div>
          ))}
        </Card>
      )}

      {section === "equipo" && (
        <Card className="max-w-2xl divide-y divide-border-subtle p-0">
          {STAFF.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-text-primary">{s.fullName}</p>
                <p className="text-xs text-text-tertiary">{s.email}</p>
              </div>
              <Badge tone="info">{ROLE_LABEL[s.role]}</Badge>
            </div>
          ))}
        </Card>
      )}

      {section === "integraciones" && (
        <Card className="max-w-xl space-y-3 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Stripe</span>
            <Badge tone="warning">No conectado (Fase 10)</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Supabase</span>
            <Badge tone="warning">No conectado (Fase 4)</Badge>
          </div>
        </Card>
      )}
    </div>
  );
}
