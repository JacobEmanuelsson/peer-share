import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { buildApp } from '../dist/app.js';

async function setup(t) {
  const groupId = randomUUID(), callbacks = new Set(), revoked = new Set();
  const members = new Set(['a','b','c']);
  const service = {
    groupForMember: async (id, user) => { if (id !== groupId || !members.has(user)) throw Object.assign(new Error('Unavailable'), { statusCode: 404 }); return { memberIds: [...members] }; },
    onUserAccessChanged: () => () => {}, canConnect: async () => true, onGroupAccessChanged: callback => { callbacks.add(callback); return () => callbacks.delete(callback); },
  };
  const auth = { api: { getSession: async args => {
    const user = args.headers.get('cookie');
    return user && !revoked.has(user) ? { user: { emailVerified: true, id: user, name: user }, session: { id: user + '-session' } } : null;
  } } };
  const app = buildApp(auth, 'http://localhost:5173', service);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const clients = [];
  t.after(async () => { for (const client of clients) client.ws.terminate(); await app.close(); });
  async function connect(user) {
    const ws = new WebSocket(address.replace('http:', 'ws:') + '/api/groups/' + groupId + '/signaling', { headers: { origin: 'http://localhost:5173', cookie: user } });
    const queue = [], waiting = [];
    const client = { ws, queue, send: message => ws.send(JSON.stringify(message)), next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve)) };
    ws.on('message', data => { const message = JSON.parse(data); if (waiting.length) waiting.shift()(message); else queue.push(message); });
    clients.push(client);
    await once(ws, 'open');
    return client;
  }
  return { app, address, groupId, members, revoked, connect, changed: event => callbacks.forEach(callback => callback(event)) };
}
test('three group members get directed signaling with fixed description roles and immediate removal', { timeout: 5000 }, async t => {
  const h = await setup(t);
  const a = await h.connect('a'); const a0 = await a.next();
  const b = await h.connect('b'); const a1 = await a.next(), b0 = await b.next();
  const c = await h.connect('c'); const a2 = await a.next(), b1 = await b.next(), c0 = await c.next();
  assert.equal(a2.peers.length, 2); assert.equal(b1.peers.length, 2); assert.equal(c0.peers.length, 2);
  const ai = a0.selfId, bi = b0.selfId;
  const [sender, receiver, target, source] = ai < bi ? [a,b,bi,ai] : [b,a,ai,bi];
  const signal = { type: 'offer', sdp: 'SDP:' + 'a'.repeat(5000) };
  sender.send({ type: 'signal', to: target, signal });
  assert.deepEqual(await receiver.next(), { type: 'signal', from: source, signal });
  assert.deepEqual(c.queue, []);
  h.members.delete('c'); const closed = once(c.ws, 'close');
  h.changed({ groupId: h.groupId, userId: 'c' });
  assert.equal((await closed)[0], 1008);
  assert.equal((await a.next()).peers.length, 1);
  assert.equal((await b.next()).peers.length, 1);
});
test('group handshake rejects missing session, outsider, or incorrect origin', async t => {
  const h = await setup(t);
  const url = '/api/groups/' + h.groupId + '/signaling';
  for (const [cookie, origin, code] of [[undefined,'http://localhost:5173',401],['eve','http://localhost:5173',404],['a','https://evil.invalid',403]]) {
    const response = await h.app.inject({ url, headers: { connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', origin, ...(cookie ? { cookie } : {}) } });
    assert.equal(response.statusCode, code);
  }
});
test('a second tab cannot replace a joined device and deletion closes the group', { timeout: 5000 }, async t => {
  const h = await setup(t);
  const a = await h.connect('a'); await a.next();
  const duplicate = await h.connect('a');
  assert.equal((await once(duplicate.ws, 'close'))[0], 1008);
  const b = await h.connect('b'); await a.next(); await b.next();
  const closes = [once(a.ws, 'close'), once(b.ws, 'close')];
  h.changed({ groupId: h.groupId });
  assert.deepEqual((await Promise.all(closes)).map(event => event[0]), [1008, 1008]);
});
test('signals never reach a peer with a revoked session', { timeout: 5000 }, async t => {
  const h = await setup(t);
  const a = await h.connect('a'); await a.next();
  const b = await h.connect('b'); const ar = await a.next(); await b.next();
  h.revoked.add('b');
  const closed = once(b.ws, 'close');
  a.send({ type: 'signal', to: ar.peers[0].id, signal: { type: 'ice-candidate', candidate: { candidate: 'candidate:1' } } });
  await closed;
  assert.deepEqual(b.queue, []);
});
for (const bad of ['unknown-target','file-payload','binary','wrong-role']) {
  test('group signaling rejects ' + bad, { timeout: 5000 }, async t => {
    const h = await setup(t);
    const a = await h.connect('a'); const first = await a.next();
    const b = await h.connect('b'); const ar = await a.next(); const br = await b.next();
    let source = a;
    if (bad === 'wrong-role') source = first.selfId < br.selfId ? b : a;
    const target = source === a ? ar.peers[0].id : br.peers[0].id;
    const closed = once(source.ws, 'close');
    if (bad === 'binary') source.ws.send(Buffer.from([1,2]));
    else source.send(bad === 'file-payload' ? { type: 'file-offer', name: 'no-files-here' } : { type: 'signal', to: bad === 'unknown-target' ? randomUUID() : target, signal: bad === 'wrong-role' ? { type: 'offer', sdp: 'wrong-side' } : { type: 'ice-candidate', candidate: { candidate: 'candidate:1' } } });
    assert.ok([1003,1008].includes((await closed)[0]));
  });
}