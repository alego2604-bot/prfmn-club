import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, getThemePref } from "./app/theme";
import "./index.css";

applyTheme(getThemePref());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
