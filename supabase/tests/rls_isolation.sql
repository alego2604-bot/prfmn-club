-- =====================================================================
-- Tests de aislamiento multi-tenant, permisos e integridad financiera.
-- Ejecutar con scripts/db-test.sh (Postgres local efímero). Cualquier fallo aborta (ON_ERROR_STOP).
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
\o /dev/null

create or replace function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
end $$;

-- Usuarios de prueba
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alex@empresa-a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@empresa-b.test'),
  ('00000000-0000-0000-0000-00000000000e', 'emma@empresa-a.test'),
  ('00000000-0000-0000-0000-0000000000cc', 'carla@gestoria.test');

-- (los privilegios por defecto de authenticated los crea bootstrap_supabase_stub.sql antes de las migraciones, como Supabase;
--  no se re-conceden aquí para no deshacer las restricciones de columna de 0920)

-- ---------------------------------------------------------------------
\echo '1. Alta de empresas vía RPC'
set role authenticated;
do $$ begin
  begin
    perform public.create_organization('Anon Gym');
    raise exception 'FAIL: create_organization sin sesión debería fallar';
  exception when insufficient_privilege then raise notice 'PASS create_organization exige sesión'; end;
end $$;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select set_config('test.org_a', public.create_organization('Empresa A', 'fitness', 'Centro Norte')::text, false);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.org_b', public.create_organization('Empresa B', 'fitness', 'Centro')::text, false);

do $$ begin
  if (select count(*) from public.organizations) <> 1 then raise exception 'FAIL: B ve % organizaciones', (select count(*) from public.organizations); end if;
  if exists (select 1 from public.organizations where id = current_setting('test.org_a')::uuid) then raise exception 'FAIL: B ve la org A'; end if;
  if (select count(*) from public.payment_methods) <> 8 then raise exception 'FAIL: B no ve sus 8 métodos de pago'; end if;
  raise notice 'PASS B solo ve su organización y su configuración';
end $$;

-- ---------------------------------------------------------------------
\echo '2. Catálogo aislado'
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into public.products (organization_id, name, price, tax_rate_bp)
values (current_setting('test.org_b')::uuid, 'Producto B', 500, 2100)
returning set_config('test.product_b', id::text, false) as _;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.product_categories (organization_id, name)
values (current_setting('test.org_a')::uuid, 'BEBIDAS')
returning set_config('test.cat_a', id::text, false) as _;
insert into public.products (organization_id, category_id, name, price, tax_rate_bp, sku)
values (current_setting('test.org_a')::uuid, current_setting('test.cat_a')::uuid, 'Agua', 100, 1000, 'AGUA-50')
returning set_config('test.product_a', id::text, false) as _;
insert into public.products (organization_id, name, price, tax_rate_bp, kind)
values (current_setting('test.org_a')::uuid, 'Drop-In', 1500, 2100, 'drop_in')
returning set_config('test.dropin_a', id::text, false) as _;

do $$ begin
  if (select count(*) from public.products) <> 2 then raise exception 'FAIL: A ve % productos', (select count(*) from public.products); end if;
  if exists (select 1 from public.products where id = current_setting('test.product_b')::uuid) then raise exception 'FAIL: A ve producto de B'; end if;
  raise notice 'PASS A no ve el catálogo de B';
end $$;

do $$ begin
  begin
    insert into public.products (organization_id, name, price, tax_rate_bp) values (current_setting('test.org_b')::uuid, 'Intruso', 1, 2100);
    raise exception 'FAIL: A pudo insertar en la org B';
  exception when insufficient_privilege then raise notice 'PASS A no puede escribir en la org B'; end;
end $$;

