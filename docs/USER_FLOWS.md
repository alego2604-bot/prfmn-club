# User Flows

Cada flujo indica su estado real. ✅ funcional y probado en navegador · 🟡 parcial · ⏭ planificado.

## ✅ Alta
Crear cuenta → «¿Qué tipo de negocio?» (8 sectores) → nombre comercial, razón social, CIF, ciudad, primer centro → dashboard con «Primeros pasos». Alternativa: «Explorar con datos de demostración» (empresa demo separada, banner permanente).

## ✅ Vender (objetivo < 5 s)
Caja → (si está cerrada: fondo inicial → Abrir caja) → tocar Agua, Agua, Monster, Drop-In (contador en la tarjeta) → método (Efectivo muestra «Entregado» con importes rápidos y cambio) → «Cobrar 19,00 €» → confirmación con nº de venta. Extras: dividir pago, cliente opcional, editar línea (cantidad, precio puntual, descuento), atajo «/» para buscar.

## ✅ Cerrar caja
Cierres → tarjeta del centro (ventas, total, esperado, por método) → Entrada/Salida de efectivo con motivo → Cerrar caja → importe o conteo por billetes/monedas → Esperado / Real / Diferencia → **CAJA CUADRADA** o **DESCUADRE** (observación obligatoria) → historial. Reabrir con motivo → nueva versión del cierre.

## ✅ Importar Excel
Importaciones → Nueva → arrastrar archivo → hojas detectadas (ventas, catálogo, resumen omitido) → mapeo de columnas con confianza y ejemplos → previsualización → validación (encontrados, válidos, revisar, duplicados, errores; control de cuadre contra los totales del propio archivo; «lo que hemos entendido»; decisión masiva para fechas fuera de mes; fila a fila: importar/ignorar, elegir producto) → confirmar → resultado → historial con reversión segura.

## ✅ Corregir una venta
Ventas → fila → detalle (líneas, IVA, pagos, origen, historial) → Anular con motivo → devoluciones compensatorias; queda tachada, nunca desaparece.

## ✅ Cambiar un precio
Catálogo → producto → nuevo precio (+ motivo) → aviso «las N ventas anteriores conservan su precio» → histórico de precios con autor y vigencias; auditoría `price_change`.

## ✅ Mandar el trimestre a la gestoría
Informes → Trimestre → Q3 → revisar KPIs, IVA por tipo y notas → Descargar Excel (`Q3_2026_TheGravityRoom.xlsx`, 10 hojas) / PDF / CSV por hoja.

## ✅ Encontrar algo
⌘K → clientes (nombre, NIF, email, teléfono), productos, `#123` ventas, facturas, acciones y secciones.

## ✅ Ficha de cliente
Clientes → filtro (activos, leads, bajas, «revisar NIF») → ficha: tarifa, último movimiento, antigüedad, WhatsApp (enlace), email, nota (fijada / silenciar avisos hasta), pestañas Resumen · Actividad · Facturas · Compras · Notas.

## ⏭ Seguimiento (siguiente fase)
Importar asistencia → reglas de actividad → «8 clientes llevan +14 días sin venir» con el motivo → contactar por WhatsApp (API oficial) → queda en el timeline → tarea / posponer / resuelto.

## ⏭ Gastos con lectura de facturas
Subir PDF/foto → extracción (proveedor, NIF, nº, base, IVA, total, categoría propuesta) → Confirmar / Editar / Descartar → gasto enlazado al documento original.
