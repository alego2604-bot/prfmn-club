-- =====================================================================
-- Business OS · 0400 · Documentos, importaciones, auditoría, integridad
-- =====================================================================

-- ---------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid,
  storage_path    text not null,               -- bucket 'documents/<organization_id>/...'
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes >= 0),
  sha256          text not null,
  kind            text not null default 'other'
                  check (kind in ('invoice_issued','invoice_received','receipt','contract','bank_statement','tax','advisor','import_source','report','other')),
  folder          text,                        -- '2026/Facturas recibidas'
  document_date   date,
  supplier_id     uuid,
  customer_id     uuid,
  tags            text[] not null default '{}',
  notes           text,
  extraction_status text not null default 'none' check (extraction_status in ('none','pending','extracted','confirmed','failed')),
  extracted_data  jsonb,                       -- propuesta de OCR/IA (nunca se aplica sin confirmación)
  uploaded_by     uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id)
);
create index documents_org_idx on public.documents (organization_id, document_date desc) where deleted_at is null;
create index documents_sha_idx on public.documents (organization_id, sha256);

create table public.document_links (
  organization_id uuid not null,
  document_id     uuid not null,
  entity_type     text not null check (entity_type in ('invoice','expense','sale','customer','supplier','import','cash_closing','payment')),
  entity_id       uuid not null,
  created_at      timestamptz not null default now(),
  primary key (document_id, entity_type, entity_id),
  foreign key (organization_id, document_id) references public.documents (organization_id, id) on delete cascade
);
create index document_links_entity_idx on public.document_links (organization_id, entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Importaciones
-- ---------------------------------------------------------------------
create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid,
  kind            text not null check (kind in ('sales','invoices','customers','catalog','attendance','expenses','bank')),
  file_name       text not null,
  file_sha256     text not null,
  document_id     uuid,                         -- original guardado en Storage
  status          text not null default 'draft' check (status in ('draft','validated','importing','completed','failed','reverted')),
  mapping         jsonb not null default '{}'::jsonb,
  options         jsonb not null default '{}'::jsonb,
  summary         jsonb not null default '{}'::jsonb,  -- {"found":942,"valid":901,"duplicates":27,"review":10,"errors":4,...}
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  reverted_at     timestamptz,
  reverted_by     uuid references auth.users(id),
  revert_reason   text,
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, document_id) references public.documents (organization_id, id)
);
create index imports_org_idx on public.imports (organization_id, created_at desc);
create index imports_sha_idx on public.imports (organization_id, file_sha256);

create table public.import_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  import_id       uuid not null,
  sheet           text,
  row_number      int,
  raw             jsonb not null,
  status          text not null check (status in ('valid','review','duplicate','error','ignored','imported')),
  confidence      text check (confidence in ('high','medium','review')),
  messages        jsonb not null default '[]'::jsonb,   -- [{"code":"PRICE_DIFFERS","text":"..."}]
  decision        text check (decision in ('import','ignore','link','create_new')),
  entity_type     text,
  entity_id       uuid,
  action          text check (action in ('created','updated','linked','skipped')),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, import_id) references public.imports (organization_id, id) on delete cascade
);
create index import_records_import_idx on public.import_records (import_id, status);
create index import_records_entity_idx on public.import_records (organization_id, entity_type, entity_id);

-- import_id en las tablas que pueden nacer de una importación
do $$
declare t text;
begin
  foreach t in array array['products','membership_plans','customers','customer_memberships','attendance','sales',
                           'invoices','payments','suppliers','expenses','bank_transactions']
  loop
    execute format('alter table public.%I add constraint %I foreign key (organization_id, import_id) references public.imports (organization_id, id)',
                   t, t || '_import_fk');
    execute format('create index %I on public.%I (import_id) where import_id is not null', t || '_import_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Notificaciones
-- ---------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id),     -- null = para todo el equipo con permiso
  kind            text not null,                       -- cash_not_closed, payment_failed, invoice_pending, membership_ending, low_stock, inactive_customer, task_due
  severity        text not null default 'info' check (severity in ('info','warning','danger')),
  title           text not null,
  body            text,
  entity_type     text,
  entity_id       uuid,
  dedupe_key      text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create unique index notifications_dedupe_uq on public.notifications (organization_id, dedupe_key) where dedupe_key is not null and read_at is null;
