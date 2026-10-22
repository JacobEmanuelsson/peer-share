import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';
import { buildApp } from '../dist/app.js';
import { createPairStore } from '../dist/modules/signaling/signaling.pairs.js';

const emptyId = '00000000-0000-4000-8000-000000000000';

test('pair store fixes membership, forbids reuse, and removes both indexes', () => {
  const store = createPairStore();
  const pair = store.create({ pairId: 'one', senderConnectionId: 'a', receiverConnectionId: 'b' });
  assert.ok(Object.isFrozen(pair));
  assert.equal(store.getForConnection('b'), pair);
  assert.equal(store.create({ pairId: 'two', senderConnectionId: 'a', receiverConnectionId: 'c' }), undefined);
  assert.equal(store.create({ pairId: 'one', senderConnectionId: 'd', receiverConnectionId: 'e' }), undefined);
  assert.equal(store.create({ pairId: 'self', senderConnectionId: 'c', receiverConnectionId: 'c' }), undefined);
  assert.equal(store.removeForConnection('b'), pair);
  assert.equal(store.getById('one'), undefined);
  assert.equal(store.getForConnection('a'), undefined);
  assert.equal(store.getForConnection('b'), undefined);
  assert.equal(store.removeForConnection('b'), undefined);
  assert.ok(store.create({ pairId: 'new', senderConnectionId: 'a', receiverConnectionId: 'c' }));
});

async function harness(t, resolveSession) {
  const revoked = new Set();
  const app = buildApp({ api: { getSession: async args => {
    const user = args.headers.get('cookie');
    if (resolveSession) return resolveSession(user);
    return revoked.has(user) ? null : { user: { id: user }, session: { id: user + '-session' } };
  } } }, 'http://localhost:5173');
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverSockets = [];
  app.websocketServer.on('connection', socket => serverSockets.push(socket));
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(({ socket }) => socket.readyState === WebSocket.CLOSED
      ? Promise.resolve() : new Promise(resolve => { socket.once('close', resolve); socket.close(); })));
    await app.close();
  });
  async function connect(user) {
    const socket = new WebSocket(address.replace('http:', 'ws:') + '/api/signaling', {
      headers: { origin: 'http://localhost:5173', cookie: user },
    });
    const queue = [], waiters = [];
    socket.on('message', data => {
      const value = JSON.parse(data.toString());
      if (waiters.length) waiters.shift()(value); else queue.push(value);
    });
    await once(socket, 'open');
    const serverSocket = serverSockets[clients.length];
    const client = {
      socket, queue,
      send: value => socket.send(JSON.stringify(value)),
      next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Expected message did not arrive')), 2000);
        waiters.push(value => { clearTimeout(timer); resolve(value); });
      }),
      close: async () => { const closed = once(serverSocket, 'close'); socket.close(); await closed; },
    };
    clients.push(client);
    return client;
  }
  return { connect, revoked };
}

async function invite(sender, receivers, recipientUserId = 'bob') {
  sender.send({ type: 'create-invitation', recipientUserId });
  const created = await sender.next();
  assert.equal(created.type, 'invitation-created');
  for (const receiver of receivers) assert.equal((await receiver.next()).type, 'invitation-received');
  return created.invitationId;
}

async function accept(sender, receiver, invitationId, others = []) {
  receiver.send({ type: 'accept-invitation', invitationId });
  const response = await receiver.next();
  assert.equal(response.type, 'invitation-accepted');
  assert.equal((await sender.next()).pairId, response.pairId);
  for (const other of others) assert.equal((await other.next()).type, 'invitation-accepted-elsewhere');
  return response.pairId;
}

for (const sameAccount of [false, true]) {
  test(`only selected connections forward in both directions (same account: ${sameAccount})`, { timeout: 10000 }, async t => {
    const { connect } = await harness(t);
    const sender = await connect('alice');
    const recipient = sameAccount ? 'alice' : 'bob';
    const receiver = await connect(recipient), extra = await connect(recipient), outsider = await connect('eve');
    const id = await invite(sender, [receiver, extra], recipient);
    sender.send({ type: 'peer-message', pairId: id, text: 'before acceptance' });
    assert.equal((await sender.next()).type, 'error');
    for (const old of [{ type: 'create-room' }, { type: 'join-room', roomId: id, invitationToken: 'x'.repeat(43) }]) {
      outsider.send(old); assert.equal((await outsider.next()).type, 'error');
    }
    const pairId = await accept(sender, receiver, id, [extra]);
    for (const other of [extra, outsider]) {
      other.send({ type: 'peer-message', pairId, text: 'not permitted' });
      assert.equal((await other.next()).type, 'error');
    }
    sender.send({ type: 'peer-message', pairId, receiverConnectionId: 'forged', text: 'redirect' });
    assert.equal((await sender.next()).type, 'error');
    sender.send({ type: 'peer-message', pairId, text: 'hello receiver' });
    assert.deepEqual(await receiver.next(), { type: 'peer-message', pairId, text: 'hello receiver' });
    receiver.send({ type: 'peer-message', pairId, text: 'hello sender' });
    assert.equal((await sender.next()).text, 'hello sender');
    assert.deepEqual(extra.queue, []); assert.deepEqual(outsider.queue, []);
    sender.send({ type: 'peer-message', pairId: emptyId, text: 'wrong pair' });
    assert.equal((await sender.next()).type, 'error');
  });
}

test('disconnect ends the pair; another tab cannot claim the old pairing', { timeout: 10000 }, async t => {
  const { connect } = await harness(t);
  const a = await connect('alice'), b = await connect('bob'), other = await connect('bob');
  const id = await invite(a, [b, other]);
  const pairId = await accept(a, b, id, [other]);
  await b.close();
  assert.deepEqual(await a.next(), { type: 'pair-ended', pairId, reason: 'peer-disconnected' });
  other.send({ type: 'accept-invitation', invitationId: id });
  assert.equal((await other.next()).type, 'error');
  other.send({ type: 'peer-message', pairId, text: 'replace receiver' });
  assert.equal((await other.next()).type, 'error');
  a.send({ type: 'peer-message', pairId, text: 'stale' });
  assert.equal((await a.next()).type, 'error');
  const newId = await invite(a, [other]);
  const newPair = await accept(a, other, newId);
  assert.notEqual(newPair, pairId);
  a.send({ type: 'peer-message', pairId, text: 'old packet' });
  assert.equal((await a.next()).type, 'error');
  a.send({ type: 'peer-message', pairId: newPair, text: 'new pairing' });
  assert.equal((await other.next()).text, 'new pairing');
});

test('accepted pairing outlives the invitation deadline', { timeout: 10000 }, async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { connect } = await harness(t);
  const a = await connect('alice'), b = await connect('bob');
  const id = await invite(a, [b]);
  const pairId = await accept(a, b, id);
  now += 6 * 60 * 1000;
  a.send({ type: 'peer-message', pairId, text: 'after invitation expiry' });
  assert.equal((await b.next()).text, 'after invitation expiry');
});

test('delivery revalidates the receiving peer session', { timeout: 10000 }, async t => {
  const { connect, revoked } = await harness(t);
  const a = await connect('alice'), b = await connect('bob');
  const id = await invite(a, [b]);
  const pairId = await accept(a, b, id);
  revoked.add('bob');
  const closed = once(b.socket, 'close');
  a.send({ type: 'peer-message', pairId, text: 'must not be delivered' });
  assert.equal((await a.next()).type, 'pair-ended');
  assert.equal((await closed)[0], 1008);
  assert.deepEqual(b.queue, []);
});

test('simultaneous accepts select only one receiver', { timeout: 10000 }, async t => {
  const { connect } = await harness(t);
  const a = await connect('alice'), b = await connect('bob'), c = await connect('bob');
  const id = await invite(a, [b, c]);
  b.send({ type: 'accept-invitation', invitationId: id });
  c.send({ type: 'accept-invitation', invitationId: id });
  const responses = [await b.next(), await c.next()];
  assert.equal(responses.filter(m => m.type === 'invitation-accepted').length, 1);
  const loser = responses[0].type === 'invitation-accepted' ? c : b;
  const loserFirst = responses[0].type === 'invitation-accepted' ? responses[1] : responses[0];
  if (loserFirst.type === 'error') assert.equal((await loser.next()).type, 'invitation-accepted-elsewhere');
  else assert.equal((await loser.next()).type, 'error');
  assert.equal((await a.next()).type, 'invitation-accepted');
});

test('a second invitation cannot overwrite a busy recipient connection', { timeout: 10000 }, async t => {
  const { connect } = await harness(t);
  const a = await connect('alice'), b = await connect('bob'), c = await connect('carol');
  const first = await invite(a, [b]);
  const second = await invite(c, [b]);
  const pairId = await accept(a, b, first);
  b.send({ type: 'accept-invitation', invitationId: second });
  assert.equal((await b.next()).type, 'error');
  a.send({ type: 'peer-message', pairId, text: 'original pair preserved' });
  assert.equal((await b.next()).text, 'original pair preserved');
  c.send({ type: 'peer-message', pairId, text: 'not the sender' });
  assert.equal((await c.next()).type, 'error');
});

test('disconnect during recipient session lookup cancels pending delivery', { timeout: 10000 }, async t => {
  let delayBob = false, releaseLookup, lookupStarted;
  const started = new Promise(resolve => { lookupStarted = resolve; });
  const { connect } = await harness(t, async user => {
    if (user === 'bob' && delayBob) {
      lookupStarted();
      await new Promise(resolve => { releaseLookup = resolve; });
    }
    return { user: { id: user }, session: { id: user + '-session' } };
  });
  const a = await connect('alice'), b = await connect('bob');
  const id = await invite(a, [b]);
  const pairId = await accept(a, b, id);
  delayBob = true;
  a.send({ type: 'peer-message', pairId, text: 'in flight' });
  await started;
  await b.close();
  assert.equal((await a.next()).type, 'pair-ended');
  releaseLookup();
  // No queued text reached the departed peer while validation was pending.
  assert.deepEqual(b.queue, []);
});

test('sender disconnect ends pairing and cannot be replaced by its other tab', { timeout: 10000 }, async t => {
  const { connect } = await harness(t);
  const a = await connect('alice'), otherSender = await connect('alice'), b = await connect('bob');
  const id = await invite(a, [b]);
  const pairId = await accept(a, b, id);
  await a.close();
  assert.equal((await b.next()).type, 'pair-ended');
  otherSender.send({ type: 'peer-message', pairId, text: 'replace sender' });
  assert.equal((await otherSender.next()).type, 'error');
  b.send({ type: 'peer-message', pairId, text: 'old sender' });
  assert.equal((await b.next()).type, 'error');
});
