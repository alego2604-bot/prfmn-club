// Tipos de dominio compartidos. Reflejan docs/DATABASE_SCHEMA.md a nivel funcional.
// En Fase 2 son consumidos por src/mocks; en Fase 5 pasarán a mapear filas de Supabase 1:1.

export type Role = "owner" | "manager" | "coach" | "reception" | "athlete";

export type RiskLevel = "low" | "medium" | "high";

export interface HealthScore {
  score: number;
  riskLevel: RiskLevel;
  factors: string[];
  computedAt: string;
}

export type ClientStatus = "pending_approval" | "active" | "paused" | "cancelled";

export interface Client {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  status: ClientStatus;
  ratePlan: string;
  joinedAt: string;
  lastVisitAt: string | null;
  visitsLast30Days: number;
  visitsPrevious30Days: number;
  cancellationsLast30Days: number;
  noShowsLast30Days: number;
  health: HealthScore;
  notes: ClientNote[];
  documents: { name: string; uploadedAt: string }[];
}

export interface ClientNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export type LeadStatus = "new" | "contacted" | "trial" | "offer" | "won" | "lost";
export type LeadSource = "instagram" | "whatsapp" | "web" | "google" | "referral" | "walk_in" | "other";

export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  source: LeadSource;
  status: LeadStatus;
  interest: string;
  notes: string;
  owner: string;
  lastInteractionAt: string;
  nextActionAt: string | null;
}

export interface GymClass {
  id: string;
  name: string;
  discipline: string;
  color: string;
}

export interface ClassSession {
  id: string;
  classId: string;
  className: string;
  discipline: string;
  color: string;
  coachName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  waitlisted: number;
}

export type BookingStatus = "booked" | "waitlisted" | "cancelled" | "attended" | "no_show";

export interface Booking {
  id: string;
  sessionId: string;
  clientId: string;
  clientName: string;
  status: BookingStatus;
  bookedAt: string;
}

export type ProductCategory = "drink" | "food" | "apparel" | "accessory" | "merch" | "event" | "bundle";

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: ProductCategory;
  costCents: number;
  priceCents: number;
  taxRate: number;
  stock: number;
  minStock: number;
  active: boolean;
  imageEmoji: string;
  frequent?: boolean;
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "partially_paid" | "void";

export interface InvoiceLine {
  id: string;
  description: string;
  qty: number;
  unitPriceCents: number;
  taxRate: number;
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  lines: InvoiceLine[];
}

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
export type PaymentMethod = "card" | "apple_pay" | "google_pay" | "cash";

export interface Payment {
  id: string;
  clientId: string;
  clientName: string;
  invoiceId: string | null;
  amountCents: number;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  role: Role;
  email: string;
  active: boolean;
  classesThisWeek: number;
}

export type AutomationTriggerType = "event" | "schedule";

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  triggerLabel: string;
  actionLabel: string;
  enabled: boolean;
  timesTriggeredLast30Days: number;
}

export type AttentionSeverity = "high" | "medium" | "low";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  actionLabel: string;
  actionHref?: string;
  relatedClientId?: string;
}

export interface DashboardKpis {
  activeMembers: number;
  activeMembersDelta: number;
  bookingsToday: number;
  occupancyPct: number;
  revenueMonthCents: number;
  mrrCents: number;
  avgTicketCents: number;
  newSignupsMonth: number;
  cancellationsMonth: number;
  churnPct: number;
  leadsOpen: number;
  leadConversionPct: number;
  shopSalesMonthCents: number;
  unpaidCents: number;
}