create index notifications_user_idx on public.notifications (organization_id, user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Auditoría (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_id        uuid,
  action          text not null,           -- insert | update | delete | void | close | reopen | price_change | import | revert ...
  entity_type     text not null,
  entity_id       uuid,
  changes         jsonb,                   -- {"price":{"from":1500,"to":1700}}
  context         jsonb,                   -- {"reason":"...","import_id":"..."}
  created_at      timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (organization_id, entity_type, entity_id);

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% sobre % no está permitido (registro inmutable)', tg_op, tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

-- Trigger genérico: guarda solo los campos que cambian
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
  o jsonb;
  n jsonb;
  act text := lower(tg_op);
begin
  if tg_op = 'INSERT' then
    n := to_jsonb(new);
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
    values (new.organization_id, auth.uid(), 'insert', tg_table_name, (n->>'id')::uuid, null);
    return new;
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
    if diff ? 'status' and (n->>'status') in ('void','voided') then act := 'void';
    elsif diff ? 'price' then act := 'price_change';
    elsif diff ? 'status' and (n->>'status') = 'archived' then act := 'archive';
    end if;
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
    values (new.organization_id, auth.uid(), act, tg_table_name, (n->>'id')::uuid, diff);
    return new;
  else
    o := to_jsonb(old);
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
    values (old.organization_id, auth.uid(), 'delete', tg_table_name, (o->>'id')::uuid, jsonb_build_object('before', o));
    return old;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations','locations','organization_members','tax_rates','payment_methods','document_series',
                           'organization_settings','product_categories','products','membership_plans','membership_plan_versions',
                           'customers','customer_memberships','customer_notes','tasks','message_templates','communications',
                           'cash_sessions','cash_closings','cash_movements','sales','invoices','payments','suppliers',
                           'expense_categories','expenses','documents','imports']
  loop
    if t = 'organizations' then
      -- organizations no tiene organization_id: auditoría con su propio id
      continue;
    end if;
    if t = 'organization_settings' then
      continue;
    end if;
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()',
                   'trg_' || t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Integridad financiera
-- ---------------------------------------------------------------------
-- Registros financieros: prohibido DELETE (también para service_role)
do $$
declare t text;
begin
  foreach t in array array['sales','sale_items','payments','invoices','invoice_items','cash_sessions','cash_closings',
                           'cash_movements','stock_movements','membership_charges','expenses']
  loop
    execute format('create trigger %I before delete on public.%I for each row execute function app.forbid_mutation()',
                   'trg_' || t || '_no_delete', t);
  end loop;
end $$;

-- Las líneas de venta/factura, pagos, movimientos de caja y stock no se editan: se compensan con registros nuevos.
do $$
declare t text;
begin
  foreach t in array array['sale_items','cash_movements','stock_movements']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_mutation()',
                   'trg_' || t || '_no_update', t);
  end loop;
end $$;

-- Venta: solo se permite anular (y notas). Importes y fecha son inmutables.
create or replace function app.guard_sale_update() returns trigger
language plpgsql as $$
begin
  if (new.subtotal, new.tax_total, new.total, new.discount_total, new.occurred_at, new.location_id, new.organization_id, new.number)
     is distinct from (old.subtotal, old.tax_total, old.total, old.discount_total, old.occurred_at, old.location_id, old.organization_id, old.number) then
    raise exception 'Los importes, fecha y centro de una venta no se pueden modificar; anúlala y crea otra' using errcode = 'insufficient_privilege';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'Una venta anulada no puede reactivarse' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger trg_sales_guard before update on public.sales for each row execute function app.guard_sale_update();

-- Pagos: solo cambia el estado (pending → succeeded/failed/cancelled)
create or replace function app.guard_payment_update() returns trigger
language plpgsql as $$
begin
  if (new.amount, new.payment_method_id, new.kind, new.sale_id, new.invoice_id, new.organization_id)
     is distinct from (old.amount, old.payment_method_id, old.kind, old.sale_id, old.invoice_id, old.organization_id) then
    raise exception 'Un pago no se modifica; regístralo como devolución y crea uno nuevo' using errcode = 'insufficient_privilege';
  end if;
  if old.status in ('succeeded','failed','cancelled') and new.status <> old.status then
    raise exception 'Estado final de pago: crea una devolución' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger trg_payments_guard before update on public.payments for each row execute function app.guard_payment_update();

-- Factura emitida: importes, cliente y número inmutables. Solo cobro y anulación.
create or replace function app.guard_invoice_update() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' then
    if (new.subtotal, new.tax_total, new.total, new.customer_id, new.customer_tax_id, new.issue_date, new.number, new.organization_id)
       is distinct from (old.subtotal, old.tax_total, old.total, old.customer_id, old.customer_tax_id, old.issue_date, old.number, old.organization_id) then
      raise exception 'Una factura emitida no se modifica; anúlala o emite una rectificativa' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'draft' then
      raise exception 'Una factura emitida no vuelve a borrador' using errcode = 'insufficient_privilege';
    end if;
    if old.status = 'void' and new.status <> 'void' then
      raise exception 'Una factura anulada no se reactiva' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger trg_invoices_guard before update on public.invoices for each row execute function app.guard_invoice_update();

