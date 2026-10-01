import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ban, Clock, Plus, ShoppingBag, Upload } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, DataTable, DescriptionList, Drawer, Kpi, KpiStrip, Mono, Page, PageHeader, ReasonDialog, Select, useToast, type Column } from "@/design-system/components";
import { voidSale } from "@/data/repos/sales";
import { customerName } from "@/data/repos/customers";
import type { Payment, Sale, SaleItem } from "@/domain/types";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatRate, NUM } from "@/lib/money";
import { usePeriodFilter } from "../shared/PeriodPicker";

const SOURCE_LABEL: Record<Sale["source"], string> = { pos: "Caja", manual: "Manual", import: "Importada", membership: "Cuota", online: "Online" };

export default function SalesPage() {
  const ws = useWorkspace();
  const { filterId } = useLocationScope();
  const [params, setParams] = useSearchParams();
  const { filter, control } = usePeriodFilter("all");
  const [status, setStatus] = useState<"all" | Sale["status"]>("all");
  const [source, setSource] = useState<"all" | Sale["source"]>("all");

  const itemsBySale = useMemo(() => {
    const m = new Map<string, SaleItem[]>();
    for (const it of ws.saleItems) m.set(it.saleId, [...(m.get(it.saleId) ?? []), it]);
    return m;
  }, [ws.saleItems]);
  const paysBySale = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of ws.payments) if (p.saleId) m.set(p.saleId, [...(m.get(p.saleId) ?? []), p]);
    return m;
  }, [ws.payments]);
  const locName = new Map(ws.locations.map((l) => [l.id, l.name]));
  const custName = new Map(ws.customers.map((c) => [c.id, customerName(c)]));
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));

  const rows = useMemo(
    () =>
      ws.sales
        .filter((s) => (!filterId || s.locationId === filterId) && filter.test(s.occurredAt) && (status === "all" || s.status === status) && (source === "all" || s.source === source))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.number - a.number),
    [ws.sales, filterId, filter, status, source],  
  );
  const active = rows.filter((s) => s.status !== "voided");
  const tx = active.filter((s) => s.granularity === "transaction");
  const total = active.reduce((a, s) => a + s.total, 0);

  const methodsOf = (s: Sale) => {
    const ps = (paysBySale.get(s.id) ?? []).filter((p) => p.kind === "charge");
    return ps.length ? [...new Set(ps.map((p) => methodName.get(p.methodKey) ?? p.methodKey))].join(" + ") : s.source === "import" ? "Desconocido" : s.status === "pending_payment" ? "Pendiente" : "—";
  };
  const summary = (s: Sale) => (itemsBySale.get(s.id) ?? []).map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.productName}`).join(", ");

  const columns: Column<Sale>[] = [
    { id: "number", header: "Nº", cell: (s) => <Mono className="text-fg-3">#{s.number}</Mono>, sortValue: (s) => s.number, exportValue: (s) => s.number, exportFormat: "integer", width: 80 },
    {
      id: "date", header: "Fecha", sortValue: (s) => s.occurredAt, exportValue: (s) => new Date(s.occurredAt), exportFormat: "datetime",
      cell: (s) => (
        <span className="whitespace-nowrap">
          {s.timePrecision === "exact" ? formatDateTime(s.occurredAt) : s.timePrecision === "month" ? `${formatDate(s.occurredAt).slice(3)} (mes)` : formatDate(s.occurredAt)}
        </span>
      ),
    },
    { id: "items", header: "Productos", cell: (s) => <span className="line-clamp-1 max-w-[340px] text-fg-2">{summary(s)}</span>, exportValue: summary },
    { id: "customer", header: "Cliente", cell: (s) => (s.customerId ? <Link onClick={(e) => e.stopPropagation()} to={`/clientes/${s.customerId}`} className="hover:underline">{custName.get(s.customerId)}</Link> : <span className="text-fg-3">—</span>), sortValue: (s) => custName.get(s.customerId ?? "") ?? "", exportValue: (s) => custName.get(s.customerId ?? "") ?? "" },
    { id: "method", header: "Pago", cell: (s) => <span className="text-fg-2">{methodsOf(s)}</span>, exportValue: methodsOf },
    { id: "location", header: "Centro", cell: (s) => locName.get(s.locationId), exportValue: (s) => locName.get(s.locationId) ?? "", defaultHidden: ws.locations.length < 2 },
    { id: "source", header: "Origen", cell: (s) => <Badge tone={s.source === "import" ? "info" : "neutral"}>{SOURCE_LABEL[s.source]}{s.granularity === "aggregate" ? " · resumen" : ""}</Badge>, exportValue: (s) => SOURCE_LABEL[s.source], sortValue: (s) => s.source },
    { id: "base", header: "Base", align: "right", cell: (s) => formatMoney(s.subtotal), sortValue: (s) => s.subtotal, exportValue: (s) => s.subtotal / 100, exportFormat: "money", defaultHidden: true },
    { id: "tax", header: "IVA", align: "right", cell: (s) => formatMoney(s.taxTotal), sortValue: (s) => s.taxTotal, exportValue: (s) => s.taxTotal / 100, exportFormat: "money", defaultHidden: true },
    {
      id: "total", header: "Total", align: "right", sortValue: (s) => s.total, exportValue: (s) => s.total / 100, exportFormat: "money",
      cell: (s) => <span className={s.status === "voided" ? "text-fg-3 line-through" : "font-medium"}>{formatMoney(s.total)}</span>,
    },
    {
      id: "status", header: "Estado", sortValue: (s) => s.status, exportValue: (s) => ({ completed: "Completada", voided: "Anulada", pending_payment: "Pendiente de pago" })[s.status],
      cell: (s) => (s.status === "voided" ? <Badge tone="danger">Anulada</Badge> : s.status === "pending_payment" ? <Badge tone="warning">Pendiente</Badge> : <Badge tone="success" dot>Cobrada</Badge>),
    },
  ];

  const selected = ws.sales.find((s) => s.id === params.get("venta"));

  return (
    <Page wide>
      <PageHeader
        title="Ventas"
        description="Cada operación con su fecha, líneas y pagos. Nada se borra: las anulaciones quedan registradas con motivo."
        actions={<Link to="/caja"><Button variant="primary" icon={Plus}>Nueva venta</Button></Link>}
      />
      <KpiStrip className="mb-5">
        <Kpi label="Facturación" value={formatMoney(total)} hint={filter.period?.label ?? "Todo el histórico"} />
        <Kpi label="Operaciones" value={tx.length.toLocaleString("es-ES", NUM)} hint={active.length > tx.length ? `+${active.length - tx.length} resúmenes importados` : undefined} />
        <Kpi label="Ticket medio" value={tx.length ? formatMoney(Math.round(tx.reduce((a, s) => a + s.total, 0) / tx.length)) : "—"} />
        <Kpi label="Anuladas" value={rows.filter((s) => s.status === "voided").length.toLocaleString("es-ES", NUM)} hint={formatMoney(rows.filter((s) => s.status === "voided").reduce((a, s) => a + s.total, 0))} />
      </KpiStrip>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(s) => s.id}
        onRowClick={(s) => setParams({ venta: s.id })}
        searchText={(s) => `${s.number} ${summary(s)} ${custName.get(s.customerId ?? "") ?? ""} ${s.notes ?? ""}`}
        searchPlaceholder="Buscar nº, producto o cliente…"
        exportName="Ventas"
        exportCompany={ws.organization.name}
        storageKey="sales"
        rowClassName={(s) => (s.status === "voided" ? "opacity-60" : undefined)}
        toolbar={
          <>
            {control}
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-[170px]">
              <option value="all">Todos los estados</option>
              <option value="completed">Cobradas</option>
              <option value="pending_payment">Pendientes</option>
              <option value="voided">Anuladas</option>
            </Select>
            <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="w-[150px]">
              <option value="all">Todo origen</option>
              <option value="pos">Caja</option>
              <option value="import">Importadas</option>
            </Select>
          </>
        }
        empty={{ icon: ShoppingBag, title: "Aún no hay ventas", description: "Registra una venta en Caja o importa tu histórico.", action: <div className="flex gap-2"><Link to="/caja"><Button variant="primary">Ir a Caja</Button></Link><Link to="/importaciones/nueva"><Button icon={Upload}>Importar</Button></Link></div> }}
      />
      <SaleDrawer sale={selected} onClose={() => setParams({})} />
    </Page>
  );
}

function SaleDrawer({ sale, onClose }: { sale?: Sale; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  if (!sale) return null;
  const items = ws.saleItems.filter((i) => i.saleId === sale.id);
  const payments = ws.payments.filter((p) => p.saleId === sale.id);
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));
  const log = ws.auditLogs.filter((l) => l.entityId === sale.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const imp = sale.importId ? ws.imports.find((i) => i.id === sale.importId) : undefined;
  const rec = sale.importId ? ws.importRecords.find((r) => r.entityId === sale.id) : undefined;
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const i of items) {
    const r = byRate.get(i.taxRateBp) ?? { base: 0, tax: 0 };
    r.base += i.baseAmount;
    r.tax += i.taxAmount;
    byRate.set(i.taxRateBp, r);
  }
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={`Venta #${sale.number}`}
        subtitle={sale.timePrecision === "exact" ? formatDateTime(sale.occurredAt) : `${formatDate(sale.occurredAt)} · hora no registrada`}
        footer={
          sale.status !== "voided" && can("sales.void") ? (
            <Button variant="ghost" className="text-danger-fg" icon={Ban} onClick={() => setVoiding(true)}>Anular venta</Button>
          ) : undefined
        }
      >
        {sale.status === "voided" && (
          <div className="mb-5 rounded-md bg-danger-soft px-3.5 py-3 text-sm text-danger-fg">
            <p className="font-medium">Anulada el {formatDateTime(sale.voidedAt!)}</p>
            <p className="mt-0.5 opacity-90">Motivo: {sale.voidReason}</p>
          </div>
        )}
        <div className="rounded-lg border border-line">
          {items.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
              <div>
                <p className="text-sm font-medium">{i.quantity > 1 && <span className="text-fg-3 num">{i.quantity}× </span>}{i.productName}</p>
                <p className="text-xs text-fg-3 num">{formatMoney(i.unitPrice)} · IVA {formatRate(i.taxRateBp)}{i.categoryName ? ` · ${i.categoryName}` : ""}{i.discount ? ` · dto. ${formatMoney(i.discount)}` : ""}</p>
              </div>
              <span className="text-sm font-medium num">{formatMoney(i.total)}</span>
            </div>
          ))}
          <div className="bg-surface-2 px-4 py-3 text-sm">
            {[...byRate.entries()].map(([rate, v]) => (
              <div key={rate} className="flex justify-between text-fg-3 num"><span>Base {formatRate(rate)}</span><span>{formatMoney(v.base)} + {formatMoney(v.tax)} IVA</span></div>
            ))}
            <div className="mt-1.5 flex justify-between text-md font-semibold num"><span>Total</span><span>{formatMoney(sale.total)}</span></div>
          </div>
        </div>

        <h3 className="mb-2 mt-6 text-sm font-semibold">Pagos</h3>
        {payments.length ? (
          <div className="flex flex-col gap-1.5">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                <span>{p.kind === "refund" ? "Devolución · " : ""}{methodName.get(p.methodKey) ?? p.methodKey}<span className="ml-2 text-xs text-fg-3">{formatDateTime(p.paidAt)}</span></span>
                <span className={p.kind === "refund" ? "text-danger-fg num" : "font-medium num"}>{p.kind === "refund" ? "−" : ""}{formatMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-3">{sale.source === "import" ? "El archivo de origen no indicaba el método de pago." : "Sin pagos registrados."}</p>
        )}

        <DescriptionList
          className="mt-6"
          items={[
            { label: "Centro", value: ws.locations.find((l) => l.id === sale.locationId)?.name },
            { label: "Cliente", value: sale.customerId ? <Link className="text-accent-fg hover:underline" to={`/clientes/${sale.customerId}`}>{customerName(ws.customers.find((c) => c.id === sale.customerId)!)}</Link> : "—" },
            { label: "Origen", value: SOURCE_LABEL[sale.source] + (sale.granularity === "aggregate" ? " (resumen mensual)" : "") },
            ...(imp ? [{ label: "Importación", value: <Link className="text-accent-fg hover:underline" to={`/importaciones/${imp.id}`}>{imp.fileName}{rec ? ` · ${rec.sheet} fila ${rec.rowNumber}` : ""}</Link> }] : []),
            ...(sale.notes ? [{ label: "Notas", value: sale.notes }] : []),
          ]}
        />

        {log.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 text-sm font-semibold">Historial</h3>
            <ol className="flex flex-col gap-2 border-l border-line pl-4">
              {log.map((l) => (
                <li key={l.id} className="text-sm">
                  <span className="font-medium">{l.actorName}</span> <span className="text-fg-3">{l.action === "void" ? "anuló" : l.action === "insert" ? "registró" : l.action}</span>
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-fg-3"><Clock className="h-3 w-3" />{formatDateTime(l.createdAt)}</span>
                  {typeof l.context?.reason === "string" && <p className="text-xs text-fg-3">«{l.context.reason}»</p>}
                </li>
              ))}
            </ol>
          </>
        )}
      </Drawer>
      <ReasonDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        danger
        title={`Anular venta #${sale.number}`}
        description={<>La venta seguirá en el histórico marcada como anulada y sus pagos se compensarán con una devolución ({formatMoney(sale.total)}).</>}
        confirmLabel="Anular venta"
        placeholder="Ej.: cobrada por error, el cliente devolvió el producto…"
        onConfirm={(reason) => {
          try {
            voidSale(ctx, sale.id, reason);
            toast.success(`Venta #${sale.number} anulada`);
            setVoiding(false);
          } catch (e) {
            toast.fromError(e);
          }
        }}
      />
    </>
  );
}
