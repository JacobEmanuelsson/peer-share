import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createMessageQueue } from '../dist/modules/signaling/signaling.queue.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function options(process, overrides = {}) {
  return { process, onOverflow: () => assert.fail('Unexpected overflow'), onError: error => { throw error; }, ...overrides };
}

test('FIFO awaits each handler and never runs two handlers together', async () => {
  const gate = deferred(), started = [], finished = [];
  let active = 0, maxActive = 0;
  const queue = createMessageQueue(options(async data => {
    active++; maxActive = Math.max(maxActive, active);
    started.push(data.toString());
    if (data.toString() === 'first') await gate.promise;
    finished.push(data.toString()); active--;
  }));
  queue.enqueue(Buffer.from('first'), false);
  queue.enqueue(Buffer.from('second'), false);
  queue.enqueue(Buffer.from('third'), false);
  assert.deepEqual(started, ['first']);
  gate.resolve(); await nextTurn();
  assert.deepEqual(finished, ['first', 'second', 'third']);
  assert.equal(maxActive, 1);
});

for (const limit of ['count', 'bytes']) {
  test(`${limit} overflow includes in-flight work and discards waiting items`, async () => {
    const gate = deferred(), started = [];
    let overflows = 0;
    const queue = createMessageQueue(options(async data => {
      started.push(data.toString()); await gate.promise;
    }, {
      maxMessages: limit === 'count' ? 2 : 10,
      maxBytes: limit === 'bytes' ? 4 : 100,
      onOverflow: () => { overflows++; },
    }));
    assert.equal(queue.enqueue(Buffer.from('aa'), false), true);
    assert.equal(queue.enqueue(Buffer.from('bb'), false), true);
    assert.equal(queue.enqueue(Buffer.from('c'), false), false);
    assert.equal(queue.enqueue(Buffer.from('d'), false), false);
    assert.equal(overflows, 1);
    gate.resolve(); await nextTurn();
    assert.deepEqual(started, ['aa']);
  });
}

test('closing drops pending work and rejects future messages', async () => {
  const gate = deferred(), started = [];
  const queue = createMessageQueue(options(async data => { started.push(data.toString()); await gate.promise; }));
  queue.enqueue(Buffer.from('first'), false);
  queue.enqueue(Buffer.from('discard'), false);
  queue.close(); queue.close();
  assert.equal(queue.enqueue(Buffer.from('late'), false), false);
  gate.resolve(); await nextTurn();
  assert.deepEqual(started, ['first']);
});

test('handler failure closes the queue, reports once, and skips remaining work', async () => {
  const gate = deferred(), failures = [], started = [];
  const queue = createMessageQueue(options(async data => {
    started.push(data.toString()); await gate.promise; throw new Error('Failed');
  }, { onError: error => failures.push(error.message) }));
  queue.enqueue(Buffer.from('first'), false);
  queue.enqueue(Buffer.from('discard'), false);
  gate.resolve(); await nextTurn();
  assert.deepEqual(failures, ['Failed']);
  assert.deepEqual(started, ['first']);
  assert.equal(queue.enqueue(Buffer.from('late'), false), false);
});

test('completed work releases capacity and different queues are independent', async () => {
  const gate = deferred(), received = [];
  const busy = createMessageQueue(options(async () => { await gate.promise; }));
  const free = createMessageQueue(options(async data => { received.push(data.toString()); }, { maxMessages: 1, maxBytes: 1 }));
  busy.enqueue(Buffer.from('blocked'), false);
  assert.equal(free.enqueue(Buffer.from('a'), false), true);
  await nextTurn();
  assert.equal(free.enqueue(Buffer.from('b'), false), true);
  await nextTurn();
  assert.deepEqual(received, ['a', 'b']);
  gate.resolve(); await nextTurn();
});

for (const data of [Buffer.from('å'), [Buffer.from('a'), Buffer.from('b')], new ArrayBuffer(2)]) {
  test('byte accounting covers UTF-8 buffers, buffer arrays, and ArrayBuffers', async () => {
    const gate = deferred(); let overflow = false;
    const queue = createMessageQueue(options(async () => { await gate.promise; }, {
      maxBytes: 2, onOverflow: () => { overflow = true; },
    }));
    assert.equal(queue.enqueue(data, false), true);
    assert.equal(queue.enqueue(Buffer.from('x'), false), false);
    assert.equal(overflow, true);
    gate.resolve(); await nextTurn();
  });
}

test('invalid queue limits fail at construction', () => {
  for (const maxMessages of [0, -1, 1.5, Infinity]) {
    assert.throws(() => createMessageQueue(options(async () => {}, { maxMessages })));
  }
  assert.throws(() => createMessageQueue(options(async () => {}, { maxBytes: 0 })));
});
