-- Reversión de 0810. ⚠ Vuelve a romper el alta de clientes/proveedores con NIF (ver la migración).
revoke execute on function app.normalize_tax_id(text) from authenticated, service_role;
