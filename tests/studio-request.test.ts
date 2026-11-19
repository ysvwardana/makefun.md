import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStudioRequestGuard } from '../src/lib/studio-request';

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

test('late Studio responses cannot commit after A → B → A', async () => {
  const guard = createStudioRequestGuard('a');
  const accepted: string[] = [];
  const oldRequests = ['context', 'enhance', 'save', 'manual', 'reuse'].map((slot) => {
    const request = guard.begin(slot, 'a')!;
    const response = deferred();
    const completion = response.promise.then((value) => {
      if (request.isCurrent()) accepted.push(value);
      assert.equal(request.finish(), false);
    });
    return { request, response, completion };
  });

  guard.select('b');
  assert.equal(guard.begin('context', 'a'), null);
  const intermediate = guard.begin('context', 'b')!;
  guard.select('a');
  assert.equal(intermediate.signal.aborted, true);
  const current = guard.begin('context', 'a')!;

  for (const { request, response } of oldRequests) {
    assert.equal(request.signal.aborted, true);
    response.resolve('old response from a');
  }
  await Promise.all(oldRequests.map(({ completion }) => completion));
  assert.deepEqual(accepted, []);
  assert.equal(current.isCurrent(), true);
  assert.equal(current.finish(), true);
  assert.equal(guard.isPending('context'), false);
});

test('replacing a request only invalidates that slot and protects the new pending state', () => {
  const guard = createStudioRequestGuard('a');
  const previous = guard.begin('context')!;
  const manual = guard.begin('manual')!;
  const current = guard.begin('context')!;

  assert.equal(previous.signal.aborted, true);
  assert.equal(previous.finish(), false);
  assert.equal(guard.isPending('context'), true);
  assert.equal(manual.isCurrent(), true);
  assert.equal(guard.select('a'), false);
  assert.equal(current.isCurrent(), true);

  guard.invalidate();
  assert.equal(current.signal.aborted, true);
  assert.equal(manual.signal.aborted, true);
  assert.equal(guard.begin('context', 'a')?.isCurrent(), true);
});
