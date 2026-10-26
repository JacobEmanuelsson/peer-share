# Free public deployment

Deployed on 2026-10-23: https://peer-share-jacob.onrender.com/

Render service: srv-dbdn12l9fdbs73bmpi7g (Free, Frankfurt, one instance).
Atlas project: 6adb6e234b209ef10ddf568f; cluster peer-share (M0, AWS Frankfurt).
Only Render outbound CIDRs 74.220.51.0/24 and 74.220.59.0/24 are allowlisted.
The application database user has readWrite only on peer_share.

Account email enabled on 2026-10-26 using Brevo SMTP with STARTTLS on port 2525.
Credentials are stored in Render's private environment; no keys or sender/test
addresses are committed to this repository. ACCOUNT_EMAIL_ENABLED=true.
Deployment dep-dbfhrtm7bikc73dkb2hg is live on the same application code commit.

SMTP authentication succeeded. The owner received the setup test in spam/junk.
Live signup is enabled, rejects invalid input with HTTP 400, and private APIs
still require authentication. Actual hosted signup/verification/sign-in is
confirmed by the owner. Inbox placement is not guaranteed; sender-domain
setup remains a separate deliverability improvement. Public TURN is configured in the current release; real-phone file transfer remains pending.
No paid compute plan, database tier or email subscription was created.
## Architecture

One Render Node web service serves the built React application, HTTP API and
WebSocket signaling on the same HTTPS origin. This keeps cookie authentication
and the existing relative /api URLs intact. MongoDB Atlas stores account and
social data. Browser chat history stays on each device; file content still goes
over WebRTC, not through the application backend or database.

Use one server instance: invitations, live connections and rooms are currently
in memory. A restart clears them and clients need to reconnect. Do not deploy
this backend as independent autoscaling functions without shared signaling state.

## 1. Accounts and free-only limits

- Render: https://dashboard.render.com/ — sign in with GitHub and use the Hobby
  workspace and Free web-service instance. Do not add a payment method or enable
  paid upgrades/overages. If account verification requires billing details, stop
  and discuss it rather than silently enabling charges.
- Atlas: https://cloud.mongodb.com/ — reuse an existing account if available.
  Create a project for Peer Share and select the Free/M0 cluster, not Flex or a
  dedicated paid tier. Choose Frankfurt if available to match Render.
