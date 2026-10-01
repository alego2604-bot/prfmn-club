-- =====================================================================
-- Business OS · 0200 · Catálogo, clientes, membresías, CRM
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table public.product_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid,
  name            text not null check (length(trim(name)) > 0),
  color           text,
  default_tax_rate_id uuid,
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.product_categories (organization_id, id),
  foreign key (organization_id, default_tax_rate_id) references public.tax_rates (organization_id, id)
);
create unique index product_categories_name_uq on public.product_categories (organization_id, lower(name)) where status <> 'archived';
create trigger trg_product_categories_touch before update on public.product_categories
  for each row execute function app.touch_updated_at();

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id     uuid,
  name            text not null check (length(trim(name)) > 0),
  sku             text,
  kind            text not null default 'physical'
                  check (kind in ('physical','service','membership','pack','drop_in')),
  subcategory     text,
  description     text,
  -- Precio VIGENTE (caché de product_prices para lectura rápida). La verdad histórica está en product_prices.
  price           bigint not null check (price >= 0),             -- céntimos, IVA incluido
  tax_rate_id     uuid,
  tax_rate_bp     int not null check (tax_rate_bp between 0 and 10000),
  cost            bigint check (cost >= 0),                        -- céntimos, sin IVA
  track_stock     boolean not null default false,
  stock_quantity  numeric(12,3),                                    -- caché de stock_movements
  min_stock       numeric(12,3),
  pos_visible     boolean not null default true,
  pos_color       text,
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  import_id       uuid,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.product_categories (organization_id, id),
  foreign key (organization_id, tax_rate_id) references public.tax_rates (organization_id, id)
);
create unique index products_sku_uq on public.products (organization_id, lower(sku)) where sku is not null and status <> 'archived';
create index products_org_status_idx on public.products (organization_id, status);
create trigger trg_products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- Histórico de precios con vigencia. Nunca se edita una fila pasada: se cierra (valid_to) y se crea otra.
create table public.product_prices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id      uuid not null,
  price           bigint not null check (price >= 0),
  tax_rate_bp     int not null check (tax_rate_bp between 0 and 10000),
  cost            bigint check (cost >= 0),
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  changed_by      uuid references auth.users(id),
  reason          text,
  created_at      timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade
);
create unique index product_prices_one_current on public.product_prices (product_id) where valid_to is null;
create index product_prices_lookup on public.product_prices (product_id, valid_from desc);

-- Al insertar un producto o cambiar su precio/IVA/coste se versiona automáticamente.
create or replace function app.version_product_price() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_prices (organization_id, product_id, price, tax_rate_bp, cost, valid_from, changed_by)
    values (new.organization_id, new.id, new.price, new.tax_rate_bp, new.cost, new.created_at, auth.uid());
  elsif (new.price, new.tax_rate_bp, coalesce(new.cost, -1)) is distinct from (old.price, old.tax_rate_bp, coalesce(old.cost, -1)) then
    update public.product_prices set valid_to = now() where product_id = new.id and valid_to is null;
    insert into public.product_prices (organization_id, product_id, price, tax_rate_bp, cost, valid_from, changed_by)
    values (new.organization_id, new.id, new.price, new.tax_rate_bp, new.cost, now(), auth.uid());
  end if;
  return new;
end $$;
create trigger trg_products_version_price after insert or update on public.products
  for each row execute function app.version_product_price();

-- ---------------------------------------------------------------------
-- Tarifas de membresía (el "qué se vende" recurrente)
-- ---------------------------------------------------------------------
create table public.membership_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  kind            text not null check (kind in ('recurring','pack','drop_in','trial')),
  billing_period  text not null default 'month' check (billing_period in ('week','month','quarter','semester','year','none')),
  is_founder      boolean not null default false,   -- tarifa protegida (grandfathering)
  open_to_new     boolean not null default true,    -- false = solo la conservan quienes ya la tienen
  location_ids    uuid[],                           -- null = todos los centros
  description     text,
  restrictions    jsonb not null default '{}'::jsonb,
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  import_id       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger trg_membership_plans_touch before update on public.membership_plans
  for each row execute function app.touch_updated_at();

