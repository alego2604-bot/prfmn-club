/**
 * Lo que ven las pantallas y los informes. Una importación que no ha llegado a COMPLETED (en curso, interrumpida o
 * cancelada) tiene sus datos ocultos aunque parte ya esté en el servidor: nunca se mezclan cifras a medias con las
 * definitivas. Los repositorios siguen escribiendo sobre el almacén completo.
 */
import type { ImportJob } from "@/domain/types";
import type { Workspace } from "./store";

/** ¿Los datos de este job cuentan? Solo si llegó a completarse (aunque después se revirtiera: quedan anulados). */
export function importCounts(job: ImportJob): boolean {
  const events = job.pipeline?.events;
  if (events?.length) return events.some((e) => e.state === "COMPLETED");
  return job.status === "completed" || job.status === "reverted"; // importaciones anteriores al pipeline
}

const cache = new WeakMap<Workspace, Workspace>();

export function visibleWorkspace(ws: Workspace): Workspace {
  const cached = cache.get(ws);
  if (cached) return cached;
  const hidden = new Set(ws.imports.filter((j) => !importCounts(j)).map((j) => j.id));
  if (!hidden.size) {
    cache.set(ws, ws);
    return ws;
  }
  const isHidden = (e: { importId?: string }) => !!e.importId && hidden.has(e.importId);
  const sales = ws.sales.filter((s) => !isHidden(s));
  const saleIds = new Set(sales.map((s) => s.id));
  const invoices = ws.invoices.filter((i) => !isHidden(i));
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const out: Workspace = {
    ...ws,
    sales,
    saleItems: ws.saleItems.filter((it) => saleIds.has(it.saleId)),
    invoices,
    invoiceItems: ws.invoiceItems.filter((it) => invoiceIds.has(it.invoiceId)),
    payments: ws.payments.filter((p) => !isHidden(p) && (!p.saleId || saleIds.has(p.saleId)) && (!p.invoiceId || invoiceIds.has(p.invoiceId))),
    customers: ws.customers.filter((c) => !isHidden(c)),
    products: ws.products.filter((p) => !isHidden(p)),
    expenses: ws.expenses.filter((e) => !isHidden(e)),
    suppliers: ws.suppliers.filter((x) => !isHidden(x)),
    customerMemberships: ws.customerMemberships.filter((m) => !isHidden(m)),
  };
  cache.set(ws, out);
  return out;
}
