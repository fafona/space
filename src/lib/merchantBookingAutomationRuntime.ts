import { runMerchantBookingAutomationForAllSites } from "./merchantBookings.server";

const DEFAULT_AUTOMATION_INTERVAL_MS = 60_000;
const STARTED_KEY = "__merchantBookingAutomationRuntimeStarted";
const RUNNING_KEY = "__merchantBookingAutomationRuntimeRunning";
const TIMER_KEY = "__merchantBookingAutomationRuntimeTimer";

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
  };
}

async function runAutomationTick() {
  const store = getAutomationStore();
  if (store[RUNNING_KEY]) return;
  store[RUNNING_KEY] = true;
  try {
    await runMerchantBookingAutomationForAllSites();
  } catch (error) {
    console.error("[booking-automation] tick failed", error);
  } finally {
    store[RUNNING_KEY] = false;
  }
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