do $$ declare n int; begin
  update public.products set name = 'Hackeado' where id = current_setting('test.product_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A modificó un producto de B'; end if;
  raise notice 'PASS A no puede modificar productos de B';
end $$;

-- ---------------------------------------------------------------------
\echo '3. Histórico de precios'
update public.products set price = 120 where id = current_setting('test.product_a')::uuid;
do $$ begin
  if (select count(*) from public.product_prices where product_id = current_setting('test.product_a')::uuid) <> 2 then
    raise exception 'FAIL: no se versionó el precio'; end if;
  if (select price from public.product_prices where product_id = current_setting('test.product_a')::uuid and valid_to is null) <> 120 then
    raise exception 'FAIL: precio vigente incorrecto'; end if;
  if not exists (select 1 from public.product_prices where product_id = current_setting('test.product_a')::uuid and price = 100 and valid_to is not null) then
    raise exception 'FAIL: el precio anterior no quedó cerrado'; end if;
  raise notice 'PASS cambio de precio versionado (100 → 120) sin perder histórico';
end $$;

do $$ declare n int; begin
  delete from public.products where id = current_setting('test.product_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: se pudo borrar un producto'; end if;
  raise notice 'PASS productos no se borran vía API (sin política DELETE; se archivan)';
end $$;
reset role;
do $$ begin
  begin
    delete from public.products where id = current_setting('test.product_a')::uuid;
    raise exception 'FAIL: el propietario de la BD pudo borrar un producto';
  exception when insufficient_privilege then raise notice 'PASS ni siquiera el rol de servicio borra productos (trigger)'; end;
end $$;
set role authenticated;

-- ---------------------------------------------------------------------
\echo '4. Caja, venta, pago'
select set_config('test.loc_a', (select id::text from public.locations where organization_id = current_setting('test.org_a')::uuid limit 1), false);
select set_config('test.cash_pm', (select id::text from public.payment_methods where organization_id = current_setting('test.org_a')::uuid and key = 'cash'), false);

insert into public.cash_sessions (organization_id, location_id, opening_float, opened_by)
values (current_setting('test.org_a')::uuid, current_setting('test.loc_a')::uuid, 5000, auth.uid())
returning set_config('test.session_a', id::text, false) as _;

do $$ begin
  begin
    insert into public.cash_sessions (organization_id, location_id) values (current_setting('test.org_a')::uuid, current_setting('test.loc_a')::uuid);
    raise exception 'FAIL: dos cajas abiertas en el mismo centro';
  exception when unique_violation then raise notice 'PASS una sola caja abierta por centro'; end;
end $$;

insert into public.sales (organization_id, location_id, cash_session_id, subtotal, tax_total, total, seller_id)
values (current_setting('test.org_a')::uuid, current_setting('test.loc_a')::uuid, current_setting('test.session_a')::uuid, 1349, 271, 1620, auth.uid())
returning set_config('test.sale_a', id::text, false) as _;
insert into public.sale_items (organization_id, sale_id, product_id, product_name, quantity, unit_price, tax_rate_bp, base_amount, tax_amount, total)
values
  (current_setting('test.org_a')::uuid, current_setting('test.sale_a')::uuid, current_setting('test.product_a')::uuid, 'Agua', 1, 120, 1000, 109, 11, 120),
  (current_setting('test.org_a')::uuid, current_setting('test.sale_a')::uuid, current_setting('test.dropin_a')::uuid, 'Drop-In', 1, 1500, 2100, 1240, 260, 1500);
insert into public.payments (organization_id, location_id, sale_id, payment_method_id, method_kind, amount, cash_session_id)
values (current_setting('test.org_a')::uuid, current_setting('test.loc_a')::uuid, current_setting('test.sale_a')::uuid,
        current_setting('test.cash_pm')::uuid, 'cash', 1620, current_setting('test.session_a')::uuid);

do $$ begin
  if (select number from public.sales where id = current_setting('test.sale_a')::uuid) <> 1 then raise exception 'FAIL: nº de ticket'; end if;
  raise notice 'PASS venta con nº de ticket correlativo';
end $$;

do $$ begin
  begin
    insert into public.sale_items (organization_id, sale_id, product_id, product_name, quantity, unit_price, tax_rate_bp, base_amount, tax_amount, total)
    values (current_setting('test.org_a')::uuid, current_setting('test.sale_a')::uuid, current_setting('test.product_b')::uuid, 'X', 1, 500, 2100, 413, 87, 500);
    raise exception 'FAIL: línea de venta con producto de otra empresa';
  exception when foreign_key_violation then raise notice 'PASS FK compuesta impide mezclar empresas'; end;
end $$;

do $$ declare n int; begin
  delete from public.sales where id = current_setting('test.sale_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: se pudo borrar una venta'; end if;
  raise notice 'PASS ventas no se borran';
  begin
    update public.sales set total = 1, subtotal = 1, tax_total = 0 where id = current_setting('test.sale_a')::uuid;
    raise exception 'FAIL: se pudo cambiar el importe de una venta';
  exception when insufficient_privilege then raise notice 'PASS importes de venta inmutables'; end;
  begin
    update public.sales set status = 'voided' where id = current_setting('test.sale_a')::uuid;
    raise exception 'FAIL: anulación sin motivo';
  exception when check_violation then raise notice 'PASS anular exige motivo'; end;
  begin
    update public.payments set amount = 1 where sale_id = current_setting('test.sale_a')::uuid;
    raise exception 'FAIL: se pudo cambiar un pago';
  exception when insufficient_privilege then raise notice 'PASS pagos inmutables'; end;
end $$;

-- Cierre de caja
insert into public.cash_closings (organization_id, cash_session_id, sales_count, sales_total, totals_by_method, opening_float, expected_cash, counted_cash, closed_by)
values (current_setting('test.org_a')::uuid, current_setting('test.session_a')::uuid, 1, 1620, '{"cash":1620}', 5000, 6620, 6600, auth.uid());
do $$ declare c record; begin
  select * into c from public.cash_closings where cash_session_id = current_setting('test.session_a')::uuid;
  if c.difference <> -20 or c.status <> 'discrepancy' then raise exception 'FAIL: descuadre mal calculado (% / %)', c.difference, c.status; end if;
  raise notice 'PASS cierre: esperado 66,20 / real 66,00 → descuadre -0,20';
  begin
    update public.cash_closings set counted_cash = 6620 where id = c.id;
    raise exception 'FAIL: se pudo editar un cierre';
  exception when insufficient_privilege then raise notice 'PASS cierres no se editan (se reabren)'; end;
end $$;

-- ---------------------------------------------------------------------
\echo '5. Facturas: numeración sin huecos e inmutabilidad'
select set_config('test.series_a', (select id::text from public.document_series where organization_id = current_setting('test.org_a')::uuid and code = 'F'), false);
insert into public.invoices (organization_id, series_id, issue_date, status, customer_name, concept, subtotal, tax_total, total)
values (current_setting('test.org_a')::uuid, current_setting('test.series_a')::uuid, current_date, 'issued', 'Cliente 1', 'Cuota', 6033, 1267, 7300)
returning set_config('test.inv1', id::text, false) as _;
insert into public.invoices (organization_id, series_id, issue_date, status, customer_name, concept, subtotal, tax_total, total)
values (current_setting('test.org_a')::uuid, current_setting('test.series_a')::uuid, current_date, 'issued', 'Cliente 2', 'Cuota', 5124, 1076, 6200);
do $$ begin
  if (select array_agg(number order by number) from public.invoices) <> array['F' || to_char(now(),'YYYY') || '-00001', 'F' || to_char(now(),'YYYY') || '-00002'] then
    raise exception 'FAIL: numeración %', (select array_agg(number) from public.invoices); end if;
  raise notice 'PASS numeración correlativa %', (select array_agg(number order by number) from public.invoices);
  begin
    update public.invoices set total = 1, subtotal = 1, tax_total = 0 where id = current_setting('test.inv1')::uuid;
    raise exception 'FAIL: factura emitida modificada';
  exception when insufficient_privilege then raise notice 'PASS factura emitida inmutable'; end;
end $$;

-- ---------------------------------------------------------------------
\echo '6. Auditoría'
do $$ begin
  if not exists (select 1 from public.audit_logs where entity_type = 'products' and action = 'price_change'
                 and changes -> 'price' = '{"from":100,"to":120}'::jsonb) then
    raise exception 'FAIL: cambio de precio no auditado'; end if;
  if (select actor_id from public.audit_logs where action = 'price_change' limit 1) <> auth.uid() then raise exception 'FAIL: actor incorrecto'; end if;
  raise notice 'PASS cambio de precio auditado con autor y valores';
end $$;
do $$ declare n int; begin
  update public.audit_logs set action = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: audit_logs editable vía API'; end if;
end $$;
reset role;
do $$ begin
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: audit_logs borrable por el propietario';
  exception when insufficient_privilege then raise notice 'PASS audit_logs append-only (API y rol de servicio)'; end;
end $$;
set role authenticated;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.audit_logs where organization_id = current_setting('test.org_a')::uuid) then raise exception 'FAIL: B lee auditoría de A'; end if;
  if exists (select 1 from public.sales) or exists (select 1 from public.invoices) or exists (select 1 from public.cash_closings) then
    raise exception 'FAIL: B ve ventas/facturas/cierres de A'; end if;
  raise notice 'PASS B no ve ventas, facturas, cierres ni auditoría de A';
end $$;

-- ---------------------------------------------------------------------
\echo '7. Roles: employee y accountant'
reset role;
select pg_temp.login('');   -- alta como mantenimiento/servicio (sin usuario): los guards de equipo solo aplican a usuarios
insert into public.locations (organization_id, name) values (current_setting('test.org_a')::uuid, 'Centro Sur')
returning set_config('test.loc_a2', id::text, false) as _;
insert into public.organization_members (organization_id, user_id, role_id, location_ids)
select current_setting('test.org_a')::uuid, '00000000-0000-0000-0000-00000000000e', id, array[current_setting('test.loc_a2')::uuid]
from public.roles where key = 'employee' and organization_id is null;
insert into public.organization_members (organization_id, user_id, role_id)
select current_setting('test.org_a')::uuid, '00000000-0000-0000-0000-0000000000cc', id
from public.roles where key = 'accountant' and organization_id is null;
set role authenticated;

select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ declare n int; begin
  if (select count(*) from public.products) <> 2 then raise exception 'FAIL: employee no ve catálogo'; end if;
  update public.products set price = 1 where id = current_setting('test.product_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: employee cambió un precio'; end if;
  if exists (select 1 from public.invoices) then raise exception 'FAIL: employee ve facturas'; end if;
  if exists (select 1 from public.audit_logs) then raise exception 'FAIL: employee ve auditoría'; end if;
  if exists (select 1 from public.sales) then raise exception 'FAIL: employee de Centro Sur ve ventas de Centro Norte'; end if;
  raise notice 'PASS employee: ve catálogo, no cambia precios, no ve facturas/auditoría ni ventas de otro centro';
  begin
    insert into public.sales (organization_id, location_id, subtotal, tax_total, total)
    values (current_setting('test.org_a')::uuid, current_setting('test.loc_a')::uuid, 0, 0, 0);
    raise exception 'FAIL: employee vendió en un centro no asignado';
  exception when insufficient_privilege then raise notice 'PASS employee no vende fuera de su centro'; end;
end $$;
insert into public.sales (organization_id, location_id, subtotal, tax_total, total)
values (current_setting('test.org_a')::uuid, current_setting('test.loc_a2')::uuid, 826, 174, 1000);
do $$ begin
  if (select count(*) from public.sales) <> 1 then raise exception 'FAIL: employee no ve su venta'; end if;
  raise notice 'PASS employee vende en su centro';
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000cc');
do $$ declare n int; begin
  if (select count(*) from public.invoices) <> 2 then raise exception 'FAIL: accountant no ve facturas'; end if;
  if (select count(*) from public.sales) <> 2 then raise exception 'FAIL: accountant no ve ventas consolidadas'; end if;
  if not exists (select 1 from public.audit_logs) then raise exception 'FAIL: accountant no ve auditoría'; end if;
  update public.products set name = 'x' where id = current_setting('test.product_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: accountant editó catálogo'; end if;
  raise notice 'PASS accountant: ve finanzas, ventas y auditoría; no edita catálogo';
end $$;

\echo '8. Integraciones (capa opcional y aislada)'
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.integration_connections (organization_id, provider, display_name, scopes)
values (current_setting('test.org_a')::uuid, 'training_platform', 'Plataforma de entrenamiento', '{attendance.read}');
do $$ begin
  begin
    insert into public.integration_events (organization_id, connection_id, direction, event_type, idempotency_key, payload)
    select organization_id, id, 'inbound', 'attendance.recorded', 'k1', '{}' from public.integration_connections limit 1;
    raise exception 'FAIL: un usuario pudo escribir eventos de integración';
  exception when insufficient_privilege then raise notice 'PASS solo el servidor registra eventos de integración'; end;
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.integration_connections) then raise exception 'FAIL: B ve integraciones de A'; end if;
  raise notice 'PASS integraciones aisladas por empresa';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ begin
  if exists (select 1 from public.integration_connections) then raise exception 'FAIL: employee ve integraciones'; end if;
  raise notice 'PASS integraciones solo para quien gestiona la configuración';
end $$;

\echo '9. Sincronización de la app (sync_push)'
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  begin
    perform public.sync_push(current_setting('test.org_a')::uuid, '{"ops":[]}'::jsonb);
    raise exception 'FAIL: B pudo sincronizar en la empresa A';
  exception when insufficient_privilege then raise notice 'PASS sync_push rechaza empresas ajenas'; end;
  begin
    perform public.sync_push(current_setting('test.org_b')::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
      'table','customers','op','insert','rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'organization_id', current_setting('test.org_a'), 'first_name','X','status','active','tags','{}'))))));
    raise exception 'FAIL: B coló un cliente en la empresa A dentro de su lote';
  exception when insufficient_privilege then raise notice 'PASS un lote no puede contener registros de otra empresa'; end;
  begin
    perform public.sync_push(current_setting('test.org_b')::uuid, '{"ops":[{"table":"audit_logs","op":"insert","rows":[{"id":1}]}]}'::jsonb);
    raise exception 'FAIL: se pudo escribir en audit_logs vía sync_push';
  exception when invalid_parameter_value then raise notice 'PASS solo tablas sincronizables (auditoría inaccesible)'; end;
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; begin
  r := public.sync_push(current_setting('test.org_a')::uuid, jsonb_build_object(
    'audit', jsonb_build_object(current_setting('test.product_a'), jsonb_build_object('action','price_change','label','Agua · nuevo precio')),
    'ops', jsonb_build_array(jsonb_build_object('table','products','op','update','rows', jsonb_build_array(jsonb_build_object('id', current_setting('test.product_a'), 'price', 130))))));
  if (r -> 0 -> 'rows' -> 0 ->> 'price')::int <> 130 then raise exception 'FAIL: sync_push no devolvió la fila actualizada'; end if;
  if not exists (select 1 from public.audit_logs where entity_id = current_setting('test.product_a')::uuid and entity_label = 'Agua · nuevo precio') then
    raise exception 'FAIL: la auditoría no recogió el contexto de la app';
  end if;
  if (select count(*) from public.product_prices where product_id = current_setting('test.product_a')::uuid) < 2 then raise exception 'FAIL: sin histórico de precio'; end if;
  begin
    perform public.sync_push(current_setting('test.org_a')::uuid, jsonb_build_object('ops', jsonb_build_array(
      jsonb_build_object('table','products','op','insert','rows', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'organization_id', current_setting('test.org_a'), 'name','Uno','price',100,'tax_rate_bp',2100))),
      jsonb_build_object('table','products','op','insert','rows', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'organization_id', current_setting('test.org_a'), 'name','Dos','price',-1,'tax_rate_bp',2100))))));
    raise exception 'FAIL: un lote con un registro inválido se aplicó';
  exception when check_violation then null; end;
  if exists (select 1 from public.products where name = 'Uno') then raise exception 'FAIL: lote aplicado a medias (no atómico)'; end if;
  raise notice 'PASS sync_push: RLS, auditoría con contexto, histórico de precios y atomicidad del lote';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ begin
  begin
    perform public.sync_push(current_setting('test.org_a')::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
      'table','products','op','update','rows', jsonb_build_array(jsonb_build_object('id', current_setting('test.product_a'), 'price', 1))))));
    raise exception 'FAIL: employee cambió un precio vía sync_push';
  exception when insufficient_privilege then raise notice 'PASS employee no cambia precios ni con sync_push'; end;
