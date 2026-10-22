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
8. Only selected connections can exchange peer-message for that pairId.

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

State remains in memory in one server process. Messages are still relayed text,
not WebRTC file contents. The signed-in frontend now supports account-ID invitations, acceptance,
accepted-elsewhere feedback, and paired text with pairId. Recipient discovery
and automatic reconnect are not implemented; refresh reconnects after a lost socket. Overlapping messages are still rejected rather than
queued. Rate limits, heartbeats, reconnect UX, and deployment work remain later steps.

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
