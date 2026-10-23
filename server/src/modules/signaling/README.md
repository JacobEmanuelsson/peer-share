# Accepted-pair signaling protocol

Current backend protocol. The original create-room/join-room prototype is removed.
All connections require the configured Origin and a verified Better Auth session.

## Flow

1. Sender sends create-invitation with recipientUserId.
2. Recipient connections receive invitation-received; sender receives invitation-created.
3. One recipient connection sends accept-invitation with invitationId.
4. The gateway validates identities, sender availability/session, and connection capacity.
5. Acceptance consumes the pending invitation and creates one fixed active pair.
6. Sender and selected receiver receive invitation-accepted with pairId and role.
7. Other recipient connections receive invitation-accepted-elsewhere.
8. Only selected connections can exchange webrtc-signal for that pairId. The sender offers; the receiver answers; both exchange ICE candidates.

## Example messages

```json
{"type":"create-invitation","recipientUserId":"recipient-account-id"}
```

```json
{"type":"accept-invitation","invitationId":"invitation-uuid"}
```

Successful acceptance includes both invitationId and pairId. The backend currently
uses the invitation UUID as the pair ID; clients should use the returned pairId.
The identifier selects a pair and is not an authentication credential.

```json
{"type":"invitation-accepted","invitationId":"invitation-uuid","pairId":"pair-uuid","role":"receiver"}
```

```json
{"type":"peer-message","pairId":"pair-uuid","text":"Hello"}
```

The other participant receives the same peer-message shape. Client-supplied sender,
receiver, or connection fields are rejected. A guessed pair ID grants no access.

## Lifetime and disconnects

Pending invitations expire after five minutes. Accepted pairs are independent
records and are not subject to that deadline. Each connection can have one active
pair. Acceptance consumes the invitation, preventing replay after a disconnect.
A busy connection cannot be substituted into another pair.

Closing or invalidating either connection removes the pair and notifies any
remaining open participant:

```json
{"type":"pair-ended","pairId":"pair-uuid","reason":"peer-disconnected"}
```

Returning users must create and accept a new invitation. New connections never
inherit the old connection's participation. A stale pairId cannot send through a
new pairing. Session revalidation is performed for the sender before processing
and for the peer before delivery; membership is checked again after awaiting.

## Files

- signaling.gateway.ts: authentication, validation, coordination and socket messages.
- signaling.invitations.ts: pending invitation creation and acceptance rules.
- signaling.pairs.ts: active pair membership and removal, without socket operations.
- signaling.connections.ts: lookup of verified active connections.

## Scope and remaining work

State remains in memory in one server process. The signed-in frontend supports
account-ID invitations, acceptance, accepted-elsewhere feedback, WebRTC setup,
direct text, and bounded file transfers. Recipient discovery, automatic reconnect,
public TURN provisioning and deployment remain later steps; rate limits are now implemented.
The peer-message endpoint is retained for the earlier server-relay prototype and
regression tests; the current UI sends text through the DataChannel.

## Verification

From the project root:

```powershell
npm run build
node --test server/test/signaling-access.test.mjs server/test/signaling-connections.test.mjs server/test/signaling-invitations.test.mjs server/test/signaling-pairs.test.mjs
```

Tests use controlled auth session resolvers, not real user credentials. Coverage
includes same-account devices, rejected outsiders/extra tabs, simultaneous accepts,
busy connections, invitation expiry independence, receiver revocation, stale IDs,
and disconnects during session lookup.

## Bounded message queue

signaling.queue.ts processes one incoming message at a time per socket, including
asynchronous session validation and forwarding. It retains arrival order and
allows independent sockets to progress separately. Limits are 32 outstanding
messages and 256 KiB of raw payload bytes, including in-flight work. Buffer arrays
and UTF-8 bytes are counted by byte length. These are initial prototype limits.
The WebSocket per-message limit is 64 KiB. SDP is capped at 24,000 characters;
candidate strings are capped at 2,048 characters. Binary WebSocket frames are rejected.

Overflow discards pending work, closes with 1008 and reason Signaling queue limit
exceeded, and ends the active pair. Handler failure closes with 1011. Disconnect
and socket errors discard waiting messages; an in-flight promise cannot be
cancelled, so session/pair/socket validity is checked again after awaits.
This is an in-memory work queue, not a durable background job system or rate limiter.

Additional tests: node --test server/test/signaling-queue.test.mjs

## WebRTC signaling and transfer

Client and server validate a strict webrtc-signal envelope. Examples:

