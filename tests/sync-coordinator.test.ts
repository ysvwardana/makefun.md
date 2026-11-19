import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncCoordinator } from '../server/sync-coordinator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    callbacks,
    delays,
    setTimeout(callback: () => void, delayMs: number) {
      const id = ++nextId;
      callbacks.set(id, callback);
      delays.push(delayMs);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { callbacks.delete(timer as unknown as number); },
    fireNext() {
      const row = callbacks.entries().next().value as [number, () => void] | undefined;
      assert.ok(row, 'expected scheduled callback');
      callbacks.delete(row[0]);
      row[1]();
    },
  };
}

test('coordinator single-flights callers and records successful attempt status', async () => {
  const pending = deferred<{ ok: boolean }>();
  const persisted: Array<{ running: boolean; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null }> = [];
  let calls = 0;
  let instant = 0;
  const coordinator = createSyncCoordinator({
    sync: () => { calls += 1; return pending.promise; },
    getIntervalMinutes: () => 1,
    now: () => new Date(1_000 + instant++ * 1_000),
    persistStatus: (value) => { persisted.push(value); },
  });
  const first = coordinator.run();
  const second = coordinator.run();
  assert.equal(first, second);
  assert.equal(calls, 0, 'sync starts after current microtask');
  assert.equal(coordinator.getStatus().running, true);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(coordinator.getStatus().running, false);
  assert.equal(coordinator.getStatus().lastAttemptAt, '1970-01-01T00:00:01.000Z');
  assert.equal(coordinator.getStatus().lastSuccessAt, '1970-01-01T00:00:02.000Z');
  assert.equal(coordinator.getStatus().lastError, null);
  assert.ok(persisted.length >= 2);
});

test('coordinator captures errors and treats returned error result as failure', async () => {
  let attempt = 0;
  const coordinator = createSyncCoordinator({
    sync: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return { error: 'upstream rejected sync' };
    },
    getIntervalMinutes: () => 3,
  });
  await assert.rejects(coordinator.run(), /network down/);
  assert.equal(coordinator.getStatus().lastError, 'network down');
  const previousSuccess = coordinator.getStatus().lastSuccessAt;
  await assert.rejects(coordinator.run(), /upstream rejected sync/);
  assert.equal(coordinator.getStatus().lastError, 'upstream rejected sync');
  assert.equal(coordinator.getStatus().lastSuccessAt, previousSuccess);
  assert.equal(coordinator.getStatus().running, false);
});

test('start/reschedule read the interval dynamically and stop clears the scheduled timer', () => {
  const timers = fakeTimers();
  let interval = 2;
  const coordinator = createSyncCoordinator({
    sync: async () => ({ ok: true }),
    getIntervalMinutes: () => interval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  coordinator.start();
  assert.equal(timers.delays.at(-1), 120_000);
  interval = 5;
  coordinator.reschedule();
  assert.equal(timers.delays.at(-1), 300_000);
  assert.equal(timers.callbacks.size, 1);
  coordinator.stop();
  assert.equal(timers.callbacks.size, 0);
});

test('distinct sync keys queue without overlap while identical keys share a promise', async () => {
  const timers = fakeTimers();
  const first = deferred<{ key: string }>();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const coordinator = createSyncCoordinator({
    sync: async () => {
      calls += 1; active += 1; maxActive = Math.max(maxActive, active);
      await (calls === 1 ? first.promise : Promise.resolve({ key: 'second' }));
      active -= 1;
      return { key: String(calls) };
    },
    getIntervalMinutes: () => 1,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const one = coordinator.run();
  const same = coordinator.run();
  assert.equal(one, same);
  await Promise.resolve();
  first.resolve({ key: 'first' });
  assert.deepEqual(await one, { key: '1' });
  const next = coordinator.run();
  assert.deepEqual(await next, { key: '2' });
  assert.equal(maxActive, 1);
});

test('scheduled callback runs sync and schedules the next interval', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const coordinator = createSyncCoordinator({
    sync: async () => { calls += 1; return { ok: true }; },
    getIntervalMinutes: () => 1,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  coordinator.start();
  timers.fireNext();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(timers.callbacks.size, 1);
  coordinator.stop();
});
