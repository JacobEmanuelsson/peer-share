import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedConnectionRoute } from '../src/webrtc/connectionRoute.ts';
function reports(local,remote,selected='chosen') {
 return new Map([
  ['transport',{type:'transport',selectedCandidatePairId:selected}],
  ['chosen',{type:'candidate-pair',state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote'}],
  ['local',{candidateType:local}],['remote',{candidateType:remote}],
  ['unused-relay',{candidateType:'relay'}],
 ]);
}
test('only a selected relay on either side reports TURN',()=>{
 assert.equal(selectedConnectionRoute(reports('host','srflx')),'direct');
 assert.equal(selectedConnectionRoute(reports('relay','host')),'relay');
 assert.equal(selectedConnectionRoute(reports('host','relay')),'relay');
});
test('missing stats are unknown and nominated pair fallback works without a transport report',()=>{
 assert.equal(selectedConnectionRoute(new Map()),'unknown');
 assert.equal(selectedConnectionRoute(reports(undefined,'host')),'unknown');
 const stats=reports('srflx','host');stats.delete('transport');
 assert.equal(selectedConnectionRoute(stats),'unknown');
 stats.get('chosen').nominated=true;
 assert.equal(selectedConnectionRoute(stats),'direct');
});