create or replace function app.guard_invoice_items() returns trigger
language plpgsql as $$
declare st text;
begin
  select status into st from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if st is distinct from 'draft' then
    raise exception 'Las líneas de una factura emitida son inmutables' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_invoice_items_guard before update on public.invoice_items for each row execute function app.guard_invoice_items();

-- Cierres: solo se pueden marcar como superseded (reapertura)
create or replace function app.guard_cash_closing_update() returns trigger
language plpgsql as $$
begin
  if old.superseded_at is not null then
    raise exception 'Cierre ya reemplazado' using errcode = 'insufficient_privilege';
  end if;
  if (new.counted_cash, new.expected_cash, new.totals_by_method, new.cash_session_id, new.version, new.closed_at)
     is distinct from (old.counted_cash, old.expected_cash, old.totals_by_method, old.cash_session_id, old.version, old.closed_at) then
    raise exception 'Un cierre no se edita; reabre la caja y vuelve a cerrar' using errcode = 'insufficient_privilege';
  end if;
  if new.superseded_at is null or new.reopen_reason is null then
    raise exception 'Reabrir un cierre requiere motivo' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_cash_closings_guard before update on public.cash_closings for each row execute function app.guard_cash_closing_update();

-- Productos/categorías/tarifas/clientes: sin borrado físico (se archivan). Si tienen histórico, la FK ya lo impide;
-- este trigger lo hace explícito y uniforme.
do $$
declare t text;
begin
  foreach t in array array['products','product_categories','membership_plans','membership_plan_versions','customers',
                           'payment_methods','tax_rates','locations','suppliers','document_series']
  loop
    execute format('create trigger %I before delete on public.%I for each row execute function app.forbid_mutation()',
                   'trg_' || t || '_no_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Alta de empresa (RPC): crea org + centro + owner + configuración por defecto
-- ---------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_vertical text default 'fitness',
  p_location_name text default 'Principal',
  p_legal_name text default null,
  p_tax_id text default null,
  p_is_demo boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_owner_role uuid;
begin
  if v_user is null then
    raise exception 'Necesitas iniciar sesión' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, legal_name, tax_id, vertical, is_demo, created_by)
  values (p_name, p_legal_name, p_tax_id, p_vertical, p_is_demo, v_user)
  returning id into v_org;

  insert into public.locations (organization_id, name) values (v_org, p_location_name);

  select id into v_owner_role from public.roles where organization_id is null and key = 'owner';
  insert into public.organization_members (organization_id, user_id, role_id) values (v_org, v_user, v_owner_role);

  insert into public.organization_subscriptions (organization_id, trial_ends_at) values (v_org, now() + interval '30 days');
  insert into public.organization_settings (organization_id) values (v_org);

  insert into public.tax_rates (organization_id, name, rate_bp, is_default) values
    (v_org, 'IVA general 21 %', 2100, true),
    (v_org, 'IVA reducido 10 %', 1000, false),
    (v_org, 'IVA superreducido 4 %', 400, false),
    (v_org, 'Exento 0 %', 0, false);

  insert into public.payment_methods (organization_id, key, name, kind, affects_cash_drawer, sort_order) values
    (v_org, 'cash',         'Efectivo',       'cash',         true,  1),
    (v_org, 'card',         'Tarjeta',        'card',         false, 2),
    (v_org, 'bizum',        'Bizum',          'bizum',        false, 3),
    (v_org, 'online',       'TPV online',     'online',       false, 4),
    (v_org, 'transfer',     'Transferencia',  'transfer',     false, 5),
    (v_org, 'direct_debit', 'Domiciliación',  'direct_debit', false, 6),
    (v_org, 'other',        'Otro',           'other',        false, 7),
    (v_org, 'unknown',      'Desconocido (importado)', 'unknown', false, 99);

  insert into public.document_series (organization_id, code, document_type, prefix, year) values
    (v_org, 'F', 'invoice', 'F' || to_char(now(), 'YYYY') || '-', extract(year from now())::smallint),
    (v_org, 'R', 'credit_note', 'R' || to_char(now(), 'YYYY') || '-', extract(year from now())::smallint);

  insert into public.organization_modules (organization_id, module_key)
  select v_org, m from unnest(array['core.sales','core.cash','core.catalog','core.customers','core.finance',
                                    'core.communications','core.analytics','core.documents','core.imports']) m;
  if p_vertical in ('fitness','gym','functional_training') then
    insert into public.organization_modules (organization_id, module_key)
    select v_org, m from unnest(array['fitness.memberships','fitness.attendance','fitness.drop_ins','fitness.classes']) m;
  end if;

  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, text, text, boolean) from public;
grant execute on function public.create_organization(text, text, text, text, text, boolean) to authenticated;
