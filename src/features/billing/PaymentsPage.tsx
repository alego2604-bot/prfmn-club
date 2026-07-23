import { PAYMENTS } from "@/mocks/invoices";
import { Badge } from "@/design-system/components";
import { DataTable, type Column } from "@/design-system/components/DataTable";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Payment, PaymentStatus } from "@/lib/types";

const STATUS_TONE: Record<PaymentStatus, "success" | "warning" | "danger" | "info"> = {
  paid: "success",
  pending: "info",
  failed: "danger",
  refunded: "warning",
  partially_refunded: "warning",
};

const METHOD_LABEL: Record<Payment["method"], string> = {
  card: "Tarjeta",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Efectivo",
};

export default function PaymentsPage() {
  const columns: Column<Payment>[] = [
    { header: "Cliente", render: (p) => p.clientName },
    { header: "Fecha", render: (p) => formatDate(p.createdAt) },
    { header: "Método", render: (p) => METHOD_LABEL[p.method] },
    { header: "Importe", render: (p) => formatCurrency(p.amountCents) },
    { header: "Estado", render: (p) => <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Pagos</h2>
        <p className="mt-1 text-sm text-text-tertiary">Estado de cobro sincronizado con Stripe (mock).</p>
      </div>
      <DataTable columns={columns} rows={PAYMENTS} rowKey={(p) => p.id} />
    </div>
  );
}
