import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const BOOKING_PERSISTENCE_MERCHANT_ID = "__faolla_booking_persistence__";
const DEFAULT_ATTEMPTS = 30;
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

const EXPECTED_STORES = {
  "__merchant_booking_records__:v1": {
    collection: "records",
    isValid: (value) => Array.isArray(value?.records),
  },
  "__merchant_booking_workbench__:v1": {
    collection: "settingsBySiteId",
    isValid: (value) => isRecord(value?.settingsBySiteId),
  },
  "__merchant_booking_rules__:v1": {
    collection: "snapshots",
    isValid: (value) => isRecord(value?.snapshots),
  },
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function entryCount(value, collection) {
  const entries = value?.[collection];
  if (Array.isArray(entries)) return entries.length;
  if (isRecord(entries)) return Object.keys(entries).length;
  return null;
}

export function summarizeBookingPersistenceRows(rows) {
  const bySlug = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
    if (!Object.hasOwn(EXPECTED_STORES, slug)) continue;
    const expected = EXPECTED_STORES[slug];
    if (bySlug.has(slug)) continue;
    const value = row?.blocks;
    bySlug.set(slug, {
      slug,
      valid: expected.isValid(value),
      entryCount: entryCount(value, expected.collection),
      updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    });
  }

  const stores = Object.keys(EXPECTED_STORES).map(
    (slug) =>
      bySlug.get(slug) ?? {
        slug,
        valid: false,
        entryCount: null,
        updatedAt: null,
      },
  );
  return {
    complete: stores.every((store) => store.valid),
    stores,
  };
}

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
      lastQueryError = error instanceof Error ? error.message : "unknown_error";
      result = null;
    } finally {
      clearTimeout(timeout);
    }

    if (result?.error) {
      lastQueryError = result.error.message || "unknown_error";
    } else if (result) {
      lastQueryError = null;
      summary = summarizeBookingPersistenceRows(result.data);
      if (summary.complete) {
        return {
          ...summary,
          attemptsUsed: attempt,
        };
      }
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (lastQueryError) {
    throw new Error(`booking_persistence_query_failed:${lastQueryError}`);
  }
  const incomplete = summary.stores.filter((store) => !store.valid).map((store) => store.slug);
  throw new Error(`booking_persistence_incomplete:${incomplete.join(",")}`);
}

async function main() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
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
    console.error(`[booking-persistence] ${error instanceof Error ? error.message : "unknown_error"}`);
    process.exitCode = 1;
  });
}
