import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ban, CheckCircle2, Copy, MoreHorizontal, Pencil, Plus, ScrollText, Store, Tag, Truck } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import {
  Badge, Button, Card, CardHeader, DataTable, Drawer, EmptyState, FilterBar, FilterSelect, IconButton, Kpi, KpiStrip, Ledger, Menu, MenuItem,
  Page, ReasonDialog, SearchField, Select, useToast, type Column,
} from "@/design-system/components";
import { BarList, ColumnChart } from "@/design-system/components/charts";
import { EXPENSE_VIEW, expenseKpis, expenseSeries, expenseView, hasComparableHistory, type ExpenseView } from "@/domain/expenses";
import { percentChange } from "@/domain/analytics";
import type { Expense } from "@/domain/types";
import { markExpensePaid, voidExpense } from "@/data/repos/expenses";
import { capitalize, formatDate, monthName, monthShort, toISODate } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { euros } from "@/lib/export";
import { normalizeKey } from "@/lib/text";
import { FinanceHeader, periodSpan, useFinancePeriod } from "@/features/finance/shared";
import { AuditTrail } from "@/features/shared/AuditTrail";
import { ExpenseDrawer } from "./ExpenseDrawer";
import { DeltaChip } from "@/design-system/components";

export default function ExpensesPage() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const ready = useServerReady();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { filterId, current, locations, canSeeAll } = useLocationScope();
  const { now, period, prev, control } = useFinancePeriod();
  const [editing, setEditing] = useState<{ mode: "new" } | { mode: "edit"; e: Expense } | { mode: "dup"; e: Expense } | null>(params.get("nuevo") ? { mode: "new" } : null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ExpenseView | "">((params.get("estado") as ExpenseView) || "");
  const [cat, setCat] = useState<string>(params.get("categoria") ?? "");
  const [sup, setSup] = useState<string>(params.get("proveedor") ?? "");
  const [scope, setScope] = useState<"period" | "all">("period");
  const today = toISODate(now);
  const manage = can("expenses.manage") && ready;

  const refs = { categories: ws.expenseCategories, suppliers: ws.suppliers, locations: ws.locations };
  const k = useMemo(() => expenseKpis(ws.expenses, refs, period, filterId, today), [ws.expenses, ws.expenseCategories, ws.suppliers, period, filterId, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const kp = useMemo(() => expenseKpis(ws.expenses, refs, prev, filterId, today), [ws.expenses, prev, filterId, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const comparable = useMemo(() => hasComparableHistory(ws.expenses, prev.start), [ws.expenses, prev.start]);
  const series = useMemo(() => expenseSeries(ws.expenses, now, 12, filterId), [ws.expenses, now, filterId]);
  const supName = useMemo(() => new Map(ws.suppliers.map((s) => [s.id, s.name])), [ws.suppliers]);
  const catName = useMemo(() => new Map(ws.expenseCategories.map((c) => [c.id, c.name])), [ws.expenseCategories]);
  const locName = useMemo(() => new Map(ws.locations.map((l) => [l.id, l.name])), [ws.locations]);
  const methodName = useMemo(() => new Map(ws.paymentMethods.map((m) => [m.id, m.name])), [ws.paymentMethods]);

  const rows = useMemo(() => {
    const inPeriod = (iso: string) => { const t = new Date(`${iso}T00:00:00`).getTime(); return t >= period.start.getTime() && t < period.end.getTime(); };
    const base = scope === "period" ? ws.expenses.filter((e) => inPeriod(e.issueDate)) : ws.expenses;
    const nq = normalizeKey(q);
    return base
      .filter((e) => !filterId || e.locationId === filterId)
      .filter((e) => !status || expenseView(e, today) === status)
      .filter((e) => !cat || (cat === "none" ? !e.categoryId : e.categoryId === cat))
      .filter((e) => !sup || (sup === "none" ? !e.supplierId : e.supplierId === sup))
      .filter((e) => !nq || normalizeKey(`${e.description} ${supName.get(e.supplierId ?? "") ?? ""} ${e.supplierInvoiceNumber ?? ""} ${catName.get(e.categoryId ?? "") ?? ""}`).includes(nq))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt));
  }, [ws.expenses, scope, period, filterId, status, cat, sup, q, today, supName, catName]);

  const active = [status, cat, sup, q].filter(Boolean).length;
  const clear = () => { setStatus(""); setCat(""); setSup(""); setQ(""); setParams({}, { replace: true }); };

  const columns: Column<Expense>[] = [
    { id: "date", header: "Fecha", cell: (e) => <span className="text-fg-2 num">{formatDate(e.issueDate)}</span>, sortValue: (e) => e.issueDate, exportValue: (e) => new Date(`${e.issueDate}T00:00`), exportFormat: "date", width: 104 },
    {
      id: "description", header: "Concepto", hideable: false,
      cell: (e) => (
        <span className="block min-w-0">
          <span className={`block truncate font-medium ${e.status === "void" ? "text-fg-3 line-through" : ""}`}>{e.description}</span>
          <span className="block truncate text-xs text-fg-3">{supName.get(e.supplierId ?? "") ?? "Sin proveedor"}{e.supplierInvoiceNumber ? ` · ${e.supplierInvoiceNumber}` : ""}</span>
        </span>
      ),
      sortValue: (e) => e.description, exportValue: (e) => e.description,
    },
    { id: "supplier", header: "Proveedor", cell: (e) => supName.get(e.supplierId ?? "") ?? "—", defaultHidden: true, exportValue: (e) => supName.get(e.supplierId ?? "") ?? "", sortValue: (e) => supName.get(e.supplierId ?? "") ?? "" },
    { id: "category", header: "Categoría", cell: (e) => e.categoryId ? <Badge>{catName.get(e.categoryId) ?? "—"}</Badge> : <span className="text-fg-3">—</span>, sortValue: (e) => catName.get(e.categoryId ?? "") ?? "", exportValue: (e) => catName.get(e.categoryId ?? "") ?? "", priority: "medium" },
    { id: "location", header: "Centro", cell: (e) => <span className="text-fg-2">{e.locationId ? locName.get(e.locationId) : "General"}</span>, exportValue: (e) => (e.locationId ? locName.get(e.locationId) : "General"), priority: "low", sortValue: (e) => locName.get(e.locationId ?? "") ?? "" },
    { id: "invoiceNo", header: "Nº factura", cell: (e) => e.supplierInvoiceNumber ?? "—", defaultHidden: true, exportValue: (e) => e.supplierInvoiceNumber ?? "" },
    { id: "base", header: "Base", align: "right", cell: (e) => <span className="text-fg-2">{formatMoney(e.subtotal)}</span>, sortValue: (e) => e.subtotal, exportValue: (e) => euros(e.subtotal), exportFormat: "money", priority: "low" },
    { id: "vat", header: "IVA", align: "right", cell: (e) => <span className="text-fg-2">{formatMoney(e.taxTotal)}</span>, sortValue: (e) => e.taxTotal, exportValue: (e) => euros(e.taxTotal), exportFormat: "money", priority: "medium" },
    { id: "rate", header: "Tipo IVA", align: "right", cell: (e) => (e.taxRateBp !== undefined ? formatRate(e.taxRateBp) : "—"), defaultHidden: true, exportValue: (e) => (e.taxRateBp ?? 0) / 100 },
    { id: "total", header: "Total", align: "right", cell: (e) => <span className={`font-semibold ${e.status === "void" ? "text-fg-3 line-through" : ""}`}>{formatMoney(e.total)}</span>, sortValue: (e) => e.total, exportValue: (e) => euros(e.total), exportFormat: "money" },
    {
      id: "status", header: "Estado",
      cell: (e) => { const v = expenseView(e, today); return <Badge tone={EXPENSE_VIEW[v].tone} dot>{EXPENSE_VIEW[v].label}</Badge>; },
      sortValue: (e) => expenseView(e, today), exportValue: (e) => EXPENSE_VIEW[expenseView(e, today)].label,
    },
    { id: "due", header: "Vence", cell: (e) => <span className="text-fg-2 num">{e.dueDate ? formatDate(e.dueDate) : "—"}</span>, sortValue: (e) => e.dueDate ?? "", exportValue: (e) => e.dueDate ?? "", priority: "low", defaultHidden: true },
    { id: "method", header: "Método", cell: (e) => methodName.get(e.paymentMethodId ?? "") ?? "—", defaultHidden: true, exportValue: (e) => methodName.get(e.paymentMethodId ?? "") ?? "" },
    {
      id: "actions", header: "", hideable: false, width: 48,
      cell: (e) => manage && e.status !== "void" ? (
        <span onClick={(ev) => ev.stopPropagation()}>
          <Menu width={200} trigger={(_, t) => <IconButton icon={MoreHorizontal} label="Acciones" size="sm" onClick={t} />}>
            {(close) => (
              <>
                <MenuItem icon={Pencil} onClick={() => { close(); setEditing({ mode: "edit", e }); }}>Editar</MenuItem>
                <MenuItem icon={Copy} onClick={() => { close(); setEditing({ mode: "dup", e }); }}>Duplicar</MenuItem>
                {e.status === "pending" && <MenuItem icon={CheckCircle2} onClick={() => { close(); paid([e]); }}>Marcar como pagado</MenuItem>}
                <MenuItem icon={Ban} danger onClick={() => { close(); setVoiding(e); }}>Anular</MenuItem>
              </>
            )}
          </Menu>
        </span>
      ) : null,
    },
  ];

  function paid(list: Expense[]) {
    try {
      const n = markExpensePaid(ctx, list.map((e) => e.id));
      toast.success(n === 1 ? "Gasto marcado como pagado" : `${n} gastos marcados como pagados`);
    } catch (err) {
      toast.fromError(err);
    }
  }

  const statusCounts = useMemo(() => {
    const m = new Map<ExpenseView, number>();
    for (const e of ws.expenses) if (!filterId || e.locationId === filterId) m.set(expenseView(e, today), (m.get(expenseView(e, today)) ?? 0) + 1);
    return m;
  }, [ws.expenses, filterId, today]);

  const hasAny = ws.expenses.length > 0;
  const newBtn = can("expenses.manage") && <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => setEditing({ mode: "new" })}>Nuevo gasto</Button>;

  return (
    <Page wide>
      <FinanceHeader title="Gastos" eyebrow={<>{period.label} · {periodSpan(period)} · {current ? current.name : canSeeAll ? "Todos los centros" : ""}</>} control={control} actions={newBtn} />
      <ServerNotice what="El módulo de Gastos" />

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="Aún no tienes gastos registrados"
            description="Registra facturas de proveedores, tickets y cargos para conocer tu resultado real, tu flujo de caja y el IVA soportado. Se tarda menos de un minuto por gasto."
            action={newBtn || undefined}
            secondary={can("expenses.manage") ? <Button icon={Truck} onClick={() => navigate("/proveedores")}>Añadir proveedores</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <KpiStrip className="mb-5">
            <Kpi label="Gasto del periodo" value={formatMoney(k.total)} delta={comparable ? <DeltaChip value={percentChange(k.total, kp.total)} invert /> : undefined} hint={comparable ? `vs ${prev.label.toLowerCase()} · IVA incluido` : "IVA incluido · sin histórico para comparar"} />
            <Kpi label="Base imponible" value={formatMoney(k.base)} hint={`${k.count} ${k.count === 1 ? "gasto" : "gastos"}`} />
            <Kpi label="IVA soportado" value={formatMoney(k.vat)} hint="Deducible según la gestoría" />
            <Kpi
              label="Pendiente de pago"
              value={formatMoney(k.pending.amount)}
              hint={k.overdue.count ? <span className="text-danger-fg">{k.overdue.count} vencido{k.overdue.count === 1 ? "" : "s"} · {formatMoney(k.overdue.amount)}</span> : `${k.pending.count} ${k.pending.count === 1 ? "factura" : "facturas"} · sin vencidos`}
            />
          </KpiStrip>

          <div className="mb-6 grid gap-4 md:grid-cols-12 [&>*]:min-w-0">
            <Card className="md:col-span-12 xl:col-span-7">
              <CardHeader title="Evolución" description="Gasto mensual · IVA incluido · últimos 12 meses" />
              <ColumnChart tone="out" partialLast height={220} currentLabel="Gasto" data={series.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), current: r.total }))} />
            </Card>
            <Card className="md:col-span-6 xl:col-span-5">
              <CardHeader title="Por categoría" description={period.label} action={<Tag className="h-4 w-4 text-fg-3" />} />
              <BarList tone="out" max={6} rows={k.byCategory.map((c) => ({ key: c.id, label: <button className="hover:underline" onClick={() => setCat(c.id)}>{c.name}</button>, value: c.amount }))} emptyText="Sin gastos en el periodo" />
            </Card>
            <Card className="md:col-span-6 xl:col-span-7">
              <CardHeader title="Principales proveedores" description={period.label} action={<Truck className="h-4 w-4 text-fg-3" />} />
              <BarList tone="out" max={5} rows={k.bySupplier.map((s) => ({ key: s.id, label: s.id === "none" ? s.name : <button className="hover:underline" onClick={() => navigate(`/proveedores/${s.id}`)}>{s.name}</button>, value: s.amount, sub: `${s.count}` }))} emptyText="Sin gastos en el periodo" />
            </Card>
            {!current && locations.length > 1 && (
              <Card className="md:col-span-12 xl:col-span-5">
                <CardHeader title="Por centro" description="Los gastos generales no se reparten entre centros" action={<Store className="h-4 w-4 text-fg-3" />} />
                <BarList tone="out" rows={k.byLocation.map((l) => ({ key: l.id, label: l.name, value: l.amount }))} emptyText="Sin gastos en el periodo" />
              </Card>
            )}
          </div>

          <DataTable

            filters={<FilterBar className="mb-0"
              active={active}
              onClear={clear}
              trailing={
                <Select value={scope} onChange={(e) => setScope(e.target.value as "period" | "all")} className="w-[172px]" aria-label="Ámbito">
                  <option value="period">Solo {period.label.toLowerCase()}</option>
                  <option value="all">Todo el histórico</option>
                </Select>
              }
            >
              <SearchField value={q} onChange={setQ} placeholder="Buscar gastos…" />
              <FilterSelect label="Estado" value={status} onChange={setStatus} options={(["pending", "overdue", "paid", "void"] as ExpenseView[]).map((v) => ({ value: v, label: EXPENSE_VIEW[v].label, count: statusCounts.get(v) ?? 0 }))} />
              <FilterSelect label="Categoría" value={cat} onChange={setCat} options={[...ws.expenseCategories.filter((c) => c.status === "active").map((c) => ({ value: c.id, label: c.name })), { value: "none", label: "Sin categoría" }]} />
              <FilterSelect label="Proveedor" value={sup} onChange={setSup} searchable options={[...ws.suppliers.filter((s) => s.status !== "archived").map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "Sin proveedor" }]} />
            </FilterBar>}
            rows={rows}
            columns={columns}
            getRowId={(e) => e.id}
            onRowClick={setDetail}
            storageKey="expenses"
            exportName="Gastos"
            exportCompany={ws.organization.name}
            selectable={manage}
            rowClassName={(e) => (e.status === "void" ? "opacity-60" : undefined)}
            bulkActions={(sel, clearSel) => sel.some((e) => e.status === "pending") ? <Button size="sm" icon={CheckCircle2} onClick={() => { paid(sel.filter((e) => e.status === "pending")); clearSel(); }}>Marcar pagados</Button> : null}
            mobile={{
              title: (e) => e.description,
              subtitle: (e) => `${formatDate(e.issueDate)} · ${supName.get(e.supplierId ?? "") ?? catName.get(e.categoryId ?? "") ?? "Sin proveedor"}`,
              value: (e) => formatMoney(e.total),
              status: (e) => { const v = expenseView(e, today); return <Badge tone={EXPENSE_VIEW[v].tone} dot>{EXPENSE_VIEW[v].label}</Badge>; },
            }}
            footer={rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-line bg-surface-2 px-4 py-2.5 text-sm">
                <span className="text-fg-3">Base <span className="font-medium text-fg-2 num">{formatMoney(rows.filter((e) => e.status !== "void").reduce((s, e) => s + e.subtotal, 0))}</span></span>
                <span className="text-fg-3">IVA <span className="font-medium text-fg-2 num">{formatMoney(rows.filter((e) => e.status !== "void").reduce((s, e) => s + e.taxTotal, 0))}</span></span>
                <span className="text-fg-3">Total <span className="font-semibold text-fg num">{formatMoney(rows.filter((e) => e.status !== "void").reduce((s, e) => s + e.total, 0))}</span></span>
              </div>
            )}
            empty={{ icon: ScrollText, title: "Ningún gasto con estos filtros", description: "Prueba con otro periodo o quita algún filtro.", action: active ? <Button onClick={clear}>Quitar filtros</Button> : undefined }}
          />
        </>
      )}

      <ExpenseDrawer
        open={!!editing}
        onClose={() => setEditing(null)}
        expense={editing?.mode === "edit" ? editing.e : undefined}
        duplicateOf={editing?.mode === "dup" ? editing.e : undefined}
        onSaved={(e) => detail && detail.id === e.id && setDetail(e)}
      />
      <ExpenseDetail expense={detail ? ws.expenses.find((e) => e.id === detail.id) ?? detail : null} onClose={() => setDetail(null)} onEdit={(e) => { setDetail(null); setEditing({ mode: "edit", e }); }} onDuplicate={(e) => { setDetail(null); setEditing({ mode: "dup", e }); }} onPaid={(e) => paid([e])} onVoid={(e) => setVoiding(e)} manage={manage} />
      <ReasonDialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title="Anular gasto"
        description="El gasto deja de contar en totales e IVA, pero se conserva en el histórico con el motivo."
        confirmLabel="Anular gasto"
        danger
        onConfirm={(reason) => {
          try {
            voidExpense(ctx, voiding!.id, reason);
            toast.success("Gasto anulado");
            setVoiding(null);
          } catch (e) {
            toast.fromError(e);
          }
        }}
      />
    </Page>
  );
}

