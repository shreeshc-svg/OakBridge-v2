import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const container = document.getElementById("root");
const app = (
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// If the page was prerendered (static markup already in #root), hydrate it so
// crawlers keep the server HTML and the app stays interactive. Otherwise mount fresh.
if (container.hasChildNodes()) {
    ReactDOM.hydrateRoot(container, app);
} else {
    ReactDOM.createRoot(container).render(app);
}
