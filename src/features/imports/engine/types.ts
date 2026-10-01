import type { Cents } from "@/lib/money";

export type CellValue = string | number | boolean | Date | null;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

export interface WorkbookData {
  fileName: string;
  format: "xlsx" | "csv";
  sheets: SheetData[];
}

export type TargetKind = "sales" | "invoices";
export type SheetRole = "sales" | "invoices" | "catalog" | "summary" | "empty" | "unknown";

export type FieldType = "date" | "text" | "money" | "number";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  synonyms: string[];
  help?: string;
}

export interface ColumnMapping {
  index: number;
  header: string;
  field: string | null;
  confidence: "high" | "medium" | "none";
  samples: string[];
}

export interface SheetAnalysis {
  name: string;
  role: SheetRole;
  headerRowIndex: number; // índice 0-based en rows
  columns: ColumnMapping[];
  dataRowCount: number;
  include: boolean;
  reason: string;
}

export interface FileAnalysis {
  kind: TargetKind | null;
  sheets: SheetAnalysis[];
  notes: string[];
}

export type IssueSeverity = "info" | "warning" | "error";

export interface Issue {
  code: string;
  severity: IssueSeverity;
  text: string;
}

export type RowStatus = "valid" | "review" | "duplicate" | "error";
export type Confidence = "high" | "medium" | "review";

export interface PlannedRowBase {
  key: string;
  sheet: string;
  rowNumber: number; // 1-based como en Excel
  raw: Record<string, string>;
  status: RowStatus;
  confidence: Confidence;
  issues: Issue[];
  decision: "import" | "ignore";
}

export interface SalesRow extends PlannedRowBase {
  type: "sale";
  occurredAt: Date | null;
  timePrecision: "exact" | "day" | "month";
  granularity: "transaction" | "aggregate";
  productName: string;
  categoryName: string;
  unitPrice: Cents | null;
  quantity: number | null;
  total: Cents | null;
  /** producto existente (id), del catálogo del fichero (name) o nuevo (name) */
  product: { kind: "existing"; id: string; name: string } | { kind: "new"; name: string } | { kind: "none" };
  candidates: { id?: string; name: string; reason: string }[];
  methodKey: string | null;
}

export interface CatalogRow extends PlannedRowBase {
  type: "catalog";
  name: string;
  categoryName: string;
  price: Cents | null;
  taxRateBp: number;
  kind: "physical" | "service" | "pack" | "drop_in";
  existingProductId?: string;
}

export interface InvoiceRow extends PlannedRowBase {
  type: "invoice";
  number: string;
  series: string;
  issueDate: Date | null;
  customerName: string;
  taxId: string;
  taxIdState: "valid" | "invalid" | "empty" | "foreign";
  concept: string;
  planName: string;
  description: string;
  servicePeriod: { start: Date; end: Date } | null;
  subtotal: Cents | null;
  taxTotal: Cents | null;
  total: Cents | null;
  taxRateBp: number;
  methodKey: string | null;
  methodLabel: string;
  invoiceStatus: "paid" | "issued" | "void";
  customer: { kind: "existing"; id: string } | { kind: "new"; groupKey: string };
}

export interface ControlCheck {
  label: string;
  expected: Cents;
  actual: Cents;
  ok: boolean;
  unit?: "money" | "count";
}

export interface IssueGroup {
  code: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  count: number;
  /** Opciones de decisión masiva (p. ej. fecha fuera de mes) */
  options?: { value: string; label: string }[];
  optionKey?: keyof PlanOptions;
}

export interface PlanOptions {
  dateOutsideSheet: "sheet_month" | "keep";
  locationId: string;
}

export interface ImportPlan {
  kind: TargetKind;
  fileName: string;
  sheetsUsed: string[];
  catalog: CatalogRow[];
  rows: (SalesRow | InvoiceRow)[];
  nonDataRows: { sheet: string; rowNumber: number; text: string }[];
  controls: ControlCheck[];
  insights: string[];
  options: PlanOptions;
}

export interface PlanSummary {
  found: number;
  valid: number;
  review: number;
  duplicates: number;
  errors: number;
  toImport: number;
  ignored: number;
  nonData: number;
  amountToImport: Cents;
  newProducts: number;
  newCustomers: number;
  highConfidence: number;
  mediumConfidence: number;
}
