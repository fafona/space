import fs from "node:fs";
import path from "node:path";

const REQUIRED_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const STRICT_MODE = process.argv.includes("--strict");

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

function formatMissingMessage(keys) {
  return `Missing required env vars: ${keys.join(", ")}`;
}

const cwd = process.cwd();
const fileEnv = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local")),
};
const mergedEnv = {
  ...fileEnv,
  ...process.env,
};
const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !(mergedEnv[key] || "").toString().trim());

if (missingKeys.length === 0) {
  console.log("[env-check] OK");
  process.exit(0);
}

const missingMessage = formatMissingMessage(missingKeys);
if (STRICT_MODE) {
  console.error(`[env-check] ${missingMessage}`);
  console.error("[env-check] Copy .env.example to .env.local and fill values before build.");
  process.exit(1);
}

console.warn(`[env-check] ${missingMessage}`);
console.warn("[env-check] Dev mode can continue with fallback backend, but remote features may not work.");
process.exit(0);
