import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnectionRegistry } from '../dist/modules/signaling/signaling.connections.js';

// Socket stand-ins: the registry stores references; it performs no network operations.
test('multiple connections for one account have unique IDs and correct sockets', () => {
  const registry = createConnectionRegistry();
  const laptop = {}, phone = {};
  const first = registry.add('alice', 'laptop-session', laptop);
  const second = registry.add('alice', 'phone-session', phone);
  assert.notEqual(first.connectionId, second.connectionId);
  assert.deepEqual(registry.getForUser('alice').map(c => c.socket), [laptop, phone]);
});

test('account lookup isolates connections and cannot mutate registry membership', () => {
  const registry = createConnectionRegistry();
  const alice = registry.add('alice', 'session-a', {});
  registry.add('bob', 'session-b', {});
  const result = registry.getForUser('alice');
  assert.deepEqual(result.map(c => c.connectionId), [alice.connectionId]);
  result.length = 0;
  assert.equal(registry.getForUser('alice').length, 1);
  assert.deepEqual(registry.getForUser('unknown'), []);
});

test('removing one connection preserves other devices and accounts', () => {
  const registry = createConnectionRegistry();
  const first = registry.add('alice', 'session-a', {});
  const second = registry.add('alice', 'session-b', {});
  registry.add('bob', 'session-c', {});
  registry.remove(first.connectionId);
  registry.remove(first.connectionId);
  assert.deepEqual(registry.getForUser('alice').map(c => c.connectionId), [second.connectionId]);
  assert.equal(registry.getForUser('bob').length, 1);
  registry.remove(second.connectionId);
  assert.deepEqual(registry.getForUser('alice'), []);
});
