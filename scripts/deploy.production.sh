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

write_env_value "WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "WEB_PUSH_PRIVATE_KEY" "${WEB_PUSH_PRIVATE_KEY:-}"
write_env_value "WEB_PUSH_SUBJECT" "${WEB_PUSH_SUBJECT:-}"
write_env_value "NEXT_PUBLIC_SUPABASE_URL" "${NEXT_PUBLIC_SUPABASE_URL:-}"
write_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
write_env_value "SUPABASE_SERVICE_ROLE_KEY" "${SUPABASE_SERVICE_ROLE_KEY:-}"
write_env_value "SUPER_ADMIN_ACCOUNT" "${SUPER_ADMIN_ACCOUNT:-}"
write_env_value "SUPER_ADMIN_PASSWORD" "${SUPER_ADMIN_PASSWORD:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_EMAIL" "${SUPER_ADMIN_VERIFICATION_EMAIL:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_SECRET" "${SUPER_ADMIN_VERIFICATION_SECRET:-}"

git fetch origin "$APP_BRANCH" --prune
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"

npm ci
npm run build

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
