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

## Frontend routes

React Router maps / to HomePage, /login to LoginPage, /sign-up to SignupPage,
and unmatched paths to NotFoundPage. main.tsx enables BrowserRouter;
router.tsx defines routes; App.tsx renders shared navigation and an Outlet.
Pages compose feature components in features/auth/components. Form submission
remains in the existing forms. Routes are public for now; session guards and
post-login navigation are future steps. Sign-out is available on the home page.

Check links, browser Back/Forward, direct visits, and refresh on /login and /sign-up.
Vite handles local page fallback. A production host must serve index.html for
frontend routes while keeping /api requests routed to the backend.

Routing reference: https://reactrouter.com/start/declarative/routing

## WebSocket learning demo

The home page includes ConnectionDemo. Its networking helper connects to
/api/signaling through Vite's WebSocket proxy. Send hello to receive a fixed
server response. Leaving the page closes the browser connection. The gateway requires a trusted browser origin and a signed-in session; WebRTC is not implemented yet.
Restart both dev servers after changing plugin or proxy configuration.


## Current room milestone

The signaling backend accepts create-room, join-room (with an invitation), and
peer-message messages. Each temporary room holds at most two connections;
messages go to the other member, and disconnects remove membership.
Rooms are lost when the backend restarts. New WebSocket connections require the origin configured by BETTER_AUTH_URL and a Better Auth session. Frontend create/join controls are not implemented yet. The current demo
button receives "Join or create a room first" until its socket joins a room.

## Signaling connection access

Before accepting /api/signaling, the gateway checks the exact Origin against
new URL(BETTER_AUTH_URL).origin, then validates the session using Better Auth.
Missing or different origins return 403. Signed-out requests return 401.
The browser sends its applicable session cookie during the WebSocket handshake.
Use localhost:5173 consistently in development and sign in before opening the demo.

The same auth instance is passed from index.ts to buildApp and the gateway.
These checks protect connection establishment only. Closing already-open sockets
when sessions expire or are revoked is the next step.

Run the isolated access tests (no MongoDB needed):

```powershell
npm run build --workspace server
node --test server/test/signaling-access.test.mjs
```

The tests use a controlled session resolver and cover origin rejection, missing
sessions, failed session lookup, cookie forwarding, and an accepted upgrade.

## Open-connection session checks

The gateway revalidates the original session before processing each message and
every 30 seconds while idle. Cookie-cache reads and session refresh are disabled
for these lookups. Revoked/expired sessions close with code 1008; lookup failures
close with 1011. Closing clears the timer and removes room membership.
Idle sign-out detection occurs at the next periodic check, not instantly.
This supersedes the connection-establishment-only limitation described above.

The prototype rejects overlapping messages while a session lookup is in flight.
A bounded sequential queue and rate limits are needed before WebRTC signaling
bursts are supported. These lookups add database traffic; the current implementation
prioritizes clear access behavior over throughput optimization.

## Authenticated connection registry

Each accepted socket receives a server-generated connection ID and is bound to
its verified Better Auth user and session IDs. The gateway owns an in-memory
registry that can find all active connections for an account, including separate
browser tabs or devices. Closing a socket removes only that connection.
Session revalidation rejects changes to the connection's original identity.

This is connection tracking only: targeted transfer invitations, recipient
acceptance, and locking the selected receiver are not implemented yet. Existing
room invitations still grant joining access to any authenticated token holder.
Connection IDs are internal identifiers, not credentials or persistent device IDs.

Registry tests: node --test server/test/signaling-connections.test.mjs

## Targeted invitation creation

A signed-in socket can send {"type":"create-invitation","recipientUserId":"..."}.
The gateway derives the sender account/connection from its verified registry,
creates a five-minute invitation, notifies the recipient's other open connections
with invitation-received, and acknowledges the sender with invitation-created.
A same-account invitation can reach another tab, but never the sending connection.
If there are no open recipient connections, it returns Recipient is unavailable.

signaling.invitations.ts owns a private Map retained by its returned methods.
Lookup rejects expired records; periodic cleanup removes expired records; sender
disconnect removes that sender connection's invitations. Records are immutable.
The store is temporary and local to one gateway instance. Invitation acceptance,
receiver locking, user lookup UI, and client response validation are future steps.
The old room flow is still a separate prototype and is not account-bound.

Run invitation tests after building the backend:
node --test server/test/signaling-invitations.test.mjs

## Gateway acceptance milestone

Send {"type":"accept-invitation","invitationId":"..."} on an authenticated socket.
The gateway validates the message, checks the intended recipient and original
sender connection, then calls acceptInv with server-verified identity. First
acceptance wins. The selected receiver and original sender receive
invitation-accepted with receiver/sender roles; other recipient connections receive
invitation-accepted-elsewhere. Extra client identity fields are rejected.

This adds acceptance handling only. Forwarding still uses the separate prototype
room flow, not accepted participant IDs. Accepted-record expiry and disconnect
policies must be addressed before using acceptance to authorize ongoing signaling.
