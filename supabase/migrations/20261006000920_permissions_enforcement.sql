-- =====================================================================
-- Business OS · 0920 · Permisos aplicados en el servidor (cobros, equipo, datos sensibles) y auditoría
--   Forward-only y NO destructiva: no borra ni reescribe datos. Reversión: supabase/rollbacks/20261006000920_down.sql
--
--   A. Cobros: nadie sin `payments.manage` puede registrar/modificar un cobro de factura o de cuota, marcar una factura como
--      cobrada ni crear un cobro parcial, ni por sync_push ni por PostgREST directo. El cobro de caja (venta) sigue siendo de
--      quien vende. El encargado (manager) recibe `payments.manage` (decisión de producto: cobra cuotas operativas).
--   B. Equipo: el owner no se puede modificar ni degradar desde la API; nadie cambia su propio rol, estado ni permisos; no se
--      puede conceder un rol ni un permiso que uno mismo no tiene. Excepciones individuales (`permission_overrides`)
--      validadas y con RPC `set_member_overrides`. Cierra la escalada por PostgREST directo (admin → owner).
--   C. customers.sensitive: columnas fiscales/personales de `customers` fuera del SELECT de la API (vista `customers_safe` +
--      RPC `customers_sensitive`, solo con el permiso); su escritura exige el permiso. La copia fiscal de la factura se
--      completa en el servidor, así quien emite una cuota sin ver el NIF no deja la factura incompleta.
--   D. Auditoría: «permission_change» al cambiar excepciones; los registros de clientes con datos sensibles solo los ve quien
--      tiene customers.sensitive; arreglo de 0910 (location_ids → «todos» perdía el valor «to»).
--   E. sync_push v3 (misma firma): devuelve solo columnas que el rol puede leer. server_capabilities().schema = 920.
-- Tests: supabase/tests/rls_isolation.sql (sección 0920) y src/data/cloud/security.integration.test.ts (contra el servidor).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A0. Encargado: cobra (payments.manage)
-- ---------------------------------------------------------------------
insert into public.role_permissions (role_id, permission)
select r.id, 'payments.manage' from public.roles r where r.organization_id is null and r.key = 'manager'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- A1. Cobros (payments)
-- ---------------------------------------------------------------------
create or replace function app.guard_payment_insert() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare org uuid := new.organization_id;
begin
  if auth.uid() is null then return new; end if;            -- servicio / mantenimiento
  if new.kind = 'refund' then
    -- Devolución: quien gestiona cobros; o, solo si compensa un cobro de caja, quien anula la venta (anular venta = devolver)
    if app.has_permission(org, 'payments.manage')
       or (new.sale_id is not null and new.invoice_id is null and new.membership_charge_id is null and app.has_permission(org, 'sales.void')) then
      return new;
    end if;
    raise exception 'No tienes permiso para registrar devoluciones (payments.manage)' using errcode = 'insufficient_privilege';
  end if;
  if new.invoice_id is not null or new.membership_charge_id is not null or new.sale_id is null then
    -- Cobro de factura, de cuota o suelto: solo cobros/pagos
    if not app.has_permission(org, 'payments.manage') then
      raise exception 'No tienes permiso para registrar cobros de facturas o cuotas (payments.manage)' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  -- Cobro de una venta de caja
  if not (app.has_permission(org, 'pos.sell') or app.has_permission(org, 'payments.manage')) then
    raise exception 'No tienes permiso para cobrar en caja (pos.sell)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_permission on public.payments;
create trigger trg_payments_permission before insert on public.payments
  for each row execute function app.guard_payment_insert();