```json
{"type":"webrtc-signal","pairId":"pair-uuid","signal":{"type":"offer","sdp":"..."}}
{"type":"webrtc-signal","pairId":"pair-uuid","signal":{"type":"answer","sdp":"..."}}
{"type":"webrtc-signal","pairId":"pair-uuid","signal":{"type":"ice-candidate","candidate":{"candidate":"...","sdpMid":"0","sdpMLineIndex":0}}}
```

Only the original sender can offer and the accepted receiver can answer. Both
can send ICE candidates. Existing membership/session checks apply to every
forwarded signal. The signaling server is trusted to bind the two peers and
forward their SDP fingerprints; this is not independent out-of-band identity
verification.

Frontend responsibilities:
- client/src/webrtc/peerConnection.ts: one ordered reliable DataChannel,
  offer/answer, queued ICE, connection timeouts, bounded incoming processing,
  send-buffer backpressure, and cleanup.
- client/src/webrtc/fileTransfer.ts: validated file offer/accept/reject,
  sequential binary chunks, exact byte count, SHA-256 verification, completion
  acknowledgement, and consent/completion deadlines.
- ConnectionDemo.tsx: invitation and transfer controls, progress, verified download.

Either participant selects a file up to 1 GiB; the receiving participant must accept before chunks
are sent. Each peer can have one outgoing and one incoming transfer concurrently,
with independent progress and completion state. Invitation roles only determine
who creates the WebRTC offer and DataChannel. Chunks are at most 16 KiB and respect the negotiated message limit.
The sender pauses above 256 KiB buffered data and resumes below 64 KiB.
The receiver streams the file to temporary OPFS disk and hashes incrementally. Resumability is not implemented. SHA-256 detects a mismatch with the offered file,
not the identity or trustworthiness of its contents. Browser WebRTC provides
DTLS transport encryption. File bytes, hashes, names, and direct text stay on
the DataChannel, not the WebSocket or MongoDB. Downloads use an object URL that
is revoked on replacement or pair cleanup. Files are not opened automatically.

ICE configuration now comes from authenticated GET /api/ice. Configure
STUN_URLS, TURN_URLS and TURN_SHARED_SECRET in server/.env. The backend issues
one-hour coturn TURN REST credentials; the signing secret never enters a
VITE_ variable. The local test relay passes forced-relay checks. Internet relay
use still needs a publicly reachable server/service and appropriate TLS/ports.
Use HTTPS/WSS when deployed.

Reconnect controls recover without refreshing the page. Automatic ICE restart,
partial-file resumability and independently verified peer keys are not included.
Files remain encrypted by the WebRTC transport, including through TURN.

Checks:
```powershell
npm run build
node --test server/test/*.test.mjs
node --import tsx --test client/test/file-transfer.test.mjs
```

Real Chrome verification: actual signup and session cookies; selected-tab pairing;
offer/answer/ICE; nominated host-to-host route; two-way DataChannel text; explicit
file decline and retry; 1 MiB + 37 bytes downloaded with matching SHA-256; empty
file; extra-tab exclusion; disconnect/re-pair and sign-out cleanup. Captured
WebSocket frames contained invitation/signaling messages only, without file or
text payload. Temporary test accounts were removed. Cross-network TURN behavior
was not tested.
## Chat identity metadata

invitation-accepted now includes peer: { id, name }, derived from the other
connection's authenticated session. The chat never accepts a sender name or
account ID from a DataChannel message. The original invitation/pair authorization
is unchanged. Display names are capped at 100 characters and account IDs are not
authentication credentials.

Current direct text uses a UUID plus up to 2000 characters through the DataChannel.
Local chat history is documented in client/src/features/chat/README.md; it is not
stored by this gateway.
## Release update: TURN, recovery, verified accounts and blocking

See docs/RELEASE-CHECKLIST.md for the current behavior. /api/ice returns
authenticated one-hour TURN REST credentials. Local coturn relay testing passed;
a public relay still requires a reachable host/service. VITE_STUN_URL is retired.

All sharing routes reject unverified email sessions. Blocking is persisted,
closes existing sockets, and prevents direct invitations/friend requests and
conflicting group joins. HTTP and per-account WebSocket/invitation budgets are
separate from FIFO queue bounds.

end-pair is a validated participant-only signaling message used by Reconnect.
File cancellation stays on the DataChannel; no file chunks are forwarded here.
Local chat history includes a cancelled status. Current downloads remain available
until their conversation's disk cache is released, not simply on pair disconnect.