end $$;

-- ---------------------------------------------------------------------
\echo '10. Endurecimiento 0800'
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.create_organization(text, text, text, text, text, boolean)', 'execute') then
    raise exception 'FAIL: anon puede ejecutar create_organization';
  end if;
  if not has_function_privilege('authenticated', 'public.create_organization(text, text, text, text, text, boolean)', 'execute') then
    raise exception 'FAIL: authenticated no puede ejecutar create_organization';
  end if;
  raise notice 'PASS create_organization: solo authenticated';
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('touch_updated_at','normalize_tax_id','assign_sale_number','forbid_mutation',
      'guard_sale_update','guard_payment_update','guard_invoice_update','guard_invoice_items','guard_cash_closing_update','guard_price_permission')
      and (p.proconfig is null or not ('search_path=public, pg_temp' = any(p.proconfig))
        or has_function_privilege('anon', p.oid, 'execute')
        -- normalize_tax_id alimenta columnas generadas: authenticated la necesita (0810)
        or (p.proname <> 'normalize_tax_id' and has_function_privilege('authenticated', p.oid, 'execute')))
  ) then raise exception 'FAIL: helper interno con search_path mutable o ejecutable por clientes'; end if;
  raise notice 'PASS helpers internos: search_path fijo y sin ejecución directa';
