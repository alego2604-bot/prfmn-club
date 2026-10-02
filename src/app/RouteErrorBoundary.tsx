import { Component, type ReactNode } from "react";
import { ErrorState } from "@/design-system/components";

/**
 * Error en una pantalla: nunca deja la app en blanco ni pierde la navegación. Ofrece reintentar, ver detalles y
 * volver al resumen. Si falla la carga de un fragmento (nueva versión publicada), propone recargar.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: unknown) {
    console.error("[pantalla]", error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = error instanceof Error && /dynamically imported module|Loading chunk|Failed to fetch/i.test(error.message);
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <ErrorState
          title={chunk ? "Hay una versión nueva de Business OS" : "Esta pantalla no se ha podido mostrar"}
          description={chunk ? "Recarga para usar la última versión. Tus datos están guardados." : "Tus datos no se han perdido. Puedes reintentar o volver al resumen; si se repite, envía los detalles al administrador."}
          error={error}
          onRetry={() => (chunk ? window.location.reload() : this.setState({ error: null }))}
        />
        <p className="mt-2 text-center text-sm"><a href={import.meta.env.BASE_URL} className="font-medium text-fg-3 hover:text-fg">Volver al resumen</a></p>
      </div>
    );
  }
}
