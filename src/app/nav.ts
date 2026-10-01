import {
  BarChart3, CalendarCheck, Contact, CreditCard, FileText, FolderOpen, Home, Inbox, Landmark,
  MessageSquareText, Package, PieChart, Receipt, ScrollText, Settings, ShoppingBag, Sparkles, Store, Truck, Upload,
  UserPlus, Users, Wallet, type LucideIcon,
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
  vertical?: "fitness";
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ to: "/", label: "Inicio", icon: Home, perm: "dashboard.view", status: "TESTED", description: "Hoy, mes y año de un vistazo", end: true }],
  },
  {
    label: "Operaciones",
    items: [
      { to: "/caja", label: "Caja", icon: Store, perm: "pos.sell", status: "TESTED", description: "Vender en segundos, táctil" },
      { to: "/ventas", label: "Ventas", icon: ShoppingBag, perm: "sales.view", status: "TESTED", description: "Histórico de operaciones, anulaciones y exportación" },
      { to: "/cierres", label: "Cierres de caja", icon: Wallet, perm: "sales.view", status: "TESTED", description: "Apertura, arqueo y cuadre por método de pago" },
      { to: "/catalogo", label: "Catálogo", icon: Package, perm: "catalog.view", status: "TESTED", description: "Productos, servicios y categorías con histórico de precios" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users, perm: "customers.view", status: "FUNCTIONAL", description: "Fichas, notas, compras y facturas" },
      { to: "/seguimiento", label: "Seguimiento", icon: Sparkles, perm: "customers.view", status: "DESIGNED", description: "Con quién hablar hoy y por qué: inactividad, renovaciones y pagos pendientes, siempre con el motivo explicado." },
      { to: "/membresias", label: "Membresías", icon: Contact, perm: "customers.view", status: "DESIGNED", description: "Tarifas versionadas (11/16/21 créditos, ilimitada, fundador…), altas, renovaciones, bajas y MRR.", vertical: "fitness" },
      { to: "/asistencia", label: "Asistencia", icon: CalendarCheck, perm: "customers.view", status: "DESIGNED", description: "Importación de asistencia (BeMadBox), última visita, frecuencia y cambios de frecuencia.", vertical: "fitness" },
      { to: "/leads", label: "Leads", icon: UserPlus, perm: "customers.view", status: "DESIGNED", description: "Pipeline Lead → Visita → Drop-in → Prueba → Interesado → Miembro / Perdido con conversión." },
    ],
  },
  {
    label: "Comunicación",
    items: [
      { to: "/inbox", label: "Inbox", icon: Inbox, perm: "customers.view", status: "DESIGNED", description: "WhatsApp Business (API oficial) y email en un único hilo por cliente, con registro en el timeline." },
      { to: "/plantillas", label: "Plantillas", icon: MessageSquareText, perm: "customers.view", status: "DESIGNED", description: "Inactividad, renovación, drop-in, pago pendiente, bienvenida, cumpleaños y recuperación. La IA propone, tú envías." },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { to: "/facturas", label: "Facturas emitidas", icon: Receipt, perm: "finance.view", status: "FUNCTIONAL", description: "Facturas, estados de cobro, IVA repercutido y pendientes" },
      { to: "/pagos", label: "Pagos y cobros", icon: CreditCard, perm: "finance.view", status: "FUNCTIONAL", description: "Todos los movimientos de dinero por método" },
      { to: "/gastos", label: "Gastos", icon: ScrollText, perm: "finance.view", status: "DESIGNED", description: "Facturas recibidas, categorías configurables, IVA soportado y lectura de tickets/PDF con validación." },
      { to: "/proveedores", label: "Proveedores", icon: Truck, perm: "finance.view", status: "DESIGNED", description: "Ficha de proveedor, histórico de compras y evolución de precios." },
      { to: "/conciliacion", label: "Conciliación", icon: Landmark, perm: "finance.view", status: "PLANNED", description: "Extracto bancario ↔ cobros y gastos, con sugerencias de emparejamiento." },
    ],
  },
  {
    label: "Inteligencia",
    items: [
      { to: "/informes", label: "Informes", icon: FileText, perm: "analytics.view", status: "TESTED", description: "Paquete para la gestoría en Excel, PDF y CSV para cualquier periodo" },
      { to: "/analytics", label: "Analytics", icon: PieChart, perm: "analytics.view", status: "PLANNED", description: "Analítica de negocio, clientes (retención, churn, LTV) y finanzas (margen, gastos)." },
      { to: "/copilot", label: "Copilot", icon: BarChart3, perm: "analytics.view", status: "PLANNED", description: "Pregunta sobre tu negocio en lenguaje natural. Solo datos reales, con la consulta de origen y respetando permisos." },
    ],
  },
  {
    label: "Datos",
    items: [
      { to: "/importaciones", label: "Importaciones", icon: Upload, perm: "imports.run", status: "TESTED", description: "Importar Excel/CSV con análisis, mapeo, validación, duplicados y reversión" },
      { to: "/documentos", label: "Documentos", icon: FolderOpen, perm: "documents.manage", status: "DESIGNED", description: "Gestor documental por año y tipo, con metadatos y vínculo a facturas, gastos e importaciones." },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { to: "/ajustes", label: "Ajustes", icon: Settings, perm: "dashboard.view", status: "FUNCTIONAL", description: "Empresa, centros, equipo, métodos de pago, IVA y auditoría" };

export const ALL_ITEMS: NavItem[] = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

export const MOBILE_TABS = ["/", "/caja", "/ventas", "/clientes"];
