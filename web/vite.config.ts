import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// the site's own address, for link previews (index.html): Render's, a custom domain's, or local
process.env.VITE_SITE_URL ??= process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the browser calls /api on the web app's own origin, so the session cookie is first-party
  server: { proxy: { "/api": process.env.SERVER_URL ?? "http://localhost:8080" } },
});
