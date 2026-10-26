# Peer Share

> Current signaling milestone: accepted pairs now control peer-message forwarding.
> The old room routes are removed. See [the current protocol](server/src/modules/signaling/README.md).
> Older milestone notes below describe previous implementations.


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

## Frontend invitation controls

Sign in on two accounts or open multiple tabs on one account. Each signed-in home
page shows its account ID. The sender enters the recipient's account ID and clicks
Invite. The receiving tab clicks Accept invitation; other recipient tabs see that
it was accepted elsewhere. Only the selected pair can use Send message.
Leaving the home page or signing out closes that tab's socket and ends its pair.
A new invitation is required to pair again. Refresh reconnects a lost connection.
These are server-relayed text messages, not WebRTC file transfer yet.

Browser verification covered actual signup/session cookies, unavailable recipients,
recipient tabs, acceptance, two-way messages, disconnect/re-pair, and sign-out
cleanup. Temporary verification accounts were removed afterward.

## Current milestone: WebRTC transfers

Accepted invitation pairs now establish a browser WebRTC DataChannel. Text and
file contents travel through that encrypted connection; the WebSocket exchanges
only setup messages. Either participant selects a file (maximum 1 GiB), the receiving
tab accepts it, and a download link appears after byte-count and SHA-256 checks.
Both people can send simultaneously; each has separate sending/receiving progress.

Start MongoDB, the backend, and the frontend as described above. Sign in in two
tabs/accounts, invite the recipient account ID, and accept in the desired tab.
Wait for WebRTC: connected, then select and send a file. Click Accept file on the
receiver and download the verified result.

This implementation streams received files to browser-managed temporary disk and defaults to local ICE
candidates. Optional STUN configuration is in client/.env.example. Reliable use
across different networks requires TURN and HTTPS/WSS before deployment.
Earlier milestone notes above describe historical behavior; the current protocol,
limits, file responsibilities, and checks are in server/src/modules/signaling/README.md.
## Workspace UI and authentication navigation

The current UI has responsive sign-in/sign-up pages, authenticated navigation,
connection/invitation panels, a file picker with separate sending/receiving
progress, verified downloads, and direct messages.

client/src/features/auth/components/SessionBoundary.tsx owns route decisions:
- /app is protected: a signed-out visitor is redirected to /login.
- /login and /sign-up are guest pages: a signed-in visitor is redirected to /app.
- Signup and login navigate to /app after success; signout replaces the route with /login.
- Pending session checks show a loading state. Verification errors show a retry
  screen instead of mounting the private workspace.
- The session is checked again on window focus and every 30 seconds. Losing the
  session unmounts the workspace and closes that tab's WebSocket/WebRTC connections.
- Unknown routes show a public 404 page; they do not mount private content.

These are navigation rules, not server authorization. Backend access remains:

