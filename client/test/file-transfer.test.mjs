import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createFileTransfer as createTransfer, CHUNK_BYTES, MAX_FILE_BYTES } from '../src/webrtc/fileTransfer.ts';

function createFileTransfer(options) {
  return createTransfer({ ...options, createSink: options.createSink ?? (async () => {
    const chunks = [];
    return { async write(data) { chunks.push(data); }, async finish() { return new Blob(chunks); }, async dispose() {} };
  }) });
}
function receiverHarness() {
  const controls = [], files = [], offers = [];
  const receiver = createFileTransfer({
    sendControl: value => controls.push(value), sendChunk: async () => {},
    chunkSize: () => CHUNK_BYTES, onText() {}, onOffer: value => offers.push(value),
    onProgress() {}, onFile: value => files.push(value),
  });
  return { receiver, controls, files, offers };
}
function offerFor(bytes, changes = {}) {
  return { type: 'file-offer', id: crypto.randomUUID(), name: 'example.bin',
    size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), ...changes };
}
const control = (target, message) => target.receive(JSON.stringify(message));

for (const size of [0, CHUNK_BYTES + 7]) {
  test(`receiver accepts, assembles, verifies, and acknowledges ${size} bytes`, async () => {
    const { receiver, files, controls } = receiverHarness();
    const bytes = new Uint8Array(size).fill(123), offer = offerFor(bytes);
    await control(receiver, offer);
    assert.equal(files.length, 0);
    await receiver.acceptFile(true);
    for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
      await receiver.receive(bytes.slice(offset, offset + CHUNK_BYTES).buffer);
    }
    await control(receiver, { type: 'file-end', id: offer.id });
    assert.deepEqual(new Uint8Array(await files[0].blob.arrayBuffer()), bytes);
    assert.equal(files[0].name, offer.name);
    assert.deepEqual(controls.filter(value => value.type !== 'file-progress').map(value => value.type), ['file-accept', 'file-complete']);
    receiver.close();
  });
}

test('no file bytes are accepted before consent or after rejection', async () => {
  const { receiver, controls, files } = receiverHarness();
  const offer = offerFor(new Uint8Array(1));
  await control(receiver, offer);
  await assert.rejects(receiver.receive(new ArrayBuffer(1)), /Invalid file chunk/);
  await receiver.acceptFile(false);
  assert.equal(controls[0].type, 'file-reject');
  await assert.rejects(receiver.receive(new ArrayBuffer(1)), /Invalid file chunk/);
  assert.deepEqual(files, []);
  receiver.close();
});

test('size limits, malformed controls, and binary chunk limits are checked', async () => {
  const { receiver } = receiverHarness();
  await assert.rejects(control(receiver, offerFor(new Uint8Array(), { size: MAX_FILE_BYTES + 1 })));
  await assert.rejects(receiver.receive('not-json'));
  await assert.rejects(receiver.receive(' '.repeat(16 * 1024 + 1)));
  await control(receiver, offerFor(new Uint8Array(CHUNK_BYTES + 1)));
  await receiver.acceptFile(true);
  await assert.rejects(receiver.receive(new ArrayBuffer(CHUNK_BYTES + 1)), /Invalid file chunk/);
  await assert.rejects(receiver.receive(new ArrayBuffer(0)), /Invalid file chunk/);
  receiver.close();
});

test('truncated and corrupted files are never published or acknowledged complete', async () => {
  for (const corrupt of [false, true]) {
    const { receiver, files, controls } = receiverHarness();
    const offer = offerFor(new Uint8Array([1, 2]));
    await control(receiver, offer); await receiver.acceptFile(true);
    await receiver.receive(new Uint8Array(corrupt ? [3, 4] : [1]).buffer);
    await assert.rejects(control(receiver, { type: 'file-end', id: offer.id }), corrupt ? /integrity/ : /incomplete/);
    assert.deepEqual(files, []);
    assert.ok(controls.every(value => value.type !== 'file-complete'));
    receiver.close();
  }
});

test('sender waits for consent and rejects premature completion', async () => {
  const messages = [], chunks = [];
  let offered;
  const offerReady = new Promise(resolve => { offered = resolve; });
  const sender = createFileTransfer({
    sendControl: message => { messages.push(message); if (message.type === 'file-offer') offered(message); },
    sendChunk: async data => { chunks.push(data); }, chunkSize: () => CHUNK_BYTES,
    onText() {}, onOffer() {}, onProgress() {}, onFile() {},
  });
  const sending = sender.sendFile(new File(['payload'], 'example.bin'));
  const offer = await offerReady;
  assert.equal(chunks.length, 0);
  await assert.rejects(control(sender, { type: 'file-complete', id: offer.id }), /Unexpected completion/);
  await control(sender, { type: 'file-reject', id: offer.id });
  await sending;
  assert.equal(chunks.length, 0);
  assert.deepEqual(messages.map(value => value.type), ['file-offer']);
  sender.close();
});

