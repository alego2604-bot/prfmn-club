-- =====================================================================
-- PRFMN Club · 0100 · Foundation: tenancy, identity, roles, settings
-- =====================================================================
-- Reglas de este esquema (ver docs/DATABASE_SCHEMA.md):
--   * Toda tabla de negocio lleva organization_id NOT NULL.
--   * Lo que ocurre en un centro lleva además location_id.
--   * Dinero en céntimos enteros (bigint). IVA en puntos básicos (2100 = 21 %).
--   * Relaciones hijas usan FK compuesta (organization_id, parent_id) para que
--     sea IMPOSIBLE enlazar registros de dos empresas distintas.
--   * Nada financiero se borra: se anula. audit_logs es append-only.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
comment on schema app is 'Funciones internas (seguridad, auditoría, numeración). No exponer vía API.';

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.normalize_tax_id(raw text) returns text
language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- ---------------------------------------------------------------------
-- Plataforma (planes SaaS) — sin organization_id
-- ---------------------------------------------------------------------
create table public.platform_plans (
  key          text primary key check (key in ('starter','pro','business')),
  name         text not null,
  limits       jsonb not null default '{}'::jsonb,   -- {"locations":1,"users":3,...}
  features     text[] not null default '{}',
  sort_order   int not null default 0
);

insert into public.platform_plans (key, name, limits, features, sort_order) values
  ('starter',  'Starter',  '{"locations":1,"users":3}',            '{core}', 1),
  ('pro',      'Pro',      '{"locations":5,"users":15}',           '{core,analytics_advanced,multi_location}', 2),
  ('business', 'Business', '{"locations":null,"users":null}',      '{core,analytics_advanced,multi_location,integrations,api}', 3);

-- ---------------------------------------------------------------------
-- Organizaciones (tenants) y centros
-- ---------------------------------------------------------------------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),   -- nombre comercial
  legal_name      text,
  tax_id          text,
  address         text,
  city            text,
  postal_code     text,
  country         text not null default 'ES',
  phone           text,
  email           text,
  website         text,
  logo_path       text,
  currency        text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  timezone        text not null default 'Europe/Madrid',
  locale          text not null default 'es-ES',
  vertical        text not null default 'fitness'
                  check (vertical in ('fitness','gym','functional_training','restaurant','retail','services','beauty','clinic','other')),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  is_demo         boolean not null default false,
  status          text not null default 'active' check (status in ('active','suspended','archived')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key        text not null references public.platform_plans(key) default 'starter',
  status          text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled')),
  trial_ends_at   timestamptz,
  current_period_end timestamptz,
  external_ref    text,  -- futuro: Stripe subscription id
  updated_at      timestamptz not null default now()
);

create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key      text not null,  -- core.*, fitness.memberships, fitness.attendance, ...
  enabled         boolean not null default true,
  primary key (organization_id, module_key)
);

create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  code            text,
  address         text,
  city            text,
  postal_code     text,
  phone           text,
  timezone        text,          -- null = la de la organización
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create index locations_org_idx on public.locations (organization_id);
create trigger trg_locations_touch before update on public.locations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Identidad: perfiles, roles, permisos, miembros
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  avatar_path text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Catálogo de permisos (fijo, lo define el producto)
create table public.permissions (
  key         text primary key,         -- p. ej. 'sales.create'
  module      text not null,
  description text not null
);

insert into public.permissions (key, module, description) values
  ('dashboard.view',       'intelligence', 'Ver dashboard'),
  ('analytics.view',       'intelligence', 'Ver analytics e informes'),
  ('reports.export',       'intelligence', 'Exportar informes (gestoría)'),
  ('pos.sell',             'operations',   'Registrar ventas en caja'),
  ('sales.view',           'operations',   'Ver ventas'),
  ('sales.void',           'operations',   'Anular ventas'),
  ('cash.operate',         'operations',   'Abrir y cerrar caja'),
  ('cash.reopen',          'operations',   'Reabrir cierres de caja'),
  ('catalog.view',         'operations',   'Ver catálogo'),
  ('catalog.manage',       'operations',   'Crear/editar productos y tarifas'),
  ('catalog.prices',       'operations',   'Cambiar precios'),
  ('customers.view',       'customers',    'Ver clientes'),
  ('customers.manage',     'customers',    'Crear/editar clientes, notas y tareas'),
  ('customers.sensitive',  'customers',    'Ver datos fiscales y de pago de clientes'),
  ('memberships.manage',   'customers',    'Gestionar membresías'),
  ('attendance.manage',    'customers',    'Registrar asistencia'),
  ('communications.send',  'communications','Enviar comunicaciones'),
  ('templates.manage',     'communications','Gestionar plantillas'),
  ('finance.view',         'finance',      'Ver finanzas, facturas y gastos'),
  ('invoices.manage',      'finance',      'Emitir/anular facturas'),
  ('expenses.manage',      'finance',      'Gestionar gastos y proveedores'),
  ('payments.manage',      'finance',      'Registrar cobros y devoluciones'),
  ('imports.run',          'data',         'Importar datos'),
  ('imports.revert',       'data',         'Revertir importaciones'),
  ('documents.manage',     'data',         'Gestionar documentos'),
  ('settings.manage',      'company',      'Configuración de empresa'),
  ('team.manage',          'company',      'Gestionar equipo y roles'),
  ('audit.view',           'company',      'Ver registro de auditoría');

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade, -- null = rol de sistema
  key             text not null,
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, key)
);

