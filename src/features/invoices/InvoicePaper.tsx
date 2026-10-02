import { useWorkspace } from "@/app/session";
import type { Invoice, InvoiceItem } from "@/domain/types";
import { invoiceLabel } from "@/data/repos/invoices";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { cn } from "@/lib/cn";

/**
 * La factura tal y como se envía: documento en papel sobre el lienzo. Misma información que el PDF.
 * `items` permite previsualizar un borrador que aún no está guardado.
 */
export function InvoicePaper({ invoice: inv, items: draftItems, className }: { invoice: Invoice; items?: InvoiceItem[]; className?: string }) {
  const ws = useWorkspace();
  const org = ws.organization;
  const items = (draftItems ?? ws.invoiceItems.filter((i) => i.invoiceId === inv.id)).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const it of items) byRate.set(it.taxRateBp, { base: (byRate.get(it.taxRateBp)?.base ?? 0) + it.baseAmount, tax: (byRate.get(it.taxRateBp)?.tax ?? 0) + it.taxAmount });
  const mark = inv.status === "draft" ? "Borrador" : inv.status === "void" ? "Anulada" : null;
  return (
    <article className={cn("relative overflow-hidden rounded-xl border border-line bg-white text-[#121211] shadow-md dark:shadow-lg", className)} aria-label={`Factura ${invoiceLabel(inv)}`}>
      {mark && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="-rotate-[30deg] select-none text-[88px] font-bold uppercase tracking-[0.08em] text-black/[0.05]">{mark}</span>
        </div>
      )}
      <div className="h-1.5 bg-[#3646f5]" />
      <div className="p-6 sm:p-10">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {org.logoDataUrl ? <img src={org.logoDataUrl} alt="" className="h-11 w-11 rounded-lg object-contain" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#121211] text-sm font-semibold text-white">{org.name.slice(0, 2).toUpperCase()}</span>}
            <div className="min-w-0 text-[12px] leading-5 text-[#78776f]">
              <p className="text-[15px] font-semibold text-[#121211]">{org.legalName || org.name}</p>
              <p>{org.taxId ? `NIF ${org.taxId}` : <span className="text-[#b45309]">NIF pendiente (Ajustes → Empresa)</span>}</p>
              {org.address && <p>{org.address}</p>}
              {(org.postalCode || org.city) && <p>{[org.postalCode, org.city].filter(Boolean).join(" ")}</p>}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[26px] font-semibold leading-none tracking-[-0.03em]">Factura</p>
            <p className="mt-2 font-mono text-[13px] font-medium text-[#3646f5]">{invoiceLabel(inv)}</p>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5 text-[12px] sm:justify-end">
              <dt className="text-[#78776f]">Emisión</dt><dd className="num">{inv.issueDate ? formatDate(inv.issueDate) : "—"}</dd>
              {inv.dueDate && <><dt className="text-[#78776f]">Vencimiento</dt><dd className="num">{formatDate(inv.dueDate)}</dd></>}
              {inv.servicePeriodStart && <><dt className="text-[#78776f]">Periodo</dt><dd className="num">{formatDate(inv.servicePeriodStart)} – {inv.servicePeriodEnd ? formatDate(inv.servicePeriodEnd) : ""}</dd></>}
            </dl>
          </div>
        </header>

        <div className="mt-8 grid gap-6 border-t border-[#e7e6e1] pt-6 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a8983]">Facturar a</p>
            <p className="mt-1.5 text-[14px] font-semibold">{inv.customerName ?? <span className="text-[#b45309]">Sin destinatario</span>}</p>
            <p className="text-[12px] leading-5 text-[#78776f]">{inv.customerTaxId ? `NIF ${inv.customerTaxId}` : "Sin NIF"}</p>
            {inv.customerAddress && <p className="text-[12px] leading-5 text-[#78776f]">{inv.customerAddress}</p>}
          </div>
          {inv.concept && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a8983]">Concepto</p>
              <p className="mt-1.5 text-[13px]">{inv.concept}</p>
            </div>
          )}
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[460px] text-[12.5px]">
            <thead>
              <tr className="border-b border-[#d6d5cf] text-left text-[10.5px] uppercase tracking-[0.06em] text-[#8a8983]">
                <th className="py-2 pr-3 font-semibold">Descripción</th>
                <th className="py-2 pr-3 text-right font-semibold">Cant.</th>
                <th className="py-2 pr-3 text-right font-semibold">Precio</th>
                <th className="py-2 pr-3 text-right font-semibold">IVA</th>
                <th className="py-2 text-right font-semibold">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-[#efeee9] align-top">
                  <td className="py-2.5 pr-3">
                    {it.description}
                    {!!it.discount && <span className="block text-[11px] text-[#78776f]">Descuento −{formatMoney(it.discount)}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right num">{Number(it.quantity).toLocaleString("es-ES")}</td>
                  <td className="py-2.5 pr-3 text-right num">{formatMoney(it.unitPrice)}</td>
                  <td className="py-2.5 pr-3 text-right num text-[#78776f]">{formatRate(it.taxRateBp)}</td>
                  <td className="py-2.5 text-right font-medium num">{formatMoney(it.total)}</td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={5} className="py-6 text-center text-[#8a8983]">{inv.status === "draft" ? "Añade líneas a la factura" : inv.concept ?? "Sin detalle de líneas"}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <dl className="w-full max-w-[300px] text-[12.5px]">
            {[...byRate].sort((a, b) => b[0] - a[0]).map(([rate, v]) => (
              <div key={rate} className="flex justify-between py-1 text-[#78776f]"><dt>Base {formatRate(rate)} · IVA {formatMoney(v.tax)}</dt><dd className="num">{formatMoney(v.base)}</dd></div>
            ))}
            {!items.length && <div className="flex justify-between py-1 text-[#78776f]"><dt>Base imponible · IVA {formatMoney(inv.taxTotal)}</dt><dd className="num">{formatMoney(inv.subtotal)}</dd></div>}
            {!!inv.discountTotal && <div className="flex justify-between py-1 text-[#78776f]"><dt>Descuentos</dt><dd className="num">−{formatMoney(inv.discountTotal)}</dd></div>}
            <div className="mt-2 flex items-baseline justify-between border-t border-[#d6d5cf] pt-3">
              <dt className="text-[13px] font-semibold">Total</dt>
              <dd className="text-[22px] font-semibold tracking-[-0.02em] num">{formatMoney(inv.total)}</dd>
            </div>
            {inv.amountPaid > 0 && inv.status !== "void" && (
              <>
                <div className="flex justify-between py-1 text-[#16884f]"><dt>Cobrado</dt><dd className="num">{formatMoney(inv.amountPaid)}</dd></div>
                {inv.total - inv.amountPaid > 0 && <div className="flex justify-between py-1 font-semibold"><dt>Pendiente</dt><dd className="num">{formatMoney(inv.total - inv.amountPaid)}</dd></div>}
              </>
            )}
          </dl>
        </div>
        {inv.notes && <p className="mt-8 whitespace-pre-wrap border-t border-[#e7e6e1] pt-4 text-[12px] text-[#4f4e49]">{inv.notes}</p>}
      </div>
    </article>
  );
}
