import {
  BarChart3, CalendarCheck, Contact, CreditCard, FileText, FolderOpen, Home, Inbox, Landmark,
  MessageSquareText, Package, PieChart, Receipt, ScrollText, Settings, ShoppingBag, Sparkles, Store, Truck, Upload,
  UserPlus, Users, UsersRound, MapPin, Wallet, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/domain/permissions";
import type { ModuleStatus } from "@/design-system/components";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  status: ModuleStatus;
  /** Descripción para la página de módulo planificado y la paleta ⌘K */
  description: string;
  end?: boolean;
  /** Requiere un módulo vertical activo (no forma parte del core) */
  module?: "fitness";
  /** Módulo aún no construido que se muestra en su grupo (marcado «Pronto») en vez de en «Próximamente». */
  inline?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * Navegación (2026-10-02): grupos cortos por tarea. Los módulos DESIGNED que forman parte de la estructura del
 * producto (Membresías, Seguimiento, Gastos, Documentos) aparecen en su grupo marcados «Pronto»; el resto de lo no
 * construido vive en «Próximamente». Empresa → Equipo / Centros / Ajustes abren las pestañas de Ajustes.
 */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ to: "/", label: "Resumen", icon: Home, perm: "dashboard.view", status: "TESTED", description: "Visión ejecutiva: facturación, tendencia, clientes y lo que requiere atención", end: true }],
  },
  {
    label: "Operaciones",
    items: [
      { to: "/caja", label: "Caja", icon: Store, perm: "pos.sell", status: "TESTED", description: "Vender en segundos, táctil" },
      { to: "/ventas", label: "Ventas", icon: ShoppingBag, perm: "sales.view", status: "TESTED", description: "Histórico de operaciones, anulaciones y exportación" },
      { to: "/cierres", label: "Cierres", icon: Wallet, perm: "sales.view", status: "TESTED", description: "Apertura, arqueo y cuadre por método de pago" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users, perm: "customers.view", status: "FUNCTIONAL", description: "Fichas, notas, compras y facturas" },
      { to: "/membresias", label: "Membresías", icon: Contact, perm: "customers.view", status: "DESIGNED", inline: true, description: "Tarifas versionadas (por créditos, ilimitadas, bonos…), altas, renovaciones, bajas y MRR.", module: "fitness" },
      { to: "/seguimiento", label: "Seguimiento", icon: Sparkles, perm: "customers.view", status: "DESIGNED", inline: true, description: "Con quién hablar hoy y por qué: inactividad, renovaciones y pagos pendientes, siempre con el motivo explicado." },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { to: "/finanzas", label: "Resumen financiero", icon: Landmark, perm: "finance.view", status: "FUNCTIONAL", description: "Ingresos, IVA, pendientes de cobro y métodos de pago del periodo" },
      { to: "/facturas", label: "Facturas", icon: Receipt, perm: "finance.view", status: "FUNCTIONAL", description: "Facturas, estados de cobro, IVA repercutido y pendientes" },
      { to: "/gastos", label: "Gastos", icon: ScrollText, perm: "finance.view", status: "DESIGNED", inline: true, description: "Facturas recibidas, categorías configurables, IVA soportado y lectura de tickets/PDF con validación." },
      { to: "/pagos", label: "Pagos", icon: CreditCard, perm: "finance.view", status: "FUNCTIONAL", description: "Todos los movimientos de dinero por método" },
    ],
  },
  {
    label: "Datos",
    items: [
      { to: "/importaciones", label: "Importaciones", icon: Upload, perm: "imports.run", status: "TESTED", description: "Importar Excel/CSV por lotes con análisis, mapeo, validación, duplicados y reversión" },
      { to: "/documentos", label: "Documentos", icon: FolderOpen, perm: "documents.manage", status: "DESIGNED", inline: true, description: "Gestor documental por año y tipo, con metadatos y vínculo a facturas, gastos e importaciones." },
    ],
  },
  {
    label: "Análisis",
    items: [
      { to: "/informes", label: "Informes", icon: FileText, perm: "analytics.view", status: "TESTED", description: "Paquete para la gestoría en Excel, PDF y CSV para cualquier periodo" },
      { to: "/catalogo", label: "Catálogo", icon: Package, perm: "catalog.view", status: "TESTED", description: "Productos, servicios y categorías con histórico de precios" },
    ],
  },
  {
    label: "Empresa",
    items: [
      { to: "/ajustes?tab=equipo", label: "Equipo", icon: UsersRound, perm: "dashboard.view", status: "FUNCTIONAL", description: "Personas, roles y centros a los que accede cada una" },
      { to: "/ajustes?tab=centros", label: "Centros", icon: MapPin, perm: "dashboard.view", status: "FUNCTIONAL", description: "Centros de la empresa: cada uno con su caja, ventas e informes" },
    ],
  },
  {
    label: "Próximamente",
    items: [
      { to: "/asistencia", label: "Asistencia", icon: CalendarCheck, perm: "customers.view", status: "DESIGNED", description: "Importación de asistencia (Excel/CSV o integración), última visita, frecuencia y cambios de frecuencia.", module: "fitness" },
      { to: "/leads", label: "Leads", icon: UserPlus, perm: "customers.view", status: "DESIGNED", description: "Pipeline de oportunidades configurable (Lead → Contacto → Prueba → Cliente / Perdido) con conversión." },
      { to: "/proveedores", label: "Proveedores", icon: Truck, perm: "finance.view", status: "DESIGNED", description: "Ficha de proveedor, histórico de compras y evolución de precios." },
      { to: "/conciliacion", label: "Conciliación", icon: Landmark, perm: "finance.view", status: "PLANNED", description: "Extracto bancario ↔ cobros y gastos, con sugerencias de emparejamiento." },
      { to: "/inbox", label: "Inbox", icon: Inbox, perm: "customers.view", status: "DESIGNED", description: "WhatsApp Business (API oficial) y email en un único hilo por cliente, con registro en el timeline." },
      { to: "/plantillas", label: "Plantillas", icon: MessageSquareText, perm: "customers.view", status: "DESIGNED", description: "Inactividad, renovación, drop-in, pago pendiente, bienvenida, cumpleaños y recuperación. La IA propone, tú envías." },
      { to: "/analytics", label: "Analytics", icon: PieChart, perm: "analytics.view", status: "PLANNED", description: "Analítica de negocio, clientes (retención, churn, LTV) y finanzas (margen, gastos)." },
      { to: "/copilot", label: "Copilot", icon: BarChart3, perm: "analytics.view", status: "PLANNED", description: "Pregunta sobre tu negocio en lenguaje natural. Solo datos reales, con la consulta de origen y respetando permisos." },
    ],
  },
];

/** Módulos aún no construidos: se agrupan en "Próximamente" para no generar ruido en la navegación. */
export const isPlanned = (i: NavItem) => i.status === "PLANNED" || i.status === "DESIGNED";

export const SETTINGS_ITEM: NavItem = { to: "/ajustes", label: "Ajustes", icon: Settings, perm: "dashboard.view", status: "FUNCTIONAL", description: "Empresa, centros, equipo, métodos de pago, IVA y auditoría" };

export const ALL_ITEMS: NavItem[] = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

/** Rutas reales (sin query) de los elementos navegables, para enrutado y página «planificado». */
export const routePath = (i: NavItem) => i.to.split("?")[0]!;

export const MOBILE_TABS = ["/", "/caja", "/ventas", "/clientes"];