end $$;
-- Los triggers y columnas generadas que usan esos helpers siguen funcionando para usuarios autenticados
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; cid uuid := gen_random_uuid(); begin
  r := public.sync_push(current_setting('test.org_a')::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
    'table','customers','op','insert','rows', jsonb_build_array(jsonb_build_object('id', cid,
      'organization_id', current_setting('test.org_a'), 'first_name','Nif','tax_id','12.345.678-z','status','active','tags','{}'))))));
  -- 0920: la respuesta de sync_push ya no incluye columnas sensibles; la columna generada se comprueba con la RPC del propietario
  if (select e ->> 'tax_id_normalized' from jsonb_array_elements(public.customers_sensitive(current_setting('test.org_a')::uuid)) e where e ->> 'id' = cid::text) is distinct from '12345678Z' then
    raise exception 'FAIL: tax_id_normalized no calculado';
  end if;
  update public.products set name = 'Agua 50cl' where id = current_setting('test.product_a')::uuid;
  raise notice 'PASS triggers y columnas generadas siguen funcionando tras revocar EXECUTE';
end $$;

-- ---------------------------------------------------------------------
\echo '11. Gastos, membresías, tareas y borradores de factura (0900)'
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
create or replace function pg_temp.op(t text, kind text, variadic rws jsonb[]) returns jsonb language sql as $f$
  select jsonb_build_object('table', t, 'op', kind, 'rows', to_jsonb(rws));
$f$;
do $$ declare r jsonb; sup uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); exp uuid := gen_random_uuid();
  plan uuid := gen_random_uuid(); ver uuid := gen_random_uuid(); cus uuid := gen_random_uuid(); mem uuid := gen_random_uuid();
  inv uuid := gen_random_uuid(); it1 uuid := gen_random_uuid(); it2 uuid := gen_random_uuid(); org text := current_setting('test.org_a');
begin
  if (public.server_capabilities() ->> 'schema')::int < 900 then raise exception 'FAIL: server_capabilities'; end if;
  r := public.sync_push(org::uuid, jsonb_build_object(
    'audit', jsonb_build_object(exp::text, jsonb_build_object('action','insert','label','Alquiler octubre')),
    'ops', jsonb_build_array(
      pg_temp.op('suppliers','insert', jsonb_build_object('id', sup, 'organization_id', org, 'name','Proveedor Ejemplo','tax_id','b-12345678')),
      pg_temp.op('expense_categories','insert', jsonb_build_object('id', cat, 'organization_id', org, 'name','Alquiler')),
      pg_temp.op('expenses','insert', jsonb_build_object('id', exp, 'organization_id', org, 'location_id', current_setting('test.loc_a'),
        'supplier_id', sup, 'category_id', cat, 'issue_date', current_date, 'description','Alquiler octubre',
        'subtotal', 100000, 'tax_rate_bp', 2100, 'tax_total', 21000, 'total', 121000, 'status','pending', 'notes','Sintético')),
      pg_temp.op('membership_plans','insert', jsonb_build_object('id', plan, 'organization_id', org, 'name','Mensual','kind','recurring','billing_period','month')),
      pg_temp.op('membership_plan_versions','insert', jsonb_build_object('id', ver, 'organization_id', org, 'plan_id', plan, 'version',1,'price',6000,'tax_rate_bp',2100,'valid_from', current_date)),
      pg_temp.op('customers','insert', jsonb_build_object('id', cus, 'organization_id', org, 'first_name','Socia','status','active','tags','{}')),
      pg_temp.op('customer_memberships','insert', jsonb_build_object('id', mem, 'organization_id', org, 'customer_id', cus,
        'plan_id', plan, 'plan_version_id', ver, 'price', 6000, 'start_date', current_date, 'next_renewal_date', current_date + 30, 'status','active')),
      pg_temp.op('membership_charges','insert', jsonb_build_object('id', gen_random_uuid(), 'organization_id', org,
        'customer_membership_id', mem, 'period_start', current_date, 'period_end', current_date + 29, 'amount', 6000, 'status','scheduled')),
      pg_temp.op('tasks','insert', jsonb_build_object('id', gen_random_uuid(), 'organization_id', org, 'customer_id', cus, 'title','Llamar para renovar')),
      pg_temp.op('invoices','insert', jsonb_build_object('id', inv, 'organization_id', org, 'series_id', current_setting('test.series_a'),
        'status','draft','customer_id', cus, 'customer_name','Socia','subtotal', 9917,'tax_total', 2083,'total', 12000, 'discount_total', 0)),
      pg_temp.op('invoice_items','insert',
        jsonb_build_object('id', it1, 'organization_id', org, 'invoice_id', inv, 'description','Cuota','quantity',1,'unit_price',6000,'tax_rate_bp',2100,'base_amount',4959,'tax_amount',1041,'total',6000),
        jsonb_build_object('id', it2, 'organization_id', org, 'invoice_id', inv, 'description','Cuota 2','quantity',1,'unit_price',6000,'tax_rate_bp',2100,'base_amount',4958,'tax_amount',1042,'total',6000)))));
  if not exists (select 1 from public.audit_logs where entity_id = exp and entity_label = 'Alquiler octubre') then raise exception 'FAIL: gasto sin auditoría'; end if;
  if not exists (select 1 from public.audit_logs where entity_type = 'membership_charges') then raise exception 'FAIL: cargo sin auditoría'; end if;
  -- Editar el borrador: borrar una línea
  perform public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(
    pg_temp.op('invoice_items','delete', jsonb_build_object('id', it2)),
    pg_temp.op('invoices','update', jsonb_build_object('id', inv, 'subtotal', 4959, 'tax_total', 1041, 'total', 6000)))));
  if exists (select 1 from public.invoice_items where id = it2) then raise exception 'FAIL: no se borró la línea del borrador'; end if;
  -- Emitir: número asignado por el servidor; después las líneas son intocables
  r := public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(
    pg_temp.op('invoices','update', jsonb_build_object('id', inv, 'status','issued','issue_date', current_date)))));
  if (r -> 0 -> 'rows' -> 0 ->> 'number') is null then raise exception 'FAIL: emisión sin número'; end if;
  perform public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(pg_temp.op('invoice_items','delete', jsonb_build_object('id', it1)))));
  if not exists (select 1 from public.invoice_items where id = it1) then raise exception 'FAIL: se borró una línea de factura emitida'; end if;
  begin
    perform public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(pg_temp.op('expenses','delete', jsonb_build_object('id', exp)))));
    raise exception 'FAIL: se pudo borrar un gasto';
  exception when insufficient_privilege then null; end;
  perform set_config('test.expense_a', exp::text, false);
  raise notice 'PASS gastos, proveedores, membresías, cargos y tareas por sync_push con auditoría';
  raise notice 'PASS borrador editable (borrar líneas), emitida inmutable, gastos nunca se borran';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.expenses where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.suppliers where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.customer_memberships where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.tasks where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: B ve gastos/proveedores/membresías/tareas de A';
  end if;
  begin
    perform public.sync_push(current_setting('test.org_b')::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
      'table','expenses','op','update','rows', jsonb_build_array(jsonb_build_object('id', current_setting('test.expense_a'), 'total', 1, 'subtotal', 1, 'tax_total', 0))))));
    raise exception 'FAIL: B modificó un gasto de A';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS gastos, proveedores, membresías y tareas aislados por empresa';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ begin
  if exists (select 1 from public.expenses) then raise exception 'FAIL: employee ve gastos (sin finance.view)'; end if;
  begin
    perform public.sync_push(current_setting('test.org_a')::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object(
      'table','expenses','op','insert','rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'organization_id', current_setting('test.org_a'),
        'issue_date', current_date, 'description','X','subtotal',1,'tax_total',0,'total',1))))));
    raise exception 'FAIL: employee registró un gasto';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS employee no ve ni registra gastos';
