import { createAuthClient } from "better-auth/react";

// talks to /api/auth on this origin (Vite's proxy forwards it to the server in development)
export const authClient = createAuthClient();
