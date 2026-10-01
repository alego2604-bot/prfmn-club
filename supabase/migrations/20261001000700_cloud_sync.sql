-- =====================================================================
-- Business OS · 0700 · Conexión de la aplicación (Supabase como fuente de verdad)
--   * Columnas que la app ya usaba y el esquema no tenía.
--   * public.sync_push(): aplica en UNA transacción los cambios de una acción de la app
--     (venta + líneas + pagos, cierre, importación completa…). SECURITY INVOKER → RLS y
--     triggers de integridad se aplican igual que a cualquier escritura directa.
--   * Auditoría enriquecida: la app aporta etiqueta/acción/contexto; el registro lo sigue
--     escribiendo el trigger (append-only), nunca el cliente.
--   * Stock calculado en servidor (sale_items / anulación), perfiles al registrarse,
--     alta de miembros por email.
-- Solo añade: no borra ni reescribe datos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------
alter table public.organizations add column if not exists logo_data_url text
  check (logo_data_url is null or length(logo_data_url) <= 400000);
alter table public.product_categories add column if not exists default_tax_rate_bp int
  check (default_tax_rate_bp is null or default_tax_rate_bp between 0 and 10000);
alter table public.invoices add column if not exists series_label text;   -- serie del sistema de origen (importadas)
alter table public.imports add column if not exists file_size bigint check (file_size is null or file_size >= 0);
alter table public.audit_logs add column if not exists entity_label text;

-- ---------------------------------------------------------------------
-- Perfil al registrarse (nombre desde los metadatos de Auth)
-- ---------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_business_os on auth.users;
create trigger on_auth_user_created_business_os after insert on auth.users
  for each row execute function app.handle_new_user();

insert into public.profiles (id, full_name)
select u.id, nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), '') from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Auditoría: el trigger incorpora el contexto que la app declara para esta transacción
-- (set_config('app.audit_ctx', '{"<entity_id>": {"action":..,"label":..,"context":{..}}}', true))
-- ---------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
  o jsonb;
  n jsonb;
  act text := lower(tg_op);
  ctx jsonb;
  rid text;
