import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Building2, Database, Download, History, Plus, ShieldCheck } from "lucide-react";
import { useCtx, useSession, useWorkspace, useTeam } from "@/app/session";
import {
  Avatar, Badge, Button, Callout, Card, CardHeader, DataTable, Field, Input, Modal, Page, PageHeader, Select, Switch, Tabs, useToast, type Column,
} from "@/design-system/components";
import { addLocation, addPaymentMethod, addTaxRate, createInvoiceSeries, setDefaultTaxRate, setLocationStatus, updateActivityRules, updateOrganization, updatePaymentMethod } from "@/data/repos/settings";
import { createExpenseCategory, ensureExpenseCategories, updateExpenseCategory } from "@/data/repos/expenses";
import { useServerReady } from "@/app/serverCaps";
import { ROLE_LABELS } from "@/domain/permissions";
import { hasModule, MODULE_INFO } from "@/domain/modules";
import type { ActivityRule, AuditLog, PaymentKind, RoleKey, Vertical } from "@/domain/types";
import { formatDateTime } from "@/lib/dates";
import { formatRate, NUM } from "@/lib/money";
import { triggerDownload } from "@/lib/export";
import { normalizeKey } from "@/lib/text";

type Tab = "company" | "locations" | "team" | "payments" | "taxes" | "billing" | "expenses" | "rules" | "audit" | "data";

/** Pestañas enlazables desde la navegación (Empresa → Equipo / Centros): ?tab=equipo|centros|… */
const TAB_PARAM: Record<string, Tab> = { empresa: "company", centros: "locations", equipo: "team", pagos: "payments", impuestos: "taxes", facturacion: "billing", gastos: "expenses", reglas: "rules", auditoria: "audit", datos: "data" };
const PARAM_OF = Object.fromEntries(Object.entries(TAB_PARAM).map(([k, v]) => [v, k])) as Record<Tab, string>;

export default function SettingsPage() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const fallback: Tab = can("settings.manage") ? "company" : "audit";
  const tab = TAB_PARAM[params.get("tab") ?? ""] ?? fallback;
  const setTab = (t: Tab) => setParams(t === fallback ? {} : { tab: PARAM_OF[t] }, { replace: true });
  const items: { value: Tab; label: string }[] = [
    ...(can("settings.manage") ? [{ value: "company" as Tab, label: "Empresa" }, { value: "locations" as Tab, label: "Centros" }] : []),
    ...(can("team.manage") ? [{ value: "team" as Tab, label: "Equipo y roles" }] : []),
    ...(can("settings.manage") ? [{ value: "payments" as Tab, label: "Métodos de pago" }, { value: "taxes" as Tab, label: "Impuestos" }, { value: "billing" as Tab, label: "Facturación" }, { value: "expenses" as Tab, label: "Categorías de gasto" }, { value: "rules" as Tab, label: "Reglas" }] : []),
    ...(can("audit.view") ? [{ value: "audit" as Tab, label: "Auditoría" }] : []),
    { value: "data", label: "Datos" },
  ];
  return (
    <Page>
      <PageHeader title="Ajustes" description="Todo lo que cambia con el negocio se configura aquí, sin tocar código. Cada cambio queda en la auditoría." />
      <Tabs className="mb-6" value={tab} onChange={setTab} items={items} />
      {tab === "company" && <CompanyTab />}
      {tab === "locations" && <LocationsTab />}
      {tab === "team" && <TeamTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "taxes" && <TaxesTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "expenses" && <ExpenseCategoriesTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "data" && <DataTab />}
    </Page>
  );
}

function CompanyTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const o = ws.organization;
  const [f, setF] = useState({ name: o.name, legalName: o.legalName ?? "", taxId: o.taxId ?? "", address: o.address ?? "", city: o.city ?? "", postalCode: o.postalCode ?? "", phone: o.phone ?? "", email: o.email ?? "", website: o.website ?? "", vertical: o.vertical, fiscalYearStartMonth: o.fiscalYearStartMonth });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 300_000) return toast.error("Logo demasiado grande", "Máximo 300 KB (PNG/SVG/JPG).");
    const r = new FileReader();
    r.onload = () => { try { updateOrganization(ctx, { logoDataUrl: String(r.result) }); toast.success("Logo actualizado"); } catch (e) { toast.fromError(e); } };
    r.readAsDataURL(file);
  };
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader title="Datos de la empresa" description="Aparecen en las facturas que emites (PDF) y en los informes." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre comercial" required><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Razón social"><Input value={f.legalName} onChange={set("legalName")} /></Field>
          <Field label="CIF / NIF"><Input value={f.taxId} onChange={set("taxId")} /></Field>
          <Field label="Tipo de negocio">
            <Select value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value as Vertical })}>
              {(Object.keys(VERTICAL_LABEL) as Vertical[]).map((v) => <option key={v} value={v}>{VERTICAL_LABEL[v]}</option>)}
            </Select>
          </Field>
          <Field label="Dirección" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
          <Field label="Ciudad"><Input value={f.city} onChange={set("city")} /></Field>
          <Field label="Código postal"><Input value={f.postalCode} onChange={set("postalCode")} /></Field>
          <Field label="Teléfono"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input value={f.email} onChange={set("email")} /></Field>
          <Field label="Web"><Input value={f.website} onChange={set("website")} /></Field>
          <Field label="Inicio del año fiscal">
            <Select value={f.fiscalYearStartMonth} onChange={(e) => setF({ ...f, fiscalYearStartMonth: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, m) => <option key={m} value={m + 1}>{new Date(2000, m, 1).toLocaleDateString("es-ES", { month: "long" })}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => { try { updateOrganization(ctx, { ...f, fiscalYearStartMonth: Number(f.fiscalYearStartMonth) }); toast.success("Datos guardados"); } catch (e) { toast.fromError(e); } }}>Guardar</Button>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <p className="mb-1 text-sm font-semibold">Módulos verticales</p>
          <p className="mb-4 text-xs text-fg-3">El núcleo (ventas, caja, catálogo, clientes, finanzas, datos) es igual para cualquier negocio. Los módulos añaden funciones de un sector.</p>
          <Switch
            checked={hasModule(o, "fitness")}
            onChange={(v) => { try { updateOrganization(ctx, { modules: v ? ["fitness"] : [] }); toast.success(v ? "Módulo Fitness activado" : "Módulo Fitness desactivado"); } catch (e) { toast.fromError(e); } }}
            label={MODULE_INFO.fitness.name}
            description={MODULE_INFO.fitness.description}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Logo" />
        <div className="flex flex-col items-center gap-4">
          {o.logoDataUrl ? <img src={o.logoDataUrl} alt="Logo" className="h-24 w-24 rounded-xl border border-line object-contain" /> : <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-line-strong"><Building2 className="h-8 w-8 text-fg-3" /></div>}
          <label className="cursor-pointer text-sm font-medium text-accent-fg hover:underline">
            Subir logo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
          </label>
          <p className="text-center text-xs text-fg-3">Moneda {o.currency} · Zona {o.timezone} · {o.locale}</p>
        </div>
      </Card>
    </div>
  );
}

function LocationsTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        {ws.locations.map((l) => (
          <div key={l.id} className="flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-0">
            <Building2 className="h-4 w-4 text-fg-3" />
            <div className="flex-1"><p className="text-sm font-medium">{l.name}</p><p className="text-xs text-fg-3">{l.city ?? "—"} · {ws.sales.filter((s) => s.locationId === l.id).length.toLocaleString("es-ES", NUM)} ventas</p></div>
            <Switch checked={l.status === "active"} onChange={(v) => { try { setLocationStatus(ctx, l.id, v ? "active" : "inactive"); } catch (e) { toast.fromError(e); } }} label={l.status === "active" ? "Activo" : "Inactivo"} />
          </div>
        ))}
      </Card>
      <Card>
        <CardHeader title="Añadir centro" description="Cada centro tiene su caja, ventas, stock e informes. La empresa ve el consolidado." />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Girona" /></Field>
          <Field label="Ciudad"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Button variant="primary" icon={Plus} disabled={!name.trim()} onClick={() => { try { addLocation(ctx, name, city); setName(""); setCity(""); toast.success("Centro añadido"); } catch (e) { toast.fromError(e); } }}>Añadir</Button>
        </div>
      </Card>
    </div>
  );
}

function TeamTab() {
  const ws = useWorkspace();
  const { member: me, mode, addMember, updateMember } = useSession();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ fullName: "", email: "", password: "", role: "employee" as RoleKey, location: "" });
  const members = useTeam();
  return (
    <div className="flex flex-col gap-4">
      <Callout icon={ShieldCheck}>Los permisos se comprueban por capacidades (p. ej. <span className="font-mono text-xs">sales.void</span>), igual que en las políticas RLS de la base de datos. Un empleado puede limitarse a uno o varios centros.</Callout>
      <Card padded={false}>
        <div className="flex items-center justify-between p-5 pb-3">
          <CardHeader className="mb-0" title="Equipo" />
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Añadir persona</Button>
        </div>
        {members.map((m) => {
          const u = { fullName: m.fullName, email: m.email };
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3">
              <Avatar name={u?.fullName ?? "?"} size={32} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{u?.fullName}{m.userId === me?.userId && <span className="ml-2 text-xs text-fg-3">(tú)</span>}</p><p className="truncate text-xs text-fg-3">{u?.email}</p></div>
              <span className="text-xs text-fg-3">{m.locationIds ? m.locationIds.map((id) => ws.locations.find((l) => l.id === id)?.name).join(", ") : "Todos los centros"}</span>
              {m.role === "owner" ? (
                <Badge tone="accent">{ROLE_LABELS.owner.name}</Badge>
              ) : (
                <Select aria-label={`Rol de ${u?.fullName ?? "este miembro"}`} value={m.role} className="w-40" onChange={async (e) => { try { await updateMember(m.id, { role: e.target.value as RoleKey }); toast.success("Rol actualizado"); } catch (err) { toast.fromError(err); } }}>
                  {(Object.keys(ROLE_LABELS) as RoleKey[]).filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r].name}</option>)}
                </Select>
              )}
            </div>
          );
        })}
      </Card>
      <Card>
        <CardHeader title="Roles" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(ROLE_LABELS) as RoleKey[]).map((r) => (
            <div key={r} className="rounded-md border border-line p-3"><p className="text-sm font-medium">{ROLE_LABELS[r].name}</p><p className="text-xs text-fg-3">{ROLE_LABELS[r].description}</p></div>
          ))}
        </div>
      </Card>
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title="Añadir persona al equipo"
          description={mode === "cloud" ? "La persona debe haber creado antes su cuenta en Business OS con ese email. Tendrá acceso inmediato con el rol elegido." : "Modo local: se crea una cuenta en este dispositivo."}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
              <Button variant="primary" onClick={async () => {
                try {
                  await addMember({ ...f, locationIds: f.location ? [f.location] : null });
                  toast.success("Persona añadida");
                  setAdding(false);
                } catch (e) { toast.fromError(e); }
              }}>Añadir</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "local" && <Field label="Nombre"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>}
            <Field label="Email" className={mode === "cloud" ? "sm:col-span-2" : undefined}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            {mode === "local" && <Field label="Contraseña inicial" hint="Mínimo 8 caracteres"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>}
            <Field label="Rol">
              <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as RoleKey })}>
                {(Object.keys(ROLE_LABELS) as RoleKey[]).filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r].name} — {ROLE_LABELS[r].description}</option>)}
              </Select>
            </Field>
            <Field label="Centro" className="sm:col-span-2">
              <Select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
                <option value="">Todos los centros</option>
                {ws.locations.map((l) => <option key={l.id} value={l.id}>Solo {l.name}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", online: "Pago online", transfer: "Transferencia",
  direct_debit: "Domiciliación", voucher: "Vale o bono", other: "Otro", unknown: "Sin especificar",
};

function PaymentsTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PaymentKind>("other");
  const safe = (fn: () => void) => { try { fn(); } catch (e) { toast.fromError(e); } };
  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        {[...ws.paymentMethods].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5 last:border-0">
            <div className="w-full sm:w-64">
              <Input aria-label={`Nombre del método (${PAYMENT_KIND_LABEL[m.kind]})`} defaultValue={m.name} onBlur={(e) => e.target.value !== m.name && safe(() => updatePaymentMethod(ctx, m.id, { name: e.target.value }))} />
            </div>
            {/* El tipo solo aporta si el nombre no lo dice ya («Vale regalo» → tipo «Vale o bono») */}
            {normalizeKey(m.name) !== normalizeKey(PAYMENT_KIND_LABEL[m.kind]) && <Badge>{PAYMENT_KIND_LABEL[m.kind]}</Badge>}
            <div className="flex items-center gap-6 sm:ml-auto">
              <Switch checked={m.affectsCashDrawer} onChange={(v) => safe(() => updatePaymentMethod(ctx, m.id, { affectsCashDrawer: v }))} label="Cuenta en el cajón" />
              <Switch checked={m.status === "active"} onChange={(v) => safe(() => updatePaymentMethod(ctx, m.id, { status: v ? "active" : "inactive" }))} label="Activo" />
            </div>
          </div>
        ))}
      </Card>
      <Card>
        <CardHeader title="Nuevo método" />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vale regalo" /></Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)} className="w-40">
              {(Object.keys(PAYMENT_KIND_LABEL) as Exclude<PaymentKind, "unknown">[]).map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Button variant="primary" icon={Plus} disabled={!name.trim()} onClick={() => safe(() => { addPaymentMethod(ctx, name, kind); setName(""); toast.success("Método añadido"); })}>Añadir</Button>
        </div>
      </Card>
    </div>
  );
}

function TaxesTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="warning">Los tipos asignados a cada producto o servicio deben validarse con tu asesoría fiscal.</Callout>
      <Card padded={false}>
        {ws.taxRates.map((t) => (
          <div key={t.id} className="flex items-center gap-4 border-b border-line px-5 py-3 last:border-0">
            <span className="flex-1 text-sm font-medium">{t.name}</span>
            <span className="text-sm num">{formatRate(t.rateBp)}</span>
            <span className="text-xs text-fg-3">{ws.products.filter((p) => p.taxRateBp === t.rateBp && p.status !== "archived").length} productos</span>
            {t.isDefault ? <Badge tone="accent">Por defecto</Badge> : <Button size="sm" variant="ghost" onClick={() => { try { setDefaultTaxRate(ctx, t.id); } catch (e) { toast.fromError(e); } }}>Hacer por defecto</Button>}
          </div>
        ))}
      </Card>
      <Card>
        <CardHeader title="Nuevo tipo" />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="IGIC 7 %" /></Field>
          <Field label="Porcentaje"><Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="7" className="w-24" /></Field>
          <Button variant="primary" icon={Plus} onClick={() => { try { addTaxRate(ctx, name, Math.round(Number(rate.replace(",", ".")) * 100)); setName(""); setRate(""); toast.success("Tipo añadido"); } catch (e) { toast.fromError(e); } }}>Añadir</Button>
        </div>
      </Card>
    </div>
  );
}

function RulesTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const [rules, setRules] = useState<ActivityRule[]>(ws.settings.activityRules);
  const [requireCash, setRequireCash] = useState(ws.settings.requireCashSession);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Reglas de actividad de clientes" description="Definen los estados de Seguimiento (Activo, Baja actividad, En riesgo, Inactivo) según los días sin venir. Se aplicarán al importar asistencia." />
        <div className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_100px_100px] items-end gap-3">
              <Field label={i === 0 ? "Estado" : undefined}><Input value={r.label} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label={i === 0 ? "Desde (días)" : undefined}><Input type="number" className="num" value={r.minDays ?? ""} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, minDays: e.target.value === "" ? undefined : Number(e.target.value) } : x)))} /></Field>
              <Field label={i === 0 ? "Hasta (días)" : undefined}><Input type="number" className="num" value={r.maxDays ?? ""} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, maxDays: e.target.value === "" ? undefined : Number(e.target.value) } : x)))} /></Field>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Switch checked={requireCash} onChange={setRequireCash} label="Exigir caja abierta para vender" description="Recomendado: toda venta queda asignada a un turno y entra en su cierre." />
      </Card>
      <div className="flex justify-end"><Button variant="primary" onClick={() => { try { updateActivityRules(ctx, rules, requireCash); toast.success("Reglas guardadas"); } catch (e) { toast.fromError(e); } }}>Guardar</Button></div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  insert: "Creó", update: "Editó", price_change: "Cambió precio", archive: "Archivó", deactivate: "Desactivó", activate: "Activó", void: "Anuló",
  open: "Abrió caja", close: "Cerró caja", reopen: "Reabrió caja", cash_in: "Entrada de caja", cash_out: "Salida de caja", import: "Importó", revert: "Revirtió", note: "Añadió nota", payment: "Registró cobro",
};
const ENTITY_LABEL: Record<string, string> = {
  products: "Producto", product_categories: "Categoría", sales: "Venta", cash_sessions: "Caja", cash_closings: "Cierre", cash_movements: "Movimiento de caja",
  customers: "Cliente", invoices: "Factura", imports: "Importación", organizations: "Empresa", locations: "Centro", payment_methods: "Método de pago", tax_rates: "IVA", organization_settings: "Configuración",
};

function fmtVal(v: unknown, key: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number" && ["price", "cost", "total"].includes(key)) return `${(v / 100).toFixed(2).replace(".", ",")} €`;
  if (typeof v === "number" && key === "taxRateBp") return formatRate(v);
  return String(v).slice(0, 60);
}

