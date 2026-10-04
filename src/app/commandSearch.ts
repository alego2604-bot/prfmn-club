import { Contact, FileText, ListTodo, Moon, Package, Plus, Receipt, Rocket, ScrollText, ShoppingBag, Truck, Upload, User, Wallet, type LucideIcon } from "lucide-react";
import type { Permission } from "@/domain/permissions";
import { normalizeKey, saleNo } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { customerName } from "@/data/repos/customers";
import type { Workspace } from "@/data/store";
import { ALL_ITEMS, isPlanned } from "./nav";

/**
 * Paleta ⌘K: acciones, navegación y búsqueda global. Cada categoría de resultado se construye SOLO si la persona tiene el
 * permiso de ver esos datos (no se filtra al abrir el resultado), y las búsquedas por NIF solo valen con customers.sensitive.
 * Es una función pura sobre el workspace ya filtrado por permisos (useWorkspace), para poder probarla sin interfaz.
 */
export interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
  keywords?: string;
  planned?: boolean;
}


export type CanFn = (p: Permission) => boolean;

/** Acciones y navegación disponibles para esta persona (sin búsqueda). */
export function buildEntries(ws: Workspace, can: CanFn, recent: string[]): Entry[] {
  const openSession = ws.cashSessions.some((x) => x.status === "open");
      const pending = ws.invoices.filter((i) => i.status === "issued" || i.status === "partially_paid").length;
      const actions: Entry[] = [
        can("pos.sell") && { id: "a-sale", group: "Acciones", label: "Nueva venta", hint: openSession ? "Caja abierta" : "Abre la caja y vende", icon: Plus, to: "/caja", keywords: "vender tpv cobrar crear venta" },
        can("cash.operate") && !openSession && { id: "a-open", group: "Acciones", label: "Abrir caja", icon: Wallet, to: "/caja", keywords: "fondo turno apertura" },
        can("imports.run") && { id: "a-import", group: "Acciones", label: "Importar datos (Excel / CSV)", icon: Upload, to: "/importaciones/nueva", keywords: "excel csv subir" },
        can("catalog.manage") && { id: "a-product", group: "Acciones", label: "Nuevo producto", icon: Package, to: "/catalogo?nuevo=1" },
        can("customers.manage") && { id: "a-customer", group: "Acciones", label: "Nuevo cliente", icon: User, to: "/clientes?nuevo=1" },
        can("invoices.manage") && { id: "a-invoice", group: "Acciones", label: "Nueva factura", icon: Receipt, to: "/facturas/nueva", keywords: "emitir facturar borrador" },
        can("expenses.manage") && { id: "a-expense", group: "Acciones", label: "Registrar gasto", icon: ScrollText, to: "/gastos?nuevo=1", keywords: "factura proveedor ticket compra pago" },
        can("memberships.manage") && { id: "a-membership", group: "Acciones", label: "Nueva membresía", icon: Contact, to: "/membresias", keywords: "alta cuota tarifa suscripcion socio" },
        can("customers.manage") && { id: "a-task", group: "Acciones", label: "Nueva tarea de seguimiento", icon: ListTodo, to: "/seguimiento", keywords: "recordar llamar pendiente" },
        can("settings.manage") && { id: "a-setup", group: "Acciones", label: "Puesta en marcha de la empresa", icon: Rocket, to: "/bienvenida", keywords: "onboarding configurar empezar" },
        can("cash.operate") && { id: "a-close", group: "Acciones", label: "Cerrar caja", icon: Wallet, to: "/cierres", keywords: "arqueo cuadre" },
        can("analytics.view") && { id: "a-report", group: "Acciones", label: "Generar informe para la gestoría", icon: FileText, to: "/informes/gestoria", keywords: "trimestre q3 exportar excel pdf csv iva" },
        can("finance.view") && pending > 0 && { id: "a-pending", group: "Acciones", label: `Ver ${pending} factura${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"} de cobro`, icon: Receipt, to: "/facturas?estado=pendiente", keywords: "cobrar impagos" },
        { id: "a-theme", group: "Acciones", label: "Cambiar tema claro / oscuro", icon: Moon, to: "#theme", keywords: "dark modo noche apariencia" },
      ].filter(Boolean) as Entry[];
      const visibleNav = ALL_ITEMS.filter((i) => !i.perm || can(i.perm));
      const toEntry = (i: (typeof ALL_ITEMS)[number], group: string): Entry => ({ id: `${group}-${i.to}`, group, label: i.label, hint: isPlanned(i) ? `Próximamente · ${i.description}` : i.description, icon: i.icon, to: i.to, planned: isPlanned(i) });
      const recents = recent.map((to) => visibleNav.find((i) => i.to === to)).filter((i): i is (typeof ALL_ITEMS)[number] => !!i && !isPlanned(i)).slice(0, 4).map((i) => toEntry(i, "Recientes"));
    return [...actions, ...recents, ...visibleNav.map((i) => toEntry(i, "Ir a"))];
}

