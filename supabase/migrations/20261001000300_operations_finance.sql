-- =====================================================================
-- PRFMN Club · 0300 · Ventas, pagos, caja, facturas, gastos
-- VENTA (qué) ≠ PAGO (cómo) ≠ FACTURA (documento fiscal) ≠ GASTO (salida)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Caja: sesiones y cierres
-- ---------------------------------------------------------------------
create table public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid not null,
  opened_by       uuid references auth.users(id),
  opened_at       timestamptz not null default now(),
  opening_float   bigint not null default 0 check (opening_float >= 0),  -- fondo de caja inicial
  status          text not null default 'open' check (status in ('open','closed')),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
-- Una sola caja abierta por centro
create unique index cash_sessions_one_open on public.cash_sessions (location_id) where status = 'open';
create index cash_sessions_org_idx on public.cash_sessions (organization_id, opened_at desc);

-- Entradas/salidas manuales de efectivo (cambio, pago a proveedor en efectivo, retirada)
create table public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cash_session_id uuid not null,
  kind            text not null check (kind in ('cash_in','cash_out')),
  amount          bigint not null check (amount > 0),
  reason          text not null check (length(trim(reason)) > 0),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, cash_session_id) references public.cash_sessions (organization_id, id)
);

-- Cierres versionados: reabrir no borra, marca el cierre como superseded y el siguiente cierre es versión+1.
create table public.cash_closings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cash_session_id uuid not null,
  version         int not null default 1 check (version > 0),
  sales_count     int not null default 0,
  sales_total     bigint not null default 0,
  totals_by_method jsonb not null default '{}'::jsonb,   -- {"cash":12200,"card":32000,"bizum":4000}
  opening_float   bigint not null default 0,
  cash_in         bigint not null default 0,
  cash_out        bigint not null default 0,
  expected_cash   bigint not null,                        -- fondo + efectivo ventas + entradas - salidas
  counted_cash    bigint not null check (counted_cash >= 0),
  difference      bigint generated always as (counted_cash - expected_cash) stored,
  status          text generated always as (case when counted_cash = expected_cash then 'balanced' else 'discrepancy' end) stored,
  notes           text,
  closed_by       uuid references auth.users(id),
  closed_at       timestamptz not null default now(),
  superseded_at   timestamptz,
  superseded_by   uuid references auth.users(id),
  reopen_reason   text,
  unique (cash_session_id, version),
  foreign key (organization_id, cash_session_id) references public.cash_sessions (organization_id, id)
);
create unique index cash_closings_one_current on public.cash_closings (cash_session_id) where superseded_at is null;

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid not null,
  number          bigint,                    -- nº de ticket correlativo por empresa (asignado por trigger)
  occurred_at     timestamptz not null default now(),
  time_precision  text not null default 'exact' check (time_precision in ('exact','day','month')),
  granularity     text not null default 'transaction' check (granularity in ('transaction','aggregate')),
  customer_id     uuid,
  seller_id       uuid references auth.users(id),
  cash_session_id uuid,
  subtotal        bigint not null,            -- base imponible
  tax_total       bigint not null,
  discount_total  bigint not null default 0 check (discount_total >= 0),
  total           bigint not null,
  status          text not null default 'completed' check (status in ('completed','pending_payment','voided')),
  source          text not null default 'pos' check (source in ('pos','manual','import','membership','online')),
  notes           text,
  import_id       uuid,
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id),
  void_reason     text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  check (total = subtotal + tax_total),
  check (status <> 'voided' or (voided_at is not null and void_reason is not null)),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, cash_session_id) references public.cash_sessions (organization_id, id)
);
create index sales_org_date_idx on public.sales (organization_id, occurred_at desc);
create index sales_location_date_idx on public.sales (organization_id, location_id, occurred_at desc);
create index sales_customer_idx on public.sales (organization_id, customer_id) where customer_id is not null;
create index sales_session_idx on public.sales (cash_session_id) where cash_session_id is not null;
create trigger trg_sales_touch before update on public.sales
  for each row execute function app.touch_updated_at();

create table public.organization_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counter         text not null,
  value           bigint not null default 0,
  primary key (organization_id, counter)
);

