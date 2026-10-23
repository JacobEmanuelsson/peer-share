# Friends and group sharing

This milestone adds persistent social data and multi-recipient peer-to-peer
transfers. The original accepted-pair signaling remains separate and unchanged.

## Layers

- social.repository.ts owns MongoDB reads/writes and indexes.
- social.service.ts owns friendship consent, group membership, ownership, and
  access-change notifications for live sockets.
- social.routes.ts owns Zod input validation, session identity, HTTP responses,
  and same-origin mutation protection.
- group.gateway.ts owns the live group roster and validated SDP/ICE forwarding.
- client/features/social/api/socialClient.ts validates REST responses.
- client/features/social/api/groupConnection.ts coordinates one WebRTC connection
  per other joined member, reusing the existing peerConnection/fileTransfer modules.
- SocialPanel.tsx manages friends and saved groups through TanStack Query.
- GroupWorkspace.tsx owns local selection, per-peer progress, offers, and downloads.

Paths under client/features above are relative to client/src.

## Friends

Send a request using the other account's sharing ID. Only the recipient can
accept. Either participant can remove a friendship; pending requests can be
cancelled or declined. Requests cannot include the actor's identity, cannot target
yourself or a missing account, and duplicate/reverse requests are rejected.
Accepted friends get an Invite shortcut into the existing one-to-one flow.
That person must still be online and accept the connection and each file.

Friendship documents contain both account IDs, a pending/accepted state, and a
unique sorted pairKey. A unique index makes duplicate pair creation atomic.
Friends and incoming requests survive server restarts. The UI refreshes this
server state every five seconds and after successful mutations.

## Saved groups versus live sessions

Create a named group with one to five accepted friends, plus yourself (six total).
Saved members can see the group and explicitly join its live session. A group
does not automatically open a connection or accept a file.

The owner can delete a group. Other members can leave the saved group. Both
actions immediately close affected live sockets in this server process.
Leaving the live session alone preserves membership, allowing later rejoin.
Removing a friend does not silently remove them from existing groups; leave or
delete those groups separately. This version chooses membership at creation;
adding more members or renaming existing groups is not implemented.

One tab/device per account may join a given group at a time. A second tab is
rejected rather than replacing the selected device. Joining/leaving updates the
roster, and departing peers' WebRTC connections and object URLs are cleaned up.
Joining a group in the UI closes the current one-to-one workspace connection;
using a friend shortcut switches back to one-to-one sharing.

## Transfers

Each member establishes a separate encrypted DataChannel to every other joined
member (small-group mesh). The lower server-generated connection UUID initiates
each link, avoiding offer collisions. The backend derives the source identity,
permits only same-group targets, and enforces offer/answer roles. Clients cannot
choose another account or group by forging a target ID.

Select any connected recipients and send one file to all selected peers. Each
recipient accepts or declines independently and has independent integrity checks,
completion acknowledgement, progress, and download links. Any group member can
send; ownership does not grant special file-transfer privileges. One outgoing
and one incoming file per peer link can run concurrently. Different people can
receive different files without affecting each other's state.

The existing 50 MiB/file in-memory limit, at most 16 KiB chunks, SHA-256 integrity
check, and DataChannel buffering rules remain. Sending to N people uploads N
copies; no file contents, names, hashes, or direct message text go through the
signaling server or MongoDB. Files are available only while peers are online.
No offline queue, persistent file storage, transfer history, or resumability
is added.

## Authorization and routes

Every REST route requires a current uncached Better Auth session. Mutation Origin
must match the configured app Origin. Identity comes from session headers, never
from JSON request fields. Responses use Cache-Control: no-store. Account lookup
exposes names/IDs only to relevant friends or group members, not emails.

| Endpoint | Behavior |
| --- | --- |
| GET /api/social | Only this user's friends/requests and member groups |
| POST /api/friends | Request friendship with recipientId |
| POST /api/friends/:id/accept | Intended recipient only |
| DELETE /api/friends/:id | Friendship/request participant only |
| POST /api/groups | name and 1–5 accepted friend memberIds |
| DELETE /api/groups/:id | Owner only |
| POST /api/groups/:id/leave | Non-owner member only |
| /api/groups/:id/signaling | Member session + exact Origin; one selected device |

Group socket sessions and membership are rechecked before forwarding signals,
including the destination's session. They are also checked every 15 seconds while
idle. Membership changes made through this service close affected connections
immediately. Signaling accepts only strict text SDP/ICE envelopes, with a 64 KiB
frame limit and a FIFO queue capped at 32 messages/256 KiB per connection.
It rejects binary file frames, outsiders, invalid roles, cross-group targets,
duplicate devices, forged actors, and revoked sessions.

MongoDB persists friendships/groups. Live rosters and access-change events are
local to one server process. Multi-process deployment would need shared presence
and revocation events. Reliable cross-network transfer still needs TURN and
HTTPS/WSS as described in the main signaling README.

## Checks

From the project root:
```powershell
npm run build
node --test server/test/*.test.mjs
node --import tsx --test client/test/file-transfer.test.mjs
```

Tests cover friendship acceptance/authorization, group membership and owner
rules, request validation and Origin/session checks, three-member directed
signaling, duplicate devices, revoked sessions, immediate leave/delete cleanup,
invalid target/role/binary/file messages, and existing transfer integrity.

Real Chrome verification used four temporary accounts: two accepted friends,
quick one-to-one invitation, saved group creation, three joined members, selected
multi-recipient transfer, independent decline/retry, sending from a non-owner,
byte-exact verified downloads, WebSocket setup-only traffic, outsider denial,
duplicate-tab rejection, reload persistence, immediate leave/delete cleanup, and
mobile layout without horizontal overflow. Test accounts and their social/auth
records were removed afterward. Local testing does not prove cross-network TURN
behavior.