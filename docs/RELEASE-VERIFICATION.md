# Verification report: release steps 1–5

2026-10-23, Windows. All results use the application, official MongoDB driver and
Better Auth. No paid service accounts or subscriptions were enabled.

**Story:** A verified user pairs with another verified browser, cancels/retries
a file transfer, blocks/reconnects, recovers the account and deletes it safely.

| Boundary | Result | Evidence |
| --- | --- | --- |
| UI renders and navigates | PASS | Real Chrome and Edge signup, verification, login, reset and settings forms. No page errors. |
| Browser to HTTP/WebSocket | PASS | Protected /api/me rejects pre-verification; exact-origin pairing, blocking and social mutations work locally and through public HTTPS. |
| Backend to data/services | PASS | Real Mongo account/friend/group operations; verification/reset mail captured by local Mailpit; actual coturn allocations. |
| Data to response | PASS | Unverified/revoked sessions denied; block removes friendship; deleting an account removes owned groups. Cookies are HttpOnly, and Secure on HTTPS. |
| Response to UI and file | PASS | Cancelled state displayed; reconnect controls recover without refresh; retried file download matches Node SHA-256. |

## Browser matrix

- Chrome 155.0.8059.86: complete account/block/recovery flow passes locally and
  through https://harry-reserves-programme-firm.trycloudflare.com.
- Chrome forced-relay check: both peers' selected candidate-pair stats contain
  actual relay candidates. Cancellation and verified retry pass through local coturn.
- Edge 155.0.4283.62: complete account/block/recovery and cancellation/retry flow passes.
- Chrome and Edge ordinary isolated profiles: exact 1 GiB transfer, downloaded
  SHA-256, oversize rejection and account verification pass on the updated app.
- Private contexts can run smaller flows, but 1 GiB is unreliable because actual
  quotas can be lower than navigator.storage.estimate reports.
- Firefox 157.0: full disk/hash/cleanup path passed earlier; WebRTC still does not
  establish locally, including forced TURN. A minimal independent relay-gathering
  diagnostic emitted no candidates. Do not claim end-to-end Firefox support.
- Windows WebKit lacks WebRTC; Safari on macOS/iOS remains pending owner testing.

## Automated checks

- 75 server tests passed.
- 21 client tests passed.
- Workspace TypeScript and production build passed.
- npm audit reports zero known production dependency vulnerabilities.
- git diff --check passed; server/.env remains ignored.

Build has existing dependency-annotation and bundle-size warnings. Those do not
indicate failed runtime checks.

## Issues caught and fixed while testing

1. Last-chunk cancellation could publish a file before observing cancellation.
   The sender now checks cancellation before file-end; a cancelling receiver
   drains frames without finalizing. A bounded cancelled-ID set ignores late ACKs.
2. Fastify auth routes registered before the rate-limit plugin's route hook did
   not receive route limits. They now register in an ordered plugin scope.
3. Auth rate keys based on raw URLs could separate encoded aliases. Fixed
   endpoint categories share budgets, tested with encoded signup aliases and
   spoofed forwarded-client headers.
4. A missing emailVerified flag must fail closed, just like false. All sharing
   boundaries now require an explicit true flag, with regression coverage.

## Still required outside this Windows environment

A publicly reachable TURN host/service with short-lived credentials, real SMTP
credentials and a verified sender, and actual Safari/device/cross-network checks.
The free public STUN service helps direct connections; it cannot replace TURN
on restrictive networks. The local relay and Mailpit are loopback-only and are
not exposed by the public preview.

The preview is temporary and depends on this computer remaining awake with the
backend, preview and tunnel running. See RELEASE-CHECKLIST.md for setup/cleanup.

## Cloud deployment — 2026-10-23

Live: https://peer-share-jacob.onrender.com/ . Owner confirmed iPhone mobile-data
access. Render Free and Atlas M0 were provisioned. Public landing interaction,
protected redirects, API/private-file rejection, WSS origin/session enforcement
and explicit deferred-email errors passed in Chrome with no page errors.
Email is intentionally deferred (ACCOUNT_EMAIL_ENABLED=false); authenticated
cloud and cross-network transfer validation remains pending. See DEPLOYMENT.md.