create or replace function app.next_counter(org uuid, name text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  insert into public.organization_counters (organization_id, counter, value) values (org, name, 1)
  on conflict (organization_id, counter) do update set value = organization_counters.value + 1
  returning value into v;
  return v;
end $$;

create or replace function app.assign_sale_number() returns trigger
language plpgsql as $$
begin
  if new.number is null then
    new.number := app.next_counter(new.organization_id, 'sale');
  end if;
  return new;
end $$;
create trigger trg_sales_number before insert on public.sales
  for each row execute function app.assign_sale_number();

create table public.sale_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sale_id         uuid not null,
  product_id      uuid,                       -- null solo en líneas libres o importadas sin match
  -- Snapshot inmutable de lo vendido:
  product_name    text not null,
  product_kind    text not null default 'physical',
  category_id     uuid,
  category_name   text,
  quantity        numeric(12,3) not null check (quantity > 0),
  unit_price      bigint not null check (unit_price >= 0),   -- IVA incluido
  discount        bigint not null default 0 check (discount >= 0),
  tax_rate_bp     int not null check (tax_rate_bp between 0 and 10000),
  base_amount     bigint not null,
  tax_amount      bigint not null,
  total           bigint not null,
  created_at      timestamptz not null default now(),
  check (total = base_amount + tax_amount),
  foreign key (organization_id, sale_id) references public.sales (organization_id, id),
  foreign key (organization_id, product_id) references public.products (organization_id, id),
  foreign key (organization_id, category_id) references public.product_categories (organization_id, id)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (organization_id, product_id);

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id      uuid not null,
  location_id     uuid,
  delta           numeric(12,3) not null check (delta <> 0),
  reason          text not null check (reason in ('sale','sale_void','restock','adjustment','loss','import')),
  sale_item_id    uuid references public.sale_items(id),
  note            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, product_id) references public.products (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create index stock_movements_product_idx on public.stock_movements (organization_id, product_id, created_at desc);

-- ---------------------------------------------------------------------
-- Facturas emitidas
-- ---------------------------------------------------------------------
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid,
  series_id       uuid,
  number          text,                        -- número fiscal completo (asignado al emitir)
  external_number text,                        -- número en el sistema de origen (p. ej. BeMadBox T2600001)
  issue_date      date,
  due_date        date,
  customer_id     uuid,
  -- Snapshot fiscal del cliente en el momento de emitir
  customer_name   text,
  customer_tax_id text,
  customer_address text,
  concept         text,
  service_period_start date,                   -- periodo de servicio ≠ fecha de emisión
  service_period_end   date,
  subtotal        bigint not null default 0,
  tax_total       bigint not null default 0,
  total           bigint not null default 0,
  amount_paid     bigint not null default 0 check (amount_paid >= 0),
  status          text not null default 'draft' check (status in ('draft','issued','paid','partially_paid','void')),
  payment_method_id uuid,
  paid_at         timestamptz,
  sale_id         uuid,
  customer_membership_id uuid,
  rectifies_invoice_id uuid,
  notes           text,
  source          text not null default 'manual' check (source in ('manual','sale','membership','import')),
  import_id       uuid,
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id),
  void_reason     text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (total = subtotal + tax_total),
  check (status = 'draft' or issue_date is not null),
  check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  check (service_period_end is null or service_period_start is null or service_period_end >= service_period_start),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, series_id) references public.document_series (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, payment_method_id) references public.payment_methods (organization_id, id),
  foreign key (organization_id, sale_id) references public.sales (organization_id, id),
  foreign key (organization_id, customer_membership_id) references public.customer_memberships (organization_id, id),
  foreign key (organization_id, rectifies_invoice_id) references public.invoices (organization_id, id)
);
create unique index invoices_number_uq on public.invoices (organization_id, number) where number is not null;
create unique index invoices_external_uq on public.invoices (organization_id, external_number) where external_number is not null;
create index invoices_org_issue_idx on public.invoices (organization_id, issue_date desc);
create index invoices_customer_idx on public.invoices (organization_id, customer_id);
create index invoices_pending_idx on public.invoices (organization_id, status) where status in ('issued','partially_paid');
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

create table public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id      uuid not null,
  description     text not null,
  quantity        numeric(12,3) not null default 1 check (quantity > 0),
  unit_price      bigint not null,            -- IVA incluido
  tax_rate_bp     int not null check (tax_rate_bp between 0 and 10000),
  base_amount     bigint not null,
  tax_amount      bigint not null,
  total           bigint not null,
  product_id      uuid,
  plan_version_id uuid,
  sort_order      int not null default 0,
  check (total = base_amount + tax_amount),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id),
  foreign key (organization_id, product_id) references public.products (organization_id, id),
  foreign key (organization_id, plan_version_id) references public.membership_plan_versions (organization_id, id)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- Numeración fiscal sin huecos: se asigna en la misma transacción que la emisión, con bloqueo de fila.
create or replace function app.assign_invoice_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.document_series%rowtype;
begin
  if new.status <> 'draft' and new.number is null and new.source <> 'import' then
    if new.series_id is null then
      raise exception 'Una factura emitida necesita serie' using errcode = 'check_violation';
    end if;
    select * into s from public.document_series where id = new.series_id and organization_id = new.organization_id for update;
    new.number := s.prefix || lpad(s.next_number::text, s.padding, '0');
    update public.document_series set next_number = next_number + 1 where id = s.id;
  end if;
  return new;
end $$;
create trigger trg_invoices_number before insert or update of status on public.invoices
  for each row execute function app.assign_invoice_number();