end $$;

-- ---------------------------------------------------------------------
\echo '0910. Auditoría de equipo, empresa y configuración'
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$
declare v_member uuid;
begin
  if not exists (select 1 from public.audit_logs where organization_id = current_setting('test.org_a')::uuid
                 and entity_type = 'organization_members' and action = 'invite' and context->>'role' = 'employee') then
    raise exception 'FAIL: alta en el equipo sin «invite» con el rol';
  end if;
  select id into v_member from public.organization_members where organization_id = current_setting('test.org_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000cc';
  perform public.update_member(v_member, 'manager');
  if not exists (select 1 from public.audit_logs where entity_id = v_member and action = 'role_change' and context->>'from' = 'accountant' and context->>'to' = 'manager') then
    raise exception 'FAIL: cambio de rol sin «role_change» from/to';
  end if;
  perform public.update_member(v_member, 'accountant');
  update public.organizations set name = 'Empresa A (renombrada)' where id = current_setting('test.org_a')::uuid;
  if not exists (select 1 from public.audit_logs where organization_id = current_setting('test.org_a')::uuid and entity_type = 'organizations'
                 and changes ? 'name') then
    raise exception 'FAIL: cambiar el nombre de la empresa no queda en la auditoría';
  end if;
  update public.organization_settings set pos_settings = pos_settings || '{"allow_negative_stock": false}'::jsonb where organization_id = current_setting('test.org_a')::uuid;
  if not exists (select 1 from public.audit_logs where organization_id = current_setting('test.org_a')::uuid and entity_type = 'organization_settings') then
    raise exception 'FAIL: cambiar la configuración no queda en la auditoría';
  end if;
  raise notice 'PASS equipo (invite/role_change), empresa y configuración auditados en servidor';
end $$;


-- =====================================================================
\echo '0920. Cobros, equipo, excepciones de permisos y datos sensibles'
-- =====================================================================
reset role;
select pg_temp.login('');   -- alta de datos de prueba como mantenimiento/servicio
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'marta@empresa-a.test'),   -- manager
  ('00000000-0000-0000-0000-000000000012', 'dani@empresa-a.test');    -- admin
insert into public.organization_members (organization_id, user_id, role_id)
select current_setting('test.org_a')::uuid, '00000000-0000-0000-0000-000000000011', id from public.roles where key = 'manager' and organization_id is null;
insert into public.organization_members (organization_id, user_id, role_id)
select current_setting('test.org_a')::uuid, '00000000-0000-0000-0000-000000000012', id from public.roles where key = 'admin' and organization_id is null;
select set_config('test.pm_card', (select id::text from public.payment_methods where organization_id = current_setting('test.org_a')::uuid and key = 'card'), false);
select set_config('test.sale_e', gen_random_uuid()::text, false);
select set_config('test.pay_e', gen_random_uuid()::text, false);
select set_config('test.cus_f', gen_random_uuid()::text, false);

-- Ayuda: la sentencia debe fallar por permisos (42501) o por regla de negocio (23514)
create or replace function pg_temp.denied(q text, what text) returns void language plpgsql as $f$
begin
  begin
    execute q;
  exception when others then
    if sqlstate in ('42501', '23514') then return; end if;
    raise exception 'FAIL: % (error inesperado % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: %', what;
end $f$;
create or replace function pg_temp.rowcount(q text) returns int language plpgsql as $f$
declare n int;
begin execute q; get diagnostics n = row_count; return n; end $f$;

set role authenticated;

-- ---------------------------------------------------------------------
\echo '0920-A. Cobros'
-- employee (Centro Sur): vende y cobra en caja, pero no cobra facturas ni cuotas ni devuelve
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ declare org uuid := current_setting('test.org_a')::uuid; pm uuid := current_setting('test.pm_card')::uuid; sale uuid := current_setting('test.sale_e')::uuid;
begin
  insert into public.sales (id, organization_id, location_id, subtotal, tax_total, total) values (sale, org, current_setting('test.loc_a2')::uuid, 100, 21, 121);
  insert into public.payments (id, organization_id, location_id, kind, sale_id, payment_method_id, method_kind, amount)
  values (current_setting('test.pay_e')::uuid, org, current_setting('test.loc_a2')::uuid, 'charge', sale, pm, 'card', 121);
  perform pg_temp.denied(format($q$insert into public.payments (organization_id, kind, invoice_id, payment_method_id, method_kind, amount) values (%L, 'charge', %L, %L, 'card', 100)$q$,
    org, current_setting('test.inv1'), pm), 'employee registró un cobro de factura (PostgREST)');
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','payments','op','insert','rows', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'organization_id', %L, 'kind','charge','invoice_id', %L,'payment_method_id', %L,'method_kind','card','amount',100))))))$q$,
    org, org, current_setting('test.inv1'), pm), 'employee registró un cobro de factura (sync_push)');
  perform pg_temp.denied(format($q$insert into public.payments (organization_id, location_id, kind, sale_id, payment_method_id, method_kind, amount, refund_of_payment_id) values (%L, %L, 'refund', %L, %L, 'card', 121, %L)$q$,
    org, current_setting('test.loc_a2'), sale, pm, current_setting('test.pay_e')), 'employee registró una devolución');
  perform pg_temp.denied(format($q$insert into public.payments (organization_id, kind, membership_charge_id, payment_method_id, method_kind, amount) values (%L, 'charge', gen_random_uuid(), %L, 'card', 100)$q$,
    org, pm), 'employee registró un cobro de cuota');
  if pg_temp.rowcount(format($q$update public.invoices set status = 'paid', amount_paid = total where id = %L$q$, current_setting('test.inv1'))) <> 0 then
    raise exception 'FAIL: employee marcó una factura como pagada';
  end if;
  raise notice 'PASS employee: cobra ventas en caja; no cobra facturas/cuotas, no devuelve, no marca facturas como pagadas (API y sync_push)';
end $$;

-- manager: cobra facturas (payments.manage) pero no emite/anula ni edita
select pg_temp.login('00000000-0000-0000-0000-000000000011');
do $$ declare org uuid := current_setting('test.org_a')::uuid; pm uuid := current_setting('test.pm_card')::uuid; inv uuid := current_setting('test.inv1')::uuid;
begin
  if not app.has_permission(org, 'payments.manage') then raise exception 'FAIL: manager sin payments.manage'; end if;
  insert into public.payments (organization_id, kind, invoice_id, payment_method_id, method_kind, amount) values (org, 'charge', inv, pm, 'card', 3000);
  update public.invoices set status = 'partially_paid', amount_paid = 3000, payment_method_id = pm where id = inv;     -- cobro parcial
  update public.invoices set status = 'paid', amount_paid = total, paid_at = now() where id = inv;                      -- resto
  perform pg_temp.denied(format($q$update public.invoices set status = 'void', voided_at = now(), void_reason = 'x' where id = %L$q$, inv), 'manager anuló una factura');
  perform pg_temp.denied(format($q$update public.invoices set notes = 'editada' where id = %L$q$, inv), 'manager editó una factura (sin invoices.manage)');
  perform pg_temp.denied(format($q$insert into public.invoices (organization_id, series_id, issue_date, status, customer_name, subtotal, tax_total, total) values (%L, %L, current_date, 'issued', 'X', 100, 21, 121)$q$,
    org, current_setting('test.series_a')), 'manager emitió una factura libre (sin invoices.manage)');
  raise notice 'PASS manager: cobra (parcial y total) facturas pendientes; no anula, no edita, no emite facturas libres';
