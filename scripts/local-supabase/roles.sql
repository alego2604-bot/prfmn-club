-- Business OS · stack local equivalente a Supabase: roles y privilegios que Supabase crea en cada proyecto.
-- Solo desarrollo/tests. En staging/producción ya existen (los crea Supabase).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password 'auth_admin';
create schema auth authorization supabase_auth_admin;
grant all on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role, postgres;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter role authenticated set statement_timeout = '8s';  -- igual que Supabase
alter role anon set statement_timeout = '3s';
