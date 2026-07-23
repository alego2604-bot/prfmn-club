import type { AutomationRule } from "@/lib/types";

export const AUTOMATION_RULES: AutomationRule[] = [
  { id: "a1", name: "7 días sin entrenar", description: "Genera una alerta interna en el dashboard.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Alerta interna", enabled: true, timesTriggeredLast30Days: 14 },
  { id: "a2", name: "10 días sin entrenar", description: "Envía un mensaje automático al cliente.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Mensaje automático", enabled: true, timesTriggeredLast30Days: 9 },
  { id: "a3", name: "21 días sin entrenar", description: "Marca al cliente en riesgo de abandono.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Riesgo de abandono", enabled: true, timesTriggeredLast30Days: 3 },
  { id: "a4", name: "Pago rechazado", description: "Mensaje automático + alerta interna.", triggerType: "event", triggerLabel: "Pago rechazado", actionLabel: "Mensaje + alerta", enabled: true, timesTriggeredLast30Days: 4 },
  { id: "a5", name: "Cumpleaños", description: "Envía felicitación automática.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Mensaje de felicitación", enabled: true, timesTriggeredLast30Days: 6 },
  { id: "a6", name: "30 días desde alta", description: "Solicita feedback al nuevo cliente.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Encuesta", enabled: true, timesTriggeredLast30Days: 5 },
  { id: "a7", name: "Vuelve tras 20 días de inactividad", description: "Avisa al coach asignado.", triggerType: "event", triggerLabel: "Check-in", actionLabel: "Aviso a coach", enabled: true, timesTriggeredLast30Days: 2 },
  { id: "a8", name: "Membresía próxima a vencer", description: "Notifica al cliente 7 días antes.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Notificación", enabled: true, timesTriggeredLast30Days: 11 },
  { id: "a9", name: "Lead sin contactar 48h", description: "Avisa al comercial responsable.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Aviso interno", enabled: true, timesTriggeredLast30Days: 7 },
  { id: "a10", name: "Stock bajo mínimo", description: "Alerta interna de reposición.", triggerType: "event", triggerLabel: "Venta / diario", actionLabel: "Alerta interna", enabled: true, timesTriggeredLast30Days: 3 },
  { id: "a11", name: "Clase con lista de espera recurrente", description: "Sugiere abrir una clase extra.", triggerType: "schedule", triggerLabel: "Diario", actionLabel: "Insight", enabled: false, timesTriggeredLast30Days: 0 },
];
