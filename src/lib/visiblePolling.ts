export type VisiblePollingEnvironment = {
  now: () => number;
  isVisible: () => boolean;
  schedule: (callback: () => void, delayMs: number) => () => void;
  subscribe: (callback: () => void) => () => void;
};

type VisiblePollingOptions = {
  refresh: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  initialDelayMs?: number;
  scheduleInitial?: (callback: () => void) => () => void;
  timeoutMs?: number;
  maxBackoffMs?: number;
};

function browserEnvironment(): VisiblePollingEnvironment {
  return {
    now: Date.now,
    isVisible: () => document.visibilityState !== "hidden",
    schedule: (callback, delayMs) => {
      const timer = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(timer);
    },
    subscribe: (callback) => {
      document.addEventListener("visibilitychange", callback);
      window.addEventListener("focus", callback);
      window.addEventListener("pageshow", callback);
      return () => {
        document.removeEventListener("visibilitychange", callback);
        window.removeEventListener("focus", callback);
        window.removeEventListener("pageshow", callback);
      };
    },
  };
}

/** Poll only while visible, with one in-flight request and bounded failure backoff.
 * Callers must check the signal before publishing results, including cache writes.
 * An abort-ignoring loader is never overlapped by a second request.
 */
export function startVisiblePolling(
  options: VisiblePollingOptions,
  environment: VisiblePollingEnvironment = browserEnvironment(),
) {
  const intervalMs = Math.max(1, options.intervalMs);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 20_000);
  const maxBackoffMs = Math.max(intervalMs, options.maxBackoffMs ?? 5 * intervalMs);
  let stopped = false;
  let initial = true;
  let failures = 0;
  let nextDueAt = environment.now() + Math.max(0, options.initialDelayMs ?? 0);
  let cancelScheduled: (() => void) | undefined;
  let active: { controller: AbortController; cancelTimeout: () => void; suspended: boolean } | undefined;

  const cancelPending = () => {
    cancelScheduled?.();
    cancelScheduled = undefined;
  };

  const scheduleNext = () => {
    cancelPending();
    if (stopped || active || !environment.isVisible()) return;
    const refresh = () => { void run(); };
    cancelScheduled = initial && options.scheduleInitial
      ? options.scheduleInitial(refresh)
      : environment.schedule(refresh, Math.max(0, nextDueAt - environment.now()));
  };

  const run = async () => {
    cancelPending();
    if (stopped || active || !environment.isVisible()) return;
    initial = false;
    const controller = new AbortController();
    let timedOut = false;
    const request = {
      controller,
      suspended: false,
      cancelTimeout: environment.schedule(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs),
    };
    active = request;
    let failed = false;
    try {
      await options.refresh(controller.signal);
    } catch {
      failed = true;
    } finally {
      request.cancelTimeout();
      active = undefined;
      if (stopped) return;
      if (request.suspended) {
        // Resume immediately once the cancelled request has actually settled.
        nextDueAt = environment.now();
      } else {
        failures = failed || timedOut ? failures + 1 : 0;
        const delayMs = Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(failures, 8));
        nextDueAt = environment.now() + delayMs;
      }
      scheduleNext();
    }
  };

  const unsubscribe = environment.subscribe(() => {
    if (stopped) return;
    if (!environment.isVisible()) {
      cancelPending();
      if (active) {
        active.suspended = true;
        active.cancelTimeout();
        active.controller.abort();
      }
      return;
    }
    // Repeated focus/visibility events neither bypass freshness nor add requests.
    scheduleNext();
  });
  scheduleNext();

  return () => {
    stopped = true;
    cancelPending();
    unsubscribe();
    active?.cancelTimeout();
    active?.controller.abort();
  };
}
