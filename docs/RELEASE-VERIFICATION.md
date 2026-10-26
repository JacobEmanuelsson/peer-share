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

## Hosted authentication and public TURN — 2026-10-26

Owner confirmed actual hosted verification email and workspace sign-in. SMTP is
enabled; initial mail arrived in junk. Verification guidance now explains
opening the email, following its link and signing in on the chosen device.

Public Metered TURN is configured privately in Render. The account's confirmed
free allowance is 500 MB/month; direct transfers avoid that allowance. No paid
plan was enabled. The 1 GiB app limit is separate from relay bandwidth capacity.
The release is live at code commit 64af704, deployment dep-dbfiile7bikc73dmua40.

86 server tests and 23 client tests passed. Chrome 155 and Edge 156 passed the
expanded local release check with coturn forced. Chrome passed the same flow
using the actual public TURN service with relay-only ICE. Checks include both
file directions and real downloaded SHA-256, cancel/retry, a three-member group
file to both recipients, non-owner chat, group reconnect, blocking, password
recovery/change and account cleanup. A separate public TLS-only probe selected
relay candidates on both sides and exchanged DataChannel messages.

The expanded group check identified a delayed signal targeting a departed peer
during reconnect. This previously closed the healthy sender. The fix remembers
a bounded set of departed IDs per live room, ignores those stale signals and
still rejects unknown IDs, self-targeting and cross-group access. Backend and
real browser regressions pass after the fix.

The deployed verification pages passed desktop/mobile-width UI checks with
fixture sessions; health is 200 and private APIs reject anonymous requests.
Those UI fixtures are not evidence of hosted authenticated transfer. The owner subsequently confirmed small-file transfers in both directions over
phone mobile data, with TURN shown on both devices. Safari large-file behavior
and the other physical-device scenarios remain separate checks in
CROSS-NETWORK-TEST.md. The app remains on direct-first
ICE, with TURN as a fallback, not relay-only in normal operation.
## Owner-reported real-device result — 2026-10-26

Computer-to-phone and phone-to-computer file transfer/download both worked
with the phone on mobile data. Both device interfaces reported TURN. The
deployment remained direct-first; relay-only was not forced. Exact versions and
file sizes were not captured. This confirms the basic hosted cross-network
relay path, not large-file Safari support or every recovery/group scenario.
