# Integraciones

> **Business OS is an independent product and has no runtime dependency on PRFMN** (ni de ningún otro producto).

## Principio

Business OS y cualquier otro producto (PRFMN, un software de reservas, una pasarela de pago…) se comunican **solo** por contratos públicos: API REST o webhooks firmados. Nunca:

- se lee o escribe la base de datos de otro producto,
- se comparte Supabase, Auth, tablas, storage ni código de negocio,
- se exige una cuenta del otro producto para usar Business OS.

Prueba de independencia (se debe cumplir siempre):
- **Si PRFMN desapareciera mañana, Business OS seguiría funcionando al 100 %.**
- **Si Business OS desapareciera, PRFMN seguiría funcionando al 100 %.**

Por eso los datos que llegan por una integración se guardan como **datos propios** de Business OS (p. ej. `attendance` con `source = 'integration'`). Si la integración se apaga, el histórico sigue ahí y la empresa puede seguir alimentando el sistema por Excel/CSV.

## Fuentes de datos de asistencia (orden de llegada)

1. **Hoy**: importación de Excel/CSV (`Cliente · Fecha · Clase · Hora`) desde cualquier sistema.
2. **Futuro**: API/webhook de un proveedor externo (por ejemplo PRFMN u otro software de reservas), como una fuente más.

## Modelo (migración `20261001000600_integrations.sql`)

| Tabla | Para qué |
|---|---|
| `integration_connections` | Una conexión por empresa y proveedor (`provider` genérico, `scopes`, `status`). Guarda solo `secret_ref` (referencia a Vault), **nunca** el secreto. |
| `external_identities` | Correspondencia cliente/producto/centro de Business OS ↔ id en el sistema externo. Sin FK hacia el otro producto. |
| `integration_events` | Registro idempotente de eventos (`unique(connection_id, idempotency_key)`). Solo lo escribe el servidor tras verificar la firma. |

RLS: aisladas por empresa; solo visibles para quien tiene `settings.manage`; los usuarios no pueden insertar eventos (tests en `supabase/tests/rls_isolation.sql §8`).

## Contrato propuesto para el futuro conector de actividad (no implementado)

**Entrada por webhook** (el proveedor llama a Business OS):
```
POST https://<business-os>/functions/v1/integrations/{connection_id}/events
Headers: X-Signature: sha256=<HMAC del cuerpo con el secreto de la conexión>
         Idempotency-Key: <id único del evento en el proveedor>
Body: {
  "type": "attendance.recorded",
  "occurred_at": "2026-09-17T18:30:00+02:00",
  "person": { "external_id": "ath_123", "email": "carlos@…", "name": "Carlos García" },
  "class": { "name": "WOD 18:30", "location_external_id": "loc_1" }
}
```
Edge Function: verifica firma → guarda en `integration_events` → resuelve el cliente vía `external_identities` (o propone vincularlo, nunca crea a ciegas) → crea `attendance` con `source = 'integration'`.

**Consulta (pull)**, alternativa: Business OS llama a `GET /athlete-activity?since=…` del proveedor con un token de alcance limitado y guarda el resultado igual.

Requisitos: consentimiento del cliente final para compartir datos entre productos (RGPD), alcance mínimo (`attendance.read`), revocable desde Ajustes, y todo evento trazable.
