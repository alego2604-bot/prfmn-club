/**
 * Datos sensibles de clientes (permiso customers.sensitive). Es la ÚNICA capa que decide qué ve quien no lo tiene: todas las
 * pantallas, búsquedas (⌘K), informes y exportaciones leen el workspace ya filtrado (useWorkspace → visibleWorkspace → aquí),
 * así que un campo sensible no puede «colarse» en una lista, un CSV o una factura por olvido de una pantalla concreta.
 * En modo Supabase, además, el servidor no entrega esas columnas a quien no tiene el permiso (migración 0920).
 */
import { CUSTOMER_SENSITIVE_COLUMNS, CUSTOMER_SENSITIVE_FIELDS, INVOICE_SENSITIVE_FIELDS } from "@/domain/permissions";
import type { AuditLog, Customer, Invoice } from "@/domain/types";
import type { Workspace } from "./store";

const SENSITIVE_KEYS = new Set<string>([...CUSTOMER_SENSITIVE_FIELDS, ...CUSTOMER_SENSITIVE_COLUMNS, ...INVOICE_SENSITIVE_FIELDS, "customer_tax_id", "customer_address"]);

export const hasSensitiveData = (c: Customer): boolean => CUSTOMER_SENSITIVE_FIELDS.some((f) => c[f] !== undefined && c[f] !== null);

export function redactCustomer(c: Customer): Customer {
  if (!hasSensitiveData(c)) return c;
  const out: Customer = { ...c };
  for (const f of CUSTOMER_SENSITIVE_FIELDS) delete out[f];
  return out;
}

export function redactInvoice(i: Invoice): Invoice {
  if (i.customerTaxId === undefined && i.customerAddress === undefined) return i;
  const { customerTaxId: _t, customerAddress: _a, ...rest } = i;
  void _t; void _a;
  return rest as Invoice;
}

/** Quita de un registro de auditoría los valores sensibles (el hecho de que algo cambió se conserva, sin el dato). */
export function redactAudit(l: AuditLog): AuditLog {
  if (!l.changes) return l;
  const keys = Object.keys(l.changes);
  if (!keys.some((k) => SENSITIVE_KEYS.has(k))) return l;
  const changes = Object.fromEntries(keys.filter((k) => !SENSITIVE_KEYS.has(k)).map((k) => [k, l.changes![k]!]));
  return { ...l, changes: Object.keys(changes).length ? changes : undefined, context: { ...(l.context ?? {}), redacted: true } };
}

/** Workspace sin datos sensibles. Mantiene las referencias de lo que no cambia (los selectores memoizados siguen valiendo). */
export function redactWorkspace(ws: Workspace): Workspace {
  const customers = ws.customers.some(hasSensitiveData) ? ws.customers.map(redactCustomer) : ws.customers;
  const invoices = ws.invoices.some((i) => i.customerTaxId !== undefined || i.customerAddress !== undefined) ? ws.invoices.map(redactInvoice) : ws.invoices;
  const auditLogs = ws.auditLogs.some((l) => l.changes && Object.keys(l.changes).some((k) => SENSITIVE_KEYS.has(k))) ? ws.auditLogs.map(redactAudit) : ws.auditLogs;
  if (customers === ws.customers && invoices === ws.invoices && auditLogs === ws.auditLogs) return ws;
  return { ...ws, customers, invoices, auditLogs };
}