-- ---------------------------------------------------------------------
-- A2. Facturas: el estado de cobro y el resto de campos tienen permisos distintos
--     (cobrar = payments.manage; emitir, anular, editar = invoices.manage)
-- ---------------------------------------------------------------------
create or replace function app.guard_invoice_permissions() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  org uuid := new.organization_id;
  paid_set constant text[] := array['paid', 'partially_paid'];
  pay boolean;
  other boolean;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.status = any (paid_set) or new.amount_paid > 0) and not app.has_permission(org, 'payments.manage') then
      raise exception 'No tienes permiso para registrar cobros (payments.manage)' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  -- UPDATE: ¿qué cambia?
  pay := (new.amount_paid, new.paid_at, new.payment_method_id) is distinct from (old.amount_paid, old.paid_at, old.payment_method_id)
         or (new.status is distinct from old.status and (old.status = any (paid_set) or new.status = any (paid_set)));
  other := (to_jsonb(new) - array['status', 'amount_paid', 'paid_at', 'payment_method_id', 'updated_at'])
           is distinct from (to_jsonb(old) - array['status', 'amount_paid', 'paid_at', 'payment_method_id', 'updated_at'])
           or (new.status is distinct from old.status
               and not (old.status in ('issued', 'partially_paid') and new.status = any (paid_set)));  -- emitir/anular/etc.
  if pay and not app.has_permission(org, 'payments.manage') then
    raise exception 'No tienes permiso para registrar cobros (payments.manage)' using errcode = 'insufficient_privilege';
  end if;
  if other and not app.has_permission(org, 'invoices.manage') then
    raise exception 'No tienes permiso para editar, emitir o anular facturas (invoices.manage)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_permissions on public.invoices;
create trigger trg_invoices_permissions before insert or update on public.invoices
  for each row execute function app.guard_invoice_permissions();

-- Cobrar una factura (payments.manage) actualiza solo su estado de cobro; el trigger anterior lo acota. Antes solo podía
-- actualizar quien tiene invoices.manage.
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using ((app.has_permission(organization_id, 'invoices.manage') or app.has_permission(organization_id, 'payments.manage'))
         and app.can_access_location(organization_id, location_id))
  with check ((app.has_permission(organization_id, 'invoices.manage') or app.has_permission(organization_id, 'payments.manage'))
              and app.can_access_location(organization_id, location_id));

-- Cuota de membresía: emitir su factura es una operación de membresías (memberships.manage), no de facturación libre.
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check ((app.has_permission(organization_id, 'invoices.manage')
               or (source = 'membership' and app.has_permission(organization_id, 'memberships.manage')))
              and app.can_access_location(organization_id, location_id));
drop policy if exists invoice_items_insert on public.invoice_items;
create policy invoice_items_insert on public.invoice_items for insert to authenticated
  with check (app.has_permission(organization_id, 'invoices.manage')
              or (app.has_permission(organization_id, 'memberships.manage')
                  and exists (select 1 from public.invoices i where i.id = invoice_id and i.organization_id = invoice_items.organization_id and i.source = 'membership')));

-- ---------------------------------------------------------------------
-- A3. Cuotas: marcarlas como cobradas es cobrar
-- ---------------------------------------------------------------------
create or replace function app.guard_membership_charge_paid() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid')
     and not app.has_permission(new.organization_id, 'payments.manage') then
    raise exception 'No tienes permiso para registrar cobros (payments.manage)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_membership_charges_paid on public.membership_charges;
create trigger trg_membership_charges_paid before insert or update on public.membership_charges
  for each row execute function app.guard_membership_charge_paid();

-- ---------------------------------------------------------------------
-- B. Equipo: miembros, excepciones y roles
-- ---------------------------------------------------------------------
-- ¿Tiene quien actúa todos los permisos de este rol? (no se puede conceder un rol mayor que el propio)
create or replace function app.actor_holds_role(org uuid, p_role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role
      and not app.has_permission(org, rp.permission)
  )
$$;