| Endpoint | Access |
| --- | --- |
| GET /api/health | Public liveness information only |
| GET/POST /api/auth/* | Better Auth owns the individual endpoint rules; signup/login must remain reachable |
| GET /api/me | Current server-verified session required; 401 otherwise; Cache-Control: no-store |
| /api/signaling WebSocket | Exact configured browser Origin and current session required; pair membership and session revalidated before forwarding |

The profile route disables the cookie session cache and session refresh for its
lookup. Private future REST routes must add server-side session/authorization
checks too; adding a frontend guard alone never secures an API.

Presentation files: client/src/styles.css for shared colors/layout/responsive
rules; App.tsx for the header/footer; AuthLayout.tsx for the common auth layout;
ConnectionDemo.tsx for the workspace controls. WebRTC logic remains in client/src/webrtc.

Verification included signed-out and signed-in direct navigation, signup/login
redirects, incorrect passwords, logout and browser history, rejected forged and
revoked cookies, session-loss cleanup, public health, desktop/mobile screenshots,
no horizontal overflow at 390px, and simultaneous two-way file transfer. Test
accounts and their auth records were removed.

Additional private-endpoint checks:
node --test server/test/auth-routes.test.mjs
## Friends and sharing groups

The workspace now includes saved friends and groups. Add someone using their
account ID; they accept the friend request. Accepted friends have an Invite
shortcut. Create a named group with up to five friends plus yourself, then have
members join the same group. Select connected members, choose a file, and send
to several people at once. Each recipient still explicitly accepts the file.
All members can send, including simultaneously on separate peer connections.

Friendships/group membership are stored in MongoDB; files remain peer-to-peer.
TanStack Query manages the saved social data; WebRTC state stays local.
Leaving a live session keeps the group saved. Leaving the saved group or deleting
it immediately revokes the corresponding live access. The owner deletes the group;
other members can leave. Only one device/tab per account may join that group.

See server/src/modules/social/README.md for architecture, routes, limits,
authorization, tests, and the distinction between saved membership and live mesh
connections.
## Local conversation history

The note area is now a chat timeline for direct and group conversations. It shows
sent/received messages, names, local dates/times, actual recipients, and file
offers with completion/decline/interruption states. Friends have a Chat with…
shortcut to view history even without a live peer. Group chat sends text to all
connected members; file selection remains independent.

As requested, history stays on this device/browser, scoped to the signed-in
account and peer/group. The latest 200 entries persist through reloads. Temporary
verified downloads appear in the timeline, but file bytes are not saved in the
history database; download links cannot survive a reload. Clear history removes
the local conversation log.

Implementation and storage limits: client/src/features/chat/README.md.
## Public landing page and current routes

Visit / for the interactive public landing page. It keeps the dark green/lime
design and includes a clearly labelled simulation: add/select sample people,
connect, accept their invitations, then send a sample file. The preview never
selects a real file or opens WebRTC/signaling connections.

The existing authenticated workspace has moved to /app. Successful login/signup
redirect there, and signed-in visitors to the auth forms are redirected there
too. The landing page stays public even when signed in, with Open workspace
navigation. The backend authorization rules remain unchanged.

The setup/transfer explainer shows the server's signaling role versus the file
DataChannel. Reduced-motion, keyboard and responsive layouts are supported.
Source layout and verification: client/src/features/landing/README.md.
Earlier milestone examples that use / as the workspace predate this route change.
## Large files: 1 GiB

The inclusive per-file limit is 1,073,741,824 bytes (1 GiB).
The sender hashes the selected file in 1 MiB slices using hash-wasm SHA-256.
The receiver hashes the incoming 16 KiB chunks and writes to OPFS (browser-managed
temporary disk) with a 256 KiB write buffer. No entire-file arrayBuffer or
in-memory chunk list is used. WebRTC encrypts the transport as before.

Cumulative receiver acknowledgements cap unacknowledged payload at 256 KiB;
the existing DataChannel and receive-queue bounds remain in place. UI byte
progress is throttled to 100 ms. Size and SHA-256 must match before a verified
download link and completion acknowledgement are published.

Acceptance checks OPFS support and estimated free quota (file size + 32 MiB
headroom). Estimates are advisory: a later disk write can still fail, which ends
the transfer and removes its partial file. Unsupported browsers decline the
offer with an explanation, rather than falling back to a 1 GiB memory buffer.
Use HTTPS in production; localhost is suitable for development.

Verified downloads are disk-backed File objects. A conversation retains at most
10 download links / 2 GiB total. Clearing history, eviction, switching
conversations and unmounting revoke the URLs and remove their temporary files.
A crash can leave abandoned files; the next accepted transfer reclaims files
older than 24 hours. Chat metadata still survives reload, but download links do
not. Temporary files are local site storage, not separately encrypted at rest.
A browser download may require another copy's worth of disk space.

Both peers must keep their tabs open. Transfers cannot resume after refresh or
disconnect. Groups send an independent copy to each selected recipient, so
bandwidth and temporary disk usage multiply. These changes do not add TURN:
connections across restrictive networks still need production ICE configuration.

### Repeatable browser checks

Start MongoDB, the backend and frontend using the normal development commands.
Install the browser test engines with:

    npx playwright install firefox webkit

Run from the repository root (Chrome and Edge must already be installed):

    node client/test/browser/large-transfer.mjs chrome
    node client/test/browser/large-transfer.mjs edge
    node client/test/browser/large-transfer.mjs firefox
    node client/test/browser/disk-storage.mjs firefox
    node client/test/browser/disk-storage.mjs webkit

Chrome and Edge checks use isolated ordinary profiles because private contexts can impose lower quotas.
The end-to-end check creates two isolated test accounts, rejects 1 GiB + 1 byte,
transfers an exact 1 GiB sparse file over real WebRTC, streams the downloaded
file through Node SHA-256, and deletes its own accounts/files in finally.
The disk check independently writes, hashes, reads and disposes a full 1 GiB
using the production storage modules. Run against stable source: Vite hot
reloads during a transfer will interrupt it.

These are local-machine tests, not internet/TURN, mobile or Safari certification.
See client/test/browser/RESULTS.md for observed browser results.
## Release features 1–5

Email verification is now required before sharing. Signup redirects to
/verify-email; verified users sign in to /app. Existing unverified accounts can
request a link on /verify-email. Development mail is captured locally at
http://localhost:8025; run docker compose up -d mailpit. It does not deliver
messages to external inboxes.

Account recovery, password changes/deletion, cancellation/retry, reconnect
controls, user blocking, HTTP/WebSocket rate limits and authenticated TURN
credential delivery are implemented. ICE configuration now lives on the backend,
not in VITE_STUN_URL. No file content passes through the application backend.

The local coturn configuration is test-only. The public deployment now has
a configured free TURN fallback with a 500 MB monthly relay allowance. Actual Safari validation is pending owner device testing.
No paid subscriptions have been created.

See docs/RELEASE-CHECKLIST.md for architecture, commands, tested behavior,
exact limits, free-only prerequisites and the public deployment status.

## Public hosting

Live site: https://peer-share-jacob.onrender.com/ (Render Free + Atlas M0).
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Atlas, email, private environment
settings, account setup and verification. Brevo SMTP account email was enabled
on 2026-10-26. The setup test reached the owner's junk folder; hosted account
verification and workspace sign-in were confirmed by the owner.

Public TURN support now loads provider ICE configuration through the verified
backend session. The current free relay account has 500 MB/month; that quota is
separate from the app's 1 GiB file limit. TURN is a fallback; direct transfers
avoid relay bandwidth. See docs/CROSS-NETWORK-TEST.md for actual device testing.

Verification feedback tests (UI fixtures only):

    node client/test/browser/verification-feedback.mjs

The expanded release-features.mjs check covers bidirectional verified downloads,
three-person groups, reconnect and cancellation. FORCE_RELAY=1 forces the actual
configured relay and asserts that selected candidates use it. Do not point its
local Mailpit/test-account cleanup at the production database unchanged.

For a tiny TLS-only public provider probe, set TURN_SETUP_PATH to the private
provider settings file, TEST_BASE_URL to the running local test app, then run:

    node client/test/browser/turn-tls.mjs