test('closing releases a sender waiting for acceptance', async () => {
  let offered;
  const ready = new Promise(resolve => { offered = resolve; });
  const sender = createFileTransfer({
    sendControl: () => offered(), sendChunk: async () => {}, chunkSize: () => CHUNK_BYTES,
    onText() {}, onOffer() {}, onProgress() {}, onFile() {},
  });
  const sending = sender.sendFile(new File(['payload'], 'example.bin'));
  await ready;
  sender.close();
  await sending;
});
test('both peers can send simultaneously with independent acceptance, progress and acknowledgements', { timeout: 5000 }, async () => {
  const files = [[], []], progress = [[], []], offers = [[], []], queues = [[], []], failures = [];
  const peers = [];
  let draining = false;
  function enqueue(target, data) {
    queues[target].push(data);
    if (!draining) {
      draining = true;
      queueMicrotask(async () => {
        try {
          while (queues.some(queue => queue.length)) {
            for (let i = 0; i < 2; i++) {
              if (queues[i].length) await peers[i].receive(queues[i].shift());
            }
          }
        } catch (error) { failures.push(error); }
        finally { draining = false; }
      });
    }
  }
  for (let i = 0; i < 2; i++) peers.push(createFileTransfer({
    sendControl: message => enqueue(1 - i, JSON.stringify(message)),
    sendChunk: async data => enqueue(1 - i, data),
    chunkSize: () => 13,
    onText() {},
    onOffer: offer => { if (offer) offers[i].push(offer); },
    onProgress: value => progress[i].push(value),
    onFile: file => files[i].push(file),
  }));
  const a = new File(['a'.repeat(100)], 'from-inviter.txt');
  const b = new File(['b'.repeat(73)], 'from-recipient.txt');
  try {
    const sending = [peers[0].sendFile(a), peers[1].sendFile(b)];
    while (offers.some(list => !list.length)) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(files, [[], []]);
    await peers[0].acceptFile(true);
    await peers[1].acceptFile(true);
    await Promise.all(sending);
    assert.deepEqual(failures, []);
    assert.equal(await files[0][0].blob.text(), await b.text());
    assert.equal(await files[1][0].blob.text(), await a.text());
    assert.equal(files[0][0].name, b.name);
    assert.equal(files[1][0].name, a.name);
    for (const events of progress) {
      assert.ok(events.some(event => event.direction === 'send' && event.status === 'complete'));
      assert.ok(events.some(event => event.direction === 'receive' && event.status === 'complete'));
    }
  } finally { peers.forEach(peer => peer.close()); }
});
test('chat text uses a validated UUID, supports longer text and rejects forged identity fields', async () => {
  const messages = [];
  const receiver = createFileTransfer({
    sendControl() {}, sendChunk: async () => {}, chunkSize: () => CHUNK_BYTES,
    onText: message => messages.push(message), onOffer() {}, onProgress() {}, onFile() {},
  });
  const id = crypto.randomUUID(), text = '"'.repeat(2000);
  await control(receiver, { type: 'text', id, text });
  assert.deepEqual(messages, [{ id, text }]);
  for (const message of [
    { type: 'text', id, text: 'a'.repeat(2001) },
    { type: 'text', id: 'invalid', text: 'hello' },
    { type: 'text', id, text: 'hello', senderId: 'forged' },
  ]) await assert.rejects(control(receiver, message));
  receiver.close();
});
test('declining and closing a received offer emit distinct file states using the same transfer id', async () => {
  const events = [];
  const receiver = createFileTransfer({
    sendControl() {}, sendChunk: async () => {}, chunkSize: () => CHUNK_BYTES,
    onText() {}, onOffer() {}, onProgress: event => events.push(event), onFile() {},
  });
  const first = offerFor(new Uint8Array(1));
  await control(receiver, first); await receiver.acceptFile(false);
  assert.equal(events.at(-1).status, 'declined');
  assert.equal(events.at(-1).id, first.id);
  const second = offerFor(new Uint8Array(1));
  await control(receiver, second); receiver.close();
  assert.equal(events.at(-1).status, 'interrupted');
  assert.equal(events.at(-1).id, second.id);
});
test('1 GiB is accepted, while one byte above is rejected on both sending and receiving', async () => {
  assert.equal(MAX_FILE_BYTES, 1024 * 1024 * 1024);
  const { receiver, offers } = receiverHarness();
  await control(receiver, offerFor(new Uint8Array(), { size: MAX_FILE_BYTES }));
  assert.equal(offers[0].size, MAX_FILE_BYTES);
  await receiver.acceptFile(false);
  await assert.rejects(control(receiver, offerFor(new Uint8Array(), { size: MAX_FILE_BYTES + 1 })));
  const sender = createFileTransfer({
    sendControl() {}, sendChunk: async () => {}, chunkSize: () => CHUNK_BYTES,
    onText() {}, onOffer() {}, onProgress() {}, onFile() {},
  });
  await assert.rejects(sender.sendFile({ name: 'oversized.bin', size: MAX_FILE_BYTES + 1 }), /1 GiB/);
  receiver.close(); sender.close();
});
test('storage failure declines the offer without publishing a file', async () => {
  const controls = [], events = [];
  const receiver = createFileTransfer({
    createSink: async () => { throw new Error('No disk quota'); },
    sendControl: message => controls.push(message), sendChunk: async () => {},
    chunkSize: () => CHUNK_BYTES, onText() {}, onOffer() {}, onProgress: e => events.push(e), onFile() { assert.fail('No file expected'); },
  });
  const offer = offerFor(new Uint8Array(1));
  await control(receiver, offer);
  await assert.rejects(receiver.acceptFile(true), /quota/);
  assert.equal(controls.at(-1).type, 'file-reject');
  assert.equal(events.at(-1).status, 'failed');
  receiver.close();
});

