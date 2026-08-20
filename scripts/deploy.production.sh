#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PAYLOAD_FILE="${FAOLLA_DEPLOY_PAYLOAD_FILE:-}"
DEPLOY_PAYLOAD_KEYS=(
  APP_DIR
  APP_NAME
  APP_PORT
  APP_BRANCH
  EXPECTED_DEPLOY_SHA
  SUPABASE_INTERNAL_URL_B64
  NEXT_PUBLIC_SUPABASE_URL_B64
  NEXT_PUBLIC_SUPABASE_ANON_KEY_B64
  SUPABASE_SERVICE_ROLE_KEY_B64
  GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64
  GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64
  GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64
  GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64
  GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS
  MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED
  MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE
  MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED
  MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS
  MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS
  MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64
  MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64
  MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64
  MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64
  MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64
  ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED
  ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64
  ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64
  RESEND_API_KEY_B64
  WEB_PUSH_PUBLIC_KEY
  WEB_PUSH_PRIVATE_KEY
  WEB_PUSH_SUBJECT
  SUPER_ADMIN_ACCOUNT
  SUPER_ADMIN_PASSWORD
  SUPER_ADMIN_VERIFICATION_EMAIL
  SUPER_ADMIN_VERIFICATION_SECRET
)

load_deploy_payload() {
  local payload_key
  local payload_value
  local loaded_count=0
  if [ -z "$DEPLOY_PAYLOAD_FILE" ] \
    || [ ! -f "$DEPLOY_PAYLOAD_FILE" ] \
    || [ -L "$DEPLOY_PAYLOAD_FILE" ]; then
    echo "[deploy] a regular deployment payload file is required"
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[deploy] node is required to validate the deployment payload"
    exit 1
  fi
  while IFS= read -r -d '' payload_key \
    && IFS= read -r -d '' payload_value; do
    case "$payload_key" in
      APP_DIR|APP_NAME|APP_PORT|APP_BRANCH|EXPECTED_DEPLOY_SHA|\
      SUPABASE_INTERNAL_URL_B64|NEXT_PUBLIC_SUPABASE_URL_B64|\
      NEXT_PUBLIC_SUPABASE_ANON_KEY_B64|SUPABASE_SERVICE_ROLE_KEY_B64|\
      GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64|\
      GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64|\
      GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64|\
      GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64|\
      GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS|\
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED|\
      MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE|\
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED|\
      MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS|\
      MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS|\
      MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64|\
      MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64|\
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64|\
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64|\
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64|\
      RESEND_API_KEY_B64|WEB_PUSH_PUBLIC_KEY|WEB_PUSH_PRIVATE_KEY|\
      WEB_PUSH_SUBJECT|SUPER_ADMIN_ACCOUNT|SUPER_ADMIN_PASSWORD|\
      SUPER_ADMIN_VERIFICATION_EMAIL|SUPER_ADMIN_VERIFICATION_SECRET)
        printf -v "$payload_key" '%s' "$payload_value"
        loaded_count=$((loaded_count + 1))
        ;;
      *)
        echo "[deploy] deployment payload contains an unexpected key"
        exit 1
        ;;
    esac
  done < <(
    node --input-type=module - "$DEPLOY_PAYLOAD_FILE" <<'NODE'
import { readFileSync } from "node:fs";

const expectedKeys = [
  "APP_DIR",
  "APP_NAME",
  "APP_PORT",
  "APP_BRANCH",
  "EXPECTED_DEPLOY_SHA",
  "SUPABASE_INTERNAL_URL_B64",
  "NEXT_PUBLIC_SUPABASE_URL_B64",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY_B64",
  "SUPABASE_SERVICE_ROLE_KEY_B64",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64",
  "GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64",
  "GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64",
  "GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS",
  "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED",
  "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE",
  "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED",
  "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS",
  "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS",
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64",
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64",
  "MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64",
  "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64",
  "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64",
  "RESEND_API_KEY_B64",
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
  "SUPER_ADMIN_ACCOUNT",
  "SUPER_ADMIN_PASSWORD",
  "SUPER_ADMIN_VERIFICATION_EMAIL",
  "SUPER_ADMIN_VERIFICATION_SECRET",
];
const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (payload?.schemaVersion !== 1 || !payload.values) process.exit(1);
const actualKeys = Object.keys(payload.values).sort();
const sortedExpected = [...expectedKeys].sort();
if (
  actualKeys.length !== sortedExpected.length ||
  actualKeys.some((key, index) => key !== sortedExpected[index])
) process.exit(1);
for (const key of expectedKeys) {
  const value = payload.values[key];
  if (typeof value !== "string" || value.includes("\0")) process.exit(1);
  process.stdout.write(`${key}\0${value}\0`);
}
NODE
  )
  rm -f -- "$DEPLOY_PAYLOAD_FILE"
  unset FAOLLA_DEPLOY_PAYLOAD_FILE DEPLOY_PAYLOAD_FILE payload_key payload_value
  if [ "$loaded_count" -ne "${#DEPLOY_PAYLOAD_KEYS[@]}" ]; then
    echo "[deploy] deployment payload is incomplete"
    exit 1
  fi
}

load_deploy_payload

