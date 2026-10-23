import {chromium,firefox} from 'playwright';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyTestAccount} from './verify-account.mjs';
const require=createRequire(new URL('../../../server/package.json',import.meta.url));
const {MongoClient}=require('mongodb');require('dotenv').config({path:new URL('../../../server/.env',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),quiet:true});
const base=process.env.TEST_BASE_URL??'http://localhost:5173', run=Date.now();
const accounts=[0,1].map(i=>({email:`release-${run}-${i}@example.invalid`,name:'Release Test '+i,password:randomBytes(18).toString('base64url')}));
const engine=process.env.TEST_BROWSER??'chrome';
const browser=await (engine==='firefox'?firefox:chromium).launch(engine==='firefox'?{firefoxUserPrefs:{'media.peerconnection.ice.loopback':true,'media.peerconnection.ice.obfuscate_host_addresses':false}}:{channel:engine==='edge'?'msedge':'chrome'}), contexts=[],errors=[];
console.log('Browser',engine,browser.version());
const mailbox=[];
async function login(page,account){
 await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(base+'/app');
 await page.getByText('Ready to connect',{exact:true}).waitFor();
}
async function signup(account){
 const context=await browser.newContext();contexts.push(context);
 await context.addInitScript(() => {
   const Original=window.RTCPeerConnection;window.__peers=[];
   window.RTCPeerConnection=class extends Original {constructor(...args){super(...args);window.__peers.push(this);}};
 });
 if(process.env.FORCE_RELAY==='1') await context.route('**/api/ice',async route=>{
   const response=await route.fetch();
   if(!response.ok()){await route.fulfill({response});return;}
   const json=await response.json();assert.equal(json.relayAvailable,true);
   await route.fulfill({response,json:{...json,iceTransportPolicy:'relay'}});
 });const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/sign-up');await page.getByLabel('Name',{exact:true}).fill(account.name);await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Create account',exact:true}).click();await page.waitForURL(/verify-email/);
 assert.equal((await page.request.get(base+'/api/me')).status(),401);
 mailbox.push(await verifyTestAccount(account.email,page));await login(page,account);return page;
}
async function social(page,path,method='GET',data){
 const response=await page.request.fetch(base+path,{method,headers:{origin:base},...(data!==undefined?{data}:method==='POST'?{data:{}}:{})});
 if(!response.ok())throw new Error(path+' returned '+response.status()+' '+await response.text());return response.json();
}
async function pair(a,b){
 const id=(await (await b.request.get(base+'/api/me')).json()).user.id;
 await a.getByLabel('Recipient account ID').fill(id);await a.getByRole('button',{name:'Invite',exact:true}).click();await b.getByRole('button',{name:'Accept invitation',exact:true}).last().click();
 await a.getByText('Direct connection established',{exact:true}).waitFor();await b.getByText('Direct connection established',{exact:true}).waitFor();return id;
}
try{
 const a=await signup(accounts[0]),b=await signup(accounts[1]);
 for (const context of contexts) {
   const cookie = (await context.cookies()).find(cookie => cookie.name.includes('session_token'));
   assert.ok(cookie); assert.equal(cookie.httpOnly, true);
   if(base.startsWith('https:')) assert.equal(cookie.secure, true);
 }
 const aId=(await(await a.request.get(base+'/api/me')).json()).user.id,bId=await pair(a,b);
 if(process.env.FORCE_RELAY==='1'){
   for(const page of [a,b]){
     const relay=await page.evaluate(async()=>{
       for(const pc of window.__peers){const stats=await pc.getStats();for(const report of stats.values())if(report.type==='candidate-pair'&&report.state==='succeeded'){const local=stats.get(report.localCandidateId);if(local?.candidateType==='relay')return true;}}
       return false;
     });
     assert.equal(relay,true);
   }
   console.log('PASS selected ICE candidate uses the authenticated TURN relay on both peers');
 }
 console.log('PASS verified signup, protected routes, login and public-origin WebSockets',base);
 await a.getByLabel('File to send').setInputFiles({name:'cancel.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(16*1024*1024,29)});
 await a.getByRole('button',{name:'Send file',exact:true}).click();await b.getByRole('button',{name:'Accept file',exact:true}).click();
 await a.getByRole('button',{name:'Cancel sending',exact:true}).click();await a.getByText(/Sending cancel.bin: cancelled/).waitFor();
 await b.getByText(/Receiving cancel.bin: cancelled/).waitFor();
 assert.equal(await b.getByRole('link',{name:/Download cancel.bin/}).count(),0);
 const payload=Buffer.from('Verified retry after cancellation');
 await a.getByLabel('File to send').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:payload});await a.getByRole('button',{name:'Send file',exact:true}).click();await b.getByRole('button',{name:'Accept file',exact:true}).click();
 const link=b.getByRole('link',{name:'Download retry.txt (verified)',exact:true});await link.waitFor();
 const downloading=b.waitForEvent('download');await link.click();const download=await downloading;const hash=createHash('sha256');for await(const chunk of await download.createReadStream())hash.update(chunk);
 assert.equal(hash.digest('hex'),createHash('sha256').update(payload).digest('hex'));
 console.log('PASS cancel in-flight file, clean receive, retry and verified download without reconnect');
 await social(a,'/api/friends','POST',{recipientId:bId});const request=(await social(b,'/api/social')).friends[0];await social(b,'/api/friends/'+request.id+'/accept','POST');
 const group=await social(a,'/api/groups','POST',{name:'Release cleanup',memberIds:[bId]});
 await social(a,'/api/blocks','POST',{recipientId:bId});await a.getByText('Signaling: disconnected',{exact:true}).waitFor();await b.getByText('Signaling: disconnected',{exact:true}).waitFor();
 assert.equal((await social(a,'/api/social')).friends.length,0);
 assert.equal((await b.request.post(base+'/api/friends',{headers:{origin:base},data:{recipientId:aId}})).status(),404);
 await social(a,'/api/blocks/'+bId,'DELETE');
 assert.equal((await social(a,'/api/social')).blocks.length,0);
 console.log('PASS blocking removes friendship, closes active sockets, denies reverse request and permits unblock');
 await a.getByRole('button',{name:'Reconnect',exact:true}).click();await b.getByRole('button',{name:'Reconnect',exact:true}).click();await a.getByText('Ready to connect',{exact:true}).waitFor();await b.getByText('Ready to connect',{exact:true}).waitFor();
 console.log('PASS reconnect controls without page refresh');
 const recovery=await contexts[0].newPage();await recovery.goto(base+'/forgot-password');await recovery.getByLabel('Email',{exact:true}).fill(accounts[0].email);await recovery.getByRole('button',{name:'Send reset email',exact:true}).click();await recovery.getByText(/If that account exists/).waitFor();
 let reset;
 for(let i=0;i<100&&!reset;i++){
  const list=await(await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
  const msg=list.messages.find(m=>m.To.some(to=>to.Address===accounts[0].email)&&/Reset/.test(m.Subject));
  if(msg){mailbox.push(msg.ID);reset=(await(await fetch('http://127.0.0.1:8025/api/v1/message/'+msg.ID)).json()).Text.match(/https?:[^\s]+/)[0];}else await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(reset);await recovery.goto(reset);const password=randomBytes(18).toString('base64url');await recovery.getByLabel('New password',{exact:true}).fill(password);await recovery.getByRole('button',{name:'Reset password',exact:true}).click();await recovery.waitForURL(/login\?reset=1/);
 assert.equal((await a.request.get(base+'/api/me')).status(),401);accounts[0].password=password;await login(a,accounts[0]);console.log('PASS password reset email, reset form, session revocation and new-password login');
 await a.goto(base+'/settings');const changed=randomBytes(18).toString('base64url');
 await a.getByLabel('Current password',{exact:true}).fill(password);await a.getByLabel('New password',{exact:true}).fill(changed);await a.getByRole('button',{name:'Update password',exact:true}).click();await a.getByText('Password updated. Other sessions have been revoked.').waitFor();
 await a.getByLabel('Password to delete account',{exact:true}).fill(changed);await a.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');await a.getByRole('button',{name:'Delete my account',exact:true}).click();await a.waitForURL(/login\?deleted=1/);
 assert.equal((await social(b,'/api/social')).groups.some(item=>item.id===group.id),false);
 console.log('PASS password change, password-confirmed account deletion and owned-group cleanup');
 assert.deepEqual(errors,[]);console.log('PASS no browser page errors');
}finally{
 await browser.close();for(const context of contexts)await context.close().catch(()=>{});
 const client=new MongoClient(process.env.DATABASE_URL);try{await client.connect();const db=client.db();const users=await db.collection('user').find({email:{$in:accounts.map(x=>x.email)}}).toArray(),ids=users.flatMap(u=>[u._id,u._id.toString()]);
 await db.collection('friendships').deleteMany({members:{$in:ids}});await db.collection('sharing_groups').deleteMany({ownerId:{$in:ids}});await db.collection('user_blocks').deleteMany({$or:[{actor:{$in:ids}},{target:{$in:ids}}]});await db.collection('session').deleteMany({userId:{$in:ids}});await db.collection('account').deleteMany({userId:{$in:ids}});await db.collection('user').deleteMany({email:{$in:accounts.map(x=>x.email)}});
 }finally{await client.close();}
 if(mailbox.length)await fetch('http://127.0.0.1:8025/api/v1/messages',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:mailbox})}).catch(()=>{});
 console.log('Temporary test accounts and captured account emails cleaned up');
}
