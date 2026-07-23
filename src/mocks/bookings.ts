import type { ClassSession, Booking } from "@/lib/types";

const disciplines: Record<string, { discipline: string; color: string }> = {
  CrossFit: { discipline: "CrossFit", color: "#c8ff3d" },
  Conditioning: { discipline: "Conditioning", color: "#4da3ff" },
  HYROX: { discipline: "HYROX", color: "#ff8a3d" },
  Strength: { discipline: "Strength", color: "#a97bff" },
};

function session(
  id: string,
  className: string,
  dayOffset: number,
  hour: number,
  minute: number,
  durationMin: number,
  coachName: string,
  capacity: number,
  booked: number,
  waitlisted = 0
): ClassSession {
  const base = new Date("2026-07-20T00:00:00");
  base.setDate(base.getDate() + dayOffset);
  base.setHours(hour, minute, 0, 0);
  const ends = new Date(base.getTime() + durationMin * 60000);
  const meta = disciplines[className] ?? disciplines.CrossFit;
  return {
    id,
    classId: className.toLowerCase(),
    className,
    discipline: meta.discipline,
    color: meta.color,
    coachName,
    startsAt: base.toISOString(),
    endsAt: ends.toISOString(),
    capacity,
    booked,
    waitlisted,
  };
}

export const CLASS_SESSIONS: ClassSession[] = [
  session("s1", "CrossFit", 3, 7, 0, 60, "Nico", 14, 12),
  session("s2", "Conditioning", 3, 8, 0, 45, "Sara", 16, 16, 4),
  session("s3", "CrossFit", 3, 13, 30, 60, "Alex", 14, 5),
  session("s4", "Strength", 3, 17, 0, 60, "Nico", 10, 9),
  session("s5", "Conditioning", 3, 18, 30, 45, "Sara", 16, 16, 6),
  session("s6", "HYROX", 3, 19, 30, 60, "Alex", 12, 10),
  session("s7", "CrossFit", 4, 7, 0, 60, "Nico", 14, 8),
  session("s8", "Conditioning", 4, 8, 0, 45, "Sara", 16, 13),
  session("s9", "CrossFit", 4, 13, 30, 60, "Alex", 14, 3),
  session("s10", "HYROX", 4, 18, 30, 60, "Sara", 12, 11),
  session("s11", "CrossFit", 5, 7, 0, 60, "Nico", 14, 10),
  session("s12", "Strength", 5, 9, 0, 60, "Alex", 10, 4),
  session("s13", "Conditioning", 5, 18, 30, 45, "Sara", 16, 15, 2),
];

export const BOOKINGS: Booking[] = [
  { id: "b1", sessionId: "s5", clientId: "c1", clientName: "Marta García", status: "waitlisted", bookedAt: "2026-07-22T10:00:00" },
  { id: "b2", sessionId: "s1", clientId: "c2", clientName: "Carlos Medina", status: "booked", bookedAt: "2026-07-21T09:00:00" },
  { id: "b3", sessionId: "s1", clientId: "c3", clientName: "Laura Fernández", status: "booked", bookedAt: "2026-07-21T09:15:00" },
  { id: "b4", sessionId: "s1", clientId: "c4", clientName: "Paula Ibáñez", status: "booked", bookedAt: "2026-07-21T09:20:00" },
  { id: "b5", sessionId: "s6", clientId: "c7", clientName: "Diego Ramos", status: "attended", bookedAt: "2026-07-19T09:00:00" },
];