end $$;

-- cuota de membresía: el manager la emite y la cobra; el employee no
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$ declare org text := current_setting('test.org_a'); plan uuid := gen_random_uuid(); ver uuid := gen_random_uuid(); mem uuid := gen_random_uuid(); ch uuid := gen_random_uuid();
begin
  perform public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(
    pg_temp.op('membership_plans','insert', jsonb_build_object('id', plan, 'organization_id', org, 'name','Cuota 0920','kind','recurring','billing_period','month')),
    pg_temp.op('membership_plan_versions','insert', jsonb_build_object('id', ver, 'organization_id', org, 'plan_id', plan, 'version',1,'price',6000,'tax_rate_bp',2100,'valid_from', current_date)),
    pg_temp.op('customers','insert', jsonb_build_object('id', current_setting('test.cus_f'), 'organization_id', org, 'first_name','Fiscal','status','active','tags','{}',
      'tax_id','B12345678','address','Calle Falsa 1','postal_code','28001','city','Madrid','birth_date','1990-01-01','email','fiscal@x.test','phone','600000000')),
    pg_temp.op('customer_memberships','insert', jsonb_build_object('id', mem, 'organization_id', org, 'customer_id', current_setting('test.cus_f'),
      'plan_id', plan, 'plan_version_id', ver, 'price', 6000, 'start_date', current_date, 'next_renewal_date', current_date + 30, 'status','active')))));
  perform set_config('test.mem_f', mem::text, false);
end $$;
select pg_temp.login('00000000-0000-0000-0000-000000000011');
do $$ declare org text := current_setting('test.org_a'); inv uuid := gen_random_uuid(); pm text := current_setting('test.pm_card'); r jsonb;
begin
  r := public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(
    pg_temp.op('invoices','insert', jsonb_build_object('id', inv, 'organization_id', org, 'series_id', current_setting('test.series_a'), 'issue_date', current_date, 'status','paid',
      'source','membership','customer_id', current_setting('test.cus_f'), 'customer_name','Fiscal','customer_membership_id', current_setting('test.mem_f'),
      'subtotal', 4959, 'tax_total', 1041, 'total', 6000, 'amount_paid', 6000, 'payment_method_id', pm)),
    pg_temp.op('invoice_items','insert', jsonb_build_object('id', gen_random_uuid(), 'organization_id', org, 'invoice_id', inv, 'description','Cuota','quantity',1,'unit_price',6000,'tax_rate_bp',2100,'base_amount',4959,'tax_amount',1041,'total',6000)),
    pg_temp.op('payments','insert', jsonb_build_object('id', gen_random_uuid(), 'organization_id', org, 'kind','charge','invoice_id', inv,'payment_method_id', pm,'method_kind','card','amount',6000)),
    pg_temp.op('membership_charges','insert', jsonb_build_object('id', gen_random_uuid(), 'organization_id', org, 'customer_membership_id', current_setting('test.mem_f'),
      'period_start', current_date, 'period_end', current_date + 29, 'amount', 6000, 'status','paid', 'invoice_id', inv)))));
  if (select customer_tax_id from public.invoices where id = inv) is distinct from 'B12345678' then raise exception 'FAIL: el servidor no completó el NIF de la factura de cuota'; end if;
  if (select customer_address from public.invoices where id = inv) is distinct from 'Calle Falsa 1, 28001 Madrid' then raise exception 'FAIL: dirección de la factura (%)', (select customer_address from public.invoices where id = inv); end if;
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','invoices','op','insert','rows', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'organization_id', %L, 'series_id', %L, 'issue_date', current_date, 'status','issued','source','manual','subtotal',100,'tax_total',21,'total',121))))))$q$,
    org, org, current_setting('test.series_a')), 'manager emitió factura manual por sync_push');
  raise notice 'PASS manager emite y cobra una cuota (factura de cuota + cobro + cargo pagado) y el servidor completa el NIF/dirección que el manager no ve';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
do $$ declare org text := current_setting('test.org_a'); n0 int; begin
  select count(*) into n0 from public.payments;
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','invoices','op','insert','rows', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'organization_id', %L, 'series_id', %L, 'issue_date', current_date, 'status','paid','source','membership','subtotal',100,'tax_total',21,'total',121,'amount_paid',121))))))$q$,
    org, org, current_setting('test.series_a')), 'employee emitió una factura de cuota');
  raise notice 'PASS employee no emite ni cobra cuotas';
end $$;

-- Sin payments.manage (excepción) ni el contable cobra; sin invoices.manage no edita
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-0000000000cc'), '{}', array['payments.manage']);
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-000000000011'), '{}', array['payments.manage']);
select pg_temp.login('00000000-0000-0000-0000-0000000000cc');
do $$ declare org uuid := current_setting('test.org_a')::uuid; inv uuid; pm uuid := current_setting('test.pm_card')::uuid;
begin
  if app.has_permission(org, 'payments.manage') then raise exception 'FAIL: la excepción revoke no se aplica'; end if;
  select id into inv from public.invoices where status = 'issued' and organization_id = org limit 1;
  if inv is null then raise exception 'FAIL: sin factura emitida para la prueba'; end if;
  perform pg_temp.denied(format($q$insert into public.payments (organization_id, kind, invoice_id, payment_method_id, method_kind, amount) values (%L, 'charge', %L, %L, 'card', 100)$q$, org, inv, pm), 'contable sin payments.manage registró un cobro');
  perform pg_temp.denied(format($q$update public.invoices set status = 'paid', amount_paid = total where id = %L$q$, inv), 'contable sin payments.manage marcó factura pagada');
  update public.invoices set notes = 'nota del contable' where id = inv;      -- editar sí (invoices.manage)
  raise notice 'PASS contable con payments.manage denegado: edita facturas pero no cobra ni marca como pagada';
end $$;
select pg_temp.login('00000000-0000-0000-0000-000000000011');
do $$ declare org text := current_setting('test.org_a'); begin
  -- manager sin payments.manage: puede generar el cargo (facturado) pero no marcarlo cobrado
  perform pg_temp.denied(format($q$insert into public.membership_charges (organization_id, customer_membership_id, period_start, period_end, amount, status) values (%L, %L, current_date + 100, current_date + 129, 6000, 'paid')$q$, org, current_setting('test.mem_f')),
    'cargo de cuota cobrado sin payments.manage');
  insert into public.membership_charges (organization_id, customer_membership_id, period_start, period_end, amount, status) values (org::uuid, current_setting('test.mem_f')::uuid, current_date + 100, current_date + 129, 6000, 'invoiced');
  raise notice 'PASS cuotas: marcar un cargo como cobrado exige payments.manage';
end $$;

