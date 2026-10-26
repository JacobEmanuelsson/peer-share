# Release steps 1–5

Status as of 2026-10-26. Application code is implemented; outside services and
real-device verification remain explicit prerequisites, not assumed successes.

## 1. Cross-network connections

- Implemented authenticated, verified-session-only GET /api/ice.
- One-hour TURN REST credentials use coturn's standard HMAC-SHA1 mechanism.
  This authenticates TURN allocation; file encryption remains WebRTC DTLS.
- Signing secrets stay on the backend. Responses are no-store and rate-limited.
- Both direct and group peers fetch configuration before exchanging descriptions.
- Local coturn test service is in compose.turn.yaml, pinned to its tested digest.
  Its listener/relay ports bind only to 127.0.0.1.
- VERIFIED: a Chrome connection forced to relay selects actual relay candidates
  on both peers and transfers a verified file after cancellation/retry.
- VERIFIED 2026-10-26: public Metered relay and TLS-only connectivity in desktop
  browser tests; 500 MB free monthly allowance. Actual phone/mobile-data file
  transfer is still pending the owner-assisted check.
- The local compose configuration intentionally permits loopback for tests.
  Never deploy it unchanged on a public host.
- Free-only requirement: do not enable a plan with automatic paid overages.

## 2. Transfer controls and recovery

- Either participant can cancel its outgoing or incoming transfer.
- Cancellation has an ordered protocol handshake. Already queued frames drain
  before a new offer; late acknowledgements are ignored for a bounded set of
  cancelled transfer IDs. Partial disk files are removed.
- Cancelled transfers have a distinct, persistent local history state.
- Direct Reconnect ends the existing pair and opens a fresh signaling socket.
  The other participant can accept a new invitation without refreshing.
- Reconnect group rebuilds the group socket/mesh; each recipient has cancel controls.
- VERIFIED: sender/receiver cancellation, last-chunk cancellation, retry on the
  same connection, and actual downloaded SHA-256 after retry.
- Refreshing/disconnecting still interrupts transfers; partial-file resumability
  is not included in this release.

## 3. Browser support

- Workspace checks secure context, OPFS and streaming file-write support.
- It displays estimated quota and explains lower private-browsing limits.
- Acceptance checks quota and fails cleanly if storage fails later.
- Chrome end-to-end account/transfer flows pass locally and through public HTTPS.
- VERIFIED: Edge account/recovery/cancellation flows, and full 1 GiB transfers in Chrome and Edge on the updated application.
- Firefox 157.0: OPFS 1 GiB hash/cleanup passed previously; local WebRTC setup
  still fails even when forced to use the local TURN service.
- Windows WebKit has no WebRTC. This is not a Safari certification.
- PENDING: actual Safari/iOS version, storage acceptance, bidirectional transfer,
  cancellation/retry and 1 GiB receive testing by the owner.

## 4. Account management

- Signup requires email verification. Existing unverified accounts must verify too.
- /verify-email supports resending with a generic response.
- /forgot-password and /reset-password implement expiring Better Auth reset links.
- Password reset revokes sessions. Account settings allow password changes and
  revoke other sessions.
- Password-confirmed account deletion uses Better Auth, removes friendships and
  blocks, deletes owned groups and removes other group memberships.
- The current device's local chat history is removed on account deletion.
  Other devices' local records are not remotely erased.
- Mail uses SMTP through Nodemailer. Local development delivers to Mailpit only.
- VERIFIED: browser signup/verify/login, reset email/token form, revoked old
  session, new password login, password change and account/group deletion.
- CONFIGURED 2026-10-26: Brevo SMTP; setup test delivered to owner spam/junk.
  Production startup requires explicit SMTP_HOST and MAIL_FROM.

## 5. Abuse controls

- HTTP: 240 requests/IP/minute default; 32 KiB request bodies; 1,000 live TCP
  connections per backend instance.
- Auth HTTP endpoints: signup 5/minute, sign-in 10/minute, reset/resend 3/minute.
  Per-path keys use request.ip, not untrusted forwarded headers.
- Better Auth also enforces its endpoint limits.
- Direct/group signaling: 240 frames/account/minute per gateway, bounded queues,
  64 KiB WebSocket frames, and up to five sockets/account per gateway type.
- Direct invitations: 10/account/minute. Incoming UI history is capped at 100.
- Friend requests: limited route rate, unique pair, list capacity.
- Blocking removes friendship, denies new friendship/direct invitations in both
  directions, and closes active sockets for both accounts. Shared groups cannot
  be joined while they contain a blocked account. Unblocking does not restore
  friendship; users explicitly re-add each other.
- Account/block mutation identity always comes from the verified server session.
- Logs strip query strings/reset-token paths and redact credential headers.
- Limits and live revocations are per process. Multiple backend instances need
  shared coordination. Proxy client-IP trust must be configured for the actual
  hosting topology rather than blindly trusting forwarded headers.

## Free local services and commands

    docker compose up -d mongodb mailpit
    docker compose --env-file server/.env -f compose.yaml -f compose.turn.yaml up -d turn
    npm run dev:server
    npm run dev:client

Mailpit: http://localhost:8025. It is bound to loopback and must stay private.
The TURN signing secret is generated in the ignored server/.env, never in Git.

## Tests

    npm run build
    node --import tsx --test client/test/*.test.mjs
    node --test server/test/*.test.mjs
    node client/test/browser/release-features.mjs
    $env:FORCE_RELAY='1'; node client/test/browser/release-features.mjs
    $env:TEST_BROWSER='edge'; node client/test/browser/release-features.mjs
    node client/test/browser/large-transfer.mjs chrome
    node client/test/browser/large-transfer.mjs edge

The browser tests use the real local inbox for verification and delete their own
test accounts/emails afterward. Mailpit must be running.

## Public Safari test site

https://peer-share-jacob.onrender.com/

The app is deployed on Render Free with an Atlas M0 database. It no longer
requires this computer or a temporary tunnel to run. Free hosting sleeps after
15 minutes of inactivity and may take about a minute to wake up.

Brevo account email was enabled on 2026-10-26 (ACCOUNT_EMAIL_ENABLED=true).
The SMTP test reached owner spam/junk. The hosted signup/verification/sign-in
check was confirmed by the owner. Verification is still required for sharing.

Public TURN is configured for the current release, with direct ICE preferred.
The free allowance is 500 MB/month, which cannot cover a full 1 GiB relayed file.
The local coturn instance remains for local testing only.

Temporary trycloudflare.com and localhost.run links are retired. Local development
continues on localhost:5173 and localhost:3000, with PUBLIC_APP_URL cleared.
VERIFIED 2026-10-23: owner opened the hosted site on iPhone mobile data.
Cloud Chrome checks passed for landing interaction, redirects, API/WSS access
checks, private-file rejection and the deferred-email error. Authenticated cloud
flows and actual cross-network file transfer remain pending.

See DEPLOYMENT.md for the 2026-10-26 checks and CROSS-NETWORK-TEST.md for
the remaining real-device test. Expanded tests cover both file directions and
three-person group transfer/reconnect; a stale-recipient reconnect race was fixed.