-- ---------------------------------------------------------------------
-- Cargos recurrentes de membresía
-- ---------------------------------------------------------------------
create table public.membership_charges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_membership_id uuid not null,
  period_start    date not null,
  period_end      date not null,
  amount          bigint not null check (amount >= 0),
  status          text not null default 'scheduled' check (status in ('scheduled','invoiced','paid','failed','waived')),
  invoice_id      uuid,
  sale_id         uuid,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (customer_membership_id, period_start),
  check (period_end >= period_start),
  foreign key (organization_id, customer_membership_id) references public.customer_memberships (organization_id, id),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id),
  foreign key (organization_id, sale_id) references public.sales (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Pagos / cobros (también devoluciones: kind = 'refund')
-- ---------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid,
  kind            text not null default 'charge' check (kind in ('charge','refund')),
  sale_id         uuid,
  invoice_id      uuid,
  membership_charge_id uuid,
  customer_id     uuid,
  payment_method_id uuid not null,
  method_kind     text not null,                -- snapshot de payment_methods.kind
  amount          bigint not null check (amount > 0),
  status          text not null default 'succeeded' check (status in ('pending','succeeded','failed','cancelled')),
  paid_at         timestamptz not null default now(),
  cash_session_id uuid,
  reference       text,
  external_id     text,                         -- Stripe/Redsys
  refund_of_payment_id uuid,
  source          text not null default 'pos' check (source in ('pos','manual','import','stripe','redsys','bank')),
  import_id       uuid,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (sale_id is not null or invoice_id is not null or membership_charge_id is not null or kind = 'refund'),
  check (kind <> 'refund' or refund_of_payment_id is not null),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, sale_id) references public.sales (organization_id, id),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id),
  foreign key (organization_id, membership_charge_id) references public.membership_charges (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id),
  foreign key (organization_id, payment_method_id) references public.payment_methods (organization_id, id),
  foreign key (organization_id, cash_session_id) references public.cash_sessions (organization_id, id),
  foreign key (organization_id, refund_of_payment_id) references public.payments (organization_id, id)
);
create index payments_org_date_idx on public.payments (organization_id, paid_at desc);
create index payments_sale_idx on public.payments (sale_id) where sale_id is not null;
create index payments_invoice_idx on public.payments (invoice_id) where invoice_id is not null;
create index payments_session_idx on public.payments (cash_session_id) where cash_session_id is not null;

-- ---------------------------------------------------------------------
-- Gastos y proveedores
-- ---------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  tax_id          text,
  tax_id_normalized text generated always as (app.normalize_tax_id(tax_id)) stored,
  email           text,
  phone           text,
  address         text,
  default_category_id uuid,
  notes           text,
  status          text not null default 'active' check (status in ('active','inactive','archived')),
  import_id       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index suppliers_tax_id_uq on public.suppliers (organization_id, tax_id_normalized) where tax_id_normalized is not null and status <> 'archived';
create trigger trg_suppliers_touch before update on public.suppliers
  for each row execute function app.touch_updated_at();

create table public.expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid,
  name            text not null,
  default_tax_rate_bp int check (default_tax_rate_bp between 0 and 10000),
  status          text not null default 'active' check (status in ('active','archived')),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.expense_categories (organization_id, id)
);
alter table public.suppliers add foreign key (organization_id, default_category_id) references public.expense_categories (organization_id, id);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id     uuid,
  supplier_id     uuid,
  category_id     uuid,
  supplier_invoice_number text,
  issue_date      date not null,
  due_date        date,
  description     text not null,
  subtotal        bigint not null,
  tax_rate_bp     int,
  tax_total       bigint not null default 0,
  total           bigint not null,
  payment_method_id uuid,
  status          text not null default 'pending' check (status in ('pending','paid','void')),
  paid_at         timestamptz,
  source          text not null default 'manual' check (source in ('manual','import','ocr','bank')),
  import_id       uuid,
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id),
  void_reason     text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (total = subtotal + tax_total),
  check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id),
  foreign key (organization_id, category_id) references public.expense_categories (organization_id, id),
  foreign key (organization_id, payment_method_id) references public.payment_methods (organization_id, id)
);
create index expenses_org_date_idx on public.expenses (organization_id, issue_date desc);
-- Detección de duplicados de facturas de proveedor
create unique index expenses_supplier_doc_uq on public.expenses (organization_id, supplier_id, supplier_invoice_number)
  where supplier_invoice_number is not null and status <> 'void';
create trigger trg_expenses_touch before update on public.expenses
  for each row execute function app.touch_updated_at();

-- Conciliación bancaria (posterior): movimientos de extracto
create table public.bank_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_label   text not null,
  booked_at       date not null,
  amount          bigint not null,               -- + entrada, - salida
  description     text,
  counterparty    text,
  reference       text,
  matched_entity_type text check (matched_entity_type in ('payment','expense','invoice')),
  matched_entity_id uuid,
  match_status    text not null default 'unmatched' check (match_status in ('unmatched','suggested','matched','ignored')),
  import_id       uuid,
  created_at      timestamptz not null default now()
);
create index bank_transactions_org_idx on public.bank_transactions (organization_id, booked_at desc);