-- ---------------------------------------------------------------------
\echo '0920-B. Equipo y excepciones'
select pg_temp.login('00000000-0000-0000-0000-000000000012');   -- admin Dani
do $$ declare org uuid := current_setting('test.org_a')::uuid; owner_role uuid; admin_role uuid; m_owner uuid; m_self uuid;
begin
  select id into owner_role from public.roles where key = 'owner' and organization_id is null;
  select id into admin_role from public.roles where key = 'admin' and organization_id is null;
  select id into m_owner from public.organization_members where organization_id = org and role_id = owner_role;
  select id into m_self from public.organization_members where organization_id = org and user_id = auth.uid();
  perform pg_temp.denied(format($q$update public.organization_members set role_id = %L where id = %L$q$, admin_role, m_owner), 'admin degradó al owner por PostgREST');
  perform pg_temp.denied(format($q$update public.organization_members set status = 'suspended' where id = %L$q$, m_owner), 'admin suspendió al owner');
  perform pg_temp.denied(format($q$update public.organization_members set permission_overrides = '{"grant":[],"revoke":["team.manage"]}' where id = %L$q$, m_owner), 'admin puso excepciones al owner');
  perform pg_temp.denied(format($q$update public.organization_members set role_id = %L where id = %L$q$, owner_role, m_self), 'admin se hizo owner');
  perform pg_temp.denied(format($q$update public.organization_members set permission_overrides = '{"grant":[],"revoke":["sales.void"]}' where id = %L$q$, m_self), 'admin cambió sus propios permisos');
  perform pg_temp.denied(format($q$update public.organization_members set status = 'suspended' where id = %L$q$, m_self), 'admin se suspendió a sí mismo');
  perform pg_temp.denied(format($q$insert into public.organization_members (organization_id, user_id, role_id) values (%L, '00000000-0000-0000-0000-00000000000b', %L)$q$, org, owner_role), 'segundo owner');
  perform pg_temp.denied(format($q$select public.update_member(%L, 'owner')$q$, m_self), 'update_member a owner');
  raise notice 'PASS el owner no se toca, nadie cambia lo suyo y no hay segundo owner (ni por PostgREST directo)';
end $$;
select pg_temp.login('00000000-0000-0000-0000-000000000011');   -- manager Marta (sin team.manage)
do $$ declare org uuid := current_setting('test.org_a')::uuid; m_e uuid; begin
  select id into m_e from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-00000000000e';
  if pg_temp.rowcount(format($q$update public.organization_members set status = 'suspended' where id = %L$q$, m_e)) <> 0 then raise exception 'FAIL: manager cambió a otro miembro'; end if;
  perform pg_temp.denied(format($q$select public.set_member_overrides(%L, array['audit.view'], '{}')$q$, m_e), 'manager dio permisos sin team.manage');
  raise notice 'PASS MANAGER no gestiona equipo ni permisos';
end $$;
select pg_temp.login('00000000-0000-0000-0000-0000000000cc');   -- contable (finance) no gestiona equipo
do $$ declare org uuid := current_setting('test.org_a')::uuid; m_e uuid; begin
  select id into m_e from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-00000000000e';
  perform pg_temp.denied(format($q$select public.update_member(%L, 'manager')$q$, m_e), 'FINANCE cambió un rol');
  perform pg_temp.denied(format($q$select public.add_member_by_email(%L, 'x@x.test', 'employee')$q$, org), 'FINANCE invitó');
  raise notice 'PASS FINANCE no gestiona el equipo';
end $$;

-- overrides: se aplican, se validan, se auditan
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$ declare org uuid := current_setting('test.org_a')::uuid; m_m uuid; m_e uuid; m_d uuid;
begin
  select id into m_m from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-000000000011';
  select id into m_e from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-00000000000e';
  select id into m_d from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-000000000012';
  -- Marta (manager): + gastos, + emitir facturas; - anular ventas (y sigue sin cobrar: revoke previo)
  perform public.set_member_overrides(m_m, array['expenses.manage', 'invoices.manage', 'reports.export'], array['sales.void', 'payments.manage']);
  perform pg_temp.denied(format($q$select public.set_member_overrides(%L, array['no.existe'], '{}')$q$, m_m), 'permiso desconocido en excepciones');
  perform pg_temp.denied(format($q$update public.organization_members set permission_overrides = '{"grant":"x"}' where id = %L$q$, m_m), 'excepciones mal formadas');
  perform pg_temp.denied(format($q$select public.set_member_overrides(%L, '{}', array['team.manage'])$q$, (select id from public.organization_members where organization_id = org and role_id = (select id from public.roles where key = 'owner' and organization_id is null))), 'excepciones al owner');
  if not exists (select 1 from public.audit_logs where entity_id = m_m and action = 'permission_change' and context #>> '{to,grant}' like '%invoices.manage%' and context #>> '{from,grant}' = '[]') then
    raise exception 'FAIL: permission_change sin auditar con de/a';
  end if;
  -- cambiar centros a «todos»: la auditoría conserva «to: null»
  perform public.update_member(m_e, null, null, true, null);
  if not exists (select 1 from public.audit_logs where entity_id = m_e and action = 'update' and (changes -> 'location_ids') ? 'to' and (changes #> '{location_ids,to}') = 'null'::jsonb) then
    raise exception 'FAIL: auditoría de centros pierde el valor «to» (%)', (select changes from public.audit_logs where entity_id = m_e and action = 'update' order by id desc limit 1);
  end if;
  raise notice 'PASS excepciones validadas, auditadas (permission_change) y «todos los centros» auditado completo';
end $$;
select pg_temp.login('00000000-0000-0000-0000-000000000011');
do $$ declare org uuid := current_setting('test.org_a')::uuid; begin
  if not (app.has_permission(org, 'expenses.manage') and app.has_permission(org, 'invoices.manage') and app.has_permission(org, 'reports.export')) then raise exception 'FAIL: grant no efectivo'; end if;
  if app.has_permission(org, 'sales.void') or app.has_permission(org, 'payments.manage') then raise exception 'FAIL: revoke no efectivo'; end if;
  if not app.has_permission(org, 'customers.manage') then raise exception 'FAIL: lo no tocado debe seguir según el rol'; end if;
  -- ya emite facturas (grant) y no cobra (revoke): ejemplo del producto
  insert into public.invoices (organization_id, series_id, issue_date, status, customer_name, subtotal, tax_total, total) values (org, current_setting('test.series_a')::uuid, current_date, 'issued', 'Con grant', 100, 21, 121);
  perform pg_temp.denied(format($q$update public.invoices set status = 'paid', amount_paid = total where customer_name = 'Con grant' and organization_id = %L$q$, org), 'manager sin payments.manage cobró');
  raise notice 'PASS MANAGER + overrides: emite facturas y ve gastos (grant), no anula ventas ni cobra (revoke)';
end $$;
-- Un manager con team.manage concedido NO puede escalar más allá de lo que tiene
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-000000000011'), array['team.manage', 'expenses.manage', 'invoices.manage', 'reports.export'], array['sales.void', 'payments.manage']);
select pg_temp.login('00000000-0000-0000-0000-000000000011');
do $$ declare org uuid := current_setting('test.org_a')::uuid; m_e uuid; custom uuid := gen_random_uuid(); begin
  select id into m_e from public.organization_members where organization_id = org and user_id = '00000000-0000-0000-0000-00000000000e';
  perform pg_temp.denied(format($q$select public.set_member_overrides(%L, array['settings.manage'], '{}')$q$, m_e), 'concedió un permiso que no tiene');
  perform pg_temp.denied(format($q$select public.update_member(%L, 'admin')$q$, m_e), 'concedió un rol mayor que el suyo');
  perform pg_temp.denied(format($q$select public.update_member(%L, 'owner')$q$, m_e), 'concedió owner');
  perform public.set_member_overrides(m_e, array['expenses.manage'], '{}');   -- sí: lo tiene
  insert into public.roles (id, organization_id, key, name) values (custom, org, 'rol_propio', 'Rol propio');
  perform pg_temp.denied(format($q$insert into public.role_permissions (role_id, permission) values (%L, '*')$q$, custom), 'rol propio con comodín');
  perform pg_temp.denied(format($q$insert into public.role_permissions (role_id, permission) values (%L, 'settings.manage')$q$, custom), 'rol propio con permiso ajeno');
  insert into public.role_permissions (role_id, permission) values (custom, 'dashboard.view');
  raise notice 'PASS un gestor de equipo no concede más de lo que tiene (permisos, roles ni roles propios)';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-000000000011'), '{}', array['payments.manage']);

-- ---------------------------------------------------------------------
\echo '0920-C. customers.sensitive'
select pg_temp.login('00000000-0000-0000-0000-00000000000e');   -- employee: sin customers.sensitive
do $$ declare org text := current_setting('test.org_a'); n int; r jsonb; cid uuid := gen_random_uuid(); begin
  perform pg_temp.denied('select tax_id from public.customers', 'employee leyó el NIF por la API');
  perform pg_temp.denied('select address from public.customers', 'employee leyó la dirección');
  perform pg_temp.denied('select * from public.customers', 'employee hizo select * de customers');
  perform pg_temp.denied('select birth_date, company_name, postal_code, city, tax_id_normalized, tax_id_valid from public.customers', 'employee leyó datos personales');
  select count(*) into n from public.customers_safe;
  if n = 0 then raise exception 'FAIL: employee no ve clientes (customers_safe)'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'customers_safe' and table_schema = 'public' and column_name in ('tax_id','address','postal_code','city','company_name','birth_date','tax_id_normalized','tax_id_valid')) then
    raise exception 'FAIL: customers_safe expone columnas sensibles';
  end if;
  perform public.customers_sensitive(org::uuid);
  if public.customers_sensitive(org::uuid) <> '[]'::jsonb then raise exception 'FAIL: employee obtuvo datos sensibles por la RPC'; end if;
  -- puede crear y editar lo no sensible; no escribir lo sensible
  r := public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','customers','op','insert','rows', jsonb_build_array(
    jsonb_build_object('id', cid, 'organization_id', org, 'first_name','Mostrador','status','lead','tags','{}','tax_id',null,'address',null))))));
  if (r -> 0 -> 'rows' -> 0) ? 'tax_id' or (r -> 0 -> 'rows' -> 0) ? 'address' then raise exception 'FAIL: sync_push devolvió columnas sensibles a employee'; end if;
  r := public.sync_push(org::uuid, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','customers','op','update','rows', jsonb_build_array(jsonb_build_object('id', cid, 'first_name','Mostrador 2'))))));
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','customers','op','update','rows', jsonb_build_array(jsonb_build_object('id', %L, 'tax_id','A1'))))))$q$, org, cid), 'employee puso un NIF');
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','customers','op','update','rows', jsonb_build_array(jsonb_build_object('id', %L, 'address','Calle'))))))$q$, org, current_setting('test.cus_f')), 'employee cambió una dirección');
  perform pg_temp.denied(format($q$select public.sync_push(%L, jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('table','customers','op','insert','rows', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'organization_id', %L, 'first_name','Con NIF','tax_id','A7','tags','{}'))))))$q$, org, org), 'employee creó un cliente con NIF');
  raise notice 'PASS employee: no lee ni escribe datos fiscales/personales de clientes (columnas, vista, RPC y sync_push)';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');   -- propietario edita el NIF y la ciudad (queda auditado)