APP_DIR="${APP_DIR:-/var/www/merchant-space}"
APP_NAME="${APP_NAME:-merchant-space}"
APP_PORT="${APP_PORT:-3000}"
APP_BRANCH="${APP_BRANCH:-main}"
EXPECTED_DEPLOY_SHA="${EXPECTED_DEPLOY_SHA:-}"
AUTOMATION_WORKER_NAME="${AUTOMATION_WORKER_NAME:-${APP_NAME}-enterprise-automation-worker}"
AUTOMATION_WORKER_KILL_TIMEOUT_MS="${AUTOMATION_WORKER_KILL_TIMEOUT_MS:-180000}"
MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="${MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:-false}"
MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE="${MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE:-legacy}"
MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="${MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:-false}"
MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS="${MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS:-3600}"
MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS="${MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS:-3900}"
ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED="${ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED:-false}"
SUPABASE_INTERNAL_URL="${SUPABASE_INTERNAL_URL:-http://127.0.0.1:8000}"
RELEASES_DIR="${RELEASES_DIR:-${APP_DIR}.releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_DIR}.current}"
SHARED_DIR="${SHARED_DIR:-${APP_DIR}.shared}"
SHARED_RUNTIME_DIR="$SHARED_DIR/.runtime"
RELEASE_KEEP_COUNT="${RELEASE_KEEP_COUNT:-2}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
RELEASE_SMOKE_ORIGIN="${RELEASE_SMOKE_ORIGIN:-http://127.0.0.1:${APP_PORT}}"
RELEASE_SMOKE_PATHS="${RELEASE_SMOKE_PATHS:-/,/login,/10909094}"
RELEASE_SMOKE_ATTEMPTS="${RELEASE_SMOKE_ATTEMPTS:-4}"
RELEASE_SMOKE_DELAY_MS="${RELEASE_SMOKE_DELAY_MS:-1000}"
RELEASE_SMOKE_TIMEOUT_MS="${RELEASE_SMOKE_TIMEOUT_MS:-12000}"
GIT_FETCH_ATTEMPTS="${GIT_FETCH_ATTEMPTS:-4}"
GIT_FETCH_DELAY_SECONDS="${GIT_FETCH_DELAY_SECONDS:-8}"
GIT_FETCH_LOW_SPEED_TIME_SECONDS="${GIT_FETCH_LOW_SPEED_TIME_SECONDS:-30}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-${APP_DIR}.deploy.lock}"
DEPLOY_LOCK_WAIT_SECONDS="${DEPLOY_LOCK_WAIT_SECONDS:-120}"
NPM_CI_TIMEOUT_SECONDS="${NPM_CI_TIMEOUT_SECONDS:-1800}"
NPM_CI_KILL_AFTER_SECONDS="${NPM_CI_KILL_AFTER_SECONDS:-30}"
NPM_CI_ATTEMPTS="${NPM_CI_ATTEMPTS:-3}"
NPM_CI_RETRY_DELAY_SECONDS="${NPM_CI_RETRY_DELAY_SECONDS:-15}"
NPM_FETCH_RETRIES="${NPM_FETCH_RETRIES:-5}"
NPM_FETCH_RETRY_MIN_TIMEOUT_MS="${NPM_FETCH_RETRY_MIN_TIMEOUT_MS:-10000}"
NPM_FETCH_RETRY_MAX_TIMEOUT_MS="${NPM_FETCH_RETRY_MAX_TIMEOUT_MS:-120000}"
BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-1800}"
BUILD_KILL_AFTER_SECONDS="${BUILD_KILL_AFTER_SECONDS:-30}"
STALE_BUILD_MINUTES="${STALE_BUILD_MINUTES:-45}"
DISK_WARNING_THRESHOLD="${DISK_WARNING_THRESHOLD:-75}"
DISK_CACHE_CLEANUP_THRESHOLD="${DISK_CACHE_CLEANUP_THRESHOLD:-80}"
DISK_ABORT_THRESHOLD="${DISK_ABORT_THRESHOLD:-90}"
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-5120}"

if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git is required on the server"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[deploy] npm is required on the server"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[deploy] pm2 is required on the server"
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "[deploy] tar is required on the server"
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "[deploy] flock is required on the server"
  exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "[deploy] timeout is required on the server"
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[deploy] APP_DIR must already contain a git checkout: $APP_DIR"
  exit 1
fi

if [ "$APP_BRANCH" != "main" ]; then
  echo "[deploy] APP_BRANCH must be main"
  exit 1
fi

