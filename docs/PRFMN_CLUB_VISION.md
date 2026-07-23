# PRFMN Club — Visión de producto

## Qué es

PRFMN Club es un **Gym Operating System**: una plataforma SaaS multi-tenant que gestiona la operación completa de un box de CrossFit, gimnasio funcional/híbrido, centro HYROX o boutique performance gym — clientes, reservas, clases, pagos, tienda, comunicaciones y automatizaciones — con un enfoque distinto al del software de gestión tradicional.

## La diferencia: sistema operativo, no software administrativo

El software de gestión de gimnasios tradicional (BeMadBox y similares) es esencialmente un ERP con tablas y formularios: correcto, pero pasivo. Obliga al propietario a ir a buscar los problemas.

PRFMN Club invierte esa relación. El sistema **sabe qué está pasando** en el negocio y **le dice al propietario qué necesita su atención**, con una acción resolutiva a un clic de distancia. El dashboard no es un panel de KPIs: es un briefing diario accionable.

> Buenos días, Alex. Necesita tu atención:
> — Marta lleva 17 días sin entrenar.
> — Carlos tiene un pago rechazado.
> — Conditioning 18:30 tiene lista de espera recurrente.
> — Quedan 6 aguas en stock.

Cada línea de ese briefing es una fila de datos con una acción directa (contactar, reintentar cobro, abrir clase extra, reponer stock), no un informe que hay que interpretar.

## Principios de producto

1. **El sistema propone, el humano decide.** Automatizamos la detección y sugerimos la acción; el propietario/coach mantiene el control final sobre comunicaciones sensibles y decisiones comerciales.
2. **Velocidad percibida por encima de todo.** Una venta en POS debe completarse en menos de 5 segundos. Una reserva, en dos toques. Si una tarea habitual tarda más de eso, es un fallo de diseño.
3. **Cero fricción en el alta.** El flujo de alta de un cliente debe poder completarse por el propio cliente en su móvil sin ayuda de recepción.
4. **Multi-tenant desde el primer commit.** No hay una versión "single-tenant" que luego se migra. Todo dato de negocio nace con `gym_id`.
5. **Trazabilidad financiera total.** Nada de dinero se borra; todo se anula, se versiona y queda auditable.
6. **Estética premium sin ruido.** Referencia conceptual: SaaS moderno (Linear, Stripe, Notion) y fitness premium. Nunca "software administrativo de los 2000".

## Quién lo usa

- **PRFMN Superadmin** (nosotros): gestiona la plataforma y sus tenants.
- **Gym Owner/Admin**: dueño del negocio, acceso total a su gimnasio.
- **Manager**: operación diaria con permisos amplios pero configurables.
- **Coach**: imparte clases, gestiona atletas y clases, sin necesidad de ver finanzas.
- **Reception/Staff**: check-in, ventas rápidas, gestión de reservas.
- **Athlete**: el cliente final, experiencia mobile-first.

## Primer cliente

**The Gravity Room** será el primer tenant real de la plataforma y el banco de pruebas para validar que cada módulo resuelve un problema operativo real, no solo una casilla del roadmap.

## Horizonte

PRFMN Club nace para un gimnasio, pero se diseña para que mañana lo usen decenas de gimnasios distintos sin que ninguno note que comparte infraestructura con otros.