function ExpenseDetail({ expense: e, onClose, onEdit, onDuplicate, onPaid, onVoid, manage }: {
  expense: Expense | null;
  onClose: () => void;
  onEdit: (e: Expense) => void;
  onDuplicate: (e: Expense) => void;
  onPaid: (e: Expense) => void;
  onVoid: (e: Expense) => void;
  manage: boolean;
}) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  if (!e) return null;
  const v = expenseView(e);
  const sup = ws.suppliers.find((s) => s.id === e.supplierId);
  return (
    <Drawer
      open
      onClose={onClose}
      title={e.description}
      subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={EXPENSE_VIEW[v].tone} dot>{EXPENSE_VIEW[v].label}</Badge>{formatDate(e.issueDate)}</span>}
      footer={manage && e.status !== "void" ? (
        <>
          <Button variant="ghost" icon={Ban} onClick={() => onVoid(e)}>Anular</Button>
          <Button icon={Copy} onClick={() => onDuplicate(e)}>Duplicar</Button>
          <Button icon={Pencil} onClick={() => onEdit(e)}>Editar</Button>
          {e.status === "pending" && <Button variant="primary" icon={CheckCircle2} onClick={() => onPaid(e)}>Marcar pagado</Button>}
        </>
      ) : undefined}
    >
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-sm text-fg-3">Total</p>
          <p className={`figure text-4xl ${e.status === "void" ? "text-fg-3 line-through" : ""}`}>{formatMoney(e.total)}</p>
        </div>
        <Ledger rows={[
          { label: "Base imponible", value: formatMoney(e.subtotal) },
          { label: `IVA soportado${e.taxRateBp !== undefined ? ` (${formatRate(e.taxRateBp)})` : ""}`, value: formatMoney(e.taxTotal) },
          { label: "Total", value: formatMoney(e.total), strong: true },
        ]} />
        <Ledger rows={[
          { label: "Proveedor", value: sup ? <button className="font-medium text-accent-fg hover:underline" onClick={() => navigate(`/proveedores/${sup.id}`)}>{sup.name}</button> : "—" },
          { label: "Nº de factura", value: e.supplierInvoiceNumber ?? "—" },
          { label: "Categoría", value: ws.expenseCategories.find((c) => c.id === e.categoryId)?.name ?? "—" },
          { label: "Centro", value: ws.locations.find((l) => l.id === e.locationId)?.name ?? "Gastos generales" },
          { label: "Vencimiento", value: e.dueDate ? formatDate(e.dueDate) : "—" },
          { label: "Pago", value: e.status === "paid" ? `${e.paidAt ? formatDate(e.paidAt) : "Pagado"}${e.paymentMethodId ? ` · ${ws.paymentMethods.find((m) => m.id === e.paymentMethodId)?.name ?? ""}` : ""}` : "Pendiente" },
          ...(e.status === "void" ? [{ label: "Anulación", value: e.voidReason ?? "—" }] : []),
        ]} />
        {e.notes && <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-fg-2 whitespace-pre-wrap">{e.notes}</div>}
        <AuditTrail entityIds={[e.id]} />
      </div>
    </Drawer>
  );
}
