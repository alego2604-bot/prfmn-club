/**
 * Entidades de dominio. Reflejan 1:1 las tablas de supabase/migrations (camelCase ↔ snake_case),
 * para que el paso del adaptador local al de Supabase sea un mapeo, no un rediseño.
 * Dinero en céntimos (number entero). IVA en puntos básicos.
 */
import type { Cents, BasisPoints } from "@/lib/money";

export type ID = string;
export type ISODate = string; // yyyy-mm-dd
export type ISODateTime = string;

export type Vertical = "fitness" | "gym" | "functional_training" | "restaurant" | "retail" | "services" | "beauty" | "clinic" | "other";

export interface Organization {
  id: ID;
  name: string;
  legalName?: string;
  taxId?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country: string;
  phone?: string;
  email?: string;
  website?: string;
  logoDataUrl?: string;
  currency: string;
  timezone: string;
  locale: string;
  vertical: Vertical;
  /** Módulos verticales activos (null/undefined = los de su sector por defecto). Espejo de organization_modules. */
  modules?: ("fitness")[];
  fiscalYearStartMonth: number;
  isDemo: boolean;
  status: "active" | "suspended" | "archived";
  createdAt: ISODateTime;
}

export interface Location {
  id: ID;
  organizationId: ID;
  name: string;
  code?: string;
  address?: string;
  city?: string;
  status: "active" | "inactive" | "archived";
  createdAt: ISODateTime;
}

export type RoleKey = "owner" | "admin" | "manager" | "employee" | "accountant" | "read_only";

export interface UserAccount {
  id: ID;
  email: string;
  fullName: string;
  passwordHash: string; // solo modo local (no es seguridad real, ver DECISIONS)
  createdAt: ISODateTime;
}

export interface Member {
  id: ID;
  organizationId: ID;
  userId: ID;
  role: RoleKey;
  locationIds: ID[] | null;
  status: "invited" | "active" | "suspended";
  createdAt: ISODateTime;
}

export interface TaxRate {
  id: ID;
  organizationId: ID;
  name: string;
  rateBp: BasisPoints;
  isDefault: boolean;
  status: "active" | "archived";
}

export type PaymentKind = "cash" | "card" | "bizum" | "online" | "transfer" | "direct_debit" | "voucher" | "other" | "unknown";

export interface PaymentMethod {
  id: ID;
  organizationId: ID;
  key: string;
  name: string;
  kind: PaymentKind;
  affectsCashDrawer: boolean;
  status: "active" | "inactive" | "archived";
  sortOrder: number;
}

export interface ActivityRule {
  key: string;
  label: string;
  minDays?: number;
  maxDays?: number;
  severity: "ok" | "info" | "warning" | "danger";
}

export interface OrganizationSettings {
  organizationId: ID;
  activityRules: ActivityRule[];
  renewalNoticeDays: number;
  requireCashSession: boolean;
}

export type CatalogStatus = "active" | "inactive" | "archived";

