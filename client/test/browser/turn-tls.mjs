import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHostedTurnLoader} from '../../../server/dist/modules/auth/turn.provider.js';
const require=createRequire(new URL('../../../server/package.json',import.meta.url));
const {chromium}=require('playwright'),dotenv=require('dotenv');
if(!process.env.TURN_SETUP_PATH)throw new Error('Set TURN_SETUP_PATH to the private provider settings file');
const env=dotenv.parse(fs.readFileSync(process.env.TURN_SETUP_PATH));
if(env.FREE_ONLY_CONFIRMED!=='true')throw new Error('Confirm the free-only relay plan before this test');
const servers=(await createHostedTurnLoader(env)()).map(server=>({...server,urls:server.urls.filter(url=>url.startsWith('turns:'))})).filter(server=>server.urls.length);
assert.ok(servers.length);
const browser=await chromium.launch({channel:'chrome'});
try {
 const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
 for(const [page,initiator]of [[a,true],[b,false]]){
  await page.goto((process.env.TEST_BASE_URL??'http://localhost:3002')+'/login');
  await page.evaluate(({servers,initiator})=>{
   const pc=new RTCPeerConnection({iceServers:servers,iceTransportPolicy:'relay'});
   window.probe={pc,received:[],opened:false};
   const attach=channel=>{window.probe.channel=channel;channel.onopen=()=>{window.probe.opened=true;if(initiator)channel.send('hello-over-tls');};channel.onmessage=event=>{window.probe.received.push(event.data);if(!initiator&&event.data==='hello-over-tls')channel.send('reply-over-tls');};};
   if(initiator)attach(pc.createDataChannel('tls-probe'));else pc.ondatachannel=event=>attach(event.channel);
  },{servers,initiator});
 }
 async function description(page,remote){return page.evaluate(async remote=>{
  const pc=window.probe.pc;if(remote)await pc.setRemoteDescription(remote);
  await pc.setLocalDescription(remote?await pc.createAnswer():await pc.createOffer());
  await new Promise((resolve,reject)=>{if(pc.iceGatheringState==='complete')return resolve();const timeout=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',changed);reject(new Error('TLS relay gathering timed out'));},15000);function changed(){if(pc.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',changed);resolve();}}pc.addEventListener('icegatheringstatechange',changed);});
  return pc.localDescription.toJSON();
 },remote);}
 const offer=await description(a);const answer=await description(b,offer);await a.evaluate(answer=>window.probe.pc.setRemoteDescription(answer),answer);
 await a.waitForFunction(()=>window.probe.received.includes('reply-over-tls'),{},{timeout:20000});
 for(const page of [a,b]){
  const relay=await page.evaluate(async()=>{const reports=await window.probe.pc.getStats();for(const report of reports.values())if(report.type==='transport'&&report.selectedCandidatePairId){const pair=reports.get(report.selectedCandidatePairId);return reports.get(pair.localCandidateId)?.candidateType==='relay';}return false;});assert.equal(relay,true);
 }
 console.log('PASS public TURN over TLS: only turns: endpoints allowed; selected relay on both peers and bidirectional DataChannel delivery');
}finally{await browser.close();}
