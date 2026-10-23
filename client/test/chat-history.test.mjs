import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { entriesSchema, fileKey, interruptedHistory, mergeHistory, recordFile, textEntry, HISTORY_LIMIT } from '../src/features/chat/chatHistory.ts';
const me = { id: 'alice', name: 'Alice' }, peer = { id: 'bob', name: 'Bob' };
const progress = (id, status, direction = 'send') => ({ id, name: 'same-name.bin', total: 5, bytes: 0, direction, status });

test('chat text records attribution, recipient and time without accepting an identity from text', () => {
  const message = { id: randomUUID(), text: '<script>not markup</script>' + String.fromCharCode(10) + 'Second line' };
  const sent = textEntry(message, me, peer, 'send', [peer], 100);
  const received = textEntry(message, me, peer, 'receive', [me], 101);
  assert.equal(sent.sender.name, 'Alice');
  assert.equal(received.sender.name, 'Bob');
  assert.equal(received.at, 101);
  assert.equal(received.text, message.text);
  assert.deepEqual(received.recipients, [me]);
  assert.notEqual(sent.key, received.key);
  assert.ok(entriesSchema.safeParse([sent, received]).success);
});

test('file events update one entry in place and never downgrade a terminal status', () => {
  const id = randomUUID();
  let entries = recordFile([], progress(id, 'waiting'), me, peer, 100);
  const unchanged = recordFile(entries, progress(id, 'waiting'), me, peer, 101);
  assert.equal(unchanged, entries);
  entries = recordFile(entries, progress(id, 'transferring'), me, peer, 102);
  entries = recordFile(entries, progress(id, 'complete'), me, peer, 103);
  entries = recordFile(entries, progress(id, 'interrupted'), me, peer, 104);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].at, 100);
  assert.equal(entries[0].file.status, 'complete');
});

test('same-named files, opposite directions and different peers have separate entries', () => {
  const id = randomUUID();
  let entries = recordFile([], progress(id, 'declined'), me, peer);
  entries = recordFile(entries, progress(id, 'waiting', 'receive'), me, peer);
  entries = recordFile(entries, progress(randomUUID(), 'waiting'), me, peer);
  entries = recordFile(entries, progress(id, 'waiting'), me, { id: 'carol', name: 'Carol' });
  assert.equal(entries.length, 4);
  assert.equal(entries[1].sender.name, 'Bob');
  assert.notEqual(fileKey('send', 'bob', id), fileKey('receive', 'bob', id));
});

test('history is bounded and deduplicated; active transfers become interrupted after reload', () => {
  const stored = Array.from({ length: HISTORY_LIMIT }, (_, n) => textEntry({ id: randomUUID(), text: 'message ' + n }, me, peer, 'send', [peer], n));
  const recent = textEntry({ id: randomUUID(), text: 'newest' }, me, peer, 'receive', [me], 500);
  const merged = mergeHistory(stored, [recent, recent]);
  assert.equal(merged.length, HISTORY_LIMIT);
  assert.equal(merged.at(-1).text, 'newest');
  assert.equal(merged[0].at, 1);
  let files = recordFile([], progress(randomUUID(), 'verifying'), me, peer);
  files = recordFile(files, progress(randomUUID(), 'complete'), me, peer);
  const restored = interruptedHistory(files);
  assert.deepEqual(restored.map(entry => entry.file.status), ['interrupted', 'complete']);
  assert.equal(files[0].file.status, 'verifying');
});
test('chat metadata supports the full 1 GiB limit and rejects larger file records', () => {
  const id = randomUUID(), maximum = 1024 * 1024 * 1024;
  const entries = recordFile([], { ...progress(id, 'complete'), total: maximum }, me, peer);
  assert.ok(entriesSchema.safeParse(entries).success);
  const oversized = [{ ...entries[0], file: { ...entries[0].file, size: maximum + 1 } }];
  assert.equal(entriesSchema.safeParse(oversized).success, false);
});