create or replace function app.valid_permission_overrides(o jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
        jsonb_typeof(o) = 'object'
        and (select coalesce(bool_and(k in ('grant', 'revoke')), true) from jsonb_object_keys(o) k)
        and jsonb_typeof(o -> 'grant') = 'array' and jsonb_typeof(o -> 'revoke') = 'array'
        and not exists (select 1 from jsonb_array_elements(o -> 'grant') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z_]+\.[a-z_]+$')
        and not exists (select 1 from jsonb_array_elements(o -> 'revoke') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z_]+\.[a-z_]+$'),
      false)      -- cualquier forma rara (claves que faltan, no objeto, null) = no válido
$$;

create or replace function app.guard_member_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid := new.organization_id;
  new_role text;
  old_role text;
  old_ov jsonb := null;
  p text;
begin
  if auth.uid() is null then return new; end if;            -- servicio / mantenimiento
  if tg_op = 'UPDATE' then old_ov := old.permission_overrides; end if;
  if not exists (select 1 from public.roles r where r.id = new.role_id and (r.organization_id is null or r.organization_id = org)) then
    raise exception 'Rol no válido' using errcode = 'check_violation';
  end if;
  select key into new_role from public.roles where id = new.role_id;
  if not app.valid_permission_overrides(new.permission_overrides) then
    raise exception 'Excepciones de permisos no válidas' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements_text((new.permission_overrides -> 'grant') || (new.permission_overrides -> 'revoke')) k
             where not exists (select 1 from public.permissions x where x.key = k)) then
    raise exception 'Permiso desconocido en las excepciones' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new_role = 'owner' then
      -- Solo el alta de la empresa crea el primer owner; después, nunca más desde la API
      if exists (select 1 from public.organization_members m join public.roles r on r.id = m.role_id and r.key = 'owner' and r.organization_id is null
                 where m.organization_id = org and m.id <> new.id) then
        raise exception 'Solo puede haber un owner por empresa' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.user_id = auth.uid() then
      raise exception 'No puedes añadirte a ti mismo' using errcode = 'insufficient_privilege';
    end if;
    if not app.actor_holds_role(org, new.role_id) then
      raise exception 'No puedes conceder un rol con más permisos que los tuyos' using errcode = 'insufficient_privilege';
    end if;
  else
    if (new.organization_id, new.user_id) is distinct from (old.organization_id, old.user_id) then
      raise exception 'Un miembro no cambia de empresa ni de usuario' using errcode = 'insufficient_privilege';
    end if;
    select key into old_role from public.roles where id = old.role_id;
    if old_role = 'owner' then
      if (new.role_id, new.status, new.location_ids, new.permission_overrides) is distinct from (old.role_id, old.status, old.location_ids, old.permission_overrides) then
        raise exception 'El owner no se puede modificar' using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
    if new_role = 'owner' then
      raise exception 'Solo puede haber un owner por empresa' using errcode = 'check_violation';
    end if;
    if new.user_id = auth.uid()
       and (new.role_id, new.status, new.location_ids, new.permission_overrides) is distinct from (old.role_id, old.status, old.location_ids, old.permission_overrides) then
      raise exception 'No puedes cambiar tu propio rol, estado, centros ni permisos' using errcode = 'insufficient_privilege';
    end if;
    if new.role_id is distinct from old.role_id and not app.actor_holds_role(org, new.role_id) then
      raise exception 'No puedes conceder un rol con más permisos que los tuyos' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Excepciones: el owner no admite; solo se concede lo que se tiene (denegar es libre)
  if new.permission_overrides is distinct from old_ov then
    if new_role = 'owner' and (new.permission_overrides -> 'grant' <> '[]'::jsonb or new.permission_overrides -> 'revoke' <> '[]'::jsonb) then
      raise exception 'El owner no admite excepciones de permisos' using errcode = 'insufficient_privilege';
    end if;
    for p in select g from jsonb_array_elements_text(new.permission_overrides -> 'grant') g
             where not (coalesce(old_ov -> 'grant', '[]'::jsonb) ? g)
    loop
      if not app.has_permission(org, p) then
        raise exception 'No puedes conceder un permiso que no tienes (%)', p using errcode = 'insufficient_privilege';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_members_guard on public.organization_members;
