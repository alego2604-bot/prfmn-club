import { useMemo, useState } from "react";
import { CLASS_SESSIONS, BOOKINGS, TODAY_OFFSET, dateForOffset } from "@/mocks/bookings";
import { CLIENTS } from "@/mocks/clients";
import { Badge, Button, Card, Drawer, SearchInput } from "@/design-system/components";
import { formatTime, cn } from "@/lib/utils";
import type { ClassSession, Booking, Client } from "@/lib/types";
import { Users, Plus, UserPlus, UserRoundPlus, ClipboardCheck, Check } from "lucide-react";

const DAYS = [
  { offset: TODAY_OFFSET, label: "Hoy" },
  { offset: TODAY_OFFSET + 1, label: "Mañana" },
  { offset: TODAY_OFFSET + 2, label: "Pasado mañana" },
];

type DrawerMode = "roster" | "addAthlete" | "addGuest" | "attendance";

export default function BookingsPage() {
  const [dayOffset, setDayOffset] = useState(TODAY_OFFSET);
  const [allSessions, setAllSessions] = useState<ClassSession[]>(CLASS_SESSIONS);
  const [allBookings, setAllBookings] = useState<Booking[]>(BOOKINGS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<DrawerMode>("roster");
  const [guestName, setGuestName] = useState("");
  const [athleteQuery, setAthleteQuery] = useState("");
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const sessions = useMemo(() => {
    const dayStr = dateForOffset(dayOffset).toDateString();
    return allSessions
      .filter((s) => new Date(s.startsAt).toDateString() === dayStr)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [allSessions, dayOffset]);

  const selected = selectedId ? allSessions.find((s) => s.id === selectedId) ?? null : null;
  const roster = selectedId ? allBookings.filter((b) => b.sessionId === selectedId) : [];
  const dayLabel = DAYS.find((d) => d.offset === dayOffset)?.label.toLowerCase() ?? "";

  function flash(message: string) {
    setFlashMessage(message);
    setTimeout(() => setFlashMessage(null), 1800);
  }

  function openSession(id: string) {
    setSelectedId(id);
    setMode("roster");
    setGuestName("");
    setAthleteQuery("");
  }

  function closeDrawer() {
    setSelectedId(null);
  }

  function addPerson(clientId: string, clientName: string) {
    if (!selected) return;
    const hasSpace = selected.booked < selected.capacity;
    setAllSessions((prev) =>
      prev.map((s) =>
        s.id === selected.id ? { ...s, booked: hasSpace ? s.booked + 1 : s.booked, waitlisted: hasSpace ? s.waitlisted : s.waitlisted + 1 } : s
      )
    );
    setAllBookings((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, sessionId: selected.id, clientId, clientName, status: hasSpace ? "booked" : "waitlisted", bookedAt: new Date().toISOString() },
    ]);
    flash(hasSpace ? `${clientName} añadido a la clase` : `${clientName} añadido a la lista de espera`);
    setMode("roster");
  }

  function confirmWaitlisted(booking: Booking) {
    if (!selected || selected.booked >= selected.capacity) return;
    setAllSessions((prev) => prev.map((s) => (s.id === selected.id ? { ...s, booked: s.booked + 1, waitlisted: Math.max(0, s.waitlisted - 1) } : s)));
    setAllBookings((prev) => prev.map((b) => (b.id === booking.id ? { ...b, status: "booked" } : b)));
    flash(`${booking.clientName} pasa a plaza confirmada`);
  }

  function markAttendance(booking: Booking, status: "attended" | "no_show") {
    setAllBookings((prev) => prev.map((b) => (b.id === booking.id ? { ...b, status } : b)));
  }

  const bookedNamesInSession = new Set(roster.filter((b) => b.status !== "cancelled").map((b) => b.clientId));
  const athleteResults = CLIENTS.filter(
    (c) => c.status === "active" && !bookedNamesInSession.has(c.id) && c.fullName.toLowerCase().includes(athleteQuery.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Reservas</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            {sessions.length} clases {dayLabel}.
          </p>
        </div>
        <Button onClick={() => flash("Creación de clases disponible en una fase posterior")}>
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
            <Card key={s.id} onClick={() => openSession(s.id)} className="cursor-pointer p-4 hover:border-accent/40">
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

      <Drawer open={!!selected} onClose={closeDrawer} title={selected?.className ?? ""}>
        {selected && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              {formatTime(selected.startsAt)} – {formatTime(selected.endsAt)} · Coach {selected.coachName}
            </div>

            {mode === "roster" && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setMode("addAthlete")}>
                  <UserPlus className="h-4 w-4" /> Añadir atleta
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMode("addGuest")}>
                  <UserRoundPlus className="h-4 w-4" /> Añadir invitado
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMode("attendance")}>
                  <ClipboardCheck className="h-4 w-4" /> Pasar asistencia
                </Button>
              </div>
            )}

            {mode === "addAthlete" && (
              <div className="space-y-2 rounded-xl border border-border-subtle p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Añadir atleta</p>
                  <button onClick={() => setMode("roster")} className="text-xs text-text-tertiary hover:text-text-primary">Cancelar</button>
                </div>
                <SearchInput autoFocus placeholder="Buscar cliente..." value={athleteQuery} onChange={(e) => setAthleteQuery(e.target.value)} />
                <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-thin">
                  {athleteResults.map((c: Client) => (
                    <button
                      key={c.id}
                      onClick={() => addPerson(c.id, c.fullName)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-white/5"
                    >
                      {c.fullName}
                      <span className="text-xs text-text-tertiary">Añadir</span>
                    </button>
                  ))}
                  {athleteResults.length === 0 && <p className="px-2 py-3 text-sm text-text-tertiary">Sin resultados.</p>}
                </div>
              </div>
            )}

            {mode === "addGuest" && (
              <div className="space-y-2 rounded-xl border border-border-subtle p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Añadir invitado</p>
                  <button onClick={() => setMode("roster")} className="text-xs text-text-tertiary hover:text-text-primary">Cancelar</button>
                </div>
                <input
                  autoFocus
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Nombre del invitado"
                  className="h-10 w-full rounded-xl border border-border-subtle bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
                />
                <Button
                  size="sm"
                  disabled={!guestName.trim()}
                  onClick={() => {
                    addPerson(`guest-${Date.now()}`, guestName.trim());
                    setGuestName("");
                  }}
                >
                  Añadir invitado
                </Button>
              </div>
            )}

            {mode === "attendance" && (
              <div className="flex items-center justify-between rounded-xl border border-border-subtle p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Pasando asistencia</p>
                <button onClick={() => setMode("roster")} className="text-xs font-medium text-accent">Finalizar</button>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Inscritos ({selected.booked}/{selected.capacity})
              </p>
              {roster.length === 0 ? (
                <p className="text-sm text-text-tertiary">Todavía no hay inscritos en esta sesión.</p>
              ) : (
                <div className="space-y-2">
                  {roster.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-sm">
                      <span className="text-text-primary">{b.clientName}</span>
                      {mode === "attendance" ? (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => markAttendance(b, "attended")}
                            className={cn(
                              "rounded-lg px-2 py-1 text-xs font-medium",
                              b.status === "attended" ? "bg-success/15 text-success" : "border border-border-subtle text-text-secondary hover:text-text-primary"
                            )}
                          >
                            Asistió
                          </button>
                          <button
                            onClick={() => markAttendance(b, "no_show")}
                            className={cn(
                              "rounded-lg px-2 py-1 text-xs font-medium",
                              b.status === "no_show" ? "bg-danger/15 text-danger" : "border border-border-subtle text-text-secondary hover:text-text-primary"
                            )}
                          >
                            No-show
                          </button>
                        </div>
                      ) : b.status === "waitlisted" ? (
                        <div className="flex items-center gap-2">
                          <Badge tone="warning">Lista de espera</Badge>
                          {selected.booked < selected.capacity && (
                            <button onClick={() => confirmWaitlisted(b)} className="text-xs font-medium text-accent hover:underline">
                              Confirmar plaza
                            </button>
                          )}
                        </div>
                      ) : (
                        <Badge tone={b.status === "attended" ? "success" : b.status === "no_show" ? "danger" : "success"}>{b.status}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {flashMessage && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-border-subtle bg-surface-raised px-4 py-2.5 text-sm text-text-primary shadow-2xl">
          <span className="inline-flex items-center gap-2">
            <Check className="h-4 w-4 text-success" /> {flashMessage}
          </span>
        </div>
      )}
    </div>
  );
}
