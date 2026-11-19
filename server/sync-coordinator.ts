import type { GlobalSyncStatus } from '../src/types/command-center.ts';

type SyncFunction = () => Promise<unknown>;
type Timer = ReturnType<typeof setTimeout>;

export interface SyncCoordinatorOptions {
  sync: SyncFunction;
  getIntervalMinutes: () => number;
  persistStatus?: (status: GlobalSyncStatus) => void | Promise<void>;
  now?: () => Date;
  setTimeout?: (callback: () => void, delayMs: number) => Timer;
  clearTimeout?: (timer: Timer) => void;
}

export interface SyncCoordinator {
  run(): Promise<unknown>;
  start(): void;
  reschedule(): void;
  stop(): void;
  getStatus(): GlobalSyncStatus;
}

/** Scheduler and single-flight guard; all timer and clock operations are injectable for tests. */
export function createSyncCoordinator(options: SyncCoordinatorOptions): SyncCoordinator {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  let timer: Timer | null = null;
  let active = false;
  let inFlight: Promise<unknown> | null = null;
  let lastAttemptAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;

  const status = (): GlobalSyncStatus => ({ running: inFlight !== null, lastAttemptAt, lastSuccessAt, lastError });
  const persist = () => { void Promise.resolve(options.persistStatus?.(status())).catch(() => undefined); };
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    cancelTimer();
    if (!active) return;
    const interval = Number(options.getIntervalMinutes());
    const delay = Number.isFinite(interval) && interval > 0 ? Math.max(1, interval * 60_000) : 60_000;
    timer = setTimer(() => {
      timer = null;
      void run().catch(() => undefined).finally(() => schedule());
    }, delay);
  };

  const run = (): Promise<unknown> => {
    if (inFlight) return inFlight;
    lastAttemptAt = now().toISOString();
    lastError = null;
    persist();
    const current = Promise.resolve().then(options.sync).then((result) => {
      if (result && typeof result === 'object' && 'error' in result && (result as { error?: unknown }).error) {
        throw new Error(String((result as { error: unknown }).error));
      }
      lastSuccessAt = now().toISOString();
      lastError = null;
      return result;
    }).catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => {
      if (inFlight === current) inFlight = null;
      persist();
    });
    inFlight = current;
    return current;
  };

  const coordinator: SyncCoordinator = {
    run,
    start() {
      active = true;
      schedule();
    },
    reschedule() {
      if (active) schedule();
    },
    stop() {
      active = false;
      cancelTimer();
    },
    getStatus: status,
  };
  return coordinator;
}