/** Resultados para el texto buscado. */
export function searchEntries(ws: Workspace, can: CanFn, base: Entry[], q: string, locationIds: string[] | null = null): Entry[] {
  // Documentos de un centro al que la persona no tiene acceso no aparecen (el servidor tampoco se los entrega)
  const inScope = (loc?: string) => !locationIds || !loc || locationIds.includes(loc);
    const nq = normalizeKey(q);
    if (!nq) return base.filter((e) => !e.planned && (e.group !== "Ir a" || !base.some((x) => x.group === "Recientes" && x.to === e.to)));
    const terms = nq.split(" ");
    const match = (s: string) => {
      const t = normalizeKey(s);
      return terms.every((x) => t.includes(x));
    };
    const out: Entry[] = base.filter((e) => e.group !== "Recientes" && match(`${e.label} ${e.keywords ?? ""} ${e.hint ?? ""}`));
    const sensitive = can("customers.sensitive");
    if (can("customers.view")) {
      for (const c of ws.customers) {
        if (c.deletedAt) continue;
        // El NIF solo entra en la búsqueda (y en la pista) con customers.sensitive: buscar un NIF también revelaría que existe
        const tax = sensitive ? c.taxId : undefined;
        if (match(`${customerName(c)} ${tax ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`)) {
          out.push({ id: `c-${c.id}`, group: "Clientes", label: customerName(c), hint: [tax, c.email].filter(Boolean).join(" · "), icon: User, to: `/clientes/${c.id}` });
          if (out.filter((x) => x.group === "Clientes").length >= 6) break;
        }
      }
    }
    if (can("catalog.view")) {
      for (const p of ws.products) {
        if (p.status === "archived") continue;
        if (match(`${p.name} ${p.sku ?? ""}`)) out.push({ id: `p-${p.id}`, group: "Productos", label: p.name, hint: formatMoney(p.price), icon: Package, to: `/catalogo?producto=${p.id}` });
        if (out.filter((x) => x.group === "Productos").length >= 5) break;
      }
    }
    if (can("finance.view")) {
      for (const sp of ws.suppliers) {
        if (sp.status === "archived" || !match(`${sp.name} ${sp.taxId ?? ""} ${sp.email ?? ""}`)) continue;
        out.push({ id: `sp-${sp.id}`, group: "Proveedores", label: sp.name, hint: sp.taxId ?? sp.email, icon: Truck, to: `/proveedores/${sp.id}` });
        if (out.filter((x) => x.group === "Proveedores").length >= 4) break;
      }
      for (const e of ws.expenses) {
        if (e.status === "void" || !inScope(e.locationId) || !match(`${e.description} ${e.supplierInvoiceNumber ?? ""}`)) continue;
        out.push({ id: `e-${e.id}`, group: "Gastos", label: e.description, hint: `${formatDate(e.issueDate)} · ${formatMoney(e.total)}`, icon: ScrollText, to: `/gastos?q=${encodeURIComponent(e.description)}` });
        if (out.filter((x) => x.group === "Gastos").length >= 4) break;
      }
    }
    if (can("customers.view")) {
      for (const pl of ws.membershipPlans) if (pl.status !== "archived" && match(pl.name)) out.push({ id: `pl-${pl.id}`, group: "Tarifas", label: pl.name, hint: "Tarifa de membresía", icon: Contact, to: "/membresias?tab=tarifas" });
    }
    if (can("sales.view")) {
      const num = /^#?(\d+)$/.exec(q.trim());
      if (num) {
        const s = ws.sales.find((x) => x.number === Number(num[1]) && inScope(x.locationId));
        if (s) out.push({ id: `s-${s.id}`, group: "Ventas", label: `Venta ${saleNo(s.number)}`, hint: `${formatDate(s.occurredAt)} · ${formatMoney(s.total)}`, icon: ShoppingBag, to: `/ventas?venta=${s.id}` });
      }
    }
    if (can("finance.view")) {
      for (const i of ws.invoices) {
        if (!inScope(i.locationId)) continue;
        if (match(`${i.number ?? ""} ${i.externalNumber ?? ""} ${i.customerName ?? ""}`)) {
          out.push({ id: `i-${i.id}`, group: "Facturas", label: i.number ?? i.externalNumber ?? "Factura", hint: `${i.customerName ?? ""} · ${formatMoney(i.total)}`, icon: Receipt, to: `/facturas/${i.id}` });
          if (out.filter((x) => x.group === "Facturas").length >= 5) break;
        }
      }
    }
    return out;
}
