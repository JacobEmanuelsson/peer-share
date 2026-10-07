# Peer Share

A learning and portfolio project for browser-to-browser file sharing.
Currently: React/TypeScript/Tailwind starter page, Fastify health endpoint,
local MongoDB, and Better Auth server integration. Sign-in forms and file
transfer are the next learning steps.

## Local setup

Use Node.js 22.12+ and Docker Desktop. From the repository root:

```powershell
npm ci
```

Copy `server/.env.example` to `server/.env` only if you do not already have
that file. Generate a secret and set BETTER_AUTH_SECRET in server/.env:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep .env private. The backend loads server/.env explicitly; no root .env is needed.

Start MongoDB, then start each development server in its own terminal:

```powershell
docker compose up -d
npm run dev:server
```

```powershell
npm run dev:client
```

Open http://localhost:5173. Use localhost consistently for browser requests.
Vite proxies /api to Fastify on 127.0.0.1:3000 during development.

- /api/health: backend liveness, not database readiness.
- /api/auth/get-session: null when signed out.

Stop development servers with Ctrl+C. `docker compose down` stops MongoDB
while preserving its named volume. `docker compose down -v` deletes database data.
Deployment routing and production configuration will be handled later.

## Current structure

```text
client/
  src/
    main.tsx                          React entry point
    App.tsx                           Starter page
    styles.css                        Tailwind import
    features/auth/api/authClient.ts   Better Auth React client
  vite.config.ts                      Build plugins and development proxy
server/
  .env.example                        Environment template, no secrets
  src/
    index.ts                          Configuration, startup, shutdown
    app.ts                            Fastify app and health route
    db/mongo.ts                       MongoDB connection lifecycle
    modules/auth/
      auth.ts                         Better Auth configuration
      auth.route.ts                   Fastify request/response integration
compose.yaml                          Local MongoDB and persistent volume
```

Create feature folders when their implementation starts. Shared components,
WebRTC, cryptography, and signaling folders will be added when needed.

Frontend flow: index.html -> main.tsx -> App.tsx.
Authentication flow: auth client -> Vite proxy -> Fastify auth route -> Better Auth
-> MongoDB adapter. The client is ready for forms but is not used by the page yet.
Better Auth owns credentials and sessions. Transfer services will own access rules.

## Learning notes

- TypeScript checks types before execution; external input still needs runtime validation.
- Vite runs and builds the frontend.
- Tailwind generates CSS from utility classes in JSX.
- Fastify handles HTTP requests.
- npm workspaces keep frontend and backend dependencies in their own packages,
  with one root lockfile.
- MongoDB stores documents. Its official driver handles backend database access.

Future application requests will follow route -> service -> repository -> MongoDB.
The health route does not need a service or repository. Better Auth handles its
own persistence through its adapter.

## Verification and next steps

```powershell
npm run typecheck
npm run build
```

Build the sign-up/sign-in forms next. Verify sign-up, sign-in, session persistence,
sign-out, and invalid credentials. Then add a protected backend endpoint.
TanStack Query, Zod, WebRTC, and testing tools will be introduced incrementally.

Consult AGENTS.md for the local mentoring agreement.

Official references:
- https://vite.dev/guide/
- https://tailwindcss.com/docs/installation/using-vite
- https://better-auth.com/docs/integrations/fastify
- https://better-auth.com/docs/adapters/mongo