create trigger trg_members_guard before insert or update on public.organization_members
  for each row execute function app.guard_member_change();

-- Roles personalizados: no se les puede dar más de lo que uno tiene
create or replace function app.guard_role_permission_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid;
begin
  if auth.uid() is null then return new; end if;
  select organization_id into org from public.roles where id = new.role_id;
  if org is null then
    raise exception 'Los roles de sistema no se modifican' using errcode = 'insufficient_privilege';
  end if;
  if new.permission <> '*' and not exists (select 1 from public.permissions x where x.key = new.permission) then
    raise exception 'Permiso desconocido' using errcode = 'check_violation';
  end if;
  if not app.has_permission(org, new.permission) then      -- '*' solo lo concede quien tiene '*' (el catálogo no incluye '*')
    raise exception 'No puedes conceder un permiso que no tienes' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_role_permissions_guard on public.role_permissions;
create trigger trg_role_permissions_guard before insert on public.role_permissions
  for each row execute function app.guard_role_permission_insert();

-- Excepciones individuales: RPC (misma validación que el trigger, que se dispara igualmente)
create or replace function public.set_member_overrides(p_member uuid, p_grant text[], p_revoke text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.organization_members%rowtype;
begin
  select * into m from public.organization_members where id = p_member;
  if m.id is null or not app.has_permission(m.organization_id, 'team.manage') then
    raise exception 'No tienes permiso para gestionar el equipo' using errcode = 'insufficient_privilege';
  end if;
  update public.organization_members set permission_overrides = jsonb_build_object(
    'grant',  (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select distinct unnest(coalesce(p_grant, '{}')) x) s),
    'revoke', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select distinct unnest(coalesce(p_revoke, '{}')) x) s))
  where id = p_member;
end $$;
revoke all on function public.set_member_overrides(uuid, text[], text[]) from public, anon;
grant execute on function public.set_member_overrides(uuid, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------
-- C. customers.sensitive
-- ---------------------------------------------------------------------
-- C1. Escritura: quien no tiene el permiso no pone ni cambia datos fiscales/personales (null = «sin dato», permitido)
create or replace function app.guard_customer_sensitive() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or app.has_permission(new.organization_id, 'customers.sensitive') then return new; end if;
  if tg_op = 'INSERT' then
    if num_nonnulls(new.tax_id, new.tax_id_valid, new.address, new.postal_code, new.city, new.company_name, new.birth_date) > 0 then
      raise exception 'No tienes permiso para guardar datos fiscales o personales de clientes (customers.sensitive)' using errcode = 'insufficient_privilege';
    end if;
  elsif (new.tax_id, new.tax_id_valid, new.address, new.postal_code, new.city, new.company_name, new.birth_date)
        is distinct from (old.tax_id, old.tax_id_valid, old.address, old.postal_code, old.city, old.company_name, old.birth_date) then
    raise exception 'No tienes permiso para cambiar datos fiscales o personales de clientes (customers.sensitive)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_sensitive on public.customers;
create trigger trg_customers_sensitive before insert or update on public.customers
  for each row execute function app.guard_customer_sensitive();

-- C2. Lectura: la API solo entrega las columnas no sensibles. (Las futuras columnas de `customers` deben concederse aquí:
--     si se olvida, falla cerrado y el test «columnas de customers» de rls_isolation.sql lo detecta.)
revoke select on public.customers from authenticated, anon;
grant select (id, organization_id, home_location_id, first_name, last_name, email, phone, status, pipeline_stage, lost_reason,
              source, joined_at, left_at, tags, marketing_consent, import_id, created_by, created_at, updated_at, deleted_at)
  on public.customers to authenticated;

create or replace view public.customers_safe with (security_invoker = true) as
  select id, organization_id, home_location_id, first_name, last_name, email, phone, status, pipeline_stage, lost_reason,
         source, joined_at, left_at, tags, marketing_consent, import_id, created_by, created_at, updated_at, deleted_at
  from public.customers;
revoke all on public.customers_safe from public, anon;
grant select on public.customers_safe to authenticated;

-- C3. Lectura de lo sensible: solo con el permiso (si no, lista vacía). Paginada por id para no chocar con el máximo de filas.
create or replace function public.customers_sensitive(p_org uuid, p_after uuid default null, p_limit int default 2000) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  if p_org is null or not app.has_permission(p_org, 'customers.sensitive') then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.id), '[]'::jsonb) into out
  from (
    select c.id, c.tax_id, c.tax_id_normalized, c.tax_id_valid, c.address, c.postal_code, c.city, c.company_name, c.birth_date
    from public.customers c
    where c.organization_id = p_org and (p_after is null or c.id > p_after)
      and num_nonnulls(c.tax_id, c.tax_id_valid, c.address, c.postal_code, c.city, c.company_name, c.birth_date) > 0
    order by c.id limit least(greatest(coalesce(p_limit, 2000), 1), 5000)
  ) s;
  return out;
