import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createInvitationStore } from '../dist/modules/signaling/signaling.invitations.js';
import { buildApp } from '../dist/app.js';

const input = { senderUserId: 'alice', senderConnectionId: 'alice-tab', recipientUserId: 'bob' };

test('store retains invitations across calls and separate stores are isolated', () => {
  const store = createInvitationStore();
  const first = store.create(input), second = store.create(input);
  assert.notEqual(first.id, second.id);
  assert.equal(store.getById(first.id), first);
  assert.equal(store.getById(second.id), second);
  assert.equal(createInvitationStore().getById(first.id), undefined);
  assert.ok(Object.isFrozen(first));
  assert.equal(store.remove(first.id), true);
  assert.equal(store.getById(first.id), undefined);
});

test('expiry prevents lookup and cleanup removes expired records', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const store = createInvitationStore();
  const first = store.create(input), second = store.create(input);
  now = first.expiresAt;
  assert.equal(store.getById(first.id), undefined);
  store.removeExpired();
  assert.equal(store.remove(second.id), false);
});

test('sender disconnect cleanup preserves other senders', () => {
  const store = createInvitationStore();
  const first = store.create(input);
  const other = store.create({ ...input, senderConnectionId: 'another-tab' });
  store.removeForSender('alice-tab');
  assert.equal(store.getById(first.id), undefined);
  assert.equal(store.getById(other.id), other);
});

test('gateway notifies only recipient connections and rejects forged sender fields', { timeout: 5000 }, async () => {
  const auth = { api: { getSession: async ({ headers }) => {
    const userId = headers.get('cookie');
    return userId ? { user: { id: userId }, session: { id: userId + '-session' } } : null;
  } } };
  const app = buildApp(auth, 'http://localhost:5173');
  const sockets = [];
  async function connect(url, userId) {
    const socket = new WebSocket(url, { headers: { origin: 'http://localhost:5173', cookie: userId } });
    sockets.push(socket);
    await once(socket, 'open');
    return socket;
  }
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = address.replace('http:', 'ws:') + '/api/signaling';
    const alice = await connect(url, 'alice');
    const bob1 = await connect(url, 'bob'), bob2 = await connect(url, 'bob');
    const eve = await connect(url, 'eve');
    const unrelated = [];
    eve.on('message', data => unrelated.push(data.toString()));
    const received1 = once(bob1, 'message'), received2 = once(bob2, 'message');
    const created = once(alice, 'message');
    alice.send(JSON.stringify({ type: 'create-invitation', recipientUserId: 'bob' }));
    const acknowledgement = JSON.parse((await created)[0].toString());
    const invitation = JSON.parse((await received1)[0].toString());
    assert.equal(acknowledgement.type, 'invitation-created');
    assert.equal(invitation.type, 'invitation-received');
    assert.equal(invitation.senderUserId, 'alice');
    assert.equal(invitation.invitationId, acknowledgement.invitationId);
    assert.equal(JSON.parse((await received2)[0].toString()).invitationId, invitation.invitationId);
    const invalid = once(alice, 'message');
    alice.send(JSON.stringify({ type: 'create-invitation', recipientUserId: 'bob', senderUserId: 'eve' }));
    assert.equal(JSON.parse((await invalid)[0].toString()).type, 'error');
    const offline = once(alice, 'message');
    alice.send(JSON.stringify({ type: 'create-invitation', recipientUserId: 'offline' }));
    assert.equal(JSON.parse((await offline)[0].toString()).text, 'Recipient is unavailable');
    assert.deepEqual(unrelated, []);
  } finally {
    await Promise.all(sockets.map(socket => new Promise(resolve => { socket.once('close', resolve); socket.close(); })));
    await app.close();
  }
});

test('acceptance records the intended recipient connection and preserves invitation details', () => {
  const store = createInvitationStore();
  const invitation = store.create(input);
  assert.equal(invitation.status, 'pending');
  assert.equal(store.acceptInv(invitation.id, 'bob', 'bob-laptop'), true);
  const accepted = store.getById(invitation.id);
  assert.deepEqual(accepted, { ...invitation, status: 'accepted', receiverConnectionId: 'bob-laptop' });
  assert.ok(Object.isFrozen(accepted));
});

test('missing invitations cannot be accepted', () => {
  const store = createInvitationStore();
  assert.equal(store.acceptInv('missing-id', 'bob', 'bob-laptop'), false);
});

test('wrong account cannot claim an invitation or block its intended recipient', () => {
  const store = createInvitationStore();
  const invitation = store.create(input);
  assert.equal(store.acceptInv(invitation.id, 'eve', 'eve-tab'), false);
  assert.equal(store.getById(invitation.id).status, 'pending');
  assert.equal(store.getById(invitation.id).receiverConnectionId, undefined);
  assert.equal(store.acceptInv(invitation.id, 'bob', 'bob-laptop'), true);
});

