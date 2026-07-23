import { useState } from "react";
import { PAYMENTS } from "@/mocks/invoices";
import { Badge, Button, Card, EmptyState } from "@/design-system/components";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { Payment } from "@/lib/types";

export default function UnpaidPage() {
  const [payments, setPayments] = useState<Payment[]>(PAYMENTS);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());

  const unpaid = payments.filter((p) => p.status === "failed");

  function retry(id: string) {
    setRetryingId(id);
    setTimeout(() => {
      setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, status: "paid" } : p)));
      setRetryingId(null);
    }, 900);
  }

  function contact(id: string) {
    setContactedIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setContactedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1800);
  }

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
            <Card key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-text-primary">{p.clientName}</p>
                <p className="text-xs text-text-tertiary">Rechazado el {formatDate(p.createdAt)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(p.amountCents)}</span>
                <Badge tone="danger">Rechazado</Badge>
                <Button size="sm" onClick={() => retry(p.id)} disabled={retryingId === p.id}>
                  {retryingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {retryingId === p.id ? "Reintentando..." : "Reintentar cobro"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => contact(p.id)} disabled={contactedIds.has(p.id)}>
                  {contactedIds.has(p.id) ? <Check className="h-4 w-4 text-success" /> : null}
                  {contactedIds.has(p.id) ? "Contactado" : "Contactar"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
