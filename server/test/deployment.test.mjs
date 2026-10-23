import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { readRuntimeConfig } from '../dist/config/runtime.js';
import { registerClient } from '../dist/http/client.js';
import { buildApp } from '../dist/app.js';

const origin = 'https://peer-share-example.onrender.com';
test('local defaults stay private and Render uses its assigned URL, port and explicit proxy hop', () => {
  assert.deepEqual(readRuntimeConfig({ BETTER_AUTH_URL: 'http://localhost:5173' }), {
    port: 3000, host: '127.0.0.1', trustProxy: false, serveClient: false, baseURL: 'http://localhost:5173',
  });
  assert.deepEqual(readRuntimeConfig({ RENDER_EXTERNAL_URL: origin, NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '10000', SERVE_CLIENT: 'true', TRUST_PROXY_HOPS: '1' }), {
    port: 10000, host: '0.0.0.0', trustProxy: 1, serveClient: true, baseURL: origin,
  });
  assert.equal(readRuntimeConfig({ BETTER_AUTH_URL: 'https://custom.example', RENDER_EXTERNAL_URL: origin }).baseURL, 'https://custom.example');
});
test('invalid listener, proxy and public URL configuration fails before serving', () => {
  for (const options of [{PORT:'0'}, {PORT:'3.5'}, {PORT:'65536'}, {TRUST_PROXY_HOPS:'4'}, {SERVE_CLIENT:'yes'}, {BETTER_AUTH_URL:origin+'/api'}, {BETTER_AUTH_URL:'ftp://example.com'}, {BETTER_AUTH_URL:'https://user:password@example.com'}, {NODE_ENV:'production',BETTER_AUTH_URL:'http://example.com'}]) {
    assert.throws(() => readRuntimeConfig({BETTER_AUTH_URL:origin,...options}));
  }
});
test('production host serves SPA deep links and assets without hiding API errors or exposing private files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'peer-share-host-'));
  await mkdir(join(root,'assets'));
  await writeFile(join(root,'index.html'), '<!doctype html><title>Peer Share</title>');
  await writeFile(join(root,'assets','main-abc123.js'), 'console.log("build")');
  await writeFile(join(root,'.env'), 'PRIVATE_SECRET=must-not-serve');
  const app = Fastify();
  t.after(async () => { await app.close(); await rm(root,{recursive:true,force:true}); });
  app.get('/api/health',async()=>({status:'ok'}));
  app.get('/api/me',async(_request,reply)=>reply.code(401).send({error:'Sign in'}));
  registerClient(app,root);
  for(const url of ['/','/app','/settings','/verify-email?token=example','/reset-password?token=example']) {
    const result=await app.inject({url,headers:{accept:'text/html'}});
    assert.equal(result.statusCode,200,url);
    assert.match(result.headers['content-type'],/text\/html/);
    assert.equal(result.headers['cache-control'],'no-store');
  }
  const asset=await app.inject('/assets/main-abc123.js');
  assert.equal(asset.statusCode,200);
  assert.match(asset.headers['cache-control'],/immutable/);
  assert.equal((await app.inject('/api/me')).statusCode,401);
  assert.deepEqual((await app.inject('/api/health')).json(),{status:'ok'});
  for(const url of ['/api','/api/missing','/assets/missing.js','/.env','/server/.env','/assets/%2e%2e/.env']) {
    const result=await app.inject({url,headers:{accept:'text/html'}});
    assert.ok(result.statusCode>=400,url);
    assert.ok(!result.body.includes('PRIVATE_SECRET'),url);
    assert.ok(!result.body.includes('<title>Peer Share</title>'),url);
  }
  assert.equal((await app.inject({method:'POST',url:'/app'})).statusCode,404);
});
test('configured proxy trusts only the nearest hop, rather than a forged first address', async t => {
  const app=buildApp({},origin,undefined,{trustProxy:1}); app.log.level='silent';
  t.after(()=>app.close());
  app.get('/test-ip',async request=>({ip:request.ip}));
  const result=await app.inject({url:'/test-ip',headers:{'x-forwarded-for':'198.51.100.99, 203.0.113.10'}});
  assert.equal(result.json().ip,'203.0.113.10');
});