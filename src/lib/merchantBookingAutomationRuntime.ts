import { runMerchantBookingAutomationForAllSites } from "./merchantBookings.server";

const DEFAULT_AUTOMATION_INTERVAL_MS = 60_000;
const STARTED_KEY = "__merchantBookingAutomationRuntimeStarted";
const RUNNING_KEY = "__merchantBookingAutomationRuntimeRunning";
const TIMER_KEY = "__merchantBookingAutomationRuntimeTimer";
const LAST_STARTED_AT_KEY = "__merchantBookingAutomationRuntimeLastStartedAt";
const LAST_COMPLETED_AT_KEY = "__merchantBookingAutomationRuntimeLastCompletedAt";
const LAST_SUCCESS_AT_KEY = "__merchantBookingAutomationRuntimeLastSuccessAt";
const LAST_ERROR_AT_KEY = "__merchantBookingAutomationRuntimeLastErrorAt";
const LAST_ERROR_MESSAGE_KEY = "__merchantBookingAutomationRuntimeLastErrorMessage";
const LAST_RESULT_KEY = "__merchantBookingAutomationRuntimeLastResult";

function readAutomationIntervalMs() {
  const raw = Number.parseInt(String(process.env.MERCHANT_BOOKING_AUTOMATION_INTERVAL_MS ?? "").trim(), 10);
  if (!Number.isFinite(raw)) return DEFAULT_AUTOMATION_INTERVAL_MS;
  return Math.min(15 * 60_000, Math.max(15_000, raw));
}

function getAutomationStore() {
  return globalThis as typeof globalThis & {
    [STARTED_KEY]?: boolean;
    [RUNNING_KEY]?: boolean;
    [TIMER_KEY]?: ReturnType<typeof setInterval>;
    [LAST_STARTED_AT_KEY]?: string;
    [LAST_COMPLETED_AT_KEY]?: string;
    [LAST_SUCCESS_AT_KEY]?: string;
    [LAST_ERROR_AT_KEY]?: string;
    [LAST_ERROR_MESSAGE_KEY]?: string;
    [LAST_RESULT_KEY]?: Awaited<ReturnType<typeof runMerchantBookingAutomationForAllSites>>;
  };
}

async function runAutomationTick() {
  const store = getAutomationStore();
  if (store[RUNNING_KEY]) return;
  store[RUNNING_KEY] = true;
  store[LAST_STARTED_AT_KEY] = new Date().toISOString();
  try {
    const result = await runMerchantBookingAutomationForAllSites();
    const completedAt = new Date().toISOString();
    store[LAST_RESULT_KEY] = result;
    store[LAST_COMPLETED_AT_KEY] = completedAt;
    store[LAST_SUCCESS_AT_KEY] = completedAt;
    store[LAST_ERROR_AT_KEY] = "";
    store[LAST_ERROR_MESSAGE_KEY] = "";
  } catch (error) {
    const failedAt = new Date().toISOString();
    store[LAST_COMPLETED_AT_KEY] = failedAt;
    store[LAST_ERROR_AT_KEY] = failedAt;
    store[LAST_ERROR_MESSAGE_KEY] = error instanceof Error ? error.message : "unknown_error";
    console.error("[booking-automation] tick failed", error);
  } finally {
    store[RUNNING_KEY] = false;
  }
}

export function getMerchantBookingAutomationRuntimeSnapshot() {
  const store = getAutomationStore();
  return {
    started: store[STARTED_KEY] === true,
    running: store[RUNNING_KEY] === true,
    lastStartedAt: store[LAST_STARTED_AT_KEY] ?? "",
    lastCompletedAt: store[LAST_COMPLETED_AT_KEY] ?? "",
    lastSuccessAt: store[LAST_SUCCESS_AT_KEY] ?? "",
    lastErrorAt: store[LAST_ERROR_AT_KEY] ?? "",
    lastErrorMessage: store[LAST_ERROR_MESSAGE_KEY] ?? "",
    lastResult: store[LAST_RESULT_KEY] ?? null,
  };
}

export function startMerchantBookingAutomationRuntime() {
  if (process.env.NODE_ENV === "test") return;
  const store = getAutomationStore();
  if (store[STARTED_KEY]) return;

  store[STARTED_KEY] = true;
  void runAutomationTick();

  const timer = setInterval(() => {
    void runAutomationTick();
  }, readAutomationIntervalMs());
  timer.unref?.();
  store[TIMER_KEY] = timer;
}