test('closing during asynchronous disk preparation disposes the late sink', async () => {
  let resolve, disposed = false;
  const receiver = createFileTransfer({
    createSink: () => new Promise(done => { resolve = done; }),
    sendControl() { assert.fail('Must not accept a closed transfer'); }, sendChunk: async () => {},
    chunkSize: () => CHUNK_BYTES, onText() {}, onOffer() {}, onProgress() {}, onFile() {},
  });
  await control(receiver, offerFor(new Uint8Array(1)));
  const accepting = receiver.acceptFile(true);
  receiver.close();
  resolve({ async write() {}, async finish() { return new Blob(); }, async dispose() { disposed = true; } });
  await accepting;
  assert.equal(disposed, true);
});

test('sender pauses after 256 KiB until cumulative receiver credit arrives', async () => {
  let offer, sent = 0, finish;
  const offered = new Promise(resolve => { finish = resolve; });
  const sender = createFileTransfer({
    sendControl(message) { if (message.type === 'file-offer') { offer = message; finish(); } },
    sendChunk: async data => { sent += data.byteLength; },
    chunkSize: () => CHUNK_BYTES, onText() {}, onOffer() {}, onProgress() {}, onFile() {},
  });
  const sending = sender.sendFile(new File([new Uint8Array(512 * 1024)], 'credit.bin'));
  await offered; await control(sender, { type: 'file-accept', id: offer.id });
  while (sent < 256 * 1024) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent, 256 * 1024);
  await assert.rejects(control(sender, { type: 'file-progress', id: offer.id, bytes: sent + 1 }), /acknowledgement/);
  await control(sender, { type: 'file-progress', id: offer.id, bytes: sent });
  while (sent < 512 * 1024) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await control(sender, { type: 'file-complete', id: offer.id });
  await sending; sender.close();
});
for (const cancelledBy of ['send', 'receive']) {
  test('cancel ' + cancelledBy + ' drains old frames and permits retry on the same connection', {timeout:5000}, async () => {
    const peers=[], chains=[Promise.resolve(),Promise.resolve()], errors=[], files=[], events=[];
    let cancelled=false;
    const deliver=(to,data)=>{chains[to]=chains[to].then(()=>peers[to].receive(data)).catch(error=>errors.push(error));};
    for(let i=0;i<2;i++)peers.push(createFileTransfer({
      sendControl:message=>deliver(1-i,JSON.stringify(message)),
      sendChunk:async data=>deliver(1-i,data),chunkSize:()=>CHUNK_BYTES,onText(){},
      onOffer:offer=>{if(offer)void peers[i].acceptFile(true);},
      onProgress:event=>{
        events.push(event);
        if(!cancelled && event.direction===cancelledBy && event.status==='transferring' && event.bytes>=64*1024){
          cancelled=true;peers[i].cancelFile(cancelledBy);
        }
      },
      onFile:file=>files.push(file),
    }));
    try {
      await assert.rejects(peers[0].sendFile(new File([new Uint8Array(1024*1024)],'cancel.bin')),/cancelled/);
      await Promise.all(chains);
      assert.equal(files.length,0);assert.deepEqual(errors,[]);
      await peers[0].sendFile(new File(['retry works'],'retry.txt'));
      await Promise.all(chains);
      assert.deepEqual(errors,[]);assert.equal(await files[0].blob.text(),'retry works');
      assert.ok(events.some(event=>event.status==='cancelled'));
    } finally {peers.forEach(peer=>peer.close());}
  });
}