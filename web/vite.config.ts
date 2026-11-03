import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// the site's own address, for link previews (index.html): set it when deploying
process.env.VITE_SITE_URL ??= "http://localhost:5173";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the browser calls /api on the web app's own origin, so the session cookie is first-party
  server: { proxy: { "/api": process.env.SERVER_URL ?? "http://localhost:8080" } },
});
