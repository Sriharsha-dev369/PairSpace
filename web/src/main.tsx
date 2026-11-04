import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./errors"; // first: report errors from the start (when the build says where)
import App from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing the #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