begin
  if tg_op = 'DELETE' then
    o := to_jsonb(old);
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, changes)
    values (old.organization_id, auth.uid(), 'delete', tg_table_name, (o->>'id')::uuid, jsonb_build_object('before', o));
    return old;
  end if;

  n := to_jsonb(new);
  rid := n->>'id';
  begin
    ctx := nullif(current_setting('app.audit_ctx', true), '')::jsonb -> rid;
  exception when others then ctx := null;
  end;

  if tg_op = 'INSERT' then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes, context)
    values (new.organization_id, auth.uid(), coalesce(ctx->>'action', 'insert'), tg_table_name, rid::uuid, ctx->>'label', null, ctx->'context');
    return new;
  end if;

  o := to_jsonb(old);
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
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes, context)
  values (new.organization_id, auth.uid(), coalesce(ctx->>'action', act), tg_table_name, rid::uuid, ctx->>'label', diff, ctx->'context');
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Stock en servidor: venta descuenta, anulación repone (con movimiento trazable)
-- ---------------------------------------------------------------------
create or replace function app.stock_on_sale_item() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_loc uuid;
begin
  if new.product_id is null then return new; end if;
  update public.products set stock_quantity = coalesce(stock_quantity, 0) - new.quantity
   where id = new.product_id and organization_id = new.organization_id and track_stock;
  if found then
    select location_id into v_loc from public.sales where id = new.sale_id;
    insert into public.stock_movements (organization_id, product_id, location_id, delta, reason, sale_item_id, created_by)
    values (new.organization_id, new.product_id, v_loc, -new.quantity, 'sale', new.id, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_sale_items_stock on public.sale_items;
create trigger trg_sale_items_stock after insert on public.sale_items
  for each row execute function app.stock_on_sale_item();

create or replace function app.stock_on_sale_void() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare it record;
begin
  if new.status = 'voided' and old.status <> 'voided' then
    for it in select si.* from public.sale_items si join public.products p on p.id = si.product_id and p.track_stock
              where si.sale_id = new.id loop
      update public.products set stock_quantity = coalesce(stock_quantity, 0) + it.quantity where id = it.product_id;
      insert into public.stock_movements (organization_id, product_id, location_id, delta, reason, sale_item_id, created_by)
      values (new.organization_id, it.product_id, new.location_id, it.quantity, 'sale_void', it.id, auth.uid());
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_sales_stock_void on public.sales;
create trigger trg_sales_stock_void after update of status on public.sales
  for each row execute function app.stock_on_sale_void();

-- ---------------------------------------------------------------------
-- sync_push: aplica un lote de cambios en una sola transacción, con RLS
--   p_batch = {"ops":[{"table":"sales","op":"insert","rows":[{...}]}, {"table":"products","op":"update","rows":[{"id":..,"price":..}]},
--                     {"table":"organization_modules","op":"set_modules","rows":[{"module":"fitness","enabled":true}]}],
--              "audit":{"<entity_id>":{"action":"close","label":"Cierre v1","context":{...}}}}
--   Devuelve, por tabla, las filas tal y como quedaron en la base de datos (números asignados, campos calculados).
-- ---------------------------------------------------------------------
create or replace function public.sync_push(p_org uuid, p_batch jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  allowed constant text[] := array[
    'organizations','organization_settings','locations','tax_rates','payment_methods','product_categories','imports',
    'products','membership_plans','membership_plan_versions','customers','customer_notes','cash_sessions','cash_movements',
    'sales','sale_items','invoices','invoice_items','payments','cash_closings','import_records'];
  op jsonb;
  t text;
  kind text;
  rws jsonb;
  rw jsonb;
  cols text;
  writable text[];
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
        'with ins as (insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) returning *)
         select coalesce(jsonb_agg(to_jsonb(ins)), ''[]''::jsonb) from ins', t, cols, cols, t)
        into r using rws;
      out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', r));

    elsif kind = 'update' then
      for rw in select value from jsonb_array_elements(rws) loop
        select string_agg(quote_ident(k), ', ') into cols
        from jsonb_object_keys(rw) k
        where k = any (writable) and k not in ('id', 'organization_id', 'created_at');
        if cols is null then continue; end if;
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
        get diagnostics n = row_count;
        if n = 0 then
          raise exception 'No se pudo actualizar % (no existe o no tienes permiso)', t using errcode = 'insufficient_privilege';
        end if;
        out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', jsonb_build_array(r)));
      end loop;
    else
      raise exception 'Operación no soportada: %', kind using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.sync_push(uuid, jsonb) from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Equipo: añadir por email a alguien que ya tiene cuenta (sin claves de servicio en el cliente)
-- ---------------------------------------------------------------------
create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role text, p_location_ids uuid[] default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_role uuid; v_id uuid;
begin
  if not app.has_permission(p_org, 'team.manage') then
    raise exception 'No tienes permiso para gestionar el equipo' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'owner' then
    raise exception 'Solo puede haber un owner por empresa' using errcode = 'check_violation';
  end if;
  select id into v_role from public.roles where organization_id is null and key = p_role;
  if v_role is null then raise exception 'Rol no válido' using errcode = 'check_violation'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Esa persona aún no tiene cuenta en Business OS: pídele que se registre y vuelve a añadirla' using errcode = 'no_data_found';
  end if;
  if p_location_ids is not null and exists (
    select 1 from unnest(p_location_ids) l where not exists (select 1 from public.locations x where x.id = l and x.organization_id = p_org)) then
    raise exception 'Centro no válido' using errcode = 'check_violation';
  end if;
  insert into public.organization_members (organization_id, user_id, role_id, location_ids, invited_email)
  values (p_org, v_user, v_role, p_location_ids, lower(trim(p_email)))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Esa persona ya forma parte del equipo' using errcode = 'unique_violation';
end $$;
revoke all on function public.add_member_by_email(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, text, uuid[]) to authenticated;

-- Cambiar rol/centros/estado de un miembro (nunca el owner)
create or replace function public.update_member(p_member uuid, p_role text default null, p_location_ids uuid[] default null,
                                                p_all_locations boolean default false, p_status text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.organization_members%rowtype; v_role uuid;
begin
  select * into m from public.organization_members where id = p_member;
  if m.id is null or not app.has_permission(m.organization_id, 'team.manage') then
    raise exception 'No tienes permiso para gestionar el equipo' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.roles r where r.id = m.role_id and r.key = 'owner') then
    raise exception 'El owner no se puede modificar desde aquí' using errcode = 'check_violation';
  end if;
  if p_role = 'owner' then raise exception 'Solo puede haber un owner por empresa' using errcode = 'check_violation'; end if;
  if p_role is not null then
    select id into v_role from public.roles where organization_id is null and key = p_role;
    if v_role is null then raise exception 'Rol no válido' using errcode = 'check_violation'; end if;
  end if;
  update public.organization_members set
    role_id = coalesce(v_role, role_id),
    location_ids = case when p_all_locations then null when p_location_ids is not null then p_location_ids else location_ids end,
    status = coalesce(p_status, status)
  where id = p_member;
end $$;
revoke all on function public.update_member(uuid, text, uuid[], boolean, text) from public, anon;
grant execute on function public.update_member(uuid, text, uuid[], boolean, text) to authenticated;
