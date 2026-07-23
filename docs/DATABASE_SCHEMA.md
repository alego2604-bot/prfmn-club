# Database Schema (diseño funcional — Fase 4 lo traduce a migraciones SQL reales)

Todas las tablas de negocio incluyen `gym_id UUID NOT NULL REFERENCES gyms(id)` salvo las marcadas explícitamente como de plataforma (sin `gym_id`). Todas incluyen `id UUID PK default gen_random_uuid()`, `created_at`, `updated_at`; las que representan dinero o auditoría añaden `created_by`.

## Plataforma (sin `gym_id`)

- **gyms**: `id, name, slug, status(active|trial|suspended), created_at, timezone, locale, fiscal_id(NIF/CIF), billing_email`
- **platform_admins**: `user_id, level`
- **platform_plans**: `id, name, max_users, modules_enabled(jsonb), price_cents`
- **gym_platform_subscriptions**: `gym_id, platform_plan_id, status, current_period_end`
- **support_access_log**: `platform_admin_id, gym_id, reason, started_at, ended_at`

## Identidad y acceso

- **gym_members**: `user_id, gym_id, role(owner|manager|coach|reception|athlete), permission_overrides(jsonb), status(active|invited|suspended)`
- **profiles**: `user_id, full_name, phone, avatar_url, birthdate, emergency_contact(jsonb)` (1:1 con `auth.users`, sin `gym_id` — un perfil de persona es único aunque pertenezca a varios gimnasios)

## Clientes / CRM

- **clients**: `id, gym_id, user_id(nullable hasta que acepte invitación), full_name, email, phone, status(pending_approval|active|paused|cancelled), rate_plan_id, joined_at, last_visit_at`
- **client_notes**: `id, gym_id, client_id, author_id, body, created_at`
- **health_scores**: `client_id, gym_id, score(0-100), risk_level(low|medium|high), computed_at, factors(jsonb)` — snapshot recalculado periódicamente, histórico conservado (no se sobreescribe, se inserta nueva fila).
- **leads**: `id, gym_id, full_name, phone, email, source(instagram|whatsapp|web|google|referral|walk_in|other), status(new|contacted|trial|offer|won|lost), owner_staff_id, notes, last_interaction_at, next_action_at, lost_reason`

## Tarifas y membresías

- **rate_plans**: `id, gym_id, name, price_cents, billing_period(monthly|annual|drop_in|pack), sessions_per_period(nullable), active`
- **memberships**: `id, gym_id, client_id, rate_plan_id, status(active|paused|cancelled|pending), start_date, end_date, renews_at`

## Clases y reservas

- **classes**: `id, gym_id, name, discipline, default_capacity, default_duration_min, color`
- **class_sessions**: `id, gym_id, class_id, coach_id, starts_at, ends_at, capacity(override nullable), status(scheduled|cancelled)`
- **bookings**: `id, gym_id, class_session_id, client_id, status(booked|waitlisted|cancelled|attended|no_show), booked_at, guest_name(nullable para invitados sin ficha)`
- **checkins**: `id, gym_id, booking_id, method(manual|qr|tablet), checked_in_at, checked_in_by`

## Catálogo y stock

- **product_categories**: `id, gym_id, name, kind(drink|food|apparel|accessory|merch|event|bundle)`
- **products**: `id, gym_id, category_id, name, sku, cost_cents, price_cents, tax_rate, stock, min_stock, margin_pct(computed), active, image_url`
- **stock_movements**: `id, gym_id, product_id, delta, reason(sale|restock|adjustment|loss), reference_id(nullable, ej. pos_sale_id), created_at` — el `stock` en `products` es una vista derivada/cacheada; la verdad histórica vive aquí, nunca se pierde el rastro de un ajuste.

## Ventas / POS

- **pos_sales**: `id, gym_id, client_id(nullable = venta anónima), staff_id, payment_mode(now|client_account|next_invoice), total_cents, created_at`
- **pos_sale_lines**: `id, gym_id, pos_sale_id, product_id, qty, unit_price_cents, tax_rate`

## Facturación y pagos

- **invoices**: `id, gym_id, client_id, number, series, status(draft|issued|paid|partially_paid|void), issue_date, due_date, total_cents, tax_total_cents`
- **invoice_lines**: `id, gym_id, invoice_id, description, qty, unit_price_cents, tax_rate, source(membership|pos_sale|manual|bundle)`
- **payments**: `id, gym_id, invoice_id(nullable), client_id, stripe_payment_intent_id, amount_cents, status(pending|paid|failed|refunded|partially_refunded), method(card|apple_pay|google_pay|cash), created_at`
- **refunds**: `id, gym_id, payment_id, amount_cents, reason, created_at, created_by`

## Comunicaciones

- **messages**: `id, gym_id, channel(push|email|whatsapp), segment_definition(jsonb), subject, body, sent_at, sent_by, recipients_count`
- **message_recipients**: `id, gym_id, message_id, client_id, status(sent|delivered|failed|opened)`

## Automatizaciones

- **automation_rules**: `id, gym_id, name, trigger(jsonb), condition(jsonb), action(jsonb), enabled`
- **automation_events**: `id, gym_id, rule_id, entity_type, entity_id, triggered_at, action_result(jsonb)` — append-only, log de auditoría de qué hizo el motor y cuándo.

## Configuración

- **gym_settings**: `gym_id (PK), cancellation_policy(jsonb), business_hours(jsonb), fiscal_data(jsonb), branding(jsonb)`

## Índices clave (Fase 4)

- Compuestos `(gym_id, status)` en `clients`, `bookings`, `payments`, `invoices`.
- `(gym_id, starts_at)` en `class_sessions` para vistas de calendario.
- `(gym_id, client_id)` en `bookings`, `payments`, `pos_sales` para Cliente 360.

## RLS — patrón general

```sql
alter table public.clients enable row level security;

create policy "gym_isolation_select" on public.clients
  for select using (gym_id in (select gym_id from public.gym_members where user_id = auth.uid()));

create policy "gym_isolation_write" on public.clients
  for all using (gym_id in (select gym_id from public.gym_members where user_id = auth.uid() and role in ('owner','manager')))
  with check (gym_id in (select gym_id from public.gym_members where user_id = auth.uid() and role in ('owner','manager')));
```

Cada tabla implementa su propia variante (algunos roles con `select`-only, ej. `coach` sobre `payments`).
