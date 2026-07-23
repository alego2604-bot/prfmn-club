# User Flows

## 1. Alta de cliente (self-service)

```
Landing / enlace del gimnasio
  → Crear cuenta (email + password, o social si se añade más adelante)
  → Datos personales (nombre, apellidos, teléfono, fecha nacimiento, contacto emergencia)
  → Seleccionar tarifa (catálogo del gimnasio, precios y condiciones visibles)
  → Método de pago (Stripe: tarjeta / Apple Pay / Google Pay)
  → Aceptar términos y firmar contrato (checkbox + registro de aceptación con timestamp/IP; PDF firmado en Fase futura)
  → Solicitud enviada → estado "pendiente de aprobación"
```

Panel admin recibe **Nueva solicitud** con: nombre, tarifa elegida, método de pago, estado del contrato. Acciones: **Aceptar / Modificar tarifa / Rechazar**.

Al Aceptar:
```
activar usuario → activar membresía → generar configuración de facturación
→ activar acceso a reservas → crear ficha CRM → registrar alta
→ (opcional) lanzar automatización de bienvenida
```

## 2. Reserva de clase (atleta)

```
Abrir Reservar → ver semana/día → elegir clase con plazas
  → Reservar (1 toque) → confirmación
```//
Si está llena: **Unirse a lista de espera** → notificación automática si se libera plaza.
Cancelar: desde "Mis reservas", 1 toque, respeta política de cancelación (configurable por gimnasio).

## 3. Gestión de clase (admin/coach)

```
Calendario → seleccionar sesión → ver lista de inscritos
  → Añadir atleta / Añadir invitado / Pasar a lista de espera
  → Pasar asistencia (marcar asistió / no-show)
  → (opcional) modificar aforo, cancelar sesión completa
```

## 4. Venta rápida (POS)

```
+ VENTA → elegir producto frecuente (Agua/Café/Barrita/Shake) o categoría (Ropa/Accesorios/Otros)
  → elegir cliente (buscador rápido o "venta anónima")
  → Cobrar ahora / A cuenta del cliente / A próxima factura
  → Confirmado
```
Objetivo: <5 segundos para una venta de producto frecuente a un cliente habitual.

## 5. Resolución desde "Necesita tu atención" (dashboard)

```
Dashboard → tarjeta de alerta (ej. "Marta lleva 17 días sin entrenar")
  → acción directa sugerida (Enviar mensaje / Ver ficha / Reintentar cobro / Reponer stock)
  → ejecutar acción sin salir del dashboard (o navegación directa a la ficha con contexto)
```

## 6. Gestión de lead (CRM)

```
Lead entra (formulario web / WhatsApp / manual) → estado "Nuevo"
  → Contactar → estado "Contactado"
  → Invitar a clase de prueba → estado "Prueba"
  → Enviar oferta/tarifa → estado "Oferta"
  → Cierre → "Ganado" (dispara flujo de alta de cliente) o "Perdido" (motivo registrado)
```

## 7. Impago y recuperación

```
Cobro Stripe falla → webhook actualiza payment a "failed"
  → automatización dispara mensaje al cliente + alerta interna en dashboard
  → staff puede "Reintentar cobro" o "Contactar cliente" desde la ficha o el dashboard
  → al cobrar correctamente, estado del cliente vuelve a normal, se cierra la alerta
```
