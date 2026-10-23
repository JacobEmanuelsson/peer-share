import { buildApp } from '../dist/app.js';
import { registerAuthRoutes } from '../dist/modules/auth/auth.route.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { iceConfiguration, registerIceRoutes } from '../dist/modules/auth/ice.js';
import { createBudget } from '../dist/modules/signaling/abuse.js';

test('TURN REST credentials expire, use standard HMAC and never expose the shared secret', () => {
  const env = { TURN_URLS: 'turn:localhost:3478?transport=udp,turns:turn.example:5349', TURN_SHARED_SECRET: 'x'.repeat(32), STUN_URLS: 'stun:localhost:3478', ICE_RELAY_ONLY: 'true' };
  const value = iceConfiguration(env, 100_000);
  assert.equal(value.expiresAt, 3700);
  assert.equal(value.iceTransportPolicy, 'relay');
  const turn = value.iceServers[1];
  assert.match(turn.username, /^3700:/);
  assert.equal(turn.credential, createHmac('sha1',env.TURN_SHARED_SECRET).update(turn.username).digest('base64'));
  assert.ok(!JSON.stringify(value).includes(env.TURN_SHARED_SECRET));
  assert.throws(() => iceConfiguration({TURN_URLS:'turn:x'}), /SECRET/);
  assert.throws(() => iceConfiguration({ICE_RELAY_ONLY:'true'}), /requires TURN/);
  assert.throws(() => iceConfiguration({STUN_URLS:'https://example.com'}), /Invalid/);
});
test('ICE configuration requires a verified current session and cannot be cached', async t => {
  const app = Fastify();
  registerIceRoutes(app, {api:{getSession:async ({headers}) => headers.get('cookie') ? {user:{emailVerified:headers.get('cookie')==='verified'}} : null}}, {});
  t.after(()=>app.close());
  for(const cookie of [undefined,'unverified','verified']){
    const response=await app.inject({url:'/api/ice',headers:cookie?{cookie}:{}});
    assert.equal(response.statusCode,cookie==='verified'?200:401);
    assert.equal(response.headers['cache-control'],'no-store');
  }
});
test('message/invitation budgets are per account, bounded, and reset after the window', () => {
  let time=0; const allowed=createBudget(2,1000,()=>time);
  assert.equal(allowed('a'),true);assert.equal(allowed('a'),true);assert.equal(allowed('a'),false);
  assert.equal(allowed('b'),true);time=1000;assert.equal(allowed('a'),true);
});
test('HTTP signup/recovery limits cannot be bypassed by spoofing forwarded client IPs', async t => {
  const auth={handler:async()=>new Response('{}',{headers:{'content-type':'application/json'}}),api:{getSession:async()=>null}};
  const app=buildApp(auth,'http://localhost:5173');app.log.level='silent';
  registerAuthRoutes(app,auth,'http://localhost:5173');t.after(()=>app.close());
  for(const [path,max]of [['sign-up/email',5],['request-password-reset',3]])for(let i=0;i<=max;i++){
    const response=await app.inject({method:'POST',url:'/api/auth/'+path,payload:{},headers:{origin:'http://localhost:5173','x-forwarded-for':'203.0.113.'+i}});
    assert.equal(response.statusCode,i===max?429:200);
  }
});
test('encoded auth endpoint aliases share the same bounded signup budget', async t => {
  const auth={handler:async()=>new Response('{}'),api:{getSession:async()=>null}};
  const app=buildApp(auth,'http://localhost:5173');app.log.level='silent';
  registerAuthRoutes(app,auth,'http://localhost:5173');t.after(()=>app.close());
  for(let i=0;i<5;i++)assert.equal((await app.inject({method:'POST',url:'/api/auth/sign-up/email',payload:{}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/%73ign-up/email',payload:{}})).statusCode,429);
});