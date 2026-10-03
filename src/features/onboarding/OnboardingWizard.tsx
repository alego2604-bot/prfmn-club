import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Building2, Check, CreditCard, FileUp, Landmark, MapPin, Package, Rocket, Settings2, SkipForward, Sparkles, Tags, Users, type LucideIcon,
} from "lucide-react";
import { useCtx, useSession, useTeam, useWorkspace } from "@/app/session";
import { useServerReady } from "@/app/serverCaps";
import { Badge, Button, Card, Field, Input, MoneyInput, Page, ProgressBar, Select, Switch, useToast } from "@/design-system/components";
import { addLocation, setDefaultTaxRate, updateActivityRules, updateOnboarding, updateOrganization, updatePaymentMethod } from "@/data/repos/settings";
import { createProduct } from "@/data/repos/catalog";
import { createPlan } from "@/data/repos/memberships";
import type { OnboardingStep, RoleKey } from "@/domain/types";
import { ROLE_LABELS } from "@/domain/permissions";
import { classifyTaxId } from "@/lib/taxid";
import { formatMoney, formatRate } from "@/lib/money";
import { cn } from "@/lib/cn";

interface StepDef { key: OnboardingStep; title: string; short: string; icon: LucideIcon; optional?: boolean; description: string }
export const ONBOARDING_STEPS: StepDef[] = [
  { key: "company", title: "Tu empresa", short: "Empresa", icon: Building2, description: "Nombre comercial con el que te verán tus clientes y tu equipo." },
  { key: "fiscal", title: "Datos fiscales", short: "Datos fiscales", icon: Landmark, description: "Razón social, NIF y dirección: aparecen en tus facturas." },
  { key: "locations", title: "Centros", short: "Centros", icon: MapPin, description: "Cada centro tiene su caja, sus ventas y sus informes." },
  { key: "team", title: "Equipo", short: "Equipo", icon: Users, optional: true, description: "Invita a quien trabaja contigo con el rol adecuado." },
  { key: "payments", title: "Métodos de pago", short: "Cobros", icon: CreditCard, description: "Activa solo los que usas: aparecerán en Caja y en los cobros." },
  { key: "products", title: "Productos y servicios", short: "Productos", icon: Package, optional: true, description: "Lo que vendes en Caja. Puedes crear unos pocos ahora o importarlos." },
  { key: "memberships", title: "Tarifas de membresía", short: "Membresías", icon: Tags, optional: true, description: "Cuotas recurrentes, bonos o pruebas, con su precio." },
  { key: "settings", title: "Configuración", short: "Configuración", icon: Settings2, description: "IVA por defecto y cómo trabajas con la caja." },
  { key: "import", title: "Importar datos", short: "Importar", icon: FileUp, optional: true, description: "Trae tu histórico desde Excel o CSV: ventas, facturas y clientes." },
  { key: "start", title: "¡Listo para empezar!", short: "Empezar", icon: Rocket, description: "Todo preparado. Elige por dónde empezar." },
];

/** Paso completado automáticamente por lo que ya existe en la empresa (o marcado a mano). */
export function useOnboardingProgress() {
  const ws = useWorkspace();
  const team = useTeam();
  const ob = ws.settings.onboarding ?? {};
  const auto: Partial<Record<OnboardingStep, boolean>> = {
    company: !!ws.organization.name,
    fiscal: !!ws.organization.taxId && !!ws.organization.legalName && !!ws.organization.address,
    team: team.length > 1,
    products: ws.products.length > 0,
    memberships: ws.membershipPlans.length > 0,
    import: ws.imports.some((i) => i.status === "completed"),
  };
  const status = (k: OnboardingStep): "done" | "skipped" | "todo" => ((ob.done ?? []).includes(k) || auto[k] ? "done" : (ob.skipped ?? []).includes(k) ? "skipped" : "todo");
  const doneCount = ONBOARDING_STEPS.filter((s) => s.key !== "start" && status(s.key) !== "todo").length;
  return { status, doneCount, total: ONBOARDING_STEPS.length - 1, finished: !!ob.completedAt, dismissed: !!ob.dismissedAt };
}

