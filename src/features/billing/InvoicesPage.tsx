import { INVOICES } from "@/mocks/invoices";
import { Badge } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Invoice, InvoiceStatus } from "@/lib/types";

const STATUS_TONE: Record<InvoiceStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  paid: "success",
  issued: "info",
  draft: "neutral",
  partially_paid: "warning",
  void: "neutral",
};

export default function InvoicesPage() {
  const columns: Column<Invoice>[] = [
    { header: "Nº Factura", render: (i) => <span className="font-medium">{i.number}</span> },
    { header: "Cliente", render: (i) => i.clientName },
    { header: "Emitida", render: (i) => formatDate(i.issueDate) },
    { header: "Vencimiento", render: (i) => formatDate(i.dueDate) },
    { header: "Total", render: (i) => formatCurrency(i.totalCents) },
    { header: "Estado", render: (i) => <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Facturas</h2>
        <p className="mt-1 text-sm text-text-tertiary">{INVOICES.length} facturas registradas. Ninguna se elimina sin histórico.</p>
      </div>
      <DataTable columns={columns} rows={INVOICES} rowKey={(i) => i.id} />
    </div>
  );
}
