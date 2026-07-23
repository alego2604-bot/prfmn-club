# Automations Engine

## Modelo

Motor basado en **eventos + condiciones + acciones**, evaluado por:
- **Triggers de evento** (algo ocurre: pago rechazado, lead creado, alta de cliente) → evaluación inmediata.
- **Triggers programados** (cron diario) → evaluación de condiciones temporales (días sin entrenar, próximo vencimiento, cumpleaños).

```ts
type AutomationRule = {
  id: string;
  gym_id: string;
  name: string;
  trigger: { type: "event"; event: EventType } | { type: "schedule"; cron: string };
  condition: ConditionExpression; // evaluada contra el estado del cliente/entidad
  action: { type: "internal_alert" | "send_message" | "notify_coach"; params: Record<string, unknown> };
  enabled: boolean;
};
```

Cada ejecución genera un `automation_event` (log auditable: qué regla, sobre qué entidad, cuándo, qué acción resultante) — nunca se ejecuta una acción silenciosa sin dejar rastro.

## Catálogo inicial de reglas (MVP)

| Trigger | Condición | Acción |
|---|---|---|
| Cron diario | 7 días sin entrenar | Alerta interna en dashboard |
| Cron diario | 10 días sin entrenar | Mensaje automático al cliente |
| Cron diario | 21 días sin entrenar | Marcar "riesgo de abandono" (impacta Health Score) |
| Evento: pago rechazado | — | Mensaje automático al cliente + alerta interna |
| Cron diario | Cumpleaños hoy | Mensaje de felicitación |
| Cron diario | 30 días desde alta | Encuesta de satisfacción |
| Evento: check-in | Cliente inactivo >20 días que vuelve | Aviso al coach asignado |
| Cron diario | Membresía vence en ≤7 días | Notificación al cliente |
| Cron diario | Lead sin contactar >48h | Aviso al comercial responsable |
| Evento: venta / cron diario | Stock por debajo del mínimo | Alerta interna |
| Cron diario | Clase con lista de espera recurrente (≥3 sesiones seguidas) | Insight en dashboard (sugerencia de abrir clase) |

## Extensibilidad

- Nuevas reglas se añaden a la tabla `automation_rules` sin desplegar código, siempre que la condición se exprese con el vocabulario de campos ya soportado (`ConditionExpression`).
- Condiciones nuevas que requieran datos no existentes sí requieren cambio de esquema/migración.
- El owner/manager puede activar/desactivar reglas desde Configuración → Automatizaciones; no puede (en el MVP) crear condiciones custom con editor visual — eso es roadmap post-MVP.
