import { createAuthClient } from 'better-auth/react';

// Vite proxies same-origin /api requests to Fastify during development.
export const authClient = createAuthClient();