export interface ProductCategory {
  id: ID;
  organizationId: ID;
  name: string;
  color: string;
  defaultTaxRateBp?: BasisPoints;
  sortOrder: number;
  status: CatalogStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ProductKind = "physical" | "service" | "membership" | "pack" | "drop_in";

export interface Product {
  id: ID;
  organizationId: ID;
  categoryId: ID | null;
  name: string;
  sku?: string;
  kind: ProductKind;
  subcategory?: string;
  description?: string;
  price: Cents; // vigente, IVA incluido
  taxRateBp: BasisPoints;
  cost?: Cents; // sin IVA
  trackStock: boolean;
  stockQuantity?: number;
  minStock?: number;
  posVisible: boolean;
  sortOrder: number;
  status: CatalogStatus;
  importId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProductPrice {
  id: ID;
  organizationId: ID;
  productId: ID;
  price: Cents;
  taxRateBp: BasisPoints;
  cost?: Cents;
  validFrom: ISODateTime;
  validTo?: ISODateTime;
  changedBy?: ID;
  reason?: string;
}

export interface MembershipPlan {
  id: ID;
  organizationId: ID;
  name: string;
  kind: "recurring" | "pack" | "drop_in" | "trial";
  billingPeriod: "week" | "month" | "quarter" | "semester" | "year" | "none";
  isFounder: boolean;
  openToNew: boolean;
  description?: string;
  status: CatalogStatus;
  importId?: ID;
  createdAt: ISODateTime;
}

export interface MembershipPlanVersion {
  id: ID;
  organizationId: ID;
  planId: ID;
  version: number;
  price: Cents;
  taxRateBp: BasisPoints;
  creditsTotal?: number | null; // null = ilimitado
  classCredits?: number;
  openBoxCredits?: number;
  sessions?: number;
  validFrom: ISODate;
  validTo?: ISODate;
}

export type CustomerStatus = "lead" | "active" | "inactive" | "cancelled" | "blocked";

export interface Customer {
  id: ID;
  organizationId: ID;
  firstName: string;
  lastName?: string;
  taxId?: string;
  taxIdNormalized?: string;
  taxIdValid?: boolean;
  email?: string;
  phone?: string;
  birthDate?: ISODate;
  address?: string;
  postalCode?: string;
  city?: string;
  companyName?: string;
  status: CustomerStatus;
  source?: string;
  joinedAt?: ISODate;
  leftAt?: ISODate;
  tags: string[];
  importId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export interface CustomerNote {
  id: ID;
  organizationId: ID;
  customerId: ID;
  authorId?: ID;
  body: string;
  pinned: boolean;
  suppressAlertsUntil?: ISODate;
  createdAt: ISODateTime;
}

export interface CashSession {
  id: ID;
  organizationId: ID;
  locationId: ID;
  openedBy?: ID;
  openedAt: ISODateTime;
  openingFloat: Cents;
  status: "open" | "closed";
  closedAt?: ISODateTime;
}

export interface CashMovement {
  id: ID;
  organizationId: ID;
  cashSessionId: ID;
  kind: "cash_in" | "cash_out";
  amount: Cents;
  reason: string;
  createdBy?: ID;
  createdAt: ISODateTime;
}

export interface CashClosing {
  id: ID;
  organizationId: ID;
  cashSessionId: ID;
  version: number;
  salesCount: number;
  salesTotal: Cents;
  totalsByMethod: Record<string, Cents>; // por payment_method.key
  openingFloat: Cents;
  cashIn: Cents;
  cashOut: Cents;
  expectedCash: Cents;
  countedCash: Cents;
  difference: Cents;
  status: "balanced" | "discrepancy";
  notes?: string;
  closedBy?: ID;
  closedAt: ISODateTime;
  supersededAt?: ISODateTime;
  supersededBy?: ID;
  reopenReason?: string;
}

export type SaleStatus = "completed" | "pending_payment" | "voided";
export type SaleSource = "pos" | "manual" | "import" | "membership" | "online";

export interface Sale {
  id: ID;
  organizationId: ID;
  locationId: ID;
  number: number;
  occurredAt: ISODateTime;
  timePrecision: "exact" | "day" | "month";
  granularity: "transaction" | "aggregate";
  customerId?: ID;
  sellerId?: ID;
  cashSessionId?: ID;
  subtotal: Cents;
  taxTotal: Cents;
  discountTotal: Cents;
  total: Cents;
  status: SaleStatus;
  source: SaleSource;
  notes?: string;
  importId?: ID;
  voidedAt?: ISODateTime;
  voidedBy?: ID;
  voidReason?: string;
  createdAt: ISODateTime;
}

export interface SaleItem {
  id: ID;
  organizationId: ID;
  saleId: ID;
  productId?: ID;
  productName: string;
  productKind: ProductKind;
  categoryId?: ID;
  categoryName?: string;
  quantity: number;
  unitPrice: Cents;
  discount: Cents;
  taxRateBp: BasisPoints;
  baseAmount: Cents;
  taxAmount: Cents;
  total: Cents;
}

export interface Payment {
  id: ID;
  organizationId: ID;
  locationId?: ID;
  kind: "charge" | "refund";
  saleId?: ID;
  invoiceId?: ID;
  customerId?: ID;
  paymentMethodId: ID;
  methodKey: string;
  methodKind: PaymentKind;
  amount: Cents;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  paidAt: ISODateTime;
  cashSessionId?: ID;
  reference?: string;
  refundOfPaymentId?: ID;
  source: "pos" | "manual" | "import" | "stripe" | "redsys" | "bank";
  importId?: ID;
  createdAt: ISODateTime;
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "partially_paid" | "void";

export interface Invoice {
  id: ID;
  organizationId: ID;
  locationId?: ID;
  series?: string;
  number?: string;
  externalNumber?: string;
  issueDate?: ISODate;
  dueDate?: ISODate;
  customerId?: ID;
  customerName?: string;
  customerTaxId?: string;
  concept?: string;
  servicePeriodStart?: ISODate;
  servicePeriodEnd?: ISODate;
  subtotal: Cents;
  taxTotal: Cents;
  total: Cents;
  amountPaid: Cents;
  status: InvoiceStatus;
  paymentMethodId?: ID;
  paidAt?: ISODateTime;
  saleId?: ID;
  planVersionId?: ID;
  notes?: string;
  source: "manual" | "sale" | "membership" | "import";
  importId?: ID;
  voidedAt?: ISODateTime;
  voidReason?: string;
  createdAt: ISODateTime;
}

export interface InvoiceItem {
  id: ID;
  organizationId: ID;
  invoiceId: ID;
  description: string;
  quantity: number;
  unitPrice: Cents;
  taxRateBp: BasisPoints;
  baseAmount: Cents;
  taxAmount: Cents;
  total: Cents;
  productId?: ID;
  planVersionId?: ID;
}

export type ImportKind = "sales" | "invoices" | "customers" | "catalog" | "attendance" | "expenses" | "bank";

export interface ImportSummary {
  found: number;
  valid: number;
  review: number;
  duplicates: number;
  errors: number;
  ignored: number;
  created: Record<string, number>;
  linked: number;
  totalAmount?: Cents;
}

export interface ImportJob {
  id: ID;
  organizationId: ID;
  locationId?: ID;
  kind: ImportKind;
  fileName: string;
  fileSha256: string;
  fileSize: number;
  status: "completed" | "failed" | "reverted";
  summary: ImportSummary;
  createdBy?: ID;
  createdAt: ISODateTime;
  revertedAt?: ISODateTime;
  revertedBy?: ID;
  revertReason?: string;
}

export interface ImportRecordRow {
  id: ID;
  organizationId: ID;
  importId: ID;
  sheet?: string;
  rowNumber?: number;
  status: "imported" | "duplicate" | "error" | "ignored";
  confidence?: "high" | "medium" | "review";
  messages: string[];
  entityType?: string;
  entityId?: ID;
  action?: "created" | "linked" | "skipped";
}

export interface AuditLog {
  id: ID;
  organizationId: ID;
  actorId?: ID;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: ID;
  entityLabel?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  context?: Record<string, unknown>;
  createdAt: ISODateTime;
}
