# Local chat history

One-to-one and group workspaces use a shared conversation timeline. It records
sent and received text, authenticated sender names, actual recipient names, a
local timestamp, and file offers/status changes. It is a local activity log,
not an offline messaging server or a shared group archive.

## Responsibilities

- chatHistory.ts defines/validates metadata, stable keys, bounded merges, and
  interrupted-transfer normalization.
- chatStore.ts uses IndexedDB, keyed by both signed-in account ID and stable
  peer account ID or saved group ID.
- useChatHistory.ts manages asynchronous hydration, live entries, persistence
  warnings, clearing, and temporary file download URLs.
- components/ChatTimeline.tsx renders sender/recipient attribution, date/time,
  incoming/outgoing bubbles, file states, downloads, and clear controls.
- The existing peer and group controllers carry data through WebRTC only.
  The signaling server supplies the verified one-to-one peer ID/display name
  after acceptance, or group roster identities. Text messages cannot supply a
  sender identity.

## Text

DataChannel text is now a strict envelope: type=text, id=UUID, text=1–2000
characters. Its ID prevents duplicate entries. A sent entry means the local
DataChannel accepted it for sending, not proof it was read by the recipient.
The chat renders plain text with preserved newlines; it never interprets HTML.

Enter sends; Shift+Enter adds a newline. One-to-one text goes to that peer.
Group text goes to all currently connected members, regardless of the selected
file recipients. The local sent entry lists only the peers whose channels
accepted the message. Offline members do not receive a replay later.
Recipients record only what they personally received.

## File activity

Progress events include the existing transfer UUID. A file entry is keyed by
direction, peer account ID, and transfer UUID, so repeated filenames and group
fan-out cannot overwrite one another. The entry updates in place as it changes:
offered, transferring, verifying, complete, declined, interrupted, or failed.
Chunk-by-chunk byte progress remains in the transfer controls, avoiding an
IndexedDB write for every chunk.

Timestamps show when the local device first observed a message or offer.
Display names are snapshots of the authenticated participant at that time.
A complete receive entry requires the existing exact byte count and SHA-256
verification; a complete send entry requires the receiver's acknowledgement.
Closing active transfers records interruption instead of successful completion.
Saved unfinished transfers are shown as interrupted after reload.

## Persistence and bounds

The most recent 200 entries are retained per conversation. History survives
reloads and sign-out on the same browser profile. Friends have a Chat with…
shortcut to open history while offline; writing still requires a live connection.
Group history opens when selecting/joining the saved group.

Only text and file metadata are stored locally. File bytes, object URLs, auth
cookies, and encryption keys are never written to the history database.
Downloaded files the user chooses to save are handled by the browser as before.

Up to 10 verified receive files / 2 GiB of temporary download data are retained
in the active conversation. Old download URLs are revoked on eviction, switching
conversations, leaving the workspace, or clearing. Reload restores metadata only;
it cannot recreate files. Already received files may remain downloadable after
the peer disconnects while the local conversation stays open.

Writes read/merge/write atomically in one IndexedDB transaction. This prevents
other tabs' entries from being lost through a stale snapshot. Terminal file
states cannot be downgraded by older writes. Clearing creates a cutoff so a
stale tab cannot silently restore older entries. A tab already displaying an
older snapshot updates on reopening/reloading; there is no live cross-tab chat
replay.

Blocked, corrupt, or unavailable local storage shows a warning, while new activity
remains visible in memory. History is not synced to the server or other devices.
It is not additionally encrypted at rest: access is governed by the browser
profile/device, and users can clear a conversation or browser site data.

## Verification

From the project root:
```powershell
npm run build
node --test server/test/*.test.mjs
node --import tsx --test client/test/*.test.mjs
```

Unit tests cover verified-peer signaling metadata, text-envelope validation,
sender/recipient attribution, timestamps, deduplication, repeated filenames,
opposite transfer directions, history bounds, terminal statuses and reload
interruption.

Real Chrome checks covered bidirectional chat, inert markup, timestamps, text
and file history after reload/reconnection, offline friend-history access,
multiple retained downloads, decline/interruption, group broadcast independent
of file selection, per-account isolation in the same browser, clear history,
real concurrent IndexedDB writes in two tabs and protection against stale writes
after clearing. Group file transfers still verified byte-for-byte. Temporary
test accounts and their auth/social records were removed.
Verified file bytes now live in temporary OPFS files. Download eviction and URL cleanup also dispose the disk file. The per-file limit is 1 GiB; metadata remains in IndexedDB.