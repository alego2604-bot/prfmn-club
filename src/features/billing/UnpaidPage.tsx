import { PAYMENTS } from "@/mocks/invoices";
import { Badge, Button, Card, EmptyState } from "@/design-system/components";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export default function UnpaidPage() {
  const unpaid = PAYMENTS.filter((p) => p.status === "failed");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Impagados</h2>
        <p className="mt-1 text-sm text-text-tertiary">{unpaid.length} pagos rechazados requieren acción.</p>
      </div>
      {unpaid.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin impagados" description="Todos los cobros están al día." />
      ) : (
        <div className="space-y-2">
          {unpaid.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-text-primary">{p.clientName}</p>
                <p className="text-xs text-text-tertiary">Rechazado el {formatDate(p.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(p.amountCents)}</span>
                <Badge tone="danger">Rechazado</Badge>
                <Button size="sm">Reintentar cobro</Button>
                <Button size="sm" variant="secondary">Contactar</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
