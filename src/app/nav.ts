import {
  BarChart3, CalendarCheck, Contact, CreditCard, FileText, FolderOpen, Home, Inbox, Landmark,
  MessageSquareText, Package, PieChart, Receipt, ScrollText, Settings, ShoppingBag, Sparkles, Store, Truck, Upload,
  UserPlus, Users, UsersRound, MapPin, Wallet, Scale, type LucideIcon,
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
 * Navegación (2026-10-03): grupos cortos por tarea (Operaciones, Clientes, Finanzas, Datos, Análisis, Catálogo, Empresa).
 * Proveedores vive dentro de Finanzas → Gastos (subnavegación) para no alargar el menú.
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
      { to: "/catalogo", label: "Catálogo", icon: Package, perm: "catalog.view", status: "TESTED", description: "Productos, servicios, categorías y tarifas de membresía con histórico de precios" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users, perm: "customers.view", status: "FUNCTIONAL", description: "Fichas 360: membresía, compras, facturas, notas, tareas y saldo" },
      { to: "/membresias", label: "Membresías", icon: Contact, perm: "customers.view", status: "FUNCTIONAL", description: "Tarifas con versiones de precio, altas, pausas, bajas, renovaciones, cuotas y MRR" },
      { to: "/seguimiento", label: "Seguimiento", icon: Sparkles, perm: "customers.view", status: "FUNCTIONAL", description: "Tareas y avisos: con quién hablar hoy y por qué (renovaciones, cuotas vencidas, inactividad)" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { to: "/finanzas", label: "Resumen", icon: Landmark, perm: "finance.view", status: "FUNCTIONAL", description: "Ingresos, gastos, resultado, flujo de caja, cobros e IVA del periodo" },
      { to: "/gastos", label: "Gastos", icon: ScrollText, perm: "finance.view", status: "FUNCTIONAL", description: "Facturas recibidas y gastos por categoría, proveedor y centro, con IVA soportado" },
      { to: "/facturas", label: "Facturas", icon: Receipt, perm: "finance.view", status: "FUNCTIONAL", description: "Emitir, cobrar, duplicar y descargar facturas; vencidas y pendientes" },
      { to: "/pagos", label: "Cobros", icon: CreditCard, perm: "finance.view", status: "FUNCTIONAL", description: "Todo el dinero cobrado y devuelto, por método y centro" },
      { to: "/impuestos", label: "Impuestos", icon: Scale, perm: "finance.view", status: "FUNCTIONAL", description: "IVA repercutido, soportado y posición estimada por trimestre (orientativo)" },
    ],
  },
  {
    label: "Datos",
    items: [
      { to: "/informes", label: "Informes", icon: FileText, perm: "analytics.view", status: "FUNCTIONAL", description: "Ventas, ingresos, gastos, caja, cobros, facturas, clientes, membresías, productos y centros; paquete para la gestoría" },
      { to: "/importaciones", label: "Importaciones", icon: Upload, perm: "imports.run", status: "TESTED", description: "Importar Excel/CSV por lotes con análisis, mapeo, validación, duplicados y reversión" },
      { to: "/documentos", label: "Documentos", icon: FolderOpen, perm: "documents.manage", status: "DESIGNED", description: "Gestor documental por año y tipo, con metadatos y vínculo a facturas, gastos e importaciones." },
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


/** Rutas reales (sin query) de los elementos navegables, para enrutado y página «planificado». */
export const routePath = (i: NavItem) => i.to.split("?")[0]!;

export const MOBILE_TABS = ["/", "/caja", "/ventas", "/clientes"];

/** Elementos que no están en el menú pero sí en la paleta ⌘K. */
export const EXTRA_ITEMS: NavItem[] = [
  { to: "/proveedores", label: "Proveedores", icon: Truck, perm: "finance.view", status: "FUNCTIONAL", description: "Fichas de proveedor con gastos, pendientes y contacto" },
  { to: "/flujo-de-caja", label: "Flujo de caja", icon: Wallet, perm: "finance.view", status: "FUNCTIONAL", description: "Entradas y salidas de dinero por mes, por cobrar y por pagar" },
];

export const ALL_ITEMS: NavItem[] = [...NAV.flatMap((g) => g.items), ...EXTRA_ITEMS, SETTINGS_ITEM];
