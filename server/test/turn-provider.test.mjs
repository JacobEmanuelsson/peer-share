import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify from 'fastify';
import {createHostedTurnLoader} from '../dist/modules/auth/turn.provider.js';
import {registerIceRoutes} from '../dist/modules/auth/ice.js';
const env={METERED_APP_NAME:'peer-share-test',METERED_TURN_API_KEY:'backend-only-api-key'};
const servers=[{urls:'turn:standard.relay.metered.ca:80',username:'temporary-user',credential:'temporary-password',debug:env.METERED_TURN_API_KEY}];

test('hosted TURN is optional, rejects incomplete configuration and fixes the provider host',()=>{
 assert.equal(createHostedTurnLoader({}),null);
 for(const settings of [{METERED_APP_NAME:'x'}, {METERED_TURN_API_KEY:'key'}, {...env,METERED_APP_NAME:'evil.example/path'}, {...env,TURN_URLS:'turn:local'}, {...env,TURN_SHARED_SECRET:'x'.repeat(32)}]) {
  assert.throws(()=>createHostedTurnLoader(settings));
 }
});
test('hosted credential requests are deduplicated, cached, normalized and stripped of provider-only fields',async()=>{
 let calls=0,now=1000;
 const load=createHostedTurnLoader(env,{clock:()=>now,request:async(url,options)=>{
  calls++;assert.equal(url.origin,'https://peer-share-test.metered.live');assert.equal(url.searchParams.get('apiKey'),env.METERED_TURN_API_KEY);
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  return new Response(JSON.stringify(servers));
 }});
 const [first,second]=await Promise.all([load(),load()]);assert.equal(calls,1);assert.deepEqual(first,second);
 assert.deepEqual(first,[{urls:['turn:standard.relay.metered.ca:80'],username:'temporary-user',credential:'temporary-password'}]);
 assert.ok(!JSON.stringify(first).includes(env.METERED_TURN_API_KEY));await load();assert.equal(calls,1);
 now+=300001;await load();assert.equal(calls,2);
});
test('provider errors, malformed responses and missing credentials fail without leaking keys or URLs',async()=>{
 for(const request of [async()=>new Response('denied',{status:403}),async()=>new Response('{'),async()=>new Response(JSON.stringify([{urls:'turn:x'}])),async()=>new Response(JSON.stringify([{urls:'https://evil.example'}])),async()=>{throw new Error('https://provider/?apiKey='+env.METERED_TURN_API_KEY);}]) {
  const load=createHostedTurnLoader(env,{request});
  await assert.rejects(load(),error=>error.message==='TURN provider unavailable'&&!JSON.stringify(error).includes(env.METERED_TURN_API_KEY));
 }
});
test('provider failure is retried rather than caching an error',async()=>{
 let calls=0;const load=createHostedTurnLoader(env,{request:async()=>++calls===1?new Response('',{status:503}):new Response(JSON.stringify(servers))});
 await assert.rejects(load());await load();assert.equal(calls,2);
});
test('private ICE route does not contact provider until session verification, and returns sanitized 503 on outage',async t=>{
 let calls=0,available=true;
 const app=Fastify();t.after(()=>app.close());
 const auth={api:{getSession:async({headers})=>headers.get('cookie')==='verified'?{user:{emailVerified:true}}:null}};
 registerIceRoutes(app,auth,{...env,ICE_RELAY_ONLY:'true'},{request:async()=>{calls++;return available?new Response(JSON.stringify(servers)):new Response('secret-response',{status:503});},clock:()=>available?0:400000});
 assert.equal((await app.inject('/api/ice')).statusCode,401);assert.equal(calls,0);
 const response=await app.inject({url:'/api/ice',headers:{cookie:'verified'}});assert.equal(response.statusCode,200);
 assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.json().relayAvailable,true);assert.equal(response.json().iceTransportPolicy,'relay');
 assert.ok(!response.body.includes(env.METERED_TURN_API_KEY));
 available=false;const failed=await app.inject({url:'/api/ice',headers:{cookie:'verified'}});
 assert.equal(failed.statusCode,503);assert.ok(!failed.body.includes('secret-response'));assert.equal(failed.headers['cache-control'],'no-store');
});