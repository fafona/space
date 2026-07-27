import { loadEnvConfig } from "@next/env";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY,
  evaluateMerchantOrderV1PrimaryCanary,
  parseMerchantOrderV1PrimaryCanaryLines,
} from "../src/lib/merchantOrderV1PrimaryCanaryAudit";
import {
  completeMerchantOrderV1PrimaryCanaryWatchNotification,
  parseMerchantOrderV1PrimaryCanaryWatchState,
  planMerchantOrderV1PrimaryCanaryWatch,
  type MerchantOrderV1PrimaryCanaryWatchNotification,
  type MerchantOrderV1PrimaryCanaryWatchState,
} from "../src/lib/merchantOrderV1PrimaryCanaryWatch";

export type V1PrimaryCanaryWatchOptions = {
  file: string;
  stateFile: string;
  siteId: string;
  activatedAt: string;
  minimumSamples: number;
  minimumObservationWindowMinutes: number;
  maximumP95DurationMs: number;
  maximumLastObservationAgeMinutes: number;
  rollbackReminderMinutes: number;
  webhookTimeoutMs: number;
  staleLockMinutes: number;
};

export type V1PrimaryCanaryWatchRuntimeConfig = {
  enabled: boolean;
  webhookUrl: string | null;
  bearerToken: string | null;
};

const MAX_STATE_FILE_BYTES = 128 * 1024;

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== value ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  return parsed;
}

function parseTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("activated_at_must_be_valid_timestamp");
  }
  return new Date(parsed).toISOString();
}

export function parseV1PrimaryCanaryWatchOptions(
  args: string[],
): V1PrimaryCanaryWatchOptions {
  const options: Partial<V1PrimaryCanaryWatchOptions> = {
    minimumSamples:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.minimumSamples,
    minimumObservationWindowMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.minimumObservationWindowMinutes,
    maximumP95DurationMs:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.maximumP95DurationMs,
    maximumLastObservationAgeMinutes:
      DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY.maximumLastObservationAgeMinutes,
    rollbackReminderMinutes: 60,
    webhookTimeoutMs: 5000,
    staleLockMinutes: 15,
  };
  const seen = new Set<string>();

  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 3) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (!value) throw new Error(`empty_argument:${name}`);
    if (seen.has(name)) throw new Error(`duplicate_argument:${name}`);
    seen.add(name);

    if (name === "file") {
      options.file = value;
    } else if (name === "state-file") {
      if (value === "-") throw new Error("state_file_cannot_be_stdin");
      options.stateFile = value;
    } else if (name === "site") {
      if (!/^\d{8}$/.test(value)) throw new Error("site_must_be_exact_8_digit_id");
      options.siteId = value;
    } else if (name === "activated-at") {
      options.activatedAt = parseTimestamp(value);
    } else if (name === "min-samples") {
      options.minimumSamples = parseBoundedInteger(
        value,
        "min_samples",
        1,
        1_000_000,
      );
    } else if (name === "min-window-minutes") {
      options.minimumObservationWindowMinutes = parseBoundedInteger(
        value,
        "min_window_minutes",
        1,
        43_200,
      );
    } else if (name === "max-p95-ms") {
      options.maximumP95DurationMs = parseBoundedInteger(
        value,
        "max_p95_ms",
        1,
        600_000,
      );
    } else if (name === "max-last-age-minutes") {
      options.maximumLastObservationAgeMinutes = parseBoundedInteger(
        value,
        "max_last_age_minutes",
        1,
        10_080,
      );
    } else if (name === "rollback-reminder-minutes") {
      options.rollbackReminderMinutes = parseBoundedInteger(
        value,
        "rollback_reminder_minutes",
        5,
        1440,
      );
    } else if (name === "webhook-timeout-ms") {
      options.webhookTimeoutMs = parseBoundedInteger(
        value,
        "webhook_timeout_ms",
        1000,
        30_000,
      );
    } else if (name === "stale-lock-minutes") {
      options.staleLockMinutes = parseBoundedInteger(
        value,
        "stale_lock_minutes",
        5,
        60,
      );
    } else {
      throw new Error(`unknown_argument:${name}`);
    }
  }

  if (!options.file) throw new Error("file_is_required");
  if (!options.stateFile) throw new Error("state_file_is_required");
  if (!options.siteId) throw new Error("site_is_required");
  if (!options.activatedAt) throw new Error("activated_at_is_required");
  return options as V1PrimaryCanaryWatchOptions;
}

function normalizeWebhookUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("canary_watch_webhook_url_must_be_valid_https");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("canary_watch_webhook_url_must_be_valid_https");
  }
  return parsed.toString();
}

export function resolveV1PrimaryCanaryWatchRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): V1PrimaryCanaryWatchRuntimeConfig {
  const enabled =
    String(
      environment.MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED ?? "",
    )
      .trim()
      .toLowerCase() === "true";
  const rawWebhookUrl = String(
    environment.MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_WEBHOOK_URL ?? "",
  ).trim();
  const rawBearerToken = String(
    environment.MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_BEARER_TOKEN ?? "",
  ).trim();
  if (rawBearerToken.length > 4096) {
    throw new Error("canary_watch_bearer_token_is_too_long");
  }
  if (rawBearerToken && !rawWebhookUrl) {
    throw new Error("canary_watch_webhook_url_required_for_bearer_token");
  }
  return {
    enabled,
    webhookUrl: rawWebhookUrl ? normalizeWebhookUrl(rawWebhookUrl) : null,
    bearerToken: rawBearerToken || null,
  };
}

async function loadObservationLines(file: string) {
  const stream =
    file === "-"
      ? process.stdin
      : createReadStream(resolve(process.cwd(), file), { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of reader) lines.push(line);
  return lines;
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function assertNotSymlink(path: string) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("canary_watch_state_file_is_symlink");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function readV1PrimaryCanaryWatchState(
  stateFile: string,
  expected: { siteId: string; activatedAt: string },
) {
  const path = resolve(process.cwd(), stateFile);
  await assertNotSymlink(path);
  try {
    const info = await stat(path);
    if (info.size > MAX_STATE_FILE_BYTES) {
      throw new Error("canary_watch_state_file_is_too_large");
    }
    const raw = await readFile(path, "utf8");
    return parseMerchantOrderV1PrimaryCanaryWatchState(
      JSON.parse(raw) as unknown,
      expected,
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    if (error instanceof SyntaxError) {
      throw new Error("canary_watch_state_file_is_invalid_json");
    }
    throw error;
  }
}

export async function writeV1PrimaryCanaryWatchState(
  stateFile: string,
  state: MerchantOrderV1PrimaryCanaryWatchState,
) {
  const path = resolve(process.cwd(), stateFile);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  await assertNotSymlink(path);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function acquireWatchLock(stateFile: string, staleLockMinutes: number) {
  const statePath = resolve(process.cwd(), stateFile);
  await mkdir(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  const staleAfterMs = staleLockMinutes * 60 * 1000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
          })}\n`,
          "utf8",
        );
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      return async () => {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : "";
      if (code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (!info) continue;
      if (Date.now() - info.mtimeMs < staleAfterMs) {
        throw new Error("canary_watch_already_running");
      }
      await unlink(lockPath);
    }
  }
  throw new Error("canary_watch_lock_unavailable");
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status">>;

export async function deliverV1PrimaryCanaryWatchWebhook(input: {
  url: string;
  bearerToken: string | null;
  timeoutMs: number;
  notification: MerchantOrderV1PrimaryCanaryWatchNotification;
  fetchImpl?: FetchLike;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": input.notification.id,
      "User-Agent": "faolla-v1-primary-canary-watch/1",
    };
    if (input.bearerToken) {
      headers.Authorization = `Bearer ${input.bearerToken}`;
    }
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.notification),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`canary_watch_webhook_http_${response.status}`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("canary_watch_webhook_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatNumber(value: number | null, fractionDigits = 1) {
  return value === null ? "-" : value.toFixed(fractionDigits);
}

async function main() {
  const options = parseV1PrimaryCanaryWatchOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const runtime = resolveV1PrimaryCanaryWatchRuntimeConfig();
  if (!runtime.enabled) throw new Error("canary_watch_execution_disabled");

  const inputPath =
    options.file === "-" ? null : resolve(process.cwd(), options.file);
  const statePath = resolve(process.cwd(), options.stateFile);
  if (inputPath === statePath) {
    throw new Error("canary_watch_state_file_must_differ_from_input_file");
  }

  const releaseLock = await acquireWatchLock(
    options.stateFile,
    options.staleLockMinutes,
  );
  try {
    const evaluatedAt = new Date();
    const lines = await loadObservationLines(options.file);
    const parsed = parseMerchantOrderV1PrimaryCanaryLines(lines, {
      siteId: options.siteId,
      activatedAt: options.activatedAt,
    });
    const report = evaluateMerchantOrderV1PrimaryCanary({
      siteId: options.siteId,
      activatedAt: options.activatedAt,
      parsed,
      policy: {
        minimumSamples: options.minimumSamples,
        minimumObservationWindowMinutes:
          options.minimumObservationWindowMinutes,
        maximumP95DurationMs: options.maximumP95DurationMs,
        maximumLastObservationAgeMinutes:
          options.maximumLastObservationAgeMinutes,
      },
      evaluatedAt,
    });
    const previousState = await readV1PrimaryCanaryWatchState(
      options.stateFile,
      {
        siteId: options.siteId,
        activatedAt: options.activatedAt,
      },
    );
    const planned = planMerchantOrderV1PrimaryCanaryWatch({
      report,
      previousState,
      rollbackReminderMinutes: options.rollbackReminderMinutes,
      nowMs: evaluatedAt.getTime(),
    });

    await writeV1PrimaryCanaryWatchState(options.stateFile, planned.state);
    console.log(
      `[v1-primary-canary-watch] site=${report.siteId} status=${report.status} samples=${report.sampleCount} fallbacks=${report.fallbackCount} circuit-open=${report.circuitOpenCount} p95-ms=${formatNumber(report.p95DurationMs, 0)} last-age-minutes=${formatNumber(report.latestObservationAgeMinutes)} state-file=${options.stateFile}`,
    );

    let deliveryFailed = false;
    if (planned.notification) {
      console.warn(
        `[v1-primary-canary-watch] notification=${planned.notification.kind} severity=${planned.notification.severity} id=${planned.notification.id}`,
      );
      try {
        if (runtime.webhookUrl) {
          await deliverV1PrimaryCanaryWatchWebhook({
            url: runtime.webhookUrl,
            bearerToken: runtime.bearerToken,
            timeoutMs: options.webhookTimeoutMs,
            notification: planned.notification,
          });
          console.log("[v1-primary-canary-watch] delivery=webhook-success");
        } else {
          console.log("[v1-primary-canary-watch] delivery=stdout-only");
        }
        const completed =
          completeMerchantOrderV1PrimaryCanaryWatchNotification(
            planned.state,
            planned.notification.id,
            new Date().toISOString(),
          );
        await writeV1PrimaryCanaryWatchState(options.stateFile, completed);
      } catch (error) {
        deliveryFailed = true;
        console.error(
          `[v1-primary-canary-watch] delivery=failed error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (deliveryFailed) process.exitCode = 4;
    else if (report.status === "rollback_required") process.exitCode = 2;
    else if (report.status === "observing") process.exitCode = 3;
  } finally {
    await releaseLock();
  }
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/watch-v1-primary-canary.ts")) {
  main().catch((error) => {
    console.error(
      `[v1-primary-canary-watch] failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
