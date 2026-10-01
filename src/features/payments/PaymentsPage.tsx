import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard } from "lucide-react";
import { useLocationScope, useWorkspace } from "@/app/session";
import { Badge, DataTable, Kpi, Page, PageHeader, Select, type Column } from "@/design-system/components";
import { BarList } from "@/design-system/components/charts";
import type { Payment } from "@/domain/types";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { usePeriodFilter } from "../shared/PeriodPicker";

const SOURCE: Record<Payment["source"], string> = { pos: "Caja", manual: "Manual", import: "Importado", stripe: "Stripe", redsys: "Redsys", bank: "Banco" };

export default function PaymentsPage() {
  const ws = useWorkspace();
  const { filterId } = useLocationScope();
  const { filter, control } = usePeriodFilter("all");
  const [kind, setKind] = useState<"all" | Payment["kind"]>("all");
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
  const sale = new Map(ws.sales.map((s) => [s.id, s]));
  const inv = new Map(ws.invoices.map((i) => [i.id, i]));

  const rows = useMemo(
    () => ws.payments.filter((p) => (!filterId || !p.locationId || p.locationId === filterId) && filter.test(p.paidAt) && (kind === "all" || p.kind === kind)).sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    [ws.payments, filterId, filter, kind],  
  );
  const net = rows.reduce((s, p) => s + (p.kind === "refund" ? -p.amount : p.amount), 0);
  const byMethod = new Map<string, number>();
  for (const p of rows) byMethod.set(p.methodKey, (byMethod.get(p.methodKey) ?? 0) + (p.kind === "refund" ? -p.amount : p.amount));
  const ref = (p: Payment) => (p.saleId ? `Venta #${sale.get(p.saleId)?.number}` : p.invoiceId ? `Factura ${inv.get(p.invoiceId)?.number ?? inv.get(p.invoiceId)?.externalNumber}` : "—");

  const columns: Column<Payment>[] = [
    { id: "date", header: "Fecha", sortValue: (p) => p.paidAt, exportValue: (p) => new Date(p.paidAt), exportFormat: "datetime", cell: (p) => formatDateTime(p.paidAt) },
    { id: "kind", header: "Tipo", exportValue: (p) => (p.kind === "refund" ? "Devolución" : "Cobro"), cell: (p) => (p.kind === "refund" ? <Badge tone="danger">Devolución</Badge> : <Badge tone="success" dot>Cobro</Badge>) },
    { id: "method", header: "Método", sortValue: (p) => p.methodKey, exportValue: (p) => methodName.get(p.methodKey) ?? p.methodKey, cell: (p) => methodName.get(p.methodKey) ?? p.methodKey },
    { id: "ref", header: "Referencia", exportValue: ref, cell: (p) => <Link onClick={(e) => e.stopPropagation()} className="text-accent-fg hover:underline" to={p.saleId ? `/ventas?venta=${p.saleId}` : `/facturas?factura=${p.invoiceId}`}>{ref(p)}</Link> },
    { id: "source", header: "Origen", exportValue: (p) => SOURCE[p.source], cell: (p) => <span className="text-fg-2">{SOURCE[p.source]}</span> },
    { id: "amount", header: "Importe", align: "right", sortValue: (p) => (p.kind === "refund" ? -p.amount : p.amount), exportValue: (p) => (p.kind === "refund" ? -p.amount : p.amount) / 100, exportFormat: "money", cell: (p) => <span className={p.kind === "refund" ? "text-danger-fg" : "font-medium"}>{p.kind === "refund" ? "−" : ""}{formatMoney(p.amount)}</span> },
  ];

  return (
    <Page wide>
      <PageHeader title="Pagos y cobros" description="Cada movimiento de dinero, separado de la venta o factura que lo origina. Las devoluciones compensan, nunca borran." />
      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-1 lg:grid-cols-1">
          <Kpi label="Cobrado neto" value={formatMoney(net)} hint={filter.period?.label ?? "Todo el histórico"} />
          <Kpi label="Movimientos" value={rows.length.toLocaleString("es-ES")} hint={`${rows.filter((p) => p.kind === "refund").length} devoluciones`} />
        </div>
        <div className="rounded-lg border border-line bg-surface p-5 shadow-xs lg:col-span-2">
          <p className="mb-3 text-sm font-semibold">Por método de pago</p>
          <BarList rows={[...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: methodName.get(k) ?? k, value: v }))} />
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(p) => p.id}
        searchText={(p) => `${ref(p)} ${methodName.get(p.methodKey) ?? ""} ${p.reference ?? ""}`}
        exportName="Pagos"
        exportCompany={ws.organization.name}
        storageKey="payments"
        toolbar={
          <>
            {control}
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-[150px]">
              <option value="all">Cobros y devoluciones</option>
              <option value="charge">Solo cobros</option>
              <option value="refund">Solo devoluciones</option>
            </Select>
          </>
        }
        empty={{ icon: CreditCard, title: "Sin movimientos", description: "Los cobros de Caja y de facturas aparecerán aquí." }}
      />
      <p className="mt-3 text-xs text-fg-3">Las ventas importadas sin método de pago no generan movimiento: el Excel de origen no indicaba cómo se cobraron.</p>
    </Page>
  );
}
