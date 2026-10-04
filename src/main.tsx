import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, getThemePref } from "./app/theme";
import "./index.css";

applyTheme(getThemePref());

// Al publicar una versión nueva desaparecen los fragmentos de la anterior (o la red falla al pedir uno): en vez de
// mostrar un error al abrir otra pantalla, se recarga una vez. Lo pendiente de guardar está en la cola local
// (IndexedDB) y se envía al volver. Si vuelve a fallar enseguida, la pantalla ofrece recargar a mano.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const key = "bos.chunkReloadAt";
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
