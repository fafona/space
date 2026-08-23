import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import {
  BOOKING_PERSISTENCE_MERCHANT_ID,
  summarizeBookingPersistenceRows,
} from "./booking-persistence-contract.mjs";

const DEFAULT_ATTEMPTS = 30;
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function isTransientBookingPersistenceError(error) {
  const status = Number(error?.status ?? error?.cause?.status);
  if (Number.isInteger(status) && status > 0) {
    return TRANSIENT_HTTP_STATUSES.has(status);
  }
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  return [
    /query_timeout_\d+ms/,
    /fetch failed/,
    /network(?: request)? (?:error|failed)/,
    /terminated/,
    /aborted/,
    /aborterror/,
    /connect(?:ion)? (?:error|failed|timeout|timed out)/,
    /socket (?:closed|error|hang up)/,
    /econn(?:reset|refused|aborted)/,
    /etimedout/,
    /enotfound/,
    /eai_again/,
    /und_err_/,
    /upstream timeout/,
    /gateway timeout/,
    /service unavailable/,
  ].some((pattern) => pattern.test(message));
}

function createBookingPersistenceQueryError(error, status) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error?.message === "string" && error.message
        ? error.message
        : "unknown_error";
  const queryError = new Error(`booking_persistence_query_failed:${message}`);
  const numericStatus = Number(status);
  if (Number.isInteger(numericStatus) && numericStatus > 0) {
    queryError.status = numericStatus;
  }
  return queryError;
}

export { summarizeBookingPersistenceRows };

export async function waitForBookingPersistence(
  client,
  options = {},
) {
  const attempts = normalizePositiveInteger(options.attempts, DEFAULT_ATTEMPTS);
  const delayMs = normalizePositiveInteger(options.delayMs, DEFAULT_DELAY_MS);
  const queryTimeoutMs = normalizePositiveInteger(
    options.queryTimeoutMs,
    DEFAULT_QUERY_TIMEOUT_MS,
  );
  let summary = summarizeBookingPersistenceRows([]);
  let lastQueryError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), queryTimeoutMs);
    let query = client
      .from("pages")
      .select("slug,blocks,updated_at")
      .eq("merchant_id", BOOKING_PERSISTENCE_MERCHANT_ID);
    if (typeof query?.abortSignal === "function") {
      query = query.abortSignal(controller.signal);
    }

    let result;
    let queryError = null;
    try {
      result = await Promise.race([
        query,
        new Promise((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error(`query_timeout_${queryTimeoutMs}ms`)),
            { once: true },
          );
        }),
      ]);
    } catch (error) {
      queryError = createBookingPersistenceQueryError(error, error?.status);
    } finally {
      clearTimeout(timeout);
    }

    if (!queryError && result) {
      const resultStatus = Number(result.status);
      if (
        result.error ||
        (Number.isInteger(resultStatus) && resultStatus >= 400)
      ) {
        queryError = createBookingPersistenceQueryError(
          result.error ?? { message: `http_status_${resultStatus}` },
          resultStatus,
        );
      }
    }

    if (queryError) {
      if (!isTransientBookingPersistenceError(queryError)) {
        throw queryError;
      }
      lastQueryError = queryError;
    } else if (result) {
      lastQueryError = null;
      summary = summarizeBookingPersistenceRows(result.data);
      if (summary.complete) {
        return {
          ...summary,
          attemptsUsed: attempt,
        };
      }
      const incomplete = summary.stores
        .filter((store) => !store.valid)
        .map((store) => store.slug);
      throw new Error(`booking_persistence_incomplete:${incomplete.join(",")}`);
    } else {
      throw new Error("booking_persistence_query_failed:unknown_response");
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (lastQueryError) {
    throw lastQueryError;
  }
  throw new Error("booking_persistence_query_failed:unknown_response");
}

async function main() {
  const primarySupabaseUrl = String(process.env.SUPABASE_INTERNAL_URL ?? "").trim();
  const fallbackSupabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseUrl = primarySupabaseUrl || fallbackSupabaseUrl;
  const primaryServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const fallbackServiceRoleKey = String(
    process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  const serviceRoleKey = primaryServiceRoleKey || fallbackServiceRoleKey;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("booking_persistence_env_missing");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const result = await waitForBookingPersistence(client, {
    attempts: process.env.BOOKING_PERSISTENCE_CHECK_ATTEMPTS,
    delayMs: process.env.BOOKING_PERSISTENCE_CHECK_DELAY_MS,
    queryTimeoutMs: process.env.BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS,
  });
  console.log(`[booking-persistence] OK attempts=${result.attemptsUsed}`);
  result.stores.forEach((store) => {
    console.log(
      `[booking-persistence] ${store.slug} entries=${store.entryCount ?? 0} updated=${store.updatedAt ?? "unknown"}`,
    );
  });
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error(`[booking-persistence] ${message}`);
    process.exitCode = isTransientBookingPersistenceError(error) ? 2 : 1;
  });
}