function AuditTab() {
  const ws = useWorkspace();
  const columns: Column<AuditLog>[] = [
    { id: "date", header: "Fecha", sortValue: (l) => l.createdAt, exportValue: (l) => new Date(l.createdAt), exportFormat: "datetime", cell: (l) => <span className="whitespace-nowrap text-fg-2">{formatDateTime(l.createdAt)}</span> },
    { id: "actor", header: "Usuario", exportValue: (l) => l.actorName ?? "", cell: (l) => l.actorName },
    { id: "action", header: "Acción", exportValue: (l) => ACTION_LABEL[l.action] ?? l.action, cell: (l) => <Badge tone={l.action === "void" || l.action === "revert" ? "danger" : l.action === "price_change" ? "warning" : "neutral"}>{ACTION_LABEL[l.action] ?? l.action}</Badge> },
    { id: "entity", header: "Elemento", exportValue: (l) => `${ENTITY_LABEL[l.entityType] ?? l.entityType}: ${l.entityLabel ?? ""}`, cell: (l) => <span><span className="text-fg-3">{ENTITY_LABEL[l.entityType] ?? l.entityType} · </span>{l.entityLabel}</span> },
    {
      id: "changes", header: "Cambios", exportValue: (l) => JSON.stringify(l.changes ?? l.context ?? ""),
      cell: (l) => (
        <span className="text-xs text-fg-3">
          {l.changes ? Object.entries(l.changes).slice(0, 3).map(([k, v]) => <span key={k} className="block">{k}: {fmtVal(v.from, k)} → <span className="text-fg">{fmtVal(v.to, k)}</span></span>) : typeof l.context?.reason === "string" ? `«${l.context.reason}»` : ""}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={[...ws.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      columns={columns}
      getRowId={(l) => l.id}
      searchText={(l) => `${l.actorName} ${l.action} ${ACTION_LABEL[l.action] ?? ""} ${l.entityLabel ?? ""} ${ENTITY_LABEL[l.entityType] ?? ""}`}
      searchPlaceholder="Buscar usuario, acción o elemento…"
      exportName="Auditoria"
      exportCompany={ws.organization.name}
      empty={{ icon: History, title: "Sin actividad registrada" }}
    />
  );
}

function DataTab() {
  const ws = useWorkspace();
  const { store, can } = useSession();
  const counts: [string, number][] = [
    ["Productos", ws.products.length], ["Ventas", ws.sales.length], ["Líneas de venta", ws.saleItems.length], ["Pagos", ws.payments.length], ["Facturas", ws.invoices.length],
    ["Clientes", ws.customers.length], ["Cierres", ws.cashClosings.length], ["Importaciones", ws.imports.length], ["Registros de auditoría", ws.auditLogs.length],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Almacenamiento" description="Modo local: los datos viven en este navegador (IndexedDB), aislados por empresa." />
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {counts.map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-fg-3">{k}</span><span className="font-medium num">{v.toLocaleString("es-ES", NUM)}</span></div>)}
        </div>
        <Callout className="mt-5" tone="warning" icon={Database} title="Haz copias de seguridad">
          Hasta conectar el servidor (Supabase), borrar los datos del navegador borraría la empresa. Descarga una copia periódicamente.
        </Callout>
      </Card>
      <Card>
        <CardHeader title="Copia de seguridad" description="Exporta toda la empresa en JSON (mismo modelo que la base de datos SQL)." />
        <Button variant="primary" icon={Download} disabled={!can("settings.manage")} onClick={async () => triggerDownload(new Blob([await store.exportWorkspaceJson()], { type: "application/json" }), `backup_${ws.organization.name.replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`)}>
          Descargar copia (.json)
        </Button>
        <p className="mt-4 text-xs text-fg-3">Plan de plataforma: Starter (sin facturación SaaS activa). Arquitectura preparada para Starter · Pro · Business.</p>
      </Card>
    </div>
  );
}

const VERTICAL_LABEL: Record<Vertical, string> = {
  fitness: "Fitness / Box", gym: "Gimnasio", functional_training: "Entrenamiento funcional / híbrido", restaurant: "Restauración",
  retail: "Comercio / retail", services: "Servicios", beauty: "Estética", clinic: "Clínica", other: "Otro",
};


/** Series de numeración: una por año (F2026-, F2027-…). El correlativo lo lleva el servidor, sin huecos. */
function BillingTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const ready = useServerReady();
  const next = new Date().getFullYear() + (ws.documentSeries.some((s) => s.year === new Date().getFullYear() && s.documentType === "invoice") ? 1 : 0);
  const [year, setYear] = useState(next);
  const [prefix, setPrefix] = useState(`F${next}-`);
  const issued = (id: string) => ws.invoices.filter((i) => i.seriesId === id && i.status !== "draft").length;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card padded={false}>
        <div className="p-5 pb-3"><CardHeader className="mb-0" title="Series de facturación" description="El número se asigna al emitir, correlativo y sin huecos. Una serie emitida no se borra." /></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm">
          <thead><tr className="border-y border-line bg-surface-2 text-xs text-fg-3"><th className="px-5 py-2 text-left font-medium">Serie</th><th className="px-3 py-2 text-left font-medium">Tipo</th><th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Año</th><th className="px-3 py-2 text-right font-medium">Siguiente</th><th className="px-5 py-2 text-right font-medium">Emitidas</th></tr></thead>
          <tbody>
            {ws.documentSeries.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-mono font-medium">{s.prefix}</td>
                <td className="px-3 py-3 text-fg-2">{{ invoice: "Factura", simplified_invoice: "Simplificada", credit_note: "Rectificativa", sale_ticket: "Ticket" }[s.documentType]}</td>
                <td className="hidden px-3 py-3 text-fg-2 sm:table-cell">{s.year ?? "Sin reinicio"}</td>
                <td className="px-3 py-3 text-right font-mono text-fg-2">{s.prefix}{String(s.nextNumber).padStart(s.padding, "0")}</td>
                <td className="px-5 py-3 text-right num">{issued(s.id)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="border-t border-line px-5 py-3 text-xs text-fg-3">Rectificativas, retenciones (IRPF) y envío a la AEAT (Verifactu) se activarán tras validarlos con tu asesoría: el modelo ya lo admite.</p>
      </Card>
      <Card>
        <CardHeader title="Nueva serie" description="Al empezar un año nuevo o para separar actividades." />
        <div className="grid gap-3">
          <Field label="Año"><Input type="number" value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); setPrefix(`F${y}-`); }} /></Field>
          <Field label="Prefijo" hint={`Primera factura: ${prefix}00001`}><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
          <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => { try { createInvoiceSeries(ctx, { year, prefix }); toast.success("Serie creada", prefix); } catch (e) { toast.fromError(e); } }}>Crear serie</Button>
        </div>
      </Card>
    </div>
  );
}

function ExpenseCategoriesTab() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const ready = useServerReady();
  const [name, setName] = useState("");
  const [rate, setRate] = useState(2100);
  const count = (id: string) => ws.expenses.filter((e) => e.categoryId === id && e.status !== "void").length;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card padded={false}>
        <div className="p-5 pb-3"><CardHeader className="mb-0" title="Categorías de gasto" description="Son datos de tu empresa: renómbralas, archívalas o crea las tuyas. El IVA es solo la propuesta del formulario." /></div>
        {ws.expenseCategories.length ? (
          <ul>
            {ws.expenseCategories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-t border-line px-5 py-2.5 text-sm">
                <span className={c.status === "archived" ? "flex-1 text-fg-3 line-through" : "flex-1 font-medium"}>{c.name}</span>
                <span className="text-xs text-fg-3">{c.defaultTaxRateBp !== undefined ? `IVA ${formatRate(c.defaultTaxRateBp)}` : "Sin IVA propuesto"} · {count(c.id)} gastos</span>
                {ready && <Button size="sm" variant="ghost" onClick={() => { try { updateExpenseCategory(ctx, c.id, { status: c.status === "archived" ? "active" : "archived" }); } catch (e) { toast.fromError(e); } }}>{c.status === "archived" ? "Reactivar" : "Archivar"}</Button>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-line p-5 text-sm text-fg-3">Aún no hay categorías. {ready && <button type="button" className="font-medium text-accent-fg hover:underline" onClick={() => { try { ensureExpenseCategories(ctx); toast.success("Categorías sugeridas creadas"); } catch (e) { toast.fromError(e); } }}>Crear las sugeridas</button>}</div>
        )}
      </Card>
      <Card>
        <CardHeader title="Nueva categoría" />
        <div className="grid gap-3">
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Formación" /></Field>
          <Field label="IVA propuesto"><Select value={rate} onChange={(e) => setRate(Number(e.target.value))}>{ws.taxRates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.rateBp}>{formatRate(t.rateBp)}</option>)}</Select></Field>
          <Button variant="primary" icon={Plus} disabled={!ready || !name.trim()} onClick={() => { try { createExpenseCategory(ctx, name, rate); setName(""); toast.success("Categoría creada"); } catch (e) { toast.fromError(e); } }}>Crear categoría</Button>
        </div>
      </Card>
    </div>
  );
}
