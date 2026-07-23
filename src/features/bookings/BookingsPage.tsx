import { useMemo, useState } from "react";
import { CLASS_SESSIONS, BOOKINGS } from "@/mocks";
import { Badge, Card, Drawer } from "@/design-system/components";
import { Button } from "@/design-system/components";
import { formatTime, cn } from "@/lib/utils";
import type { ClassSession } from "@/lib/types";
import { Users, Plus } from "lucide-react";

const DAYS = [
  { offset: 3, label: "Lun 20" },
  { offset: 4, label: "Mar 21" },
  { offset: 5, label: "Mié 22" },
];

function sessionsForDay(offset: number): ClassSession[] {
  const base = new Date("2026-07-20T00:00:00");
  base.setDate(base.getDate() + offset);
  const dayStr = base.toDateString();
  return CLASS_SESSIONS.filter((s) => new Date(s.startsAt).toDateString() === dayStr).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
}

export default function BookingsPage() {
  const [dayOffset, setDayOffset] = useState(3);
  const [selected, setSelected] = useState<ClassSession | null>(null);
  const sessions = useMemo(() => sessionsForDay(dayOffset), [dayOffset]);
  const roster = selected ? BOOKINGS.filter((b) => b.sessionId === selected.id) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Reservas</h2>
          <p className="mt-1 text-sm text-text-tertiary">Vista de calendario por día. {sessions.length} clases hoy.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4" /> Nueva clase
        </Button>
      </div>

      <div className="inline-flex gap-1 rounded-xl border border-border-subtle bg-surface p-1">
        {DAYS.map((d) => (
          <button
            key={d.offset}
            onClick={() => setDayOffset(d.offset)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium",
              dayOffset === d.offset ? "bg-accent text-accent-contrast" : "text-text-secondary hover:text-text-primary"
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((s) => {
          const occupancyPct = Math.round((s.booked / s.capacity) * 100);
          const isFull = s.booked >= s.capacity;
          return (
            <Card key={s.id} onClick={() => setSelected(s)} className="cursor-pointer p-4 hover:border-accent/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-tertiary">
                  {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
                </span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              </div>
              <p className="mt-2 font-semibold text-text-primary">{s.className}</p>
              <p className="text-xs text-text-tertiary">Coach {s.coachName}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
                  <Users className="h-3.5 w-3.5" /> {s.booked}/{s.capacity}
                </span>
                {isFull ? (
                  <Badge tone="warning">{s.waitlisted > 0 ? `+${s.waitlisted} espera` : "Completa"}</Badge>
                ) : (
                  <Badge tone={occupancyPct < 40 ? "info" : "success"}>{occupancyPct}%</Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.className ?? ""}>
        {selected && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              {formatTime(selected.startsAt)} – {formatTime(selected.endsAt)} · Coach {selected.coachName}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary">Añadir atleta</Button>
              <Button size="sm" variant="secondary">Añadir invitado</Button>
              <Button size="sm" variant="secondary">Pasar asistencia</Button>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Inscritos ({selected.booked}/{selected.capacity})
              </p>
              {roster.length === 0 ? (
                <p className="text-sm text-text-tertiary">Sin datos de reserva individual en este mock.</p>
              ) : (
                <div className="space-y-2">
                  {roster.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-sm">
                      <span className="text-text-primary">{b.clientName}</span>
                      <Badge tone={b.status === "waitlisted" ? "warning" : "success"}>{b.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