if ! [[ "$EXPECTED_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[deploy] EXPECTED_DEPLOY_SHA must be an exact lowercase 40-hex commit"
  exit 1
fi

cd "$APP_DIR"

echo "[deploy] working directory: $APP_DIR"
echo "[deploy] branch: $APP_BRANCH"

validate_disk_thresholds() {
  local name
  local value
  for name in \
    DISK_WARNING_THRESHOLD \
    DISK_CACHE_CLEANUP_THRESHOLD \
    DISK_ABORT_THRESHOLD \
    MIN_FREE_DISK_MB \
    RELEASE_KEEP_COUNT \
    HEALTHCHECK_ATTEMPTS \
    RELEASE_SMOKE_ATTEMPTS \
    RELEASE_SMOKE_DELAY_MS \
    RELEASE_SMOKE_TIMEOUT_MS \
    GIT_FETCH_ATTEMPTS \
    GIT_FETCH_DELAY_SECONDS \
    GIT_FETCH_LOW_SPEED_TIME_SECONDS \
    DEPLOY_LOCK_WAIT_SECONDS \
    NPM_CI_TIMEOUT_SECONDS \
    NPM_CI_KILL_AFTER_SECONDS \
    NPM_CI_ATTEMPTS \
    NPM_CI_RETRY_DELAY_SECONDS \
    NPM_FETCH_RETRIES \
    NPM_FETCH_RETRY_MIN_TIMEOUT_MS \
    NPM_FETCH_RETRY_MAX_TIMEOUT_MS \
    BUILD_TIMEOUT_SECONDS \
    BUILD_KILL_AFTER_SECONDS \
    STALE_BUILD_MINUTES \
    AUTOMATION_WORKER_KILL_TIMEOUT_MS; do
    value="${!name}"
    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
      echo "[deploy] $name must be a non-negative integer: $value"
      exit 1
    fi
  done
  if [ "$DISK_WARNING_THRESHOLD" -gt 100 ] \
    || [ "$DISK_CACHE_CLEANUP_THRESHOLD" -gt 100 ] \
    || [ "$DISK_ABORT_THRESHOLD" -gt 100 ] \
    || [ "$DISK_WARNING_THRESHOLD" -ge "$DISK_CACHE_CLEANUP_THRESHOLD" ] \
    || [ "$DISK_CACHE_CLEANUP_THRESHOLD" -ge "$DISK_ABORT_THRESHOLD" ]; then
    echo "[deploy] disk thresholds must be ordered warning < cleanup < abort <= 100"
    exit 1
  fi
  if [ "$RELEASE_KEEP_COUNT" -lt 2 ]; then
    echo "[deploy] RELEASE_KEEP_COUNT must be at least 2"
    exit 1
  fi
  if [ "$HEALTHCHECK_ATTEMPTS" -lt 1 ]; then
    echo "[deploy] HEALTHCHECK_ATTEMPTS must be at least 1"
    exit 1
  fi
  if [ "$RELEASE_SMOKE_ATTEMPTS" -lt 1 ]; then
    echo "[deploy] RELEASE_SMOKE_ATTEMPTS must be at least 1"
    exit 1
  fi
  if [ "$RELEASE_SMOKE_TIMEOUT_MS" -lt 250 ]; then
    echo "[deploy] RELEASE_SMOKE_TIMEOUT_MS must be at least 250"
    exit 1
  fi
  if [ "$GIT_FETCH_ATTEMPTS" -lt 1 ] || [ "$GIT_FETCH_LOW_SPEED_TIME_SECONDS" -lt 1 ]; then
    echo "[deploy] Git fetch attempts and low-speed timeout must be at least 1"
    exit 1
  fi
  if [ "$DEPLOY_LOCK_WAIT_SECONDS" -lt 1 ] \
    || [ "$NPM_CI_TIMEOUT_SECONDS" -lt 60 ] \
    || [ "$NPM_CI_KILL_AFTER_SECONDS" -lt 1 ] \
    || [ "$NPM_CI_ATTEMPTS" -lt 1 ] \
    || [ "$NPM_FETCH_RETRIES" -lt 1 ] \
    || [ "$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" -lt 1 ] \
    || [ "$NPM_FETCH_RETRY_MAX_TIMEOUT_MS" -lt "$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" ] \
    || [ "$BUILD_TIMEOUT_SECONDS" -lt 60 ] \
    || [ "$BUILD_KILL_AFTER_SECONDS" -lt 1 ] \
    || [ "$STALE_BUILD_MINUTES" -lt 1 ]; then
    echo "[deploy] deploy lock, install/build timeouts, and stale-build limits are invalid"
    exit 1
  fi
  if [ "$AUTOMATION_WORKER_KILL_TIMEOUT_MS" -lt 10000 ]; then
    echo "[deploy] AUTOMATION_WORKER_KILL_TIMEOUT_MS must be at least 10000"
    exit 1
  fi
  case "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED must be true or false"
      exit 1
      ;;
  esac
  case "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" in
    legacy|outbox) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE must be legacy or outbox"
      exit 1
      ;;
  esac
  case "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED must be true or false"
      exit 1
      ;;
  esac
  case "$ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED must be true or false"
      exit 1
      ;;
  esac
  if [ "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" = "outbox" ] \
    && [ "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" != "true" ]; then
    echo "[deploy] outbox invitation delivery requires the invitation worker"
    exit 1
  fi
  if ! [[ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" =~ ^[0-9]{2,5}$ ]] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" -lt 60 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" -gt 86100 ]; then
    echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS is invalid"
    exit 1
  fi
  if ! [[ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" =~ ^[0-9]{2,5}$ ]] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -lt 60 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -gt 86400 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -lt $((MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS + 300)) ]; then
    echo "[deploy] invitation issuance lease must cover the Auth link TTL plus 300 seconds"
    exit 1
  fi
}

acquire_deploy_lock() {
  if [ -L "$DEPLOY_LOCK_FILE" ]; then
    echo "[deploy] refusing to use a symlink as the deploy lock: $DEPLOY_LOCK_FILE"
    exit 1
  fi
  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -w "$DEPLOY_LOCK_WAIT_SECONDS" 9; then
    echo "[deploy] another deployment still owns the lock: $DEPLOY_LOCK_FILE"
    exit 1
  fi
  echo "[deploy] acquired exclusive deployment lock"
}

disk_usage_percent() {
  df -P "$APP_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

disk_available_mb() {
  df -Pk "$APP_DIR" | awk 'NR == 2 { print int($4 / 1024) }'
}

report_disk_status() {
  local disk_usage
  local disk_available
  disk_usage="$(disk_usage_percent)"
  disk_available="$(disk_available_mb)"
  echo "[deploy] disk usage: ${disk_usage}% (${disk_available} MB available)"
  if [ "$disk_usage" -ge "$DISK_WARNING_THRESHOLD" ]; then
    echo "[deploy] warning: disk usage has reached the ${DISK_WARNING_THRESHOLD}% warning threshold"
  fi
}

cleanup_cache_dir() {
  local expected_path="$1"
  local resolved_path
  if [ ! -d "$expected_path" ]; then
    return 0
  fi
  resolved_path="$(readlink -f "$expected_path" 2>/dev/null || true)"
  if [ -z "$resolved_path" ] || [ "$resolved_path" != "$expected_path" ]; then
    echo "[deploy] warning: refusing to clean unexpected cache path: $expected_path -> ${resolved_path:-missing}"
    return 0
  fi
  find "$resolved_path" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

cleanup_rebuildable_caches() {
  local home_dir="${HOME:-/root}"
  local disk_usage
  cleanup_cache_dir "$home_dir/.cache/ffmpeg-static-nodejs"
  disk_usage="$(disk_usage_percent)"
  if [ -n "$disk_usage" ] && [ "$disk_usage" -ge "$DISK_CACHE_CLEANUP_THRESHOLD" ]; then
    echo "[deploy] disk usage is ${disk_usage}%; clearing the rebuildable npm cache"
    cleanup_cache_dir "$home_dir/.npm/_cacache"
  fi
}

ensure_disk_headroom() {
  local disk_usage
  local disk_available
  disk_usage="$(disk_usage_percent)"
  disk_available="$(disk_available_mb)"
  if [ "$disk_usage" -ge "$DISK_ABORT_THRESHOLD" ]; then
    echo "[deploy] refusing to deploy at ${disk_usage}% disk usage; limit is ${DISK_ABORT_THRESHOLD}%"
    exit 1
  fi
  if [ "$disk_available" -lt "$MIN_FREE_DISK_MB" ]; then
    echo "[deploy] refusing to deploy with ${disk_available} MB free; minimum is ${MIN_FREE_DISK_MB} MB"
    exit 1
  fi
}

fetch_deploy_branch() {
  local attempt
  for attempt in $(seq 1 "$GIT_FETCH_ATTEMPTS"); do
    if git \
      -c http.lowSpeedLimit=1024 \
      -c "http.lowSpeedTime=$GIT_FETCH_LOW_SPEED_TIME_SECONDS" \
      fetch origin "$APP_BRANCH" --prune; then
      return 0
    fi
    if [ "$attempt" = "$GIT_FETCH_ATTEMPTS" ]; then
      echo "[deploy] Git fetch failed after $GIT_FETCH_ATTEMPTS attempts"
      return 1
    fi
    echo "[deploy] Git fetch attempt $attempt failed; retrying in ${GIT_FETCH_DELAY_SECONDS}s"
    sleep "$GIT_FETCH_DELAY_SECONDS"
  done
}

validate_disk_thresholds
acquire_deploy_lock
fetch_deploy_branch
REMOTE_DEPLOY_SHA="$(git rev-parse "origin/$APP_BRANCH")"
if [ "$REMOTE_DEPLOY_SHA" != "$EXPECTED_DEPLOY_SHA" ]; then
  echo "[deploy] origin/$APP_BRANCH no longer matches EXPECTED_DEPLOY_SHA"
  exit 1
fi
git checkout "$APP_BRANCH"
git reset --hard "$EXPECTED_DEPLOY_SHA"
if [ "$(git rev-parse HEAD)" != "$EXPECTED_DEPLOY_SHA" ]; then
  echo "[deploy] checked out revision does not match EXPECTED_DEPLOY_SHA"
  exit 1
fi
FAOLLA_WEB_BUILD_ID="$EXPECTED_DEPLOY_SHA"
FAOLLA_WEB_RELEASED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
report_disk_status
cleanup_rebuildable_caches
report_disk_status
ensure_disk_headroom

write_env_value() {
  local key="$1"
  local value="$2"
  local file="${3:-.env.local}"
  if [ -z "$key" ] || [ -z "$value" ]; then
    return 0
  fi
  local temp_file
  temp_file="$(mktemp)"
  if [ -f "$file" ]; then
    grep -v "^${key}=" "$file" > "$temp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$temp_file"
  mv "$temp_file" "$file"
}

remove_env_value() {
  local key="$1"
  local file="${2:-.env.local}"
  if [ -z "$key" ] || [ ! -f "$file" ]; then
    return 0
  fi
  local temp_file
  temp_file="$(mktemp)"
  grep -v "^${key}=" "$file" > "$temp_file" || true
  mv "$temp_file" "$file"
}

decode_base64_value() {
  local value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  printf '%s' "$value" | base64 -d
}

write_env_value "WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "WEB_PUSH_PRIVATE_KEY" "${WEB_PUSH_PRIVATE_KEY:-}"
write_env_value "WEB_PUSH_SUBJECT" "${WEB_PUSH_SUBJECT:-}"
write_env_value "NEXT_PUBLIC_SUPABASE_URL" "$(decode_base64_value "${NEXT_PUBLIC_SUPABASE_URL_B64:-}")"
SUPABASE_INTERNAL_URL_FROM_B64="$(decode_base64_value "${SUPABASE_INTERNAL_URL_B64:-}")"
write_env_value "SUPABASE_INTERNAL_URL" "${SUPABASE_INTERNAL_URL_FROM_B64:-$SUPABASE_INTERNAL_URL}"
write_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$(decode_base64_value "${NEXT_PUBLIC_SUPABASE_ANON_KEY_B64:-}")"
write_env_value "SUPABASE_SERVICE_ROLE_KEY" "$(decode_base64_value "${SUPABASE_SERVICE_ROLE_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_ID" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_TOKEN_KEY" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_REDIRECT_URI" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS" "${GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS:-}"
write_env_value "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS"
# Reset the persisted one-time gate and erase any prior case before validating
# a newly requested enablement. A failed deploy therefore stays closed, and
# the gate is written true only after both fresh secrets are safely persisted.
write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "false"
remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON"
remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET"
if [ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" = "true" ]; then
  if [ -z "${ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64:-}" ] \
    || [ -z "${ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64:-}" ]; then
    echo "[deploy] enabled ordinary legacy personal recovery requires fresh case and HMAC secrets"
    exit 1
  fi
  ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE="$(decode_base64_value "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64")"
  ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE="$(decode_base64_value "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64")"
  if [ -z "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE" ] \
    || [[ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE" =~ [[:space:]#] ]] \
    || ! [[ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE" =~ ^[0-9a-f]{64}$ ]]; then
    echo "[deploy] ordinary legacy personal recovery requires compact case JSON and a lowercase 64-hex HMAC secret"
    exit 1
  fi
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE"
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE"
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "true"
fi
write_env_value "RESEND_API_KEY" "$(decode_base64_value "${RESEND_API_KEY_B64:-}")"
write_env_value "SUPER_ADMIN_ACCOUNT" "${SUPER_ADMIN_ACCOUNT:-}"
write_env_value "SUPER_ADMIN_PASSWORD" "${SUPER_ADMIN_PASSWORD:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_EMAIL" "${SUPER_ADMIN_VERIFICATION_EMAIL:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_SECRET" "${SUPER_ADMIN_VERIFICATION_SECRET:-}"

if [ -f "$APP_DIR/scripts/configure-production-log-retention.sh" ]; then
  if ! bash "$APP_DIR/scripts/configure-production-log-retention.sh"; then
    echo "[deploy] warning: production log retention configuration failed"
  fi
fi

write_env_value "FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "FAOLLA_WEB_RELEASED_AT" "$FAOLLA_WEB_RELEASED_AT"

resolve_current_runtime_dir() {
  local linked_dir
  linked_dir="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  if [ -n "$linked_dir" ] && [ -d "$linked_dir/.next" ]; then
    printf '%s\n' "$linked_dir"
    return 0
  fi
  if [ -d "$APP_DIR/.next" ]; then
    printf '%s\n' "$APP_DIR"
    return 0
  fi
  printf '\n'
}

safe_remove_release_path() {
  local target="$1"
  local parent
  local resolved_parent
  if [ -z "$target" ]; then
    return 0
  fi
  parent="$(dirname "$target")"
  resolved_parent="$(readlink -f "$parent" 2>/dev/null || true)"
  if [ -z "$resolved_parent" ] || [ "$resolved_parent" != "$(readlink -f "$RELEASES_DIR")" ]; then
    echo "[deploy] refusing to remove unexpected release path: $target"
    exit 1
  fi
  rm -rf -- "$target"
}

release_path_in_use() {
  local target="$1"
  local resolved_target
  local cwd_link
  local process_cwd
  resolved_target="$(readlink -f "$target" 2>/dev/null || true)"
  if [ -z "$resolved_target" ]; then
    return 1
  fi
  for cwd_link in /proc/[0-9]*/cwd; do
    process_cwd="$(readlink -f "$cwd_link" 2>/dev/null || true)"
    if [ "$process_cwd" = "$resolved_target" ] || [[ "$process_cwd" == "$resolved_target/"* ]]; then
      return 0
    fi
  done
  return 1
}

cleanup_stale_build_dirs() {
  local release_dir
  while IFS= read -r -d '' release_dir; do
    if release_path_in_use "$release_dir"; then
      echo "[deploy] warning: stale build is still in use and was not removed: $release_dir"
      continue
    fi
    echo "[deploy] removing stale incomplete build: $release_dir"
    safe_remove_release_path "$release_dir"
  done < <(
    find "$RELEASES_DIR" \
      -mindepth 1 \
      -maxdepth 1 \
      -type d \
      -name '.*.building' \
      -mmin "+$STALE_BUILD_MINUTES" \
      -print0
  )
}

copy_previous_static_assets() {
  local previous_runtime_dir="$1"
  local next_release_dir="$2"
  local previous_static_dir="$previous_runtime_dir/.next/static"
  local next_static_dir="$next_release_dir/.next/static"
  local previous_manifest="$previous_runtime_dir/.faolla-current-static-files"
  local relative_path

  if [ ! -d "$previous_static_dir" ] || [ ! -d "$next_static_dir" ]; then
    return 0
  fi

  echo "[deploy] preserving previous release assets for open browser tabs"
  if [ -f "$previous_manifest" ]; then
    while IFS= read -r relative_path; do
      relative_path="${relative_path#./}"
      if [ -z "$relative_path" ] || [ ! -f "$previous_static_dir/$relative_path" ]; then
        continue
      fi
      mkdir -p "$(dirname "$next_static_dir/$relative_path")"
      cp -p -n -- "$previous_static_dir/$relative_path" "$next_static_dir/$relative_path"
    done < "$previous_manifest"
    return 0
  fi

  cp -a -n -- "$previous_static_dir/." "$next_static_dir/"
}

prepare_shared_runtime() {
  mkdir -p "$SHARED_RUNTIME_DIR"
  if [ "$PREVIOUS_RUNTIME_DIR" = "$APP_DIR" ] && [ -d "$APP_DIR/.runtime" ]; then
    echo "[deploy] migrating persistent runtime data into the shared directory"
    cp -a -- "$APP_DIR/.runtime/." "$SHARED_RUNTIME_DIR/"
  fi
}

prepare_legacy_static_bridge() {
  if [ "$PREVIOUS_RUNTIME_DIR" != "$APP_DIR" ]; then
    return 0
  fi
  if [ ! -d "$APP_DIR/.next/static" ] || [ ! -d "$RELEASE_DIR/.next/static" ]; then
    return 0
  fi
  echo "[deploy] adding new assets to the legacy static path before the first atomic switch"
  cp -a -n -- "$RELEASE_DIR/.next/static/." "$APP_DIR/.next/static/"
}

install_runtime_compatibility_links() {
  local next_link="$APP_DIR/.next"
  local modules_link="$APP_DIR/node_modules"
  local next_backup="$APP_DIR/.next.pre-atomic-deploy"
  local modules_backup="$APP_DIR/node_modules.pre-atomic-deploy"

  if [ "$(readlink "$next_link" 2>/dev/null || true)" = "$CURRENT_LINK/.next" ] \
    && [ "$(readlink "$modules_link" 2>/dev/null || true)" = "$CURRENT_LINK/node_modules" ]; then
    return 0
  fi
  if [ -e "$next_backup" ] || [ -L "$next_backup" ] \
    || [ -e "$modules_backup" ] || [ -L "$modules_backup" ]; then
    echo "[deploy] refusing to overwrite an existing compatibility backup"
    return 1
  fi

  if [ -e "$next_link" ] || [ -L "$next_link" ]; then
    mv -- "$next_link" "$next_backup"
  fi
  if [ -e "$modules_link" ] || [ -L "$modules_link" ]; then
    mv -- "$modules_link" "$modules_backup"
  fi

  if ! ln -s "$CURRENT_LINK/.next" "$next_link" \
    || ! ln -s "$CURRENT_LINK/node_modules" "$modules_link"; then
    rm -f -- "$next_link" "$modules_link"
    if [ -e "$next_backup" ] || [ -L "$next_backup" ]; then
      mv -- "$next_backup" "$next_link"
    fi
    if [ -e "$modules_backup" ] || [ -L "$modules_backup" ]; then
      mv -- "$modules_backup" "$modules_link"
    fi
    return 1
  fi

  rm -rf -- "$next_backup" "$modules_backup"
}

wait_for_port_release() {
  if ! command -v ss >/dev/null 2>&1; then
    sleep 2
    return 0
  fi
  for _ in $(seq 1 20); do
    if ! ss -ltn "( sport = :$APP_PORT )" | grep -Fq ":$APP_PORT"; then
      return 0
    fi
    sleep 1
  done
  echo "[deploy] port $APP_PORT is still in use after waiting"
  return 1
}

read_runtime_automation_worker_enabled() {
  local runtime_dir="$1"
  local configured_value=""
  if [ -f "$runtime_dir/.env.local" ]; then
    configured_value="$(grep '^MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED=' "$runtime_dir/.env.local" \
      | tail -n 1 \
      | cut -d= -f2- || true)"
  fi
  if [ "$configured_value" = "true" ]; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

read_runtime_invitation_worker_enabled() {
  local runtime_dir="$1"
  local configured_value=""
  if [ -f "$runtime_dir/.env.local" ]; then
    configured_value="$(grep '^MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED=' "$runtime_dir/.env.local" \
      | tail -n 1 \
      | cut -d= -f2- || true)"
  fi
  if [ "$configured_value" = "true" ]; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

start_release() {
  local runtime_dir="$1"
  local automation_worker_enabled
  if [ -z "$runtime_dir" ] || [ ! -f "$runtime_dir/package.json" ] || [ ! -d "$runtime_dir/.next" ]; then
    return 1
  fi
  automation_worker_enabled="$(read_runtime_automation_worker_enabled "$runtime_dir")"
  (
    cd "$runtime_dir"
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$automation_worker_enabled" \
      PORT="$APP_PORT" pm2 start npm --name "$APP_NAME" -- start -- -p "$APP_PORT"
  )
}

pm2_process_has_pid() {
  local process_name="$1"
  local process_pid
  process_pid="$(pm2 pid "$process_name" 2>/dev/null | tail -n 1 | tr -d '[:space:]')"
  [[ "$process_pid" =~ ^[1-9][0-9]*$ ]]
}

start_automation_worker_process() {
  local runtime_dir="$1"
  local tsx_entry="$runtime_dir/node_modules/tsx/dist/cli.mjs"
  local worker_entry="$runtime_dir/scripts/run-merchant-enterprise-automation-worker.ts"
  local automation_worker_enabled
  local invitation_worker_enabled
  if [ -z "$runtime_dir" ] \
    || [ ! -f "$runtime_dir/package.json" ] \
    || [ ! -f "$tsx_entry" ] \
    || [ ! -f "$worker_entry" ]; then
    return 1
  fi
  automation_worker_enabled="$(read_runtime_automation_worker_enabled "$runtime_dir")"
  invitation_worker_enabled="$(read_runtime_invitation_worker_enabled "$runtime_dir")"
  if [ "$automation_worker_enabled" != "true" ] \
    && [ "$invitation_worker_enabled" != "true" ]; then
    return 1
  fi
  (
    cd "$runtime_dir"
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$automation_worker_enabled" \
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="$invitation_worker_enabled" \
      pm2 start "$tsx_entry" \
      --name "$AUTOMATION_WORKER_NAME" \
      --interpreter node \
      --cwd "$runtime_dir" \
      --kill-timeout "$AUTOMATION_WORKER_KILL_TIMEOUT_MS" \
      --restart-delay 5000 \
      --wait-ready \
      --listen-timeout 20000 \
      -- "$worker_entry"
  )
}

wait_for_automation_worker_online() {
  local previous_pid=""
  local current_pid=""
  local stable_checks=0
  for _ in $(seq 1 20); do
    current_pid="$(pm2 pid "$AUTOMATION_WORKER_NAME" 2>/dev/null | tail -n 1 | tr -d '[:space:]')"
    if [[ "$current_pid" =~ ^[1-9][0-9]*$ ]]; then
      if [ "$current_pid" = "$previous_pid" ]; then
        stable_checks=$((stable_checks + 1))
      else
        previous_pid="$current_pid"
        stable_checks=1
      fi
      if [ "$stable_checks" -ge 3 ]; then
        return 0
      fi
    else
      previous_pid=""
      stable_checks=0
    fi
    sleep 1
  done
  return 1
}

wait_for_release_health() {
  local expected_build_id="$1"
  local response
  for _ in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
    response="$(curl -fsS --max-time 4 "http://127.0.0.1:${APP_PORT}/api/app-web-version" 2>/dev/null || true)"
    if [ -n "$response" ] && printf '%s' "$response" | grep -Fq "\"buildId\":\"$expected_build_id\""; then
      return 0
    fi
    sleep 1
  done
  return 1
}

run_local_release_smoke() {
  (
    cd "$RELEASE_DIR"
    node scripts/check-production-smoke.mjs \
      --origin "$RELEASE_SMOKE_ORIGIN" \
      --paths "$RELEASE_SMOKE_PATHS" \
      --expected-build "$FAOLLA_WEB_BUILD_ID" \
      --attempts "$RELEASE_SMOKE_ATTEMPTS" \
      --delay-ms "$RELEASE_SMOKE_DELAY_MS" \
      --timeout-ms "$RELEASE_SMOKE_TIMEOUT_MS"
  )
}

verify_supabase_health() {
  local attempt
  local status
  for attempt in 1 2 3; do
    status=0
    node scripts/check-supabase-health.mjs || status=$?
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" != "3" ]; then
      echo "[deploy] Supabase health check attempt $attempt failed with status $status; retrying"
      sleep 5
    fi
  done
  return "$status"
}

verify_booking_persistence() {
  (
    cd "$RELEASE_DIR"
    BOOKING_PERSISTENCE_CHECK_ATTEMPTS="${BOOKING_PERSISTENCE_CHECK_ATTEMPTS:-3}" \
      BOOKING_PERSISTENCE_CHECK_DELAY_MS="${BOOKING_PERSISTENCE_CHECK_DELAY_MS:-2000}" \
      BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS="${BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS:-10000}" \
      node --env-file=.env.local scripts/check-booking-persistence.mjs
  )
}

switch_current_release() {
  local release_dir="$1"
  local pending_link="${CURRENT_LINK}.pending"
  rm -f -- "$pending_link"
  ln -s "$release_dir" "$pending_link"
  mv -Tf -- "$pending_link" "$CURRENT_LINK"
}

cleanup_old_releases() {
  local current_release
  local index=0
  local release_dir
  current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  while IFS= read -r release_dir; do
    [ -n "$release_dir" ] || continue
    if [ "$release_dir" = "$current_release" ]; then
      continue
    fi
    index=$((index + 1))
    if [ "$index" -ge "$RELEASE_KEEP_COUNT" ]; then
      safe_remove_release_path "$release_dir"
    fi
  done < <(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*.building' -printf '%T@ %p\n' \
      | sort -nr \
      | cut -d' ' -f2-
  )
}

mkdir -p "$RELEASES_DIR" "$SHARED_RUNTIME_DIR"
cleanup_stale_build_dirs
RELEASE_STAMP="$(date -u +"%Y%m%d%H%M%S")"
RELEASE_NAME="${FAOLLA_WEB_BUILD_ID:0:12}-${RELEASE_STAMP}"
RELEASE_BUILD_DIR="$RELEASES_DIR/.${RELEASE_NAME}.building"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
PREVIOUS_RUNTIME_DIR="$(resolve_current_runtime_dir)"
PREVIOUS_LINK_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
PREVIOUS_AUTOMATION_WORKER_RUNNING=0
if pm2_process_has_pid "$AUTOMATION_WORKER_NAME"; then
  PREVIOUS_AUTOMATION_WORKER_RUNNING=1
fi
SWITCH_COMPLETED=0
PROCESSES_STOPPED=0
DEPLOY_HEALTHY=0

rollback_release() {
  if { [ "$SWITCH_COMPLETED" != "1" ] && [ "$PROCESSES_STOPPED" != "1" ]; } \
    || [ "$DEPLOY_HEALTHY" = "1" ]; then
    return 0
  fi
  echo "[deploy] new release failed health checks; restoring previous runtime"
  pm2 delete "$AUTOMATION_WORKER_NAME" >/dev/null 2>&1 || true
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  wait_for_port_release || true
  if [ -n "$PREVIOUS_LINK_TARGET" ] && [ -d "$PREVIOUS_LINK_TARGET/.next" ]; then
    switch_current_release "$PREVIOUS_LINK_TARGET"
  else
    rm -f -- "$CURRENT_LINK"
  fi
  if [ -n "$PREVIOUS_RUNTIME_DIR" ]; then
    start_release "$PREVIOUS_RUNTIME_DIR" >/dev/null 2>&1 || true
    if [ "$PREVIOUS_AUTOMATION_WORKER_RUNNING" = "1" ]; then
      start_automation_worker_process "$PREVIOUS_RUNTIME_DIR" >/dev/null 2>&1 || true
    fi
    pm2 save >/dev/null 2>&1 || true
  fi
}

cleanup_failed_build() {
  if [ -d "$RELEASE_BUILD_DIR" ]; then
    safe_remove_release_path "$RELEASE_BUILD_DIR"
  fi
  rollback_release
  if [ "$DEPLOY_HEALTHY" != "1" ] && [ -d "$RELEASE_DIR" ]; then
    safe_remove_release_path "$RELEASE_DIR"
  fi
}

trap cleanup_failed_build EXIT
safe_remove_release_path "$RELEASE_BUILD_DIR"
mkdir -p "$RELEASE_BUILD_DIR"

echo "[deploy] building isolated release: $RELEASE_DIR"
git archive --format=tar "$EXPECTED_DEPLOY_SHA" | tar -xf - -C "$RELEASE_BUILD_DIR"
cp -p -- "$APP_DIR/.env.local" "$RELEASE_BUILD_DIR/.env.local"

cd "$RELEASE_BUILD_DIR"
echo "[deploy] installing dependencies with up to ${NPM_CI_ATTEMPTS} attempts and a ${NPM_CI_TIMEOUT_SECONDS}s total timeout"
npm_ci_started_at=$SECONDS
npm_status=1
for ((npm_attempt = 1; npm_attempt <= NPM_CI_ATTEMPTS; npm_attempt++)); do
  npm_elapsed_seconds=$((SECONDS - npm_ci_started_at))
  npm_remaining_seconds=$((NPM_CI_TIMEOUT_SECONDS - npm_elapsed_seconds))
  if [ "$npm_remaining_seconds" -lt 1 ]; then
    npm_status=124
    break
  fi

  echo "[deploy] npm ci attempt ${npm_attempt}/${NPM_CI_ATTEMPTS}"
  set +e
  timeout \
    --signal=TERM \
    --kill-after="${NPM_CI_KILL_AFTER_SECONDS}s" \
    "${npm_remaining_seconds}s" \
    npm ci \
      --prefer-offline \
      --no-audit \
      --fetch-retries="$NPM_FETCH_RETRIES" \
      --fetch-retry-mintimeout="$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" \
      --fetch-retry-maxtimeout="$NPM_FETCH_RETRY_MAX_TIMEOUT_MS"
  npm_status=$?
  set -e

  if [ "$npm_status" -eq 0 ]; then
    break
  fi
  if [ "$npm_status" -eq 124 ] || [ "$npm_status" -eq 137 ]; then
    break
  fi
  if [ "$npm_attempt" -ge "$NPM_CI_ATTEMPTS" ]; then
    break
  fi

  npm_elapsed_seconds=$((SECONDS - npm_ci_started_at))
  npm_remaining_seconds=$((NPM_CI_TIMEOUT_SECONDS - npm_elapsed_seconds))
  if [ "$npm_remaining_seconds" -le "$NPM_CI_RETRY_DELAY_SECONDS" ]; then
    npm_status=124
    break
  fi
  echo "[deploy] npm ci attempt ${npm_attempt} failed with status ${npm_status}; retrying in ${NPM_CI_RETRY_DELAY_SECONDS}s"
  sleep "$NPM_CI_RETRY_DELAY_SECONDS"
done

if [ "$npm_status" -ne 0 ]; then
  if [ "$npm_status" -eq 124 ] || [ "$npm_status" -eq 137 ]; then
    echo "[deploy] npm ci exceeded the ${NPM_CI_TIMEOUT_SECONDS}s total timeout"
  else
    echo "[deploy] npm ci failed after ${NPM_CI_ATTEMPTS} attempts with status $npm_status"
  fi
  exit "$npm_status"
fi

if [ -f "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
  chmod +x "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" || true
  write_env_value "FFMPEG_PATH" "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" "$RELEASE_BUILD_DIR/.env.local"
elif command -v ffmpeg >/dev/null 2>&1; then
  write_env_value "FFMPEG_PATH" "$(command -v ffmpeg)" "$RELEASE_BUILD_DIR/.env.local"
else
  echo "[deploy] warning: ffmpeg binary not found; intro video uploads will not transcode"
fi

SUPABASE_HEALTH_STATUS=0
verify_supabase_health || SUPABASE_HEALTH_STATUS=$?
if [ "$SUPABASE_HEALTH_STATUS" -eq 2 ]; then
  echo "[deploy] warning: Supabase preflight was unreachable after retries; continuing because no configuration or backend validation error was returned"
elif [ "$SUPABASE_HEALTH_STATUS" -ne 0 ]; then
  echo "[deploy] Supabase health check failed with status $SUPABASE_HEALTH_STATUS"
  exit 1
fi
echo "[deploy] building application with a ${BUILD_TIMEOUT_SECONDS}s timeout"
if timeout \
  --signal=TERM \
  --kill-after="${BUILD_KILL_AFTER_SECONDS}s" \
  "${BUILD_TIMEOUT_SECONDS}s" \
  npm run build; then
  :
else
  build_status=$?
  if [ "$build_status" -eq 124 ] || [ "$build_status" -eq 137 ]; then
    echo "[deploy] application build exceeded the ${BUILD_TIMEOUT_SECONDS}s timeout"
  else
    echo "[deploy] application build failed with status $build_status"
  fi
  exit "$build_status"
fi

if [ ! -f "$RELEASE_BUILD_DIR/.next/BUILD_ID" ]; then
  echo "[deploy] isolated build did not produce .next/BUILD_ID"
  exit 1
fi

find "$RELEASE_BUILD_DIR/.next/static" -type f -printf '%P\n' | sort > "$RELEASE_BUILD_DIR/.faolla-current-static-files"
copy_previous_static_assets "$PREVIOUS_RUNTIME_DIR" "$RELEASE_BUILD_DIR"
cleanup_cache_dir "$RELEASE_BUILD_DIR/.next/cache"
if [ -e "$RELEASE_BUILD_DIR/.runtime" ] || [ -L "$RELEASE_BUILD_DIR/.runtime" ]; then
  echo "[deploy] isolated build unexpectedly created a .runtime path"
  exit 1
fi
ln -s "$SHARED_RUNTIME_DIR" "$RELEASE_BUILD_DIR/.runtime"
mv -- "$RELEASE_BUILD_DIR" "$RELEASE_DIR"

cd "$APP_DIR"
cleanup_rebuildable_caches
report_disk_status
ensure_disk_headroom
prepare_legacy_static_bridge

PROCESSES_STOPPED=1
if pm2 describe "$AUTOMATION_WORKER_NAME" >/dev/null 2>&1; then
  pm2 delete "$AUTOMATION_WORKER_NAME" >/dev/null 2>&1 || true
fi
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
fi
wait_for_port_release
prepare_shared_runtime
switch_current_release "$RELEASE_DIR"
SWITCH_COMPLETED=1

if ! start_release "$RELEASE_DIR"; then
  echo "[deploy] failed to start isolated release"
  exit 1
fi

if ! wait_for_release_health "$FAOLLA_WEB_BUILD_ID"; then
  echo "[deploy] release health check failed"
  exit 1
fi

BOOKING_PERSISTENCE_STATUS=0
verify_booking_persistence || BOOKING_PERSISTENCE_STATUS=$?
if [ "$BOOKING_PERSISTENCE_STATUS" -eq 2 ]; then
  echo "[deploy] warning: booking persistence endpoint was unreachable after retries; continuing because no schema or persisted-data error was returned"
elif [ "$BOOKING_PERSISTENCE_STATUS" -ne 0 ]; then
  echo "[deploy] booking persistence check failed with status $BOOKING_PERSISTENCE_STATUS"
  exit 1
fi

if ! run_local_release_smoke; then
  echo "[deploy] local release smoke check failed"
  exit 1
fi

if [ "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" = "true" ]; then
  echo "[deploy] starting enterprise worker supervisor"
  if ! start_automation_worker_process "$RELEASE_DIR"; then
    echo "[deploy] failed to start enterprise worker supervisor"
    exit 1
  fi
  if ! wait_for_automation_worker_online; then
    echo "[deploy] enterprise worker supervisor did not remain online"
    exit 1
  fi
else
  echo "[deploy] enterprise worker supervisor is disabled"
fi

install_runtime_compatibility_links
DEPLOY_HEALTHY=1
if ! pm2 save; then
  echo "[deploy] warning: pm2 save failed after the healthy release was activated"
fi

safe_remove_release_path "$RELEASE_BUILD_DIR"
cleanup_old_releases

trap - EXIT
report_disk_status
echo "[deploy] deploy finished: $RELEASE_NAME"
