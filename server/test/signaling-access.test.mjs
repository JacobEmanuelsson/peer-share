import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import WebSocket from 'ws';
import { buildApp } from '../dist/app.js';

const origin = 'http://localhost:5173';
// Controlled session resolvers isolate access rules from database setup.
const sessionAuth = (resolve) => ({ api: { getSession: resolve } });

for (const suppliedOrigin of [undefined, 'http://untrusted.example', origin + '.evil']) {
  test(`rejects untrusted/missing origin: ${suppliedOrigin}`, async () => {
    let checked = false;
    const app = buildApp(sessionAuth(async () => { checked = true; return null; }), origin);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/signaling',
        headers: suppliedOrigin ? { origin: suppliedOrigin } : {} });
      assert.equal(response.statusCode, 403);
      assert.equal(checked, false);
    } finally { await app.close(); }
  });
}

test('signed-out trusted-origin request is rejected', async () => {
  const app = buildApp(sessionAuth(async () => null), origin);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/signaling', headers: { origin } });
    assert.equal(response.statusCode, 401);
  } finally { await app.close(); }
});

test('session lookup failure does not grant access', async () => {
  const app = buildApp(sessionAuth(async () => { throw new Error('Session lookup unavailable'); }), origin);
  try {
    const response = await app.inject({ method: 'GET', url: '/api/signaling', headers: { origin } });
    assert.equal(response.statusCode, 500);
  } finally { await app.close(); }
});

test('valid session upgrades and can create a room', { timeout: 5000 }, async () => {
  let cookie;
  const app = buildApp(sessionAuth(async ({ headers }) => {
    cookie = headers.get('cookie');
    return { user: { id: 'test-user' }, session: { id: 'test-session' } };
  }), origin);
  let socket;
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    socket = new WebSocket(address.replace('http:', 'ws:') + '/api/signaling', {
      headers: { origin, cookie: 'test-session-cookie=example' },
    });
    await once(socket, 'open');
    assert.equal(cookie, 'test-session-cookie=example');
    const reply = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'create-room' }));
    const [data] = await reply;
    assert.equal(JSON.parse(data.toString()).type, 'room-created');
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      const closed = once(socket, 'close'); socket.close(); await closed;
    } else { socket?.terminate(); }
    await app.close();
  }
});

for (const mode of ['message', 'idle', 'lookup-failure']) {
  test(`closes an existing connection after ${mode} revalidation`, { timeout: 40000 }, async () => {
    let revoked = false;
    let checks = 0;
    const app = buildApp(sessionAuth(async ({ query }) => {
      checks++;
      assert.equal(query.disableCookieCache, true);
      assert.equal(query.disableRefresh, true);
      if (revoked && mode === 'lookup-failure') throw new Error('Database unavailable');
      return revoked ? null : { user: { id: 'test-user' }, session: { id: 'test-session' } };
    }), origin);
    let socket;
    try {
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      socket = new WebSocket(address.replace('http:', 'ws:') + '/api/signaling', { headers: { origin } });
      await once(socket, 'open');
      const created = once(socket, 'message');
      socket.send(JSON.stringify({ type: 'create-room' }));
      assert.equal(JSON.parse((await created)[0].toString()).type, 'room-created');
      revoked = true;
      const closed = once(socket, 'close');
      const subsequentMessages = [];
      socket.on('message', data => subsequentMessages.push(data));
      if (mode !== 'idle') socket.send(JSON.stringify({ type: 'peer-message', text: 'must not be processed' }));
      const [code] = await closed;
      assert.equal(code, mode === 'lookup-failure' ? 1011 : 1008);
      assert.deepEqual(subsequentMessages, []);
      assert.ok(checks >= 3);
    } finally {
      socket?.terminate();
      await app.close();
    }
  });
}

test('an open connection cannot change its authenticated account', { timeout: 5000 }, async () => {
  let userId = 'alice';
  const app = buildApp(sessionAuth(async () => ({ user: { id: userId }, session: { id: 'same-session' } })), origin);
  let socket;
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    socket = new WebSocket(address.replace('http:', 'ws:') + '/api/signaling', { headers: { origin } });
    await once(socket, 'open');
    userId = 'bob';
    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'create-room' }));
    assert.equal((await closed)[0], 1008);
  } finally { socket?.terminate(); await app.close(); }
});
