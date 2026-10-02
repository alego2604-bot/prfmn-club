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
  /** Progreso de la puesta en marcha guiada (pasos completados u omitidos). Columna `onboarding` (0900). */
  onboarding?: OnboardingState;
}

export type OnboardingStep =
  | "company" | "fiscal" | "locations" | "team" | "payments" | "products" | "memberships" | "settings" | "import" | "start";

export interface OnboardingState {
  done?: OnboardingStep[];
  skipped?: OnboardingStep[];
  completedAt?: ISODateTime;
  dismissedAt?: ISODateTime;
}

/** Series de numeración (facturas, rectificativas…). El número lo asigna el servidor al emitir (sin huecos). */
export interface DocumentSeries {
  id: ID;
  organizationId: ID;
  code: string;
  documentType: "invoice" | "simplified_invoice" | "credit_note" | "sale_ticket";
  prefix: string;
  nextNumber: number;
  padding: number;
  /** null = no reinicia por año */
  year?: number | null;
  status: "active" | "archived";
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
  /** null = todos los centros */
  locationIds?: ID[] | null;
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
  /** Validez de bonos (días) */
  durationDays?: number;
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
  /** Serie de numeración propia (document_series). `series` es la etiqueta de la serie del sistema de origen (importadas). */
  seriesId?: ID;
  number?: string;
  externalNumber?: string;
  issueDate?: ISODate;
  dueDate?: ISODate;
  customerId?: ID;
  customerName?: string;
  customerTaxId?: string;
  customerAddress?: string;
  concept?: string;
  servicePeriodStart?: ISODate;
  servicePeriodEnd?: ISODate;
  subtotal: Cents;
  taxTotal: Cents;
  /** Descuentos aplicados en las líneas (IVA incluido). Informativo: subtotal/IVA/total ya son netos. */
  discountTotal?: Cents;
  total: Cents;
  amountPaid: Cents;
  status: InvoiceStatus;
  paymentMethodId?: ID;
  paidAt?: ISODateTime;
  saleId?: ID;
  planVersionId?: ID;
  customerMembershipId?: ID;
  /** Rectificativa: factura a la que corrige (preparado; emisión de rectificativas aún no disponible). */
  rectifiesInvoiceId?: ID;
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
  /** Descuento de la línea (IVA incluido). total = quantity × unitPrice − discount */
  discount?: Cents;
  taxRateBp: BasisPoints;
  baseAmount: Cents;
  taxAmount: Cents;
  total: Cents;
  productId?: ID;
  planVersionId?: ID;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gastos y proveedores
// ---------------------------------------------------------------------------------------------------------------------
export interface Supplier {
  id: ID;
  organizationId: ID;
  name: string;
  taxId?: string;
  taxIdNormalized?: string;
  email?: string;
  phone?: string;
  address?: string;
  defaultCategoryId?: ID;
  notes?: string;
  status: "active" | "inactive" | "archived";
  importId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ExpenseCategory {
  id: ID;
  organizationId: ID;
  parentId?: ID;
  name: string;
  defaultTaxRateBp?: BasisPoints;
  status: "active" | "archived";
}

export type ExpenseStatus = "pending" | "paid" | "void";

export interface Expense {
  id: ID;
  organizationId: ID;
  locationId?: ID;
  supplierId?: ID;
  categoryId?: ID;
  /** Nº de la factura del proveedor (detecta duplicados) */
  supplierInvoiceNumber?: string;
  issueDate: ISODate;
  dueDate?: ISODate;
  description: string;
  /** Base imponible */
  subtotal: Cents;
  taxRateBp?: BasisPoints;
  /** IVA soportado */
  taxTotal: Cents;
  total: Cents;
  paymentMethodId?: ID;
  status: ExpenseStatus;
  paidAt?: ISODateTime;
  source: "manual" | "import" | "ocr" | "bank";
  importId?: ID;
  notes?: string;
  voidedAt?: ISODateTime;
  voidedBy?: ID;
  voidReason?: string;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------------------------------------------------
// Membresías de clientes
// ---------------------------------------------------------------------------------------------------------------------
/** Estado guardado (columna). PAST_DUE se deriva (cuota vencida sin cobrar), ver domain/memberships.ts */
export type MembershipStatus = "pending" | "active" | "paused" | "cancelled" | "expired";

export interface CustomerMembership {
  id: ID;
  organizationId: ID;
  customerId: ID;
  planId: ID;
  planVersionId: ID;
  locationId?: ID;
  /** Precio pactado por periodo (IVA incluido): se conserva aunque la tarifa suba */
  price: Cents;
  startDate: ISODate;
  endDate?: ISODate;
  nextRenewalDate?: ISODate;
  autoRenew: boolean;
  creditsRemaining?: number;
  status: MembershipStatus;
  cancelledAt?: ISODateTime;
  cancelReason?: string;
  pausedAt?: ISODateTime;
  resumeOn?: ISODate;
  notes?: string;
  importId?: ID;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface MembershipCharge {
  id: ID;
  organizationId: ID;
  customerMembershipId: ID;
  periodStart: ISODate;
  periodEnd: ISODate;
  amount: Cents;
  status: "scheduled" | "invoiced" | "paid" | "failed" | "waived";
  invoiceId?: ID;
  saleId?: ID;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------------------------------------------------
// Seguimiento
// ---------------------------------------------------------------------------------------------------------------------
export interface Task {
  id: ID;
  organizationId: ID;
  customerId?: ID;
  title: string;
  description?: string;
  reason?: string;
  alertKey?: string;
  assigneeId?: ID;
  dueDate?: ISODate;
  status: "pending" | "in_progress" | "done" | "cancelled";
  snoozedUntil?: ISODate;
  completedAt?: ISODateTime;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
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
  /** Valor de la columna `imports.status` (restricción de la base de datos). El estado fino vive en `pipeline`. */
  status: "importing" | "completed" | "failed" | "reverted";
  summary: ImportSummary;
  /** Pipeline por lotes (columna `imports.options`). Ausente en importaciones anteriores a 2026-10-02. */
  pipeline?: ImportPipeline;
  createdBy?: ID;
  createdAt: ISODateTime;
  completedAt?: ISODateTime;
  revertedAt?: ISODateTime;
  revertedBy?: ID;
  revertReason?: string;
}

/**
 * Estados de una importación. Las cuatro primeras son fases del asistente (en el navegador, antes de guardar nada);
 * desde IMPORTING el job existe en la base de datos y sus datos se envían por lotes.
 *  - IMPORTING: enviando lotes. Sus datos NO son visibles (ni en informes ni en pantallas) hasta COMPLETED.
 *  - COMPLETED: todos los lotes confirmados.
 *  - PARTIAL: se interrumpió con parte de los lotes ya en el servidor. Datos ocultos e identificados por import_id.
 *  - FAILED: no queda nada activo (no llegó a entrar nada o lo parcial ya se limpió).
 *  - CANCELLED: cancelada por el usuario; lo que hubiera entrado se anula.
 *  - REVERTED: completada y después revertida (sus registros quedan anulados en el histórico).
 */
export type ImportState =
  | "UPLOADING" | "ANALYZING" | "MAPPING" | "VALIDATING"
  | "IMPORTING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "REVERTED";

export interface ImportPipeline {
  state: ImportState;
  /** Trazabilidad: cada cambio de estado con su momento (incluye las fases del asistente). */
  events: { state: ImportState; at: ISODateTime; note?: string }[];
  /** Lo que debe existir al terminar, para verificar una importación reanudada en otro momento o dispositivo. */
  expected: { main: number; records: number };
  error?: string;
  /** Pestaña que la está enviando (las demás no la dan por interrumpida mientras siga viva). */
  ownerTab?: string;
  updatedAt: ISODateTime;
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