export default function OnboardingWizard() {
  const ws = useWorkspace();
  const ctx = useCtx();
  const navigate = useNavigate();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const serverReady = useServerReady();
  const progress = useOnboardingProgress();
  const firstTodo = ONBOARDING_STEPS.find((s) => progress.status(s.key) === "todo")?.key ?? "start";
  const stepKey = (params.get("paso") as OnboardingStep) || firstTodo;
  const idx = Math.max(0, ONBOARDING_STEPS.findIndex((s) => s.key === stepKey));
  const step = ONBOARDING_STEPS[idx]!;
  const go = (k: OnboardingStep) => setParams({ paso: k }, { replace: true });
  const next = () => go(ONBOARDING_STEPS[Math.min(idx + 1, ONBOARDING_STEPS.length - 1)]!.key);
  const markDone = () => { try { updateOnboarding(ctx, { done: step.key }); } catch { /* sin permiso: solo navegación */ } next(); };
  const skip = () => { try { updateOnboarding(ctx, { skipped: step.key }); } catch { /* idem */ } next(); };

  if (!can("settings.manage")) {
    return <Page><Card className="mx-auto max-w-lg text-center"><p className="font-semibold">La puesta en marcha la hace quien administra la empresa</p><p className="mt-1 text-sm text-fg-3">Tu rol puede trabajar con normalidad; pide a un administrador que complete la configuración.</p><Button className="mt-4" onClick={() => navigate("/")}>Ir al resumen</Button></Card></Page>;
  }

  return (
    <Page wide>
      <section className="surface-card relative mb-6 overflow-hidden rounded-2xl p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-accent-fg"><Sparkles className="h-4 w-4" />Puesta en marcha</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] sm:text-[28px]">Prepara {ws.organization.name}</h1>
            <p className="mt-1 max-w-xl text-sm text-fg-3">Unos minutos y tu empresa queda lista para vender, cobrar y facturar. Se guarda solo: puedes salir y volver cuando quieras.</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="figure text-4xl leading-none num">{Math.round((progress.doneCount / progress.total) * 100)}<span className="text-xl text-fg-3"> %</span></p>
            <p className="mt-1.5 text-sm text-fg-3">{progress.doneCount} de {progress.total} pasos</p>
            <Button variant="ghost" size="sm" className="-mr-2.5 mt-1" onClick={() => { try { updateOnboarding(ctx, { dismiss: true }); } catch { /* */ } navigate("/"); }}>Terminar más tarde</Button>
          </div>
        </div>
        <ProgressBar value={progress.doneCount} max={progress.total} tone={progress.doneCount >= progress.total ? "success" : "accent"} className="relative mt-4 h-2" label="Progreso de la puesta en marcha" />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Pasos" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <ol className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
            {ONBOARDING_STEPS.map((s, i) => {
              const st = progress.status(s.key);
              const active = s.key === step.key;
              return (
                <li key={s.key} className="shrink-0">
                  <button type="button" onClick={() => go(s.key)} aria-current={active ? "step" : undefined}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors", active ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-line" : "text-fg-2 hover:bg-surface-sunken")}>
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold num", st === "done" ? "bg-success text-white" : active ? "bg-ink text-fg-inverse" : st === "skipped" ? "bg-surface-sunken text-fg-3 line-through" : "border border-line-strong text-fg-3")}>
                      {st === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="whitespace-nowrap lg:flex-1">{s.short}</span>
                    {st === "skipped" && <span className="hidden text-2xs text-fg-3 lg:inline">Omitido</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="min-w-0 p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><step.icon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg-3">{idx + 1 < ONBOARDING_STEPS.length ? `Paso ${idx + 1} de ${progress.total}` : "Último paso"}{step.optional ? " · opcional" : ""}</p>
              <h2 className="text-xl font-semibold tracking-tight">{step.title}</h2>
              <p className="mt-0.5 text-sm text-fg-3">{step.description}</p>
            </div>
          </div>
          {!serverReady && step.key === "memberships" && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-fg">Las tarifas necesitan la actualización 0900 del servidor.</p>}
          <StepBody k={step.key} onDone={markDone} onSkip={skip} done={progress.status(step.key) === "done"} />
        </Card>
      </div>
    </Page>
  );
}

function Footer({ onDone, onSkip, optional, primary = "Guardar y continuar", disabled, extra }: { onDone: () => void; onSkip?: () => void; optional?: boolean; primary?: string; disabled?: boolean; extra?: ReactNode }) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
      <div className="text-xs text-fg-3">{extra ?? (disabled ? "Completa los campos obligatorios (*) para continuar." : null)}</div>
      <div className="flex gap-2">
        {optional && onSkip && <Button variant="ghost" icon={SkipForward} onClick={onSkip}>Omitir por ahora</Button>}
        <Button variant="primary" iconRight={ArrowRight} disabled={disabled} onClick={onDone}>{primary}</Button>
      </div>
    </div>
  );
}

function StepBody({ k, onDone, onSkip, done }: { k: OnboardingStep; onDone: () => void; onSkip: () => void; done: boolean }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const session = useSession();
  const team = useTeam();
  const ready = useServerReady();
  const org = ws.organization;
  const [f, setF] = useState({ name: org.name, legalName: org.legalName ?? "", taxId: org.taxId ?? "", address: org.address ?? "", postalCode: org.postalCode ?? "", city: org.city ?? "", email: org.email ?? "", phone: org.phone ?? "" });
  const [loc, setLoc] = useState({ name: "", city: "" });
  const [inv, setInv] = useState({ email: "", role: "employee" as RoleKey });
  const [prod, setProd] = useState({ name: "", price: 0 as number | null, taxRateBp: ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100 });
  const [plan, setPlan] = useState({ name: "", price: 0 as number | null, billingPeriod: "month" as "month" | "quarter" | "year" });
  const tax = useMemo(() => classifyTaxId(f.taxId), [f.taxId]);
  const run = (fn: () => void, ok?: string) => { try { fn(); if (ok) toast.success(ok); return true; } catch (e) { toast.fromError(e); return false; } };

  switch (k) {
    case "company":
      return (
        <>
          <Field label="Nombre comercial" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <p className="mt-3 text-sm text-fg-3">Sector: <Badge>{org.vertical}</Badge> · Moneda {org.currency} · Zona horaria {org.timezone}</p>
          <Footer onDone={() => run(() => updateOrganization(ctx, { name: f.name })) && onDone()} disabled={!f.name.trim()} />
        </>
      );
    case "fiscal":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social" required className="sm:col-span-2"><Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} placeholder="Ej. Mi Empresa S.L." /></Field>
            <Field label="NIF / CIF" required error={f.taxId && tax.kind !== "empty" && !tax.valid ? "No parece un NIF/CIF válido" : null}><Input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></Field>
            <Field label="Email de facturación"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Dirección fiscal" required className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Código postal"><Input value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} /></Field>
            <Field label="Ciudad"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="Teléfono"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Footer optional onSkip={onSkip} onDone={() => run(() => updateOrganization(ctx, { legalName: f.legalName || undefined, taxId: f.taxId || undefined, address: f.address || undefined, postalCode: f.postalCode || undefined, city: f.city || undefined, email: f.email || undefined, phone: f.phone || undefined }), "Datos fiscales guardados") && onDone()}  disabled={!f.legalName.trim() || !f.taxId.trim() || !f.address.trim() || (tax.kind !== "empty" && !tax.valid)}/>
        </>
      );
    case "locations":
      return (
        <>
          <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
            {ws.locations.filter((l) => l.status !== "archived").map((l) => (
              <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm"><span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-fg-3" /><span className="font-medium">{l.name}</span>{l.city && <span className="text-fg-3">· {l.city}</span>}</span><Badge tone={l.status === "active" ? "success" : "neutral"} dot>{l.status === "active" ? "Activo" : "Inactivo"}</Badge></li>
            ))}
          </ul>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (run(() => addLocation(ctx, loc.name, loc.city), "Centro añadido")) setLoc({ name: "", city: "" }); }}>
            <Field label="Nuevo centro" className="min-w-[180px] flex-1"><Input value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} placeholder="Ej. Centro Sur" /></Field>
            <Field label="Ciudad" className="w-40"><Input value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} /></Field>
            <Button type="submit" disabled={!loc.name.trim()}>Añadir</Button>
          </form>
          <Footer onDone={onDone} primary={ws.locations.length > 1 ? "Continuar" : "Solo tengo este centro"} />
        </>
      );
    case "team":
      return (
        <>
          <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
            {team.map((m) => <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm"><span className="font-medium">{m.fullName ?? m.email ?? "Usuario"}</span><Badge>{ROLE_LABELS[m.role].name}</Badge></li>)}
          </ul>
          {session.mode === "local" ? (
            <p className="text-sm text-fg-3">En este modo sin servidor, el equipo se gestiona con contraseña propia en <Link className="font-medium text-accent-fg hover:underline" to="/ajustes?tab=equipo">Ajustes → Equipo</Link>.</p>
          ) : (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); try { await session.addMember({ fullName: inv.email.split("@")[0]!, email: inv.email, password: crypto.randomUUID(), role: inv.role, locationIds: null }); toast.success("Persona añadida al equipo"); setInv({ ...inv, email: "" }); } catch (err) { toast.fromError(err); } }}>
            <Field label="Email" className="min-w-[220px] flex-1" hint={session.mode === "cloud" ? "Debe tener ya cuenta en Business OS" : undefined}><Input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="Rol" className="w-48"><Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as RoleKey })}>{(Object.keys(ROLE_LABELS) as RoleKey[]).filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r].name} · {ROLE_LABELS[r].description}</option>)}</Select></Field>
            <Button type="submit" disabled={!inv.email.includes("@")}>Añadir</Button>
          </form>
          )}
          <Footer optional onSkip={onSkip} onDone={onDone} primary="Continuar" />
        </>
      );
    case "payments":
      return (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {ws.paymentMethods.filter((m) => m.kind !== "unknown").map((m) => (
              <div key={m.id} className="rounded-xl border border-line px-4 py-3">
                <Switch checked={m.status === "active"} onChange={(v) => run(() => updatePaymentMethod(ctx, m.id, { status: v ? "active" : "inactive" }))} label={m.name} description={m.affectsCashDrawer ? "Cuenta en el arqueo de caja" : undefined} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-fg-3">«Pendiente de cobro» no es un método: es el estado de una factura sin cobrar.</p>
          <Footer onDone={onDone} primary="Continuar" />
        </>
      );
    case "products":
      return (
        <>
          {ws.products.length > 0 && <p className="mb-4 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-fg">Ya tienes {ws.products.length} productos en el catálogo.</p>}
          <form className="grid gap-3 sm:grid-cols-[1fr_140px_140px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (run(() => createProduct(ctx, { name: prod.name, categoryId: null, kind: "service", price: prod.price ?? 0, taxRateBp: prod.taxRateBp, trackStock: false, posVisible: true }), "Producto creado")) setProd({ ...prod, name: "", price: 0 }); }}>
            <Field label="Producto o servicio"><Input value={prod.name} onChange={(e) => setProd({ ...prod, name: e.target.value })} placeholder="Ej. Sesión individual" /></Field>
            <Field label="Precio (IVA incl.)"><MoneyInput value={prod.price} onChange={(v) => setProd({ ...prod, price: v })} /></Field>
            <Field label="IVA"><Select value={prod.taxRateBp} onChange={(e) => setProd({ ...prod, taxRateBp: Number(e.target.value) })}>{ws.taxRates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.rateBp}>{formatRate(t.rateBp)}</option>)}</Select></Field>
            <Button type="submit" disabled={!prod.name.trim() || !prod.price}>Añadir</Button>
          </form>
          <p className="mt-3 text-sm text-fg-3">¿Muchos productos? <Link className="font-medium text-accent-fg hover:underline" to="/catalogo">Gestiona el catálogo completo</Link> o impórtalo desde Excel en el paso 9.</p>
          <Footer optional onSkip={onSkip} onDone={onDone} primary="Continuar" />
        </>
      );
    case "memberships":
      return (
        <>
          {ws.membershipPlans.length > 0 && <ul className="mb-4 divide-y divide-line rounded-xl border border-line">{ws.membershipPlans.map((p) => <li key={p.id} className="px-4 py-2.5 text-sm font-medium">{p.name}</li>)}</ul>}
          <form className="grid gap-3 sm:grid-cols-[1fr_140px_140px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (run(() => createPlan(ctx, { name: plan.name, kind: "recurring", billingPeriod: plan.billingPeriod, price: plan.price ?? 0, taxRateBp: ws.taxRates.find((t) => t.isDefault)?.rateBp ?? 2100, openToNew: true }), "Tarifa creada")) setPlan({ ...plan, name: "", price: 0 }); }}>
            <Field label="Tarifa"><Input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} placeholder="Ej. Mensual ilimitada" /></Field>
            <Field label="Precio (IVA incl.)"><MoneyInput value={plan.price} onChange={(v) => setPlan({ ...plan, price: v })} /></Field>
            <Field label="Cada"><Select value={plan.billingPeriod} onChange={(e) => setPlan({ ...plan, billingPeriod: e.target.value as "month" })}><option value="month">Mes</option><option value="quarter">Trimestre</option><option value="year">Año</option></Select></Field>
            <Button type="submit" disabled={!ready || !plan.name.trim() || !plan.price}>Añadir</Button>
          </form>
          <Footer optional onSkip={onSkip} onDone={onDone} primary="Continuar" />
        </>
      );
    case "settings": {
      const def = ws.taxRates.find((t) => t.isDefault);
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IVA por defecto" hint="Se propone al crear productos y facturas">
              <Select value={def?.id ?? ""} onChange={(e) => run(() => setDefaultTaxRate(ctx, e.target.value), "IVA por defecto actualizado")}>{ws.taxRates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            </Field>
            <div className="rounded-xl border border-line px-4 py-3">
              <Switch checked={ws.settings.requireCashSession} onChange={(v) => run(() => updateActivityRules(ctx, ws.settings.activityRules, v), "Configuración guardada")} label="Abrir caja para vender" description="Obliga a abrir la caja con su fondo antes de cobrar" />
            </div>
          </div>
          <p className="mt-4 text-sm text-fg-3">Serie de facturas: <span className="font-mono text-fg-2">{ws.documentSeries.find((s) => s.documentType === "invoice" && s.status === "active")?.prefix ?? "—"}00001</span> · numeración correlativa sin huecos, asignada al emitir. Ejemplo de cuota: {formatMoney(5500)} con IVA incluido.</p>
          <Footer onDone={onDone} primary="Continuar" />
        </>
      );
    }
    case "import":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["Ventas de caja", "Tickets o resúmenes por día"], ["Facturas emitidas", "Crea clientes y cobros"], ["Clientes", "Altas, contacto y NIF"]].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line p-4"><p className="text-sm font-semibold">{t}</p><p className="mt-1 text-xs text-fg-3">{d}</p></div>
            ))}
          </div>
          <p className="mt-4 text-sm text-fg-3">El asistente analiza el archivo, propone columnas, detecta duplicados y te enseña todo antes de guardar. Se puede revertir.</p>
          <Footer optional onSkip={onSkip} onDone={() => navigate("/importaciones/nueva")} primary="Abrir el asistente de importación" extra={done ? <Badge tone="success" dot>Ya has importado datos</Badge> : null} />
        </>
      );
    case "start":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["/caja", "Hacer la primera venta", "Abre la caja y cobra en segundos"], ["/clientes?nuevo=1", "Dar de alta un cliente", "Con su membresía y primera cuota"], ["/facturas/nueva", "Emitir una factura", "Con numeración de tu serie"], ["/gastos?nuevo=1", "Registrar un gasto", "Para ver tu resultado real"]] as const).map(([to, t, d]) => (
              <Link key={to} to={to} onClick={() => { try { updateOnboarding(ctx, { complete: true, done: "start" }); } catch { /* */ } }} className="group rounded-xl border border-line p-4 transition-colors hover:border-accent hover:bg-accent-soft/40">
                <p className="text-sm font-semibold group-hover:text-accent-fg">{t} →</p>
                <p className="mt-1 text-xs text-fg-3">{d}</p>
              </Link>
            ))}
          </div>
          <Footer onDone={() => { try { updateOnboarding(ctx, { complete: true, done: "start" }); } catch { /* */ } navigate("/"); }} primary="Ir al resumen" />
        </>
      );
  }
}
