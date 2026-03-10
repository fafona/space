import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const STORAGE_BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"];

function parseEnvFile(filePath) {
  const parsed = {};
  if (!fs.existsSync(filePath)) return parsed;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (!key) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function fetchWithTimeout(target, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    return await fetch(target, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkEndpoint(name, target, headers, timeoutMs) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(target, { method: "GET", headers }, timeoutMs);
    const elapsed = Date.now() - startedAt;
    console.log(`[publish-check] ${name}: status=${response.status} elapsed=${elapsed}ms`);
    return response;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[publish-check] ${name}: failed elapsed=${elapsed}ms reason=${message}`);
    return null;
  }
}

const cwd = process.cwd();
const envFromFile = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local")),
};
const env = {
  ...envFromFile,
  ...process.env,
};
const url = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const anonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const serviceRoleKey =
  String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
  String(env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const timeoutMs = parsePositiveInt(env.SUPABASE_HEALTH_TIMEOUT_MS, 4000);

const missingKeys = [];
if (!url) missingKeys.push("NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) missingKeys.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) missingKeys.push("SUPABASE_SERVICE_ROLE_KEY");

if (missingKeys.length > 0) {
  console.error(`[publish-check] Missing required env vars: ${missingKeys.join(", ")}`);
  process.exit(1);
}

const anonHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
};
const serviceHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

const authResponse = await checkEndpoint("auth-settings", `${url}/auth/v1/settings`, { apikey: anonKey }, timeoutMs);
const restRootResponse = await checkEndpoint("rest-root", `${url}/rest/v1/`, anonHeaders, timeoutMs);
const pagesAnonResponse = await checkEndpoint(
  "pages-anon-read",
  `${url}/rest/v1/pages?select=id&limit=1`,
  anonHeaders,
  timeoutMs,
);
const pagesServiceResponse = await checkEndpoint(
  "pages-service-read",
  `${url}/rest/v1/pages?select=id&limit=1`,
  serviceHeaders,
  timeoutMs,
);
const bucketResponse = await checkEndpoint("storage-buckets", `${url}/storage/v1/bucket`, serviceHeaders, timeoutMs);

let exitCode = 0;
for (const [name, response] of [
  ["auth-settings", authResponse],
  ["rest-root", restRootResponse],
  ["pages-anon-read", pagesAnonResponse],
  ["pages-service-read", pagesServiceResponse],
  ["storage-buckets", bucketResponse],
]) {
  if (!response) {
    exitCode = Math.max(exitCode, 2);
    continue;
  }
  if (response.status >= 500) {
    console.error(`[publish-check] ${name} has upstream server errors.`);
    exitCode = Math.max(exitCode, 3);
  } else if (response.status >= 400) {
    console.error(`[publish-check] ${name} returned HTTP ${response.status}.`);
    exitCode = Math.max(exitCode, 4);
  }
}

if (bucketResponse?.ok) {
  const buckets = await bucketResponse.json().catch(() => []);
  const bucketList = Array.isArray(buckets) ? buckets : [];
  const matchedBuckets = STORAGE_BUCKET_CANDIDATES.map((name) => {
    const bucket = bucketList.find((entry) => entry && typeof entry === "object" && entry.name === name) ?? null;
    return {
      name,
      exists: !!bucket,
      public: bucket ? bucket.public === true : false,
    };
  });

  matchedBuckets.forEach((bucket) => {
    console.log(
      `[publish-check] bucket ${bucket.name}: exists=${bucket.exists ? "yes" : "no"} public=${bucket.public ? "yes" : "no"}`,
    );
  });

  if (!matchedBuckets.some((bucket) => bucket.exists)) {
    console.error(
      `[publish-check] None of the expected storage buckets exist: ${STORAGE_BUCKET_CANDIDATES.join(", ")}`,
    );
    exitCode = Math.max(exitCode, 5);
  }

  if (!matchedBuckets.some((bucket) => bucket.exists && bucket.public)) {
    console.error(
      `[publish-check] At least one public bucket is required for asset externalization: ${STORAGE_BUCKET_CANDIDATES.join(", ")}`,
    );
    exitCode = Math.max(exitCode, 6);
  }

  const uploadCandidate = matchedBuckets.find((bucket) => bucket.exists) ?? null;
  if (uploadCandidate) {
    const serviceClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const anonClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const serviceObjectPath = `diagnostics/service-upload-check/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const serviceUploadResult = await serviceClient.storage.from(uploadCandidate.name).upload(
      serviceObjectPath,
      new Blob(["publish-check"], { type: "text/plain" }),
      {
        contentType: "text/plain",
        upsert: false,
      },
    );
    if (serviceUploadResult.error) {
      console.error(
        `[publish-check] service-role storage upload failed for bucket ${uploadCandidate.name}: ${serviceUploadResult.error.message}`,
      );
      exitCode = Math.max(exitCode, 7);
    } else {
      console.log(`[publish-check] service-role storage upload OK via bucket ${uploadCandidate.name}`);
      await serviceClient.storage.from(uploadCandidate.name).remove([serviceObjectPath]).catch(() => {
        // Ignore cleanup failures.
      });
    }

    const anonObjectPath = `diagnostics/anon-upload-check/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const anonUploadResult = await anonClient.storage.from(uploadCandidate.name).upload(
      anonObjectPath,
      new Blob(["publish-check"], { type: "text/plain" }),
      {
        contentType: "text/plain",
        upsert: false,
      },
    );
    if (anonUploadResult.error) {
      console.warn(
        `[publish-check] anonymous storage upload is blocked for bucket ${uploadCandidate.name}: ${anonUploadResult.error.message}`,
      );
      console.warn("[publish-check] Super admin relies on the server-side asset upload proxy when browser-side upload is denied.");
    } else {
      console.log(`[publish-check] anonymous storage upload OK via bucket ${uploadCandidate.name}`);
      await serviceClient.storage.from(uploadCandidate.name).remove([anonObjectPath]).catch(() => {
        // Ignore cleanup failures.
      });
    }
  }
}

if (exitCode === 0) {
  console.log("[publish-check] OK");
} else {
  console.error(`[publish-check] FAILED with exit code ${exitCode}`);
}

process.exit(exitCode);