end $$;
revoke all on function public.customers_sensitive(uuid, uuid, int) from public, anon;
grant execute on function public.customers_sensitive(uuid, uuid, int) to authenticated;

-- C4. Copia fiscal de la factura: si no la envía el cliente, la completa el servidor desde la ficha (security definer: quien
--     emite una cuota sin ver el NIF no deja la factura incompleta). No pisa lo que se envía.
create or replace function app.fill_invoice_customer_snapshot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  if new.customer_id is null or (new.customer_tax_id is not null and new.customer_address is not null) then return new; end if;
  select tax_id, address, postal_code, city into c from public.customers where id = new.customer_id and organization_id = new.organization_id;
  if found then
    new.customer_tax_id := coalesce(new.customer_tax_id, c.tax_id);
    new.customer_address := coalesce(new.customer_address,
      nullif(concat_ws(', ', nullif(c.address, ''), nullif(concat_ws(' ', c.postal_code, c.city), '')), ''));
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_customer_snapshot on public.invoices;
create trigger trg_invoices_customer_snapshot before insert on public.invoices
  for each row execute function app.fill_invoice_customer_snapshot();

-- ---------------------------------------------------------------------
-- D. Auditoría
-- ---------------------------------------------------------------------
-- Registros de clientes con datos sensibles en sus cambios: solo para quien tiene customers.sensitive
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.has_permission(organization_id, 'audit.view')
         and (changes is null
              or not (changes ?| array['tax_id', 'tax_id_normalized', 'tax_id_valid', 'address', 'postal_code', 'city', 'company_name', 'birth_date',
                                       'customer_tax_id', 'customer_address'])
              or app.has_permission(organization_id, 'customers.sensitive')));

-- 0910 (corregido): «todos los centros» conservaba solo «from» (jsonb_strip_nulls borraba «to: null»); ahora también se
-- audita el cambio de excepciones de permisos.
create or replace function app.audit_member() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_role text;
  v_old_role text;
  ch jsonb := '{}'::jsonb;
begin
  select coalesce(p.full_name, new.invited_email, 'Miembro') into v_name from (select 1) x left join public.profiles p on p.id = new.user_id;
  select key into v_role from public.roles where id = new.role_id;
  if tg_op = 'INSERT' then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, context)
    values (new.organization_id, auth.uid(), 'invite', 'organization_members', new.id, v_name,
            jsonb_build_object('role', v_role, 'email', new.invited_email));
    return new;
  end if;
  if new.role_id is distinct from old.role_id then
    select key into v_old_role from public.roles where id = old.role_id;
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, context)
    values (new.organization_id, auth.uid(), 'role_change', 'organization_members', new.id, v_name,
            jsonb_build_object('from', v_old_role, 'to', v_role));
  end if;
  if new.permission_overrides is distinct from old.permission_overrides then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, context)
    values (new.organization_id, auth.uid(), 'permission_change', 'organization_members', new.id, v_name,
            jsonb_build_object('role', v_role, 'from', old.permission_overrides, 'to', new.permission_overrides));
  end if;
  if new.location_ids is distinct from old.location_ids then
    ch := ch || jsonb_build_object('location_ids', jsonb_build_object('from', to_jsonb(old.location_ids), 'to', to_jsonb(new.location_ids)));
  end if;
  if new.status is distinct from old.status then
    ch := ch || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if ch <> '{}'::jsonb then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes)
    values (new.organization_id, auth.uid(), 'update', 'organization_members', new.id, v_name, ch);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- E. Capacidades y sync_push v3
