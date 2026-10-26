# Large-file verification — 2026-10-23, Windows

The inclusive limit is 1,073,741,824 bytes (1 GiB).

| Browser / engine | Result |
| --- | --- |
| Google Chrome 155.0.8059.86, ordinary isolated profiles | PASS: full 1 GiB real WebRTC transfer, verified download length and Node SHA-256; 1 GiB + 1 byte blocked before offer; no page errors. |
| Microsoft Edge 155.0.4283.62, ordinary isolated profiles | PASS: same full transfer, download hash and oversize rejection checks. |
| Chrome / Edge, isolated private contexts | UNRELIABLE: an initial Chrome run passed, but later Chrome and Edge runs exceeded the actual quota partway through. The initial estimate reported 10 GiB. Partial transfer was cleaned up, no verified download published. |
| Playwright Firefox 157.0 | PASS: production OPFS module writes/reads 1 GiB, incremental SHA-256 matches and disposal leaves zero temporary files. End-to-end transfer UNVERIFIED: local ICE failed before transferring data. |
| Playwright WebKit 27.2 on Windows | Cannot run WebRTC: RTCPeerConnection is absent. The 1 GiB storage check was also rejected by its quota estimate. |
| Safari on macOS/iOS | Not available here; NOT TESTED. Windows WebKit is not a Safari test. |

Chrome and Edge used two separate accounts and browser sessions, the real
Better Auth signup flow, invitation acceptance, a real ordered/reliable WebRTC
DataChannel, explicit file acceptance and the application's verified download.
The test file was an exact-size sparse file; SHA-256 validation streamed the
download without allocating a 1 GiB Node buffer. Temporary accounts, auth records
and test files were removed in finally.

Firefox's failed ICE setup was reproduced using two RTCPeerConnection objects
outside the application, without its signaling or transfer code. Neither emitted
a candidate. Explicit loopback and host-candidate test preferences did not help.
Its separate storage test used 1 GiB of repeated nonzero bytes and verified the
disk-backed file hash and cleanup. This does not prove Firefox end-to-end support.

Early runs interrupted by Vite hot reload were discarded, then rerun against
stable source. Do not edit source or dependencies during these tests.

Also verified: 21 client unit tests, 75 server tests, workspace TypeScript checks,
and production build. Build succeeds with dependency annotation warnings and a
bundle-size warning; those do not indicate transfer-test failure.

## Practical limits

These tests cover same-machine desktop transfers, not restrictive networks, TURN,
mobile devices, background-tab suspension or resumability. OPFS requires a secure
context (localhost or HTTPS), sufficiently recent browser APIs and available
quota. Quota estimates are advisory; private contexts can enforce lower actual
limits. File bytes remain on the receiving device's temporary browser disk until
download cleanup. A user-initiated download can consume additional disk space.
Release steps 1–5 were subsequently implemented and the complete 1 GiB Chrome
and Edge checks rerun with verified signup and authenticated backend ICE config.
See ../../../docs/RELEASE-VERIFICATION.md for account, cancellation, blocking,
public-origin and forced-relay evidence and remaining external prerequisites.
## Release checks — 2026-10-26

The 1 GiB results above are from 2026-10-23. This release did not change the
chunking/storage protocol; its new end-to-end checks used small files.

| Browser / setup | Result |
| --- | --- |
| Chrome 155.0.8059.86, local coturn forced | PASS: actual relay selection, bidirectional SHA-256 downloads, cancellation/retry, three-member group file to both recipients, non-owner group chat, group reconnect, auth/recovery/blocking/cleanup. |
| Edge 156.0.4314.42, local coturn forced | PASS: the same expanded release flow. |
| Chrome 155.0.8059.86, actual public Metered TURN forced | PASS: the expanded release flow, with actual relay candidates selected on both direct peers. Small files fit the confirmed 500 MB free allowance. |
| Chrome, public TURN TLS-only | PASS: only turns: endpoints allowed, selected relay on both peers, bidirectional DataChannel messages. |
| Chrome and Edge, widths 1280 and 390 | PASS: verification steps, resend, sign-in link, success/expired-link messages and no horizontal overflow. These use UI fixtures and do not certify email delivery. |
| Real phone/mobile-data file transfer | PASS, owner-reported 2026-10-26: small-file transfer/download worked computer to phone and phone to computer; both showed TURN. Exact browser/device versions and file sizes were not recorded. Phone large-file/group/recovery behavior is not certified by this result. |

86 server tests, 23 client tests and the production build passed. The expanded
group test found a stale-recipient signaling race during group reconnect. A
bounded per-room departed-ID record and regression test fixed it without
accepting unknown recipients or cross-group signaling.