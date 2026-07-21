#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/merchant-space}"
APP_NAME="${APP_NAME:-merchant-space}"
APP_PORT="${APP_PORT:-3000}"
APP_BRANCH="${APP_BRANCH:-main}"

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

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[deploy] APP_DIR must already contain a git checkout: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

echo "[deploy] working directory: $APP_DIR"
echo "[deploy] branch: $APP_BRANCH"

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
  disk_usage="$(df -P "$APP_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if [ -n "$disk_usage" ] && [ "$disk_usage" -ge 85 ]; then
    echo "[deploy] disk usage is ${disk_usage}%; clearing the rebuildable npm cache"
    cleanup_cache_dir "$home_dir/.npm/_cacache"
  fi
}

cleanup_rebuildable_caches

write_env_value() {
  local key="$1"
  local value="$2"
  local file=".env.local"
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
write_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$(decode_base64_value "${NEXT_PUBLIC_SUPABASE_ANON_KEY_B64:-}")"
write_env_value "SUPABASE_SERVICE_ROLE_KEY" "$(decode_base64_value "${SUPABASE_SERVICE_ROLE_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_ID" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_TOKEN_KEY" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_REDIRECT_URI" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS" "${GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS:-}"
write_env_value "SUPER_ADMIN_ACCOUNT" "${SUPER_ADMIN_ACCOUNT:-}"
write_env_value "SUPER_ADMIN_PASSWORD" "${SUPER_ADMIN_PASSWORD:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_EMAIL" "${SUPER_ADMIN_VERIFICATION_EMAIL:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_SECRET" "${SUPER_ADMIN_VERIFICATION_SECRET:-}"

git fetch origin "$APP_BRANCH" --prune
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"

FAOLLA_WEB_BUILD_ID="$(git rev-parse HEAD)"
FAOLLA_WEB_RELEASED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
write_env_value "FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "FAOLLA_WEB_RELEASED_AT" "$FAOLLA_WEB_RELEASED_AT"

node scripts/check-supabase-health.mjs

npm ci

if [ -f "$APP_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
  chmod +x "$APP_DIR/node_modules/ffmpeg-static/ffmpeg" || true
  write_env_value "FFMPEG_PATH" "$APP_DIR/node_modules/ffmpeg-static/ffmpeg"
elif command -v ffmpeg >/dev/null 2>&1; then
  write_env_value "FFMPEG_PATH" "$(command -v ffmpeg)"
else
  echo "[deploy] warning: ffmpeg binary not found; intro video uploads will not transcode"
fi

npm run build
cleanup_rebuildable_caches

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
fi

if command -v ss >/dev/null 2>&1; then
  for _ in $(seq 1 20); do
    if ! ss -ltn "( sport = :$APP_PORT )" | grep -Fq ":$APP_PORT"; then
      break
    fi
    sleep 1
  done
  if ss -ltn "( sport = :$APP_PORT )" | grep -Fq ":$APP_PORT"; then
    echo "[deploy] port $APP_PORT is still in use after waiting"
    exit 1
  fi
fi

PORT="$APP_PORT" pm2 start npm --name "$APP_NAME" -- start -- -p "$APP_PORT"

pm2 save
echo "[deploy] deploy finished"