-- ---------------------------------------------------------------------
create or replace function public.server_capabilities() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'schema', 920,
    'features', jsonb_build_array('expenses', 'suppliers', 'memberships', 'tasks', 'invoice_editor', 'onboarding',
                                  'permission_overrides', 'payment_enforcement', 'sensitive_columns'));
$$;
revoke all on function public.server_capabilities() from public, anon;
grant execute on function public.server_capabilities() to authenticated;

-- Igual que v2 (0900) salvo que `returning` solo incluye columnas que el rol puede leer (customers: sin las sensibles).
create or replace function public.sync_push(p_org uuid, p_batch jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  allowed constant text[] := array[
    'organizations','organization_settings','locations','tax_rates','payment_methods','document_series','product_categories',
    'imports','products','membership_plans','membership_plan_versions','customers','customer_notes','suppliers',
    'expense_categories','customer_memberships','tasks','cash_sessions','cash_movements','sales','sale_items','invoices',
    'invoice_items','payments','membership_charges','expenses','cash_closings','import_records'];
  deletable constant text[] := array['invoice_items'];
  op jsonb;
  t text;
  kind text;
  rws jsonb;
  rw jsonb;
  cols text;
  writable text[];
  retcols text;
  xcols text;
  all_readable boolean;
  r jsonb;
  out jsonb := '[]'::jsonb;
  n int;
begin
  if p_org is null or not app.is_member(p_org) then
    raise exception 'No perteneces a esta empresa' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.audit_ctx', coalesce(p_batch -> 'audit', '{}'::jsonb)::text, true);

  for op in select value from jsonb_array_elements(coalesce(p_batch -> 'ops', '[]'::jsonb)) loop
    t := op ->> 'table';
    kind := op ->> 'op';
    rws := coalesce(op -> 'rows', '[]'::jsonb);
    if jsonb_typeof(rws) <> 'array' or jsonb_array_length(rws) = 0 then continue; end if;

    if t = 'organization_modules' and kind = 'set_modules' then
      if not app.has_permission(p_org, 'settings.manage') then
        raise exception 'No tienes permiso para cambiar los módulos' using errcode = 'insufficient_privilege';
      end if;
      for rw in select value from jsonb_array_elements(rws) loop
        insert into public.organization_modules (organization_id, module_key, enabled)
        select p_org, m, (rw ->> 'enabled')::boolean
        from unnest(case rw ->> 'module'
                      when 'fitness' then array['fitness.memberships','fitness.attendance','fitness.drop_ins','fitness.classes']
                      else array[]::text[] end) m
        on conflict (organization_id, module_key) do update set enabled = excluded.enabled;
      end loop;
      continue;
    end if;

    if not (t = any (allowed)) then
      raise exception 'Tabla no sincronizable: %', t using errcode = 'invalid_parameter_value';
    end if;

    select array_agg(a.attname::text) into writable
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = '';

    -- Columnas que este rol puede leer (en casi todas las tablas, todas)
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) filter (where has_column_privilege(a.attrelid, a.attnum, 'SELECT')),
           string_agg('x.' || quote_ident(a.attname), ', ' order by a.attnum) filter (where has_column_privilege(a.attrelid, a.attnum, 'SELECT')),
           bool_and(has_column_privilege(a.attrelid, a.attnum, 'SELECT'))
      into retcols, xcols, all_readable
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped;

    if kind = 'insert' then
      if t in ('organizations','organization_settings') then
        raise exception 'Alta de empresa solo mediante create_organization()' using errcode = 'insufficient_privilege';
      end if;
      if exists (select 1 from jsonb_array_elements(rws) e where (e.value ->> 'organization_id')::uuid is distinct from p_org) then
        raise exception 'Registro de otra empresa en el lote (%)', t using errcode = 'insufficient_privilege';
      end if;
      select string_agg(quote_ident(k), ', ') into cols
      from (select distinct jsonb_object_keys(e.value) k from jsonb_array_elements(rws) e) s
      where k = any (writable);
      execute format(
        'with ins as (insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) returning %s)
         select coalesce(jsonb_agg(to_jsonb(ins)), ''[]''::jsonb) from ins', t, cols, cols, t, case when all_readable then '*' else retcols end)
        into r using rws;
      out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', r));

    elsif kind = 'update' then
      for rw in select value from jsonb_array_elements(rws) loop
        select string_agg(quote_ident(k), ', ') into cols
        from jsonb_object_keys(rw) k
        where k = any (writable) and k not in ('id', 'organization_id', 'created_at');
        if cols is null then continue; end if;
        if all_readable then
          if t = 'organizations' then
            execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.id = $2 returning to_jsonb(x.*)',
                           t, cols, cols, t) into r using rw, p_org;
          elsif t = 'organization_settings' then
            execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.organization_id = $2 returning to_jsonb(x.*)',
                           t, cols, cols, t) into r using rw, p_org;
          else
            execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.id = ($1 ->> ''id'')::uuid and x.organization_id = $2 returning to_jsonb(x.*)',
                           t, cols, cols, t) into r using rw, p_org;
          end if;
        else
          execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.id = ($1 ->> ''id'')::uuid and x.organization_id = $2 returning (select to_jsonb(s) from (select %s) s)',
                         t, cols, cols, t, xcols) into r using rw, p_org;
        end if;
        get diagnostics n = row_count;
        if n = 0 then
          raise exception 'No se pudo actualizar % (no existe o no tienes permiso)', t using errcode = 'insufficient_privilege';
        end if;
        out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', jsonb_build_array(r)));
      end loop;

    elsif kind = 'delete' then
      if not (t = any (deletable)) then
        raise exception 'No se puede borrar en %', t using errcode = 'insufficient_privilege';
      end if;
      if not app.has_permission(p_org, 'invoices.manage') then
        raise exception 'No tienes permiso para editar facturas' using errcode = 'insufficient_privilege';
      end if;
      delete from public.invoice_items x
       where x.organization_id = p_org
         and x.id in (select (e.value ->> 'id')::uuid from jsonb_array_elements(rws) e)
         and exists (select 1 from public.invoices i where i.id = x.invoice_id and i.organization_id = p_org and i.status = 'draft');
    else
      raise exception 'Operación no soportada: %', kind using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.sync_push(uuid, jsonb) from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Endurecimiento (como 0800): las funciones internas no se invocan desde la API; los triggers siguen funcionando
-- (PostgreSQL no comprueba EXECUTE al dispararlos) y las que se llaman desde otras funciones SECURITY DEFINER corren como propietario.
-- ---------------------------------------------------------------------
revoke all on function
  app.guard_payment_insert(), app.guard_invoice_permissions(), app.guard_membership_charge_paid(),
  app.guard_member_change(), app.guard_role_permission_insert(), app.guard_customer_sensitive(),
  app.fill_invoice_customer_snapshot(), app.audit_member(),
  app.actor_holds_role(uuid, uuid), app.valid_permission_overrides(jsonb)
from public, anon, authenticated;
