import fs from "node:fs";
import path from "node:path";

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
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
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
const anon = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const timeoutMs = parsePositiveInt(env.SUPABASE_HEALTH_TIMEOUT_MS, 4000);

if (!url || !anon) {
  console.error("[supabase-health] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

async function checkEndpoint(name, target, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(target, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const elapsed = Date.now() - startedAt;
    console.log(`[supabase-health] ${name}: status=${response.status} elapsed=${elapsed}ms`);
    return response.status;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[supabase-health] ${name}: failed elapsed=${elapsed}ms reason=${message}`);
    return -1;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const checks = [
    checkEndpoint("auth-settings", `${url}/auth/v1/settings`, { apikey: anon }),
    checkEndpoint("rest-root", `${url}/rest/v1/`, { apikey: anon }),
  ];

  const [authStatus, restStatus] = await Promise.all(checks);
  if (authStatus < 0 || restStatus < 0) {
    process.exitCode = 2;
    return;
  }

  if (authStatus >= 500 || restStatus >= 500) {
    console.error("[supabase-health] Gateway reachable but upstream backend has server errors.");
    process.exitCode = 3;
    return;
  }

  console.log("[supabase-health] OK");
}

await main();
