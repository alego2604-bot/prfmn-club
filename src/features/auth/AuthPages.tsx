import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Building2, Check, Dumbbell, FlaskConical, HeartPulse, LogOut, Scissors, ShoppingBasket, Sparkles, Store, UtensilsCrossed, Wrench } from "lucide-react";
import { useSession } from "@/app/session";
import { Logo } from "@/app/Logo";
import { Button, Callout, Field, Input, useToast } from "@/design-system/components";
import type { Vertical } from "@/domain/types";
import { cn } from "@/lib/cn";

function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { mode } = useSession();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0e0e0d] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]" />
        <div className="pointer-events-none absolute -right-48 top-1/3 h-[480px] w-[480px] rounded-full bg-[#3646f5] opacity-20 blur-[140px]" />
        <div className="relative flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="9" fill="#fff" />
            <rect x="8" y="8.5" width="9.5" height="6.5" rx="2" fill="#0e0e0d" />
            <rect x="19.5" y="8.5" width="4.5" height="6.5" rx="2" fill="#3646f5" />
            <rect x="8" y="17" width="16" height="6.5" rx="2" fill="#0e0e0d" opacity="0.92" />
          </svg>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Business<span className="font-medium text-white/50"> OS</span></span>
        </div>
        <div className="relative mt-auto max-w-lg">
          {aside ?? (
            <>
              <p className="text-[44px] font-semibold leading-[1.05] tracking-[-0.035em]">El sistema operativo de tu negocio.</p>
              <p className="mt-5 text-[15px] leading-relaxed text-white/60">
                Caja, ventas, clientes, facturación e informes en una única fuente de verdad. Importa tus Excel, valida cada registro y decide con datos reales.
              </p>
              <div className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
                {[
                  ["< 5 s", "por venta en caja"],
                  ["1 clic", "informe para la gestoría"],
                  ["0", "hojas por mes"],
                ].map(([a, b]) => (
                  <div key={b} className="bg-[#0e0e0d] p-4">
                    <p className="text-2xl font-semibold tracking-[-0.03em]">{a}</p>
                    <p className="mt-0.5 text-xs text-white/50">{b}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <p className="relative mt-10 text-xs text-white/35">
          {mode === "cloud" ? "Tus datos se guardan en el espacio de tu empresa, aislados de cualquier otra." : "Modo local · los datos se guardan en este navegador."}
        </p>
      </div>
      <div className="flex items-center justify-center bg-canvas px-5 py-10">
        <div className="w-full max-w-[400px] animate-rise">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthPage() {
  const s = useSession();
  const toast = useToast();
  const hasAccounts = s.mode === "cloud" || s.store.getMeta().users.length > 0;
  const [mode, setMode] = useState<"login" | "register">(hasAccounts ? "login" : "register");
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await s.login(form.email, form.password);
      else {
        const r = await s.register(form);
        if (r.needsConfirmation) {
          setMode("login");
          toast.success("Revisa tu email", "Te hemos enviado un enlace para confirmar la cuenta. Después, inicia sesión.");
        } else toast.success("Cuenta creada", "Ahora crea tu empresa o explora la demo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-3xl font-semibold tracking-[-0.03em]">{mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}</h1>
      <p className="mt-1.5 text-sm text-fg-3">{mode === "login" ? "Accede a tu espacio de trabajo." : "Empieza en menos de un minuto. Sin tarjeta."}</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        {mode === "register" && (
          <Field label="Nombre y apellidos" htmlFor="fullName">
            <Input id="fullName" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Alex Martín" required />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tu@empresa.com" required />
        </Field>
        <Field label="Contraseña" htmlFor="password" hint={mode === "register" ? "Mínimo 8 caracteres." : undefined}>
          <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" size="lg" loading={busy} iconRight={ArrowRight} className="mt-2">
          {mode === "login" ? "Entrar" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-3">
        {mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
        <button type="button" className="font-medium text-accent-fg hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
          {mode === "login" ? "Crear cuenta" : "Inicia sesión"}
        </button>
      </p>
    </AuthLayout>
  );
}

const VERTICALS: { value: Vertical; label: string; icon: typeof Dumbbell; note?: string }[] = [
  { value: "fitness", label: "Fitness / Box", icon: Dumbbell, note: "Membresías, créditos, asistencia" },
  { value: "gym", label: "Gimnasio", icon: HeartPulse },
  { value: "functional_training", label: "Functional / Híbrido", icon: Sparkles },
  { value: "restaurant", label: "Restauración", icon: UtensilsCrossed },
  { value: "retail", label: "Retail", icon: ShoppingBasket },
  { value: "beauty", label: "Estética", icon: Scissors },
  { value: "services", label: "Servicios", icon: Wrench },
  { value: "other", label: "Otro", icon: Store },
];

export function OnboardingPage() {
  const s = useSession();
  const toast = useToast();
  const [step, setStep] = useState<"choose" | "create">(s.memberships.length ? "choose" : "create");
  const [form, setForm] = useState({ name: "", legalName: "", taxId: "", city: "", locationName: "", vertical: "fitness" as Vertical });
  const [busy, setBusy] = useState(false);
  const orgs = s.organizations;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await s.createOrganization({ ...form, locationName: form.locationName || form.city || "Principal" });
      toast.success(`${form.name} está lista`, "Siguiente paso: importa tus Excel o crea tu catálogo.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      aside={
        <>
          <p className="text-3xl font-semibold leading-tight tracking-tight">Una empresa, varios centros, un único sistema.</p>
          <ul className="mt-8 flex flex-col gap-3 text-[15px] text-white/70">
            {["Cada empresa tiene sus datos aislados (usuarios, clientes, ventas, facturas).", "Cada centro tiene su caja, ventas e informes; la empresa ve el consolidado.", "Los datos DEMO viven en una empresa aparte: nunca se mezclan con los reales."].map((t) => (
              <li key={t} className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-[#7d8fff]" />{t}</li>
            ))}
          </ul>
        </>
      }
    >
      {step === "choose" ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Elige empresa</h1>
          <p className="mt-1.5 text-sm text-fg-3">Hola, {s.user?.fullName.split(" ")[0]}. ¿Dónde trabajamos hoy?</p>
          <div className="mt-6 flex flex-col gap-2">
            {orgs.map((o) => (
              <button type="button" key={o.id} onClick={() => s.switchOrganization(o.id)} className="flex items-center gap-3 rounded-lg border border-line p-3.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", o.isDemo ? "bg-warning-soft text-warning-fg" : "bg-accent-soft text-accent-fg")}>
                  {o.isDemo ? <FlaskConical className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">{o.name}</span>
                  <span className="block text-xs text-fg-3">{o.isDemo ? "Datos ficticios" : "Empresa real"}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-fg-3" />
              </button>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={() => setStep("create")}>Crear nueva empresa</Button>
            {!orgs.some((o) => o.isDemo) && (
              <Button size="lg" icon={FlaskConical} loading={busy} onClick={async () => { setBusy(true); try { await s.createDemo(); } catch (e) { toast.fromError(e); } finally { setBusy(false); } }}>
                Explorar con datos de demostración
              </Button>
            )}
            <Button variant="ghost" icon={LogOut} onClick={() => void s.logout()}>Cerrar sesión</Button>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Crea tu empresa</h1>
          <p className="mt-1.5 text-sm text-fg-3">Podrás completar los datos fiscales y añadir centros después.</p>
          <form onSubmit={create} className="mt-6 flex flex-col gap-4">
            <Field label="¿Qué tipo de negocio?">
              <div className="grid grid-cols-2 gap-2">
                {VERTICALS.map((v) => (
                  <button
                    type="button"
                    key={v.value}
                    onClick={() => setForm({ ...form, vertical: v.value })}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-all",
                      form.vertical === v.value ? "border-accent bg-accent-soft text-accent-fg ring-1 ring-accent" : "border-line hover:border-line-strong",
                    )}
                  >
                    <v.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate font-medium">{v.label}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Nombre comercial" required htmlFor="orgName">
              <Input id="orgName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi Empresa" required autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Razón social" htmlFor="legal"><Input id="legal" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
              <Field label="CIF / NIF" htmlFor="tax"><Input id="tax" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ciudad" htmlFor="city"><Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Barcelona" /></Field>
              <Field label="Primer centro" htmlFor="loc"><Input id="loc" value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })} placeholder={form.city || "Principal"} /></Field>
            </div>
            <Button type="submit" variant="primary" size="lg" loading={busy} iconRight={ArrowRight} className="mt-2">Crear empresa</Button>
          </form>
          <div className="relative my-6 text-center text-xs text-fg-3">
            <span className="relative z-10 bg-surface px-2">o</span>
            <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
          </div>
          <Button size="lg" className="w-full" icon={FlaskConical} loading={busy} onClick={async () => { setBusy(true); try { await s.createDemo(); } catch (e) { toast.fromError(e); } finally { setBusy(false); } }}>
            Explorar con datos de demostración
          </Button>
          {s.memberships.length > 0 && <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep("choose")}>Volver</Button>}
        </>
      )}
    </AuthLayout>
  );
}
