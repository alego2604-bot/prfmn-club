import type { StaffMember } from "@/lib/types";

export const STAFF: StaffMember[] = [
  { id: "st1", fullName: "Alex Demo", role: "owner", email: "alex@example.com", active: true, classesThisWeek: 6 },
  { id: "st2", fullName: "Nico Demo", role: "coach", email: "nico@example.com", active: true, classesThisWeek: 9 },
  { id: "st3", fullName: "Sara Demo", role: "coach", email: "sara@example.com", active: true, classesThisWeek: 8 },
  { id: "st4", fullName: "Marc Demo", role: "reception", email: "marc@example.com", active: true, classesThisWeek: 0 },
];
