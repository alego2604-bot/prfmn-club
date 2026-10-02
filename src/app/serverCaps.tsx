import { ServerCog } from "lucide-react";
import { Callout } from "@/design-system/components";
import { useSession, useWorkspace } from "./session";

/**
 * ¿El servidor admite los módulos de 0900 (gastos, proveedores, membresías, tareas, borradores de factura)?
 * En modo local siempre. En Supabase, si `server_capabilities()` existe (schema ≥ 900).
 * Sin ella se puede consultar, pero no se ofrece guardar: el servidor rechazaría el cambio.
 */
export function useServerReady(): boolean {
  const s = useSession();
  const ws = useWorkspace();
  return s.mode === "local" || !ws.server || ws.server.schema >= 900;
}

export function ServerNotice({ what = "Este módulo" }: { what?: string }) {
  const ready = useServerReady();
  if (ready) return null;
  return (
    <Callout tone="warning" icon={ServerCog} className="mb-5" title={`${what} necesita la actualización 0900 del servidor`}>
      Puedes consultar lo que ya existe, pero guardar está desactivado hasta aplicar la migración
      <span className="font-mono"> 20261002000900</span> en el servidor (una sola vez, la aplica quien administra Supabase).
    </Callout>
  );
}
