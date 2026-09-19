import React from "react";
import { createRoot } from "react-dom/client";
const root = createRoot(document.getElementById("root"));
if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
  import("./Admin.tsx").then(({ Admin }) =>
    root.render(
      <React.StrictMode>
        <Admin />
      </React.StrictMode>,
    ),
  );
} else {
  Promise.all([import("./App.tsx"), import("./game.css")]).then(([{ App }]) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
