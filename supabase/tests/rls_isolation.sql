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
  ('00000000-0000-0000-0000-00000000000a', 'alex@gravity.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@othergym.test'),
  ('00000000-0000-0000-0000-00000000000e', 'emma@gravity.test'),
  ('00000000-0000-0000-0000-0000000000cc', 'carla@gestoria.test');

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

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
select set_config('test.org_a', public.create_organization('The Gravity Room', 'fitness', 'Calonge')::text, false);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.org_b', public.create_organization('Other Gym', 'fitness', 'Centro')::text, false);

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
insert into public.locations (organization_id, name) values (current_setting('test.org_a')::uuid, 'Girona')
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
  if exists (select 1 from public.sales) then raise exception 'FAIL: employee de Girona ve ventas de Calonge'; end if;
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

reset role;
\echo ''
\echo '✔ Todos los tests de aislamiento, permisos e integridad han pasado.'