update public.customers set tax_id = 'B87654321', city = 'Sevilla' where id = current_setting('test.cus_f')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000cc');   -- contable: tiene customers.sensitive
do $$ declare org uuid := current_setting('test.org_a')::uuid; e jsonb; begin
  select x into e from jsonb_array_elements(public.customers_sensitive(org)) x where x ->> 'id' = current_setting('test.cus_f');
  if e is null or e ->> 'tax_id' <> 'B87654321' or e ->> 'city' <> 'Sevilla' or e ->> 'birth_date' <> '1990-01-01' or e ->> 'tax_id_normalized' <> 'B87654321' then
    raise exception 'FAIL: la RPC no devuelve lo sensible a quien tiene el permiso (%)', e;
  end if;
  perform pg_temp.denied('select tax_id from public.customers', 'ni el contable lee la columna directa (solo RPC)');
  if not exists (select 1 from public.audit_logs where entity_id = current_setting('test.cus_f')::uuid and changes ? 'tax_id') then raise exception 'FAIL: cambio de NIF sin auditar'; end if;
  raise notice 'PASS contable (customers.sensitive): lee por RPC y ve en la auditoría el cambio de NIF';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');   -- otra empresa
do $$ begin
  if public.customers_sensitive(current_setting('test.org_a')::uuid) <> '[]'::jsonb then raise exception 'FAIL: B leyó datos sensibles de A'; end if;
  raise notice 'PASS otra empresa no obtiene datos sensibles';
end $$;
-- Sin el permiso (excepción), el contable deja de ver lo sensible y los registros de auditoría que lo contienen
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-0000000000cc'), '{}', array['customers.sensitive', 'payments.manage']);
select pg_temp.login('00000000-0000-0000-0000-0000000000cc');
do $$ begin
  if public.customers_sensitive(current_setting('test.org_a')::uuid) <> '[]'::jsonb then raise exception 'FAIL: la excepción customers.sensitive no corta la RPC'; end if;
  if exists (select 1 from public.audit_logs where entity_id = current_setting('test.cus_f')::uuid and changes ? 'tax_id') then raise exception 'FAIL: auditoría con NIF visible sin customers.sensitive'; end if;
  if not exists (select 1 from public.audit_logs where action = 'insert') then raise exception 'FAIL: el resto de la auditoría debe seguir visible'; end if;
  raise notice 'PASS audit.view sin customers.sensitive: no ve NIF ni sus cambios en la auditoría';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_overrides((select id from public.organization_members where user_id = '00000000-0000-0000-0000-0000000000cc'), '{}', '{}');
do $$ declare bad text; begin
  -- Deriva de columnas: toda columna de customers es sensible (y está fuera del SELECT) o legible por authenticated
  select string_agg(a.attname, ', ') into bad from pg_attribute a
   where a.attrelid = 'public.customers'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('tax_id','tax_id_normalized','tax_id_valid','address','postal_code','city','company_name','birth_date')
     and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT');
  if bad is not null then raise exception 'FAIL: columnas no sensibles de customers sin SELECT (¿falta un GRANT en la migración?): %', bad; end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.customers'::regclass and a.attname in ('tax_id','tax_id_normalized','tax_id_valid','address','postal_code','city','company_name','birth_date')
             and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')) then raise exception 'FAIL: columna sensible legible por authenticated'; end if;
  if (public.server_capabilities() ->> 'schema')::int < 920 then raise exception 'FAIL: server_capabilities < 920'; end if;
  raise notice 'PASS columnas de customers: sensibles fuera del SELECT, el resto legible; capacidades 920';
end $$;

reset role;
\echo ''
\echo '✔ Todos los tests de aislamiento, permisos e integridad han pasado.'
