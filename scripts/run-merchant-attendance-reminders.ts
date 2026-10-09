// Explicit, finite trusted-system entry. Import/no arguments never load env,
// create a service client, register a timer, enumerate merchants or dispatch.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { areBackgroundJobsPaused } from "../src/lib/backgroundJobsPause";
import { captureBrowserExact } from "../src/lib/merchantAttendanceRuleCapturesBrowser";
import {
  assertAttendanceReminderTree,
  parseAttendanceReminderJson,
  parseAttendanceReminderSystemQuery,
  type AttendanceReminderResult,
  type AttendanceReminderSystemRunQuery,
} from "../src/lib/merchantAttendanceReminders";
import type { AttendanceSelfRpc } from "../src/lib/merchantAttendanceSelf.server";

export type ReminderRunnerInvocation = Readonly<{
  action: "once" | "recover";
  originalRun: AttendanceReminderSystemRunQuery;
}>;
export type ReminderRunnerDependencies = Readonly<{
  service: AttendanceSelfRpc | null;
  environment?: () => Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
}>;

function invalid(): never { throw new Error("attendance_reminder_runner_arguments_invalid"); }
function invocation(raw: ReminderRunnerInvocation): ReminderRunnerInvocation {
  assertAttendanceReminderTree(raw, "request");
  const value = captureBrowserExact(raw, ["action", "originalRun"]);
  if (value.action !== "once" && value.action !== "recover") invalid();
  const originalRun = parseAttendanceReminderSystemQuery(value.originalRun);
  if (originalRun.mode !== "run") invalid();
  return Object.freeze({ action: value.action, originalRun });
}

/** Exact original cursor is compulsory, including explicit JSON null. Recovery
 * needs it to verify the saved full command SHA, not just an operation UUID. */
export function parseReminderRunnerArgs(argv: readonly string[]): ReminderRunnerInvocation | null {
  if (argv.length === 0) return null;
  if (argv.length !== 7 || !argv.every(arg => typeof arg === "string" && arg.length <= 8192)) invalid();
  const [mode, siteFlag, siteId, operationFlag, operationId, cursorFlag, rawCursor] = argv;
  if (mode !== "--once" && mode !== "--recover" || siteFlag !== "--site" || operationFlag !== "--operation" || cursorFlag !== "--cursor") invalid();
  try {
    return invocation({ action: mode === "--once" ? "once" : "recover", originalRun: parseAttendanceReminderSystemQuery({
      siteId, mode: "run", operationId, cursor: parseAttendanceReminderJson(rawCursor),
    }) as AttendanceReminderSystemRunQuery });
  } catch { return invalid(); }
}

/** One existing system adapter only. No Auth/owner proxy and no retry loop.
 * Returns its strict result internally; CLI output deliberately omits bodies
 * and batch IDs. Caller retains originalRun on any error/unknown outcome. */
export async function executeReminderRunner(raw: ReminderRunnerInvocation, dependencies: ReminderRunnerDependencies): Promise<AttendanceReminderResult> {
  // Detach exact input before the first asynchronous boundary.
  const input = invocation(raw), environment = dependencies.environment ?? (() => process.env);
  const paused = input.action === "once" && areBackgroundJobsPaused(environment());
  const { createAttendanceReminderSystemRunner } = await import("../src/lib/merchantAttendanceReminders.server");
  const runner = createAttendanceReminderSystemRunner(dependencies.service, {
    signal: dependencies.signal,
    environment: () => {
      const env = environment();
      // A pause observed after original recovery must also prevent admission.
      return areBackgroundJobsPaused(env) ? { ...env, FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED: undefined } : env;
    },
  });
  if (input.action === "recover" || paused) return runner.recover({
    siteId: input.originalRun.siteId, mode: "recover", operationId: input.originalRun.operationId, cursor: null,
  }, input.originalRun);
  return runner.run(input.originalRun);
}

/** Public process output is intentionally non-secret and receipt-only. A null
 * result is UNKNOWN, never success, rollback, or permission to change the id. */
export function reminderRunnerSummary(input: ReminderRunnerInvocation, result: AttendanceReminderResult | null) {
  const receipt = result?.receipt, run = receipt?.result.kind === "run" ? receipt.result : null;
  return Object.freeze({
    status: receipt && run ? "verified" : "unconfirmed",
    siteId: input.originalRun.siteId,
    operationId: input.originalRun.operationId,
    originalCursor: input.originalRun.cursor,
    keepOriginalParameters: !(receipt && run),
    runStatus: run?.status ?? null,
    counts: run ? { checked: run.checkedCount, delivered: run.deliveredCount, deferred: run.deferredCount, stopped: run.stoppedCount } : null,
    nextCursor: run?.nextCursor ?? null,
  });
}

export async function reminderRunnerMain(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let input: ReminderRunnerInvocation | null;
  try { input = parseReminderRunnerArgs(argv); }
  catch { console.error("attendance_reminder_runner_arguments_invalid"); process.exitCode = 1; return; }
  if (!input) {
    console.info("Explicit only: --once|--recover --site <8 digits> --operation <original UUID> --cursor <original JSON|null>. No timer is registered.");
    return;
  }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    // Validation precedes env loading and any configured credential/client use.
    const { loadEnvConfig } = await import("@next/env");
    // Do not let dotenv diagnostics print configured values or file contents.
    loadEnvConfig(process.cwd(), undefined, { info() {}, error() {} });
    const { createServerSupabaseServiceClient } = await import("../src/lib/superAdminServer");
    const result = await executeReminderRunner(input, { service: createServerSupabaseServiceClient(), signal: controller.signal });
    const summary = reminderRunnerSummary(input, result);
    console.info(JSON.stringify(summary));
    if (summary.status !== "verified") process.exitCode = 1;
  } catch {
    // Never expose SQL, credentials, notification content or claim a rollback.
    console.error(JSON.stringify(reminderRunnerSummary(input, null)));
    process.exitCode = 1;
  } finally {
    controller.abort(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void reminderRunnerMain().catch(() => { console.error("attendance_reminder_runner_unconfirmed_keep_original_parameters"); process.exitCode = 1; });
}