- Account email: the Blueprint is configured for Brevo's free transactional email
  service (https://app.brevo.com/). Verify your sender and activate transactional
  sending. Use its SMTP login and SMTP key, not your account password or API key.
  Render Free blocks ports 25, 465 and 587; this setup uses STARTTLS on port 2525.
  Sender verification/account approval is required; a personal-address sender
  can have delivery restrictions. Confirm delivery before inviting users.
  No domain purchase is included. Another existing SMTP provider that supports
  STARTTLS on port 2525 can be configured instead.

Render Free sleeps after 15 minutes without inbound traffic and can take about
a minute to wake up. It has usage limits and can restart without notice. It is
suitable for this portfolio/demo, not an always-available production guarantee.
No keep-awake workaround is configured. Public TURN is not included by these
services; cross-network file transfer can still fail on restrictive networks.

## 2. Atlas database

1. Create the Free/M0 cluster and a database user restricted to readWrite on
   peer_share. Generate a strong password and keep it private.
2. In Connect > Drivers, select Node.js and copy the mongodb+srv connection string.
   Include /peer_share before the query string, and URL-encode the password if
   it contains reserved characters. This is DATABASE_URL; never commit it.
3. Add the Render service's outbound CIDR ranges to Atlas Network Access. Render
   shows them under the service's Connect > Outbound tab. Allow those ranges,
   rather than opening the database to every IP. Add your own IP only if needed
   for local testing. Remove temporary access after testing.
4. Existing local accounts are not migrated automatically. New accounts on the
   hosted database need verification emails delivered by the configured sender.

## 3. Publish the prepared source and create the service

Render builds Git source, so the current app changes and render.yaml must be
committed and pushed before its build can use them. Do not upload server/.env,
client/.env, local databases, browser profiles, private keys or test artifacts.

In Render select New > Blueprint, connect JacobEmanuelsson/peer-share, and select
main. Review render.yaml: one Node web service on the Free plan, Frankfurt region,
no paid database or persistent disk. Automatic deployments are off so unrelated
pushes do not restart live sessions. Do not create duplicate services if a
previous attempt already created one.

Provide these private values when prompted:

| Variable | Value source |
| --- | --- |
| DATABASE_URL | Atlas connection string ending in /peer_share plus driver options |
| SMTP_USER | Brevo SMTP login |
| SMTP_PASSWORD | Brevo SMTP key |
| MAIL_FROM | Peer Share <your-verified-sender-address> |

The Blueprint generates BETTER_AUTH_SECRET in Render. Keep it unchanged across
redeployments. It supplies HOST=0.0.0.0, PORT=10000, SERVE_CLIENT=true and
TRUST_PROXY_HOPS=1. Do not copy the local .env wholesale: localhost addresses and
temporary tunnel URLs are not valid hosted configuration.

The backend uses Render's automatic RENDER_EXTERNAL_URL as its auth URL when
BETTER_AUTH_URL is not explicitly set. Leave BETTER_AUTH_URL and PUBLIC_APP_URL
unset on Render for its assigned onrender.com address. For a future custom
domain set BETTER_AUTH_URL to that exact HTTPS origin, without an /api path.

Build: npm ci --include=dev && npm run build
Start: npm run start --workspace server
Health check: /api/health

If the first start cannot connect to Atlas, add the service's outbound CIDRs to
Atlas as above, then manually redeploy. Never substitute localhost or expose the
local MongoDB port to fix a cloud database connection.

## 4. Verify the actual public URL

Copy the exact service URL from Render; do not assume the service name is free.
The host may differ from peer-share.onrender.com if already taken.

- Open / and /api/health using iPhone mobile data with Wi-Fi off. Health should
  return {"status":"ok"}. Allow for the free instance waking up.
- Directly open /login, /sign-up, /app and /settings. Deep links must load React;
  signed-out users are redirected away from protected pages.
- Create a new account with a real inbox; open its verification link, then sign
  in. Confirm the link points to the assigned Render origin.
- Verify sign-out, password recovery and secure session cookies over HTTPS.
- Connect two accounts through direct and group signaling. Check WSS upgrade
  succeeds. Try file transfer in both directions, cancellation and retry.
- Test different physical networks. A failure at the WebRTC connection stage
  needs public TURN; it is distinct from an HTTP site-loading timeout.
- Confirm /api/missing returns an API error, not index.html, and private files
  such as /.env are never served.

The existing browser release harness uses local MongoDB/Mailpit for generated
test accounts and cleanup. Do not point it at the deployed app unchanged: real
email delivery and the remote database need a separate test configuration.

## Local verification of the hosting layout

Keep normal localhost development on the original ports. For a separate smoke
check, build the project then run the backend with SERVE_CLIENT=true, PORT=3001,
BETTER_AUTH_URL=http://localhost:3001, PUBLIC_APP_URL empty, HOST=127.0.0.1 and
NODE_ENV=development. Use the existing local MongoDB and Mailpit. Then open
http://localhost:3001. This tests the single-server layout without exposing it
or pretending to validate the remote provider.

Commands from the repository root:

    npm run typecheck
    npm run build
    node --test server/test/*.test.mjs
    node --import tsx --test client/test/*.test.mjs

Targeted deployment tests cover environment validation, SPA deep links, static
assets, API 404/auth behavior, private-file rejection and bounded proxy trust.

## Official references

- https://render.com/docs/free
- https://render.com/docs/web-services
- https://render.com/docs/websocket
- https://render.com/docs/blueprint-spec
- https://render.com/docs/outbound-ip-addresses
- https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/
- https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP
## Verification of this change

Typecheck and production build passed. All 79 server tests and 21 client tests
passed. The Chrome end-to-end check passed against the built single-server
layout at localhost:3001: verified signup/login, WebSockets, cancel/retry with
verified download, blocking, reconnect, password reset/change and account deletion.
Dependency audit reported no vulnerabilities. Cloud deployment is live; The owner confirmed the site opens on iPhone mobile data.

### Live deployment verification (2026-10-23)

Render deployment dep-dbdn2svavr4c73alhb00 is live at code commit 47bae38.
The service plan was checked as free; Atlas is M0. The owner confirmed the HTTPS
site opens on iPhone mobile data, resolving the temporary-tunnel access problem.
Chrome against the actual public URL passed:

- Landing assets and the interactive Connect / Accept / Send sample flow.
- Direct navigation to protected /app and /settings redirects to /login.
- /api/me and /api/ice reject signed-out requests.
- Unknown APIs and private-file paths are not replaced with frontend HTML.
- Signup displays the explicit pending-email message and creates no account.
- The public WSS signaling endpoint rejects missing sessions and bad origins.
- No browser page errors.

Authenticated cloud signup/login, secure session-cookie inspection and actual
cross-network WebRTC transfer remain pending email delivery setup and test
accounts. Public TURN is still required for restrictive networks. The Windows
local release test passed previously; it is not a cloud authenticated-flow test.

The old tunnel was stopped and local PUBLIC_APP_URL cleared. The hosted app no
longer depends on the Windows backend, MongoDB container or tunnel processes.
## Hosted TURN configuration

The backend optionally supports Metered/Open Relay through its existing private
/api/ice endpoint. Set METERED_APP_NAME to the app label before .metered.live and
METERED_TURN_API_KEY to a credential-scoped API key from TURN Server > Credentials
> Get credential > Show API Key. Do not use a Realtime publishable key or the
account-wide secret key. Do not set either value in VITE_ variables.

Clear TURN_URLS and TURN_SHARED_SECRET when using this provider. The coturn
configuration remains supported as the alternative. Invalid/mixed configuration
fails startup. The provider API uses a fixed HTTPS host, no redirects and a
five-second timeout. Responses are validated and cached for five minutes;
concurrent requests share the provider call. Provider errors return sanitized
HTTP 503, not leaked keys or a silent downgrade to STUN-only.

A verified session is required before any provider request. Only the ICE server
URLs and scoped TURN credentials reach the browser; the API key stays private.
The configuration refresh timestamp is not the provider credential's expiry.
Credential expiry/rotation is managed in the provider dashboard. Newly created
credentials can take up to two minutes to propagate.

Confirm the account's actual free allowance and keep paid upgrades/overages and
payment methods disabled. One product advertises 20 GB/month; a separate free
trial advertises 500 MB/month. The smaller allowance cannot support a full 1 GiB
relayed file. No paid tier is authorized for this project.

Use CROSS-NETWORK-TEST.md for the real-device and forced-relay checks. Local
browser tests are not proof of a successful iPhone/mobile-data file transfer.
## Release steps 1–4 update — 2026-10-26

The owner confirmed hosted email verification and successful sign-in to the
workspace. Verification pages and email now explain the three steps and the
phone/computer distinction; the login page shows clear success or expired-link
feedback. No public email-status lookup or authentication bypass was added.

Metered public TURN was validated using a confirmed free account with 500 MB
monthly allowance and no payment/paid-overage authorization. The private app/key
are configured on Render for the current rollout, with ICE_RELAY_ONLY=false.
The verified private /api/ice route provides TURN as a fallback to direct ICE.
A full 1 GiB relayed file exceeds this allowance; small public-relay test files
were used. The application's direct/file-storage limit remains 1 GiB.

Local automated verification passed: 86 backend tests and 23 client tests,
production build, desktop/mobile-width verification UI in Chrome and Edge,
Chrome and Edge with local TURN forced, and Chrome with the real public TURN
forced. The expanded flow checks verified downloads in both directions, three
members receiving a group file, non-owner group chat, group reconnect,
cancellation/retry, blocking, recovery and account cleanup. A separate public
TLS-only probe selected relay candidates on both peers and exchanged messages.

The expanded group check found and fixed a reconnect race: late signaling for a
recently departed peer must not close a healthy sender. A per-room bounded
record handles those IDs; unrelated IDs, cross-group routing and self-targeting
remain rejected. This has a backend regression test and the real browser check.

Actual phone/mobile-data file transfer remains a required owner-assisted check;
a desktop test forced through public TURN does not certify Safari behavior.
Follow CROSS-NETWORK-TEST.md and record device/browser versions and results.
Live rollout: dep-dbfiile7bikc73dmua40 at application commit 64af704.
Hosted verification UI checks passed at widths 1280 and 390. Health returned
200; anonymous /api/me and /api/ice returned 401. No credentials were committed.
Direct ICE remains preferred (ICE_RELAY_ONLY=false).
