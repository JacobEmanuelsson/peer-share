import { firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';
const engine = process.argv[2] ?? 'firefox';
const browser = await ({firefox,webkit}[engine]).launch();
try {
 const page = await browser.newPage(); await page.goto('http://localhost:5173');
 const result = await page.evaluate(async () => {
  const {createTemporaryFile} = await import('/src/webrtc/temporaryFile.ts');
  const {createSHA256, hashFile} = await import('/src/webrtc/incrementalHash.ts');
  const sink=await createTemporaryFile(1024**3), hash=await createSHA256();hash.init();
  const chunk=new Uint8Array(16*1024).fill(71);
  try{
   for(let i=0;i<65536;i++){await sink.write(chunk.buffer);hash.update(chunk);}
   const blob=await sink.finish();
   const expected=hash.digest('hex'), actual=await hashFile(blob,()=>false);
   const size=blob.size;
   await sink.dispose();
   const root=await navigator.storage.getDirectory(), dir=await root.getDirectoryHandle('peer-share-transfers');
   const entries=[];for await(const entry of dir.keys())entries.push(entry);
   return {size,expected,actual,remaining:entries.length,rtc:typeof RTCPeerConnection};
  } finally {await sink.dispose();}
 });
 assert.equal(result.size,1024**3);assert.equal(result.expected,result.actual);assert.equal(result.remaining,0);
 console.log('PASS disk storage, incremental hashing, cleanup',engine,browser.version(),result);
} finally {await browser.close();}