for (const [offset, allowed] of [[-1, true], [0, false], [1, false]]) {
  test(`acceptance at expiry ${offset}ms returns ${allowed}`, t => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const store = createInvitationStore();
    const invitation = store.create(input);
    now = invitation.expiresAt + offset;
    assert.equal(store.acceptInv(invitation.id, 'bob', 'bob-laptop'), allowed);
  });
}

test('first acceptance wins and repeated calls cannot replace the receiver', async () => {
  const store = createInvitationStore();
  const invitation = store.create(input);
  // Both attempts are scheduled together in this single server process.
  const results = await Promise.all([
    Promise.resolve().then(() => store.acceptInv(invitation.id, 'bob', 'bob-laptop')),
    Promise.resolve().then(() => store.acceptInv(invitation.id, 'bob', 'bob-phone')),
  ]);
  assert.deepEqual(results, [true, false]);
  assert.equal(store.acceptInv(invitation.id, 'bob', 'bob-laptop'), false);
  assert.equal(store.getById(invitation.id).receiverConnectionId, 'bob-laptop');
});

test('sender connection cannot accept but another connection on the same account can', () => {
  const store = createInvitationStore();
  const invitation = store.create({ ...input, recipientUserId: 'alice' });
  assert.equal(store.acceptInv(invitation.id, 'alice', 'alice-tab'), false);
  assert.equal(store.getById(invitation.id).status, 'pending');
  assert.equal(store.acceptInv(invitation.id, 'alice', 'alice-phone'), true);
  assert.equal(store.getById(invitation.id).receiverConnectionId, 'alice-phone');
});

test('sender cleanup makes an invitation unavailable for acceptance', () => {
  const store = createInvitationStore();
  const invitation = store.create(input);
  store.removeForSender('alice-tab');
  assert.equal(store.acceptInv(invitation.id, 'bob', 'bob-laptop'), false);
});

for (const sameAccount of [false, true]) {
  test(`gateway accepts one recipient connection (same account: ${sameAccount})`, { timeout: 5000 }, async () => {
    const auth = { api: { getSession: async ({ headers }) => {
      const userId = headers.get('cookie');
      return { user: { id: userId }, session: { id: userId + '-session' } };
    } } };
    const app = buildApp(auth, 'http://localhost:5173');
    const clients = [];
    async function connect(url, userId) {
      const socket = new WebSocket(url, { headers: { origin: 'http://localhost:5173', cookie: userId } });
      const queue = [], pending = [];
      socket.on('message', data => {
        const message = JSON.parse(data.toString());
        if (pending.length) pending.shift()(message); else queue.push(message);
      });
      await once(socket, 'open');
      const client = {
        socket,
        send: message => socket.send(JSON.stringify(message)),
        next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => pending.push(resolve)),
      };
      clients.push(client);
      return client;
    }
    try {
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const url = address.replace('http:', 'ws:') + '/api/signaling';
      const recipientId = sameAccount ? 'alice' : 'bob';
      const sender = await connect(url, 'alice');
      const first = await connect(url, recipientId), second = await connect(url, recipientId);
      const outsider = await connect(url, 'eve');
      sender.send({ type: 'create-invitation', recipientUserId: recipientId });
      const invitationId = (await sender.next()).invitationId;
      assert.equal((await first.next()).type, 'invitation-received');
      assert.equal((await second.next()).type, 'invitation-received');
      outsider.send({ type: 'accept-invitation', invitationId });
      assert.equal((await outsider.next()).type, 'error');
      first.send({ type: 'accept-invitation', invitationId, userId: recipientId });
      assert.equal((await first.next()).text, 'Invalid message');
      first.send({ type: 'accept-invitation', invitationId });
      assert.deepEqual(await first.next(), { type: 'invitation-accepted', invitationId, pairId: invitationId, role: 'receiver' });
      assert.deepEqual(await sender.next(), { type: 'invitation-accepted', invitationId, pairId: invitationId, role: 'sender' });
      assert.deepEqual(await second.next(), { type: 'invitation-accepted-elsewhere', invitationId });
      second.send({ type: 'accept-invitation', invitationId });
      assert.equal((await second.next()).type, 'error');
      first.send({ type: 'accept-invitation', invitationId });
      assert.equal((await first.next()).type, 'error');
      outsider.send({ type: 'accept-invitation', invitationId: '00000000-0000-4000-8000-000000000000' });
      assert.equal((await outsider.next()).type, 'error');
    } finally {
      await Promise.all(clients.map(({ socket }) => new Promise(resolve => { socket.once('close', resolve); socket.close(); })));
      await app.close();
    }
  });
}