create table public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  permission text not null,  -- clave de permissions o '*'
  primary key (role_id, permission),
  check (permission = '*' or permission ~ '^[a-z_]+\.[a-z_]+$')
);

-- Roles de sistema
with r as (
  insert into public.roles (organization_id, key, name, description, is_system) values
    (null, 'owner',      'Owner',      'Control total, incluida facturación de la plataforma', true),
    (null, 'admin',      'Admin',      'Gestión completa del negocio', true),
    (null, 'manager',    'Manager',    'Operativa diaria, clientes y caja', true),
    (null, 'employee',   'Employee',   'Caja, ventas y clientes básicos', true),
    (null, 'accountant', 'Accountant', 'Finanzas y exportaciones, solo lectura operativa', true),
    (null, 'read_only',  'Read only',  'Solo consulta', true)
  returning id, key
)
insert into public.role_permissions (role_id, permission)
select r.id, p from r, unnest(case r.key
  when 'owner' then array['*']
  when 'admin' then array['*']
  when 'manager' then array['dashboard.view','analytics.view','pos.sell','sales.view','sales.void','cash.operate','cash.reopen',
                            'catalog.view','catalog.manage','customers.view','customers.manage','memberships.manage',
                            'attendance.manage','communications.send','templates.manage','finance.view','imports.run','documents.manage']
  when 'employee' then array['dashboard.view','pos.sell','sales.view','cash.operate','catalog.view','customers.view',
                             'customers.manage','attendance.manage','communications.send']
  when 'accountant' then array['dashboard.view','analytics.view','reports.export','sales.view','catalog.view','customers.view',
                               'customers.sensitive','finance.view','invoices.manage','expenses.manage','payments.manage',
                               'documents.manage','audit.view']
  when 'read_only' then array['dashboard.view','analytics.view','sales.view','catalog.view','customers.view','finance.view']
end) as p;

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role_id         uuid not null references public.roles(id),
  location_ids    uuid[],          -- null = todos los centros
  permission_overrides jsonb not null default '{"grant":[],"revoke":[]}'::jsonb,
  status          text not null default 'active' check (status in ('invited','active','suspended')),
  invited_email   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id) where status = 'active';
create trigger trg_members_touch before update on public.organization_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Funciones de seguridad (SECURITY DEFINER: evitan recursión de RLS)
-- ---------------------------------------------------------------------
create or replace function app.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function app.has_permission(org uuid, perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.organization_members m
    left join public.role_permissions rp on rp.role_id = m.role_id and rp.permission in (perm, '*')
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and not coalesce((m.permission_overrides -> 'revoke') ? perm, false)
      and (rp.role_id is not null or coalesce((m.permission_overrides -> 'grant') ? perm, false))
  )
$$;

-- ¿Puede el usuario operar en este centro? (null location = registro de empresa)
create or replace function app.can_access_location(org uuid, loc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select loc is null or exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
      and (m.location_ids is null or loc = any (m.location_ids))
  )
$$;

revoke all on function app.is_member(uuid), app.has_permission(uuid, text), app.can_access_location(uuid, uuid) from public;
grant usage on schema app to authenticated;
grant execute on function app.is_member(uuid), app.has_permission(uuid, text), app.can_access_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Configuración de empresa
-- ---------------------------------------------------------------------
create table public.tax_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  rate_bp         int not null check (rate_bp between 0 and 10000),  -- 2100 = 21,00 %
  is_default      boolean not null default false,
  status          text not null default 'active' check (status in ('active','archived')),
  created_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index tax_rates_one_default on public.tax_rates (organization_id) where is_default and status = 'active';

create table public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  name            text not null,
  kind            text not null check (kind in ('cash','card','bizum','online','transfer','direct_debit','voucher','other','unknown')),
  affects_cash_drawer boolean not null default false,  -- true = cuenta en el efectivo esperado del cierre
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, key),
  unique (organization_id, id)
);

create table public.document_series (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,                 -- 'F', 'S', 'R' (rectificativa)...
  document_type   text not null check (document_type in ('invoice','simplified_invoice','credit_note','sale_ticket')),
  prefix          text not null default '',      -- p. ej. 'F2026-'
  next_number     bigint not null default 1 check (next_number > 0),
  padding         smallint not null default 5,
  year            smallint,                      -- null = no reinicia por año
  status          text not null default 'active' check (status in ('active','archived')),
  unique (organization_id, code, year),
  unique (organization_id, id)
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  activity_rules  jsonb not null default
    '[{"key":"active","label":"Activo","max_days":7,"severity":"ok"},
      {"key":"low_activity","label":"Baja actividad","min_days":7,"max_days":14,"severity":"info"},
      {"key":"at_risk","label":"En riesgo","min_days":14,"max_days":21,"severity":"warning"},
      {"key":"inactive","label":"Inactivo","min_days":30,"severity":"danger"}]'::jsonb,
  renewal_notice_days smallint not null default 7,
  invoice_defaults jsonb not null default '{}'::jsonb,
  pos_settings     jsonb not null default '{"require_cash_session":true,"allow_negative_stock":true}'::jsonb,
  updated_at      timestamptz not null default now()
);
create trigger trg_settings_touch before update on public.organization_settings
  for each row execute function app.touch_updated_at();