-- Cada cambio de precio/créditos = versión nueva. Las membresías apuntan a la versión → histórico intacto.
create table public.membership_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  plan_id         uuid not null,
  version         int not null check (version > 0),
  price           bigint not null check (price >= 0),          -- céntimos IVA incluido por periodo
  tax_rate_bp     int not null check (tax_rate_bp between 0 and 10000),
  credits_total   int check (credits_total >= 0),               -- null = ilimitado
  class_credits   int check (class_credits >= 0),
  open_box_credits int check (open_box_credits >= 0),
  sessions        int check (sessions >= 0),                    -- bonos
  duration_days   int check (duration_days > 0),                -- validez de bonos
  valid_from      date not null,
  valid_to        date,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (plan_id, version),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (organization_id, plan_id) references public.membership_plans (organization_id, id) on delete cascade
);
create unique index membership_plan_versions_current on public.membership_plan_versions (plan_id) where valid_to is null;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  home_location_id uuid,
  first_name      text not null check (length(trim(first_name)) > 0),
  last_name       text,
  tax_id          text,
  tax_id_normalized text generated always as (app.normalize_tax_id(tax_id)) stored,
  tax_id_valid    boolean,
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text,
  birth_date      date,
  address         text,
  postal_code     text,
  city            text,
  company_name    text,
  status          text not null default 'active' check (status in ('lead','active','inactive','cancelled','blocked')),
  pipeline_stage  text check (pipeline_stage in ('lead','visit','drop_in','trial','interested','member','lost')),
  lost_reason     text,
  source          text,                          -- walk_in, instagram, referral, import...
  joined_at       date,
  left_at         date,
  tags            text[] not null default '{}',
  marketing_consent boolean not null default false,
  import_id       uuid,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,                   -- soft delete (RGPD: anonimización en función aparte)
  unique (organization_id, id),
  foreign key (organization_id, home_location_id) references public.locations (organization_id, id)
);
create unique index customers_tax_id_uq on public.customers (organization_id, tax_id_normalized)
  where tax_id_normalized is not null and deleted_at is null;
create index customers_org_status_idx on public.customers (organization_id, status) where deleted_at is null;
create index customers_name_idx on public.customers (organization_id, lower(first_name), lower(last_name));
create trigger trg_customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();

create table public.customer_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id     uuid not null,
  plan_id         uuid not null,
  plan_version_id uuid not null,
  location_id     uuid,
  price           bigint not null check (price >= 0),  -- snapshot del precio pactado
  start_date      date not null,
  end_date        date,
  next_renewal_date date,
  auto_renew      boolean not null default true,
  credits_remaining int,
  status          text not null default 'active' check (status in ('pending','active','paused','cancelled','expired')),
  cancelled_at    timestamptz,
  cancel_reason   text,
  import_id       uuid,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (end_date is null or end_date >= start_date),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, plan_id) references public.membership_plans (organization_id, id),
  foreign key (organization_id, plan_version_id) references public.membership_plan_versions (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index customer_memberships_customer_idx on public.customer_memberships (organization_id, customer_id, start_date desc);
create index customer_memberships_renewal_idx on public.customer_memberships (organization_id, next_renewal_date) where status = 'active';
create trigger trg_customer_memberships_touch before update on public.customer_memberships
  for each row execute function app.touch_updated_at();

create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid,
  customer_id     uuid not null,
  customer_membership_id uuid,
  occurred_at     timestamptz not null,
  kind            text not null default 'class' check (kind in ('class','open_box','drop_in','personal','other')),
  class_name      text,
  source          text not null default 'manual' check (source in ('manual','import','checkin','integration')),
  import_id       uuid,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, customer_membership_id) references public.customer_memberships (organization_id, id)
);
create index attendance_customer_idx on public.attendance (organization_id, customer_id, occurred_at desc);
create unique index attendance_dedupe_uq on public.attendance (organization_id, customer_id, occurred_at, coalesce(class_name, ''));

create table public.customer_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id     uuid not null,
  author_id       uuid references auth.users(id),
  body            text not null check (length(trim(body)) > 0),
  pinned          boolean not null default false,
  suppress_alerts_until date,      -- "Estará dos semanas fuera" → no generar avisos de inactividad
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index customer_notes_customer_idx on public.customer_notes (organization_id, customer_id, created_at desc);
create trigger trg_customer_notes_touch before update on public.customer_notes
  for each row execute function app.touch_updated_at();

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid,
  title           text not null check (length(trim(title)) > 0),
  description     text,
  reason          text,                     -- "18 días sin entrenar"
  alert_key       text,                     -- vínculo con la alerta que la originó
  assignee_id     uuid references auth.users(id),
  due_date        date,
  status          text not null default 'pending' check (status in ('pending','in_progress','done','cancelled')),
  snoozed_until   date,
  completed_at    timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index tasks_open_idx on public.tasks (organization_id, status, due_date) where status in ('pending','in_progress');
create trigger trg_tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Comunicaciones
-- ---------------------------------------------------------------------
create table public.message_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        text not null check (category in ('inactivity','renewal','drop_in_follow_up','payment_pending','welcome','birthday','win_back','other')),
  channel         text not null check (channel in ('whatsapp','email','sms')),
  subject         text,
  body            text not null,
  external_template_name text,     -- nombre de plantilla aprobada en WhatsApp Business
  status          text not null default 'active' check (status in ('active','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger trg_message_templates_touch before update on public.message_templates
  for each row execute function app.touch_updated_at();

create table public.communications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id     uuid,
  channel         text not null check (channel in ('whatsapp','email','sms','call','in_person','other')),
  direction       text not null default 'outbound' check (direction in ('outbound','inbound')),
  template_id     uuid,
  subject         text,
  body            text,
  status          text not null default 'logged' check (status in ('draft','queued','sent','delivered','read','failed','logged')),
  outcome         text,             -- "Responde que vuelve el lunes"
  ai_generated    boolean not null default false,
  external_id     text,
  sent_by         uuid references auth.users(id),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, template_id) references public.message_templates (organization_id, id)
);
create index communications_customer_idx on public.communications (organization_id, customer_id, created_at desc);
