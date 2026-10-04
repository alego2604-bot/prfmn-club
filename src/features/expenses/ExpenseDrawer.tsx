import { useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Button, Combobox, Drawer, Field, Input, MoneyInput, Segmented, Select, Switch, Textarea, useToast, DateInput } from "@/design-system/components";
import { createExpense, createExpenseCategory, createSupplier, ensureExpenseCategories, expenseToInput, updateExpense, type ExpenseInput } from "@/data/repos/expenses";
import { expenseAmounts } from "@/domain/expenses";
import type { Expense } from "@/domain/types";
import { formatMoney, formatRate } from "@/lib/money";
import { toISODate } from "@/lib/dates";

/**
 * Alta y edición de gastos en panel lateral. Pensado para registrar una factura de proveedor en segundos:
 * importe tal cual aparece en la factura (IVA incluido por defecto), proveedor y categoría con búsqueda y alta al vuelo.
 */
export function ExpenseDrawer({ open, onClose, expense, duplicateOf, defaults, onSaved }: {
  open: boolean;
  onClose: () => void;
  expense?: Expense;
  duplicateOf?: Expense;
  defaults?: Partial<ExpenseInput>;
  onSaved?: (e: Expense) => void;
}) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const { can } = useSession();
  const ready = useServerReady();
  const { current, locations } = useLocationScope();
  const [form, setForm] = useState<ExpenseInput>(() => initial());
  const [busy, setBusy] = useState(false);

  function initial(): ExpenseInput {
    if (expense) return expenseToInput(expense);
    if (duplicateOf) return expenseToInput(duplicateOf, true);
    const def = ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100;
    return { description: "", issueDate: toISODate(new Date()), amount: 0, includesTax: true, taxRateBp: def, paid: true, locationId: current?.id, ...defaults };
  }

  useEffect(() => {
    if (!open) return;
    setForm(initial());
    if (can("expenses.manage") && ready) {
      try { ensureExpenseCategories(ctx); } catch { /* sin permiso: se muestran las existentes */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id, duplicateOf?.id]);

  const set = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const preview = useMemo(() => {
    try { return form.amount > 0 ? expenseAmounts({ amount: form.amount, taxRateBp: form.taxRateBp, includesTax: form.includesTax }) : null; } catch { return null; }
  }, [form.amount, form.taxRateBp, form.includesTax]);

  const suppliers = ws.suppliers.filter((s) => s.status !== "archived" || s.id === form.supplierId);
  const categories = ws.expenseCategories.filter((c) => c.status === "active" || c.id === form.categoryId);
  const rates = [...new Set([...ws.taxRates.filter((t) => t.status === "active").map((t) => t.rateBp), form.taxRateBp])].sort((a, b) => b - a);
  const methods = ws.paymentMethods.filter((m) => m.status === "active" && m.kind !== "unknown");

  const pickSupplier = (id: string | undefined) => {
    const s = ws.suppliers.find((x) => x.id === id);
    setForm((f) => {
      const cat = s?.defaultCategoryId && !f.categoryId ? s.defaultCategoryId : f.categoryId;
      const c = ws.expenseCategories.find((x) => x.id === cat);
      return { ...f, supplierId: id, categoryId: cat, taxRateBp: c?.defaultTaxRateBp ?? f.taxRateBp };
    });
  };
  const pickCategory = (id: string | undefined) => {
    const c = ws.expenseCategories.find((x) => x.id === id);
    setForm((f) => ({ ...f, categoryId: id, taxRateBp: !expense && c?.defaultTaxRateBp !== undefined ? c.defaultTaxRateBp : f.taxRateBp }));
  };

  const save = (andNew = false) => {
    setBusy(true);
    try {
      const saved = expense ? updateExpense(ctx, expense.id, form) : createExpense(ctx, form);
      toast.success(expense ? "Gasto actualizado" : "Gasto registrado", `${saved.description} · ${formatMoney(saved.total)}`);
      onSaved?.(saved);
      if (andNew) setForm({ ...initial(), issueDate: form.issueDate, locationId: form.locationId, paid: form.paid, paymentMethodId: form.paymentMethodId });
      else onClose();
    } catch (e) {
      toast.fromError(e, "No se ha podido guardar el gasto");
    } finally {
      setBusy(false);
    }
  };

  const valid = form.description.trim() && form.amount > 0 && form.issueDate;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={expense ? "Editar gasto" : duplicateOf ? "Duplicar gasto" : "Nuevo gasto"}
      subtitle={expense ? `Registrado el ${new Date(expense.createdAt).toLocaleDateString("es-ES")}` : "Factura de proveedor, ticket o cargo bancario"}
      footer={
        <>
          {!expense && <Button variant="ghost" disabled={!valid || busy || !ready} onClick={() => save(true)}>Guardar y añadir otro</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={busy} disabled={!valid || !ready} onClick={() => save(false)}>{expense ? "Guardar cambios" : "Registrar gasto"}</Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (valid) save(false); }}>
        <Field label="Concepto" required>
          <Input autoFocus placeholder="Ej. Alquiler de octubre" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
            <Field label={form.includesTax ? "Importe total (IVA incluido)" : "Base imponible (sin IVA)"} required>
              <MoneyInput value={form.amount || null} onChange={(v) => set("amount", v ?? 0)} className="text-lg font-semibold" />
            </Field>
            <Field label="IVA">
              <Select value={form.taxRateBp} onChange={(e) => set("taxRateBp", Number(e.target.value))}>
                {rates.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Switch checked={form.includesTax} onChange={(v) => set("includesTax", v)} label="El importe incluye IVA" />
            {preview && (
              <p className="text-xs text-fg-3 num">
                Base {formatMoney(preview.subtotal)} · IVA {formatMoney(preview.taxTotal)} · <span className="font-semibold text-fg">Total {formatMoney(preview.total)}</span>
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor">
            <Combobox
              value={form.supplierId}
              onChange={pickSupplier}
              placeholder="Sin proveedor"
              options={suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.taxId }))}
              onCreate={can("expenses.manage") && ready ? (name) => { try { pickSupplier(createSupplier(ctx, { name }).id); } catch (e) { toast.fromError(e); } } : undefined}
              createLabel={(t) => `Crear proveedor «${t}»`}
            />
          </Field>
          <Field label="Categoría">
            <Combobox
              value={form.categoryId}
              onChange={pickCategory}
              placeholder="Sin categoría"
              options={categories.map((c) => ({ value: c.id, label: c.name, hint: c.defaultTaxRateBp !== undefined ? formatRate(c.defaultTaxRateBp) : undefined }))}
              onCreate={can("expenses.manage") && ready ? (name) => { try { pickCategory(createExpenseCategory(ctx, name).id); } catch (e) { toast.fromError(e); } } : undefined}
              createLabel={(t) => `Crear categoría «${t}»`}
            />
          </Field>
          <Field label="Fecha de la factura" required>
            <DateInput value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
          </Field>
          <Field label="Vencimiento" hint="Opcional: avisa si se pasa sin pagar">
            <DateInput value={form.dueDate ?? ""} min={form.issueDate} onChange={(e) => set("dueDate", e.target.value || undefined)} />
          </Field>
          <Field label="Nº de factura del proveedor" hint="Evita registrar dos veces la misma factura">
            <Input value={form.supplierInvoiceNumber ?? ""} onChange={(e) => set("supplierInvoiceNumber", e.target.value)} placeholder="Ej. A-2026-0142" />
          </Field>
          <Field label="Centro">
            <Select value={form.locationId ?? ""} onChange={(e) => set("locationId", e.target.value || undefined)}>
              <option value="">Gastos generales (todos los centros)</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-fg-2">Estado</p>
          <Segmented value={form.paid ? "paid" : "pending"} onChange={(v) => set("paid", v === "paid")} items={[{ value: "paid", label: "Pagado" }, { value: "pending", label: "Pendiente de pago" }]} />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={form.paid ? "Pagado con" : "Se pagará con"}>
              <Select value={form.paymentMethodId ?? ""} onChange={(e) => set("paymentMethodId", e.target.value || undefined)}>
                <option value="">Sin indicar</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            {form.paid && (
              <Field label="Fecha de pago">
                <DateInput value={form.paidAt ?? form.issueDate} onChange={(e) => set("paidAt", e.target.value || undefined)} />
              </Field>
            )}
          </div>
        </div>

        <Field label="Notas">
          <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Información interna (no aparece en ningún documento)" />
        </Field>

        <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-fg-3">
          <Paperclip className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Adjuntar la factura (PDF o foto) llegará con el módulo de Documentos. El gasto ya queda preparado para enlazarla.</span>
        </div>
      </form>
    </Drawer>
  );
}
