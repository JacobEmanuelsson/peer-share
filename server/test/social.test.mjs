import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { createSocialService } from '../dist/modules/social/social.service.js';
import { registerSocialRoutes } from '../dist/modules/social/social.routes.js';

function fixture() {
  const friends = new Map(), groups = new Map(), blocks = new Set();
  const profiles = ['a', 'b', 'c', 'eve'].map(id => ({ id, name: 'Person ' + id }));
  const repo = {
    listBlocks: async actor => [...blocks].map(key => JSON.parse(key)).filter(([a]) => a === actor).map(([actor, target]) => ({actor,target})),
    isBlocked: async (a,b) => blocks.has(JSON.stringify([a,b])) || blocks.has(JSON.stringify([b,a])),
    block: async (a,b) => { blocks.add(JSON.stringify([a,b])); for (const [id,f] of friends) if (f.members.includes(a) && f.members.includes(b)) friends.delete(id); },
    unblock: async (a,b) => { blocks.delete(JSON.stringify([a,b])); },
    removeAccount: async actor => { for(const [id,f] of friends) if(f.members.includes(actor))friends.delete(id); for(const [id,g]of groups)if(g.ownerId===actor)groups.delete(id);else g.memberIds=g.memberIds.filter(x=>x!==actor); },
    profiles: async ids => profiles.filter(user => ids.includes(user.id)),
    listFriends: async id => [...friends.values()].filter(friend => friend.members.includes(id)),
    getFriend: async id => friends.get(id),
    addFriend: async friend => { if ([...friends.values()].some(other => other.pairKey === friend.pairKey)) return false; friends.set(friend._id, friend); return true; },
    acceptFriend: async (id, actor) => { const f = friends.get(id); if (!f || f.recipientId !== actor || f.status !== 'pending') return false; f.status = 'accepted'; return true; },
    removeFriend: async (id, actor) => { const f = friends.get(id); return Boolean(f?.members.includes(actor) && friends.delete(id)); },
    listGroups: async actor => [...groups.values()].filter(group => group.memberIds.includes(actor)),
    getGroup: async id => groups.get(id),
    addGroup: async group => { groups.set(group._id, group); },
    removeGroup: async (id, actor) => groups.get(id)?.ownerId === actor && groups.delete(id),
    leaveGroup: async (id, actor) => { const g = groups.get(id); if (!g || g.ownerId === actor || !g.memberIds.includes(actor)) return false; g.memberIds = g.memberIds.filter(id => id !== actor); return true; },
  };
  return { service: createSocialService(repo), friends, groups };
}
test('friendships require recipient acceptance and enforce participant-only changes', async () => {
  const { service, friends } = fixture();
  await assert.rejects(service.requestFriend('a', 'a'), /yourself/);
  await assert.rejects(service.requestFriend('a', 'missing'), /unavailable/);
  await service.requestFriend('a', 'b');
  const [id] = friends.keys();
  await assert.rejects(service.requestFriend('b', 'a'), /already exists/);
  await assert.rejects(service.acceptFriend('a', id), /unavailable/);
  await assert.rejects(service.acceptFriend('eve', id), /unavailable/);
  await assert.rejects(service.removeFriend('eve', id), /unavailable/);
  await service.acceptFriend('b', id);
  assert.equal((await service.list('a')).friends[0].status, 'accepted');
  assert.equal((await service.list('eve')).friends.length, 0);
  await service.removeFriend('b', id);
  assert.equal((await service.list('a')).friends.length, 0);
});
test('groups contain accepted friends only, isolate outsiders and notify on access removal', async () => {
  const { service, friends } = fixture();
  const changed = [];
  const stop = service.onGroupAccessChanged(event => changed.push(event));
  await service.requestFriend('a', 'b');
  await assert.rejects(service.createGroup('a', 'Work', ['b']), /accepted friends/);
  await service.acceptFriend('b', [...friends.keys()][0]);
  for (const members of [[], ['a'], ['b', 'b'], ['b', 'c'], ['b','c','d','e','f','g']]) {
    await assert.rejects(service.createGroup('a', 'Work', members));
  }
  const { id } = await service.createGroup('a', 'Work', ['b']);
  assert.deepEqual((await service.groupForMember(id, 'b')).memberIds, ['a', 'b']);
  await assert.rejects(service.groupForMember(id, 'eve'), /unavailable/);
  assert.equal((await service.list('eve')).groups.length, 0);
  await assert.rejects(service.deleteGroup('b', id), /owner/);
  await assert.rejects(service.leaveGroup('a', id), /owner/);
  await service.leaveGroup('b', id);
  await assert.rejects(service.groupForMember(id, 'b'), /unavailable/);
  assert.deepEqual(changed, [{ groupId: id, userId: 'b' }]);
  await service.deleteGroup('a', id);
  assert.deepEqual(changed[1], { groupId: id });
  stop();
});

test('social routes fail closed, require mutation origin and reject forged actors', async t => {
  const { service } = fixture();
  const app = Fastify(); t.after(() => app.close());
  const calls = [];
  const auth = { api: { getSession: async args => { calls.push(args); return args.headers.get('cookie') === 'valid' ? { user: { emailVerified: true, id: 'a' } } : null; } } };
  await app.register(async instance => registerSocialRoutes(instance, auth, service, 'http://localhost:5173'));
  for (const url of ['/api/social', '/api/friends', '/api/groups']) {
    const response = await app.inject({ method: url === '/api/social' ? 'GET' : 'POST', url, headers: { origin: 'http://localhost:5173' }, ...(url !== '/api/social' ? { payload: {} } : {}) });
    assert.equal(response.statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/friends', headers: { cookie: 'valid', origin: 'https://evil.invalid' }, payload: { recipientId: 'b' } })).statusCode, 403);
  for (const payload of [{ recipientId: 'b', userId: 'eve' }, { recipientId: { $ne: null } }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/friends', headers: { cookie: 'valid', origin: 'http://localhost:5173' }, payload })).statusCode, 400);
  }
  const response = await app.inject({ url: '/api/social', headers: { cookie: 'valid' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(calls.every(call => call.query.disableCookieCache && call.query.disableRefresh));
  assert.equal((await app.inject({ method: 'POST', url: '/api/friends/' + randomUUID() + '/accept', headers: { cookie: 'valid', origin: 'http://localhost:5173' } })).statusCode, 404);
});
test('blocking removes friendship, prevents connections in both directions, and unblocking does not restore friendship', async () => {
  const {service,friends} = fixture(); const events=[];
  service.onUserAccessChanged(ids=>events.push(ids));
  await service.requestFriend('a','b'); await service.acceptFriend('b',[...friends.keys()][0]);
  await service.block('a','b');
  assert.equal(friends.size,0);
  assert.equal(await service.canConnect('a','b'),false);assert.equal(await service.canConnect('b','a'),false);
  await assert.rejects(service.requestFriend('b','a'),/unavailable/);
  assert.equal((await service.list('a')).blocks[0].id,'b');
  assert.deepEqual(events,[['a','b']]);
  await service.unblock('a','b');assert.equal(await service.canConnect('a','b'),true);assert.equal(friends.size,0);
});
test('account cleanup deletes owned groups and removes membership before access revocation', async () => {
  const {service,friends,groups}=fixture();const events=[];
  service.onGroupAccessChanged(event=>events.push(event));
  await service.requestFriend('a','b');await service.acceptFriend('b',[...friends.keys()][0]);
  const {id}=await service.createGroup('a','Owned',['b']);
  await service.removeAccount('a');
  assert.equal(friends.size,0);assert.equal(groups.size,0);
  assert.deepEqual(events,[{groupId:id}]);
});