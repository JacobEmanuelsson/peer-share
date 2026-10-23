import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../dist/modules/auth/auth.route.js';

test('private profile requires a current server-verified session and never caches responses', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let revoked = false;
  const calls = [];
  registerAuthRoutes(app, { api: { getSession: async options => {
    calls.push(options);
    if (options.headers.get('cookie') !== 'session=valid' || revoked) return null;
    return { user: { emailVerified: true, id: 'alice', name: 'Alice', email: 'alice@example.invalid', secret: 'not-for-client' } };
  } } }, 'http://localhost:5173');
  for (const cookie of [undefined, 'session=forged']) {
    const response = await app.inject({ url: '/api/me', headers: cookie ? { cookie } : {} });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const response = await app.inject({ url: '/api/me', headers: { cookie: 'session=valid' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { user: { id: 'alice', name: 'Alice', email: 'alice@example.invalid' } });
  revoked = true;
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: 'session=valid' } })).statusCode, 401);
  assert.ok(calls.every(call => call.query.disableCookieCache && call.query.disableRefresh));
});

test('session verification failure does not return a private profile', async t => {
  const app = Fastify();
  t.after(() => app.close());
  registerAuthRoutes(app, { api: { getSession: async () => { throw new Error('Unavailable'); } } }, 'http://localhost:5173');
  const response = await app.inject({ url: '/api/me' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().user, undefined);
});
test('unverified and missing verification flags cannot access private profile', async t => {
  for(const emailVerified of [false,undefined]){
    const app=Fastify();t.after(()=>app.close());
    registerAuthRoutes(app,{api:{getSession:async()=>({user:{id:'a',emailVerified}})}},'http://localhost:5173');
    assert.equal((await app.inject({url:'/api/me'})).statusCode,401);
  }
});