import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, ArrowLeft, Mail, MapPin, Pencil, Phone, Plus, RotateCcw, ScrollText, Truck } from "lucide-react";
import { useCtx, useSession, useWorkspace } from "@/app/session";
import { ServerNotice, useServerReady } from "@/app/serverCaps";
import {
  Avatar, Badge, Button, Card, CardHeader, DataTable, Drawer, EmptyState, Field, FilterBar, FilterSelect, Input, Kpi, KpiStrip, Ledger, Page,
  SearchField, Select, Textarea, useToast, type Column,
} from "@/design-system/components";
import { ColumnChart } from "@/design-system/components/charts";
import { createSupplier, setSupplierStatus, updateSupplier, type SupplierInput } from "@/data/repos/expenses";
import { EXPENSE_VIEW, expenseSeries, expenseView } from "@/domain/expenses";
import type { Expense, Supplier } from "@/domain/types";
import { addMonths, capitalize, formatDate, monthName, monthShort, relativeDays, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { euros } from "@/lib/export";
import { normalizeKey } from "@/lib/text";
import { FinanceHeader } from "@/features/finance/shared";
import { AuditTrail } from "@/features/shared/AuditTrail";
import { ExpenseDrawer } from "./ExpenseDrawer";

interface SupplierRow extends Supplier { spend12: number; pending: number; count: number; last?: string; category?: string }

function useSupplierRows(): SupplierRow[] {
  const ws = useWorkspace();
  return useMemo(() => {
    const since = toISODate(addMonths(new Date(), -12));
    const cat = new Map(ws.expenseCategories.map((c) => [c.id, c.name]));
    const by = new Map<string, Expense[]>();
    for (const e of ws.expenses) if (e.supplierId && e.status !== "void") by.set(e.supplierId, [...(by.get(e.supplierId) ?? []), e]);
    return ws.suppliers.map((s) => {
      const list = by.get(s.id) ?? [];
      return {
        ...s,
        spend12: list.filter((e) => e.issueDate >= since).reduce((t, e) => t + e.total, 0),
        pending: list.filter((e) => e.status === "pending").reduce((t, e) => t + e.total, 0),
        count: list.length,
        last: list.reduce<string | undefined>((m, e) => (!m || e.issueDate > m ? e.issueDate : m), undefined),
        category: s.defaultCategoryId ? cat.get(s.defaultCategoryId) : undefined,
      };
    });
  }, [ws.suppliers, ws.expenses, ws.expenseCategories]);
}

export default function SuppliersPage() {
  const ws = useWorkspace();
  const { can } = useSession();
  const ready = useServerReady();
  const navigate = useNavigate();
  const rows = useSupplierRows();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "archived">("active");
  const [creating, setCreating] = useState(false);
  const nq = normalizeKey(q);
  const list = rows
    .filter((r) => !status || (status === "archived" ? r.status === "archived" : r.status !== "archived"))
    .filter((r) => !nq || normalizeKey(`${r.name} ${r.taxId ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`).includes(nq))
    .sort((a, b) => b.spend12 - a.spend12 || a.name.localeCompare(b.name));

  const columns: Column<SupplierRow>[] = [
    { id: "name", header: "Proveedor", hideable: false, cell: (r) => <span className="flex min-w-0 items-center gap-2.5"><Avatar name={r.name} size={28} /><span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-fg-3">{r.taxId ?? "Sin NIF"}</span></span></span>, sortValue: (r) => r.name, exportValue: (r) => r.name },
    { id: "taxId", header: "NIF", cell: (r) => r.taxId ?? "—", defaultHidden: true, exportValue: (r) => r.taxId ?? "" },
    { id: "category", header: "Categoría habitual", cell: (r) => r.category ? <Badge>{r.category}</Badge> : <span className="text-fg-3">—</span>, exportValue: (r) => r.category ?? "", priority: "medium" },
    { id: "contact", header: "Contacto", cell: (r) => <span className="text-fg-2">{r.email ?? r.phone ?? "—"}</span>, exportValue: (r) => [r.email, r.phone].filter(Boolean).join(" · "), priority: "low" },
    { id: "count", header: "Gastos", align: "right", cell: (r) => r.count, sortValue: (r) => r.count, exportValue: (r) => r.count, priority: "medium" },
    { id: "last", header: "Último", cell: (r) => <span className="text-fg-2">{r.last ? relativeDays(r.last) : "—"}</span>, sortValue: (r) => r.last ?? "", exportValue: (r) => r.last ?? "", priority: "low" },
    { id: "pending", header: "Pendiente", align: "right", cell: (r) => r.pending ? <span className="font-medium text-warning-fg">{formatMoney(r.pending)}</span> : <span className="text-fg-3">—</span>, sortValue: (r) => r.pending, exportValue: (r) => euros(r.pending), exportFormat: "money" },
    { id: "spend", header: "Gasto 12 meses", align: "right", cell: (r) => <span className="font-semibold">{formatMoney(r.spend12)}</span>, sortValue: (r) => r.spend12, exportValue: (r) => euros(r.spend12), exportFormat: "money" },
  ];

  const newBtn = can("expenses.manage") && <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => setCreating(true)}>Nuevo proveedor</Button>;
  return (
    <Page wide>
      <FinanceHeader title="Proveedores" eyebrow={`${rows.filter((r) => r.status !== "archived").length} activos · ${formatMoney(rows.reduce((s, r) => s + r.pending, 0))} pendiente de pago`} actions={newBtn} />
      <ServerNotice what="La gestión de proveedores" />
      {!ws.suppliers.length ? (
        <Card>
          <EmptyState icon={Truck} title="Aún no tienes proveedores" description="Guarda a quién compras (alquiler, suministros, material, servicios) para ver cuánto gastas con cada uno, qué está pendiente y detectar facturas repetidas." action={newBtn || undefined} />
        </Card>
      ) : (
        <>
          <DataTable
            filters={<FilterBar className="mb-0" active={q ? 1 : 0} onClear={() => setQ("")}>
              <SearchField value={q} onChange={setQ} placeholder="Buscar nombre, NIF, email…" />
              <FilterSelect label="Estado" value={status} onChange={setStatus} allLabel="Todos" options={[{ value: "active", label: "Activos" }, { value: "archived", label: "Archivados" }]} />
            </FilterBar>}
            rows={list}
            columns={columns}
            getRowId={(r) => r.id}
            onRowClick={(r) => navigate(`/proveedores/${r.id}`)}
            storageKey="suppliers"
            exportName="Proveedores"
            exportCompany={ws.organization.name}
            mobile={{ title: (r) => r.name, subtitle: (r) => `${r.count} gastos${r.pending ? ` · ${formatMoney(r.pending)} pendiente` : ""}`, value: (r) => formatMoney(r.spend12), leading: (r) => <Avatar name={r.name} size={32} /> }}
            empty={{ icon: Truck, title: "Ningún proveedor coincide", description: "Prueba con otra búsqueda." }}
          />
        </>
      )}
      <SupplierDrawer open={creating} onClose={() => setCreating(false)} onSaved={(s) => navigate(`/proveedores/${s.id}`)} />
    </Page>
  );
}

export function SupplierDrawer({ open, onClose, supplier, onSaved }: { open: boolean; onClose: () => void; supplier?: Supplier; onSaved?: (s: Supplier) => void }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const empty: SupplierInput = { name: "" };
  const [form, setForm] = useState<SupplierInput>(empty);
  useEffect(() => {
    if (open) setForm(supplier ? { name: supplier.name, taxId: supplier.taxId, email: supplier.email, phone: supplier.phone, address: supplier.address, defaultCategoryId: supplier.defaultCategoryId, notes: supplier.notes } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.id]);
  const set = <K extends keyof SupplierInput>(k: K, v: SupplierInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    try {
      const s = supplier ? updateSupplier(ctx, supplier.id, form) : createSupplier(ctx, form);
      toast.success(supplier ? "Proveedor actualizado" : "Proveedor creado", s.name);
      onSaved?.(s);
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title={supplier ? "Editar proveedor" : "Nuevo proveedor"} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.name.trim()} onClick={save}>{supplier ? "Guardar" : "Crear proveedor"}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Nombre o razón social" required className="sm:col-span-2"><Input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="NIF / CIF"><Input value={form.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} /></Field>
        <Field label="Categoría habitual" hint="Se propone al registrar sus gastos">
          <Select value={form.defaultCategoryId ?? ""} onChange={(e) => set("defaultCategoryId", e.target.value || undefined)}>
            <option value="">Sin categoría</option>
            {ws.expenseCategories.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Email"><Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Teléfono"><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Dirección" className="sm:col-span-2"><Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Notas" className="sm:col-span-2"><Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Condiciones, persona de contacto, días de pago…" /></Field>
      </form>
    </Drawer>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const ready = useServerReady();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [newExpense, setNewExpense] = useState(false);
  const [status, setStatus] = useState<"" | "pending" | "overdue" | "paid" | "void">("");
  const s = ws.suppliers.find((x) => x.id === id);
  const expenses = useMemo(() => ws.expenses.filter((e) => e.supplierId === id).sort((a, b) => b.issueDate.localeCompare(a.issueDate)), [ws.expenses, id]);
  const now = useMemo(() => new Date(), []);
  const series = useMemo(() => expenseSeries(expenses, now, 12), [expenses, now]);
  if (!s) {
    return <Page><EmptyState icon={Truck} title="Proveedor no encontrado" description="Puede que pertenezca a otra empresa o que el enlace sea incorrecto." action={<Button onClick={() => navigate("/proveedores")}>Ver proveedores</Button>} /></Page>;
  }
  const live = expenses.filter((e) => e.status !== "void");
  const since = toISODate(addMonths(now, -12));
  const spend12 = live.filter((e) => e.issueDate >= since).reduce((t, e) => t + e.total, 0);
  const pending = live.filter((e) => e.status === "pending");
  const manage = can("expenses.manage") && ready;
  const cat = ws.expenseCategories.find((c) => c.id === s.defaultCategoryId);
  const columns: Column<Expense>[] = [
    { id: "date", header: "Fecha", cell: (e) => <span className="num text-fg-2">{formatDate(e.issueDate)}</span>, sortValue: (e) => e.issueDate, exportValue: (e) => e.issueDate },
    { id: "description", header: "Concepto", cell: (e) => <span className="font-medium">{e.description}</span>, exportValue: (e) => e.description },
    { id: "number", header: "Nº factura", cell: (e) => e.supplierInvoiceNumber ?? "—", exportValue: (e) => e.supplierInvoiceNumber ?? "", priority: "medium" },
    { id: "vat", header: "IVA", align: "right", cell: (e) => formatMoney(e.taxTotal), exportValue: (e) => euros(e.taxTotal), exportFormat: "money", priority: "low" },
    { id: "total", header: "Total", align: "right", cell: (e) => <span className="font-semibold">{formatMoney(e.total)}</span>, sortValue: (e) => e.total, exportValue: (e) => euros(e.total), exportFormat: "money" },
    { id: "status", header: "Estado", cell: (e) => { const v = expenseView(e); return <Badge tone={EXPENSE_VIEW[v].tone} dot>{EXPENSE_VIEW[v].label}</Badge>; }, exportValue: (e) => EXPENSE_VIEW[expenseView(e)].label },
  ];
  return (
    <Page wide>
      <Link to="/proveedores" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Proveedores</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={s.name} size={52} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[26px] font-semibold tracking-[-0.03em]">{s.name}</h1>
              {s.status === "archived" && <Badge>Archivado</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-fg-3">{[s.taxId ?? "Sin NIF", cat?.name].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button icon={s.status === "archived" ? RotateCcw : Archive} onClick={() => { setSupplierStatus(ctx, s.id, s.status === "archived" ? "active" : "archived"); toast.success(s.status === "archived" ? "Proveedor reactivado" : "Proveedor archivado"); }}>{s.status === "archived" ? "Reactivar" : "Archivar"}</Button>
            <Button icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>
            <Button variant="primary" icon={Plus} onClick={() => setNewExpense(true)}>Registrar gasto</Button>
          </div>
        )}
      </div>
      <ServerNotice what="La gestión de proveedores" />
      <KpiStrip className="mb-5">
        <Kpi label="Gasto últimos 12 meses" value={formatMoney(spend12)} hint={`${live.length} ${live.length === 1 ? "gasto" : "gastos"} en total`} />
        <Kpi label="Pendiente de pago" value={formatMoney(pending.reduce((t, e) => t + e.total, 0))} hint={pending.length ? `${pending.length} ${pending.length === 1 ? "factura" : "facturas"}` : "Todo pagado"} />
        <Kpi label="IVA soportado (12 m)" value={formatMoney(live.filter((e) => e.issueDate >= since).reduce((t, e) => t + e.taxTotal, 0))} />
        <Kpi label="Último gasto" value={live[0] ? formatDate(live[0].issueDate) : "—"} hint={live[0] ? formatMoney(live[0].total) : "Sin gastos"} />
      </KpiStrip>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Gasto mensual" description="IVA incluido · últimos 12 meses" />
            <ColumnChart tone="out" partialLast height={180} currentLabel="Gasto" data={series.map((r) => ({ key: toISODate(r.date), label: capitalize(monthShort(r.date.getMonth())), tooltipLabel: capitalize(`${monthName(r.date.getMonth())} ${r.date.getFullYear()}`), current: r.total }))} />
          </Card>
          <div>
            <FilterBar active={status ? 1 : 0} onClear={() => setStatus("")}>
              <FilterSelect label="Estado" value={status} onChange={setStatus} options={(["pending", "overdue", "paid", "void"] as const).map((v) => ({ value: v, label: EXPENSE_VIEW[v].label }))} />
            </FilterBar>
            <DataTable
              rows={expenses.filter((e) => !status || expenseView(e) === status)}
              columns={columns}
              getRowId={(e) => e.id}
              exportName={`Gastos ${s.name}`}
              exportCompany={ws.organization.name}
              mobile={{ title: (e) => e.description, subtitle: (e) => formatDate(e.issueDate), value: (e) => formatMoney(e.total), status: (e) => { const v = expenseView(e); return <Badge tone={EXPENSE_VIEW[v].tone} dot>{EXPENSE_VIEW[v].label}</Badge>; } }}
              empty={{ icon: ScrollText, title: "Sin gastos de este proveedor", description: "Cuando registres una factura suya aparecerá aquí.", action: manage ? <Button icon={Plus} onClick={() => setNewExpense(true)}>Registrar gasto</Button> : undefined }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Contacto" />
            <ul className="flex flex-col gap-3 text-sm">
              <li className="flex items-center gap-2.5"><Mail className="h-4 w-4 text-fg-3" />{s.email ? <a className="text-accent-fg hover:underline" href={`mailto:${s.email}`}>{s.email}</a> : <span className="text-fg-3">Sin email</span>}</li>
              <li className="flex items-center gap-2.5"><Phone className="h-4 w-4 text-fg-3" />{s.phone ? <a className="hover:underline" href={`tel:${s.phone}`}>{s.phone}</a> : <span className="text-fg-3">Sin teléfono</span>}</li>
              <li className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 text-fg-3" />{s.address ?? <span className="text-fg-3">Sin dirección</span>}</li>
            </ul>
            {s.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg-2">{s.notes}</p>}
          </Card>
          <Card>
            <CardHeader title="Resumen" />
            <Ledger rows={[
              { label: "Total histórico", value: formatMoney(live.reduce((t, e) => t + e.total, 0)) },
              { label: "Pagado", value: formatMoney(live.filter((e) => e.status === "paid").reduce((t, e) => t + e.total, 0)) },
              { label: "Pendiente", value: formatMoney(pending.reduce((t, e) => t + e.total, 0)), tone: pending.length ? "negative" : "muted" },
              { label: "Gasto medio", value: live.length ? formatMoney(Math.round(live.reduce((t, e) => t + e.total, 0) / live.length)) : "—" },
            ]} />
          </Card>
          <Card><AuditTrail entityIds={[s.id]} /></Card>
        </div>
      </div>
      <SupplierDrawer open={editing} onClose={() => setEditing(false)} supplier={s} />
      <ExpenseDrawer open={newExpense} onClose={() => setNewExpense(false)} defaults={{ supplierId: s.id, categoryId: s.defaultCategoryId, taxRateBp: cat?.defaultTaxRateBp ?? 2100 }} />
    </Page>
  );
}
