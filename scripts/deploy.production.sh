#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/merchant-space}"
APP_NAME="${APP_NAME:-merchant-space}"
APP_PORT="${APP_PORT:-3000}"
APP_BRANCH="${APP_BRANCH:-main}"
RELEASES_DIR="${RELEASES_DIR:-${APP_DIR}.releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_DIR}.current}"
SHARED_DIR="${SHARED_DIR:-${APP_DIR}.shared}"
SHARED_RUNTIME_DIR="$SHARED_DIR/.runtime"
RELEASE_KEEP_COUNT="${RELEASE_KEEP_COUNT:-2}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
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

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[deploy] APP_DIR must already contain a git checkout: $APP_DIR"
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
    HEALTHCHECK_ATTEMPTS; do
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

validate_disk_thresholds
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

if [ -f "$APP_DIR/scripts/configure-production-log-retention.sh" ]; then
  if ! bash "$APP_DIR/scripts/configure-production-log-retention.sh"; then
    echo "[deploy] warning: production log retention configuration failed"
  fi
fi

FAOLLA_WEB_BUILD_ID="$(git rev-parse HEAD)"
FAOLLA_WEB_RELEASED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
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

start_release() {
  local runtime_dir="$1"
  if [ -z "$runtime_dir" ] || [ ! -f "$runtime_dir/package.json" ] || [ ! -d "$runtime_dir/.next" ]; then
    return 1
  fi
  (
    cd "$runtime_dir"
    PORT="$APP_PORT" pm2 start npm --name "$APP_NAME" -- start -- -p "$APP_PORT"
  )
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
RELEASE_STAMP="$(date -u +"%Y%m%d%H%M%S")"
RELEASE_NAME="${FAOLLA_WEB_BUILD_ID:0:12}-${RELEASE_STAMP}"
RELEASE_BUILD_DIR="$RELEASES_DIR/.${RELEASE_NAME}.building"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
PREVIOUS_RUNTIME_DIR="$(resolve_current_runtime_dir)"
PREVIOUS_LINK_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
SWITCH_COMPLETED=0
DEPLOY_HEALTHY=0

rollback_release() {
  if [ "$SWITCH_COMPLETED" != "1" ] || [ "$DEPLOY_HEALTHY" = "1" ]; then
    return 0
  fi
  echo "[deploy] new release failed health checks; restoring previous runtime"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  wait_for_port_release || true
  if [ -n "$PREVIOUS_LINK_TARGET" ] && [ -d "$PREVIOUS_LINK_TARGET/.next" ]; then
    switch_current_release "$PREVIOUS_LINK_TARGET"
  else
    rm -f -- "$CURRENT_LINK"
  fi
  if [ -n "$PREVIOUS_RUNTIME_DIR" ]; then
    start_release "$PREVIOUS_RUNTIME_DIR" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi
}

cleanup_failed_build() {
  if [ -d "$RELEASE_BUILD_DIR" ]; then
    safe_remove_release_path "$RELEASE_BUILD_DIR"
  fi
  rollback_release
}

trap cleanup_failed_build EXIT
safe_remove_release_path "$RELEASE_BUILD_DIR"
mkdir -p "$RELEASE_BUILD_DIR"

echo "[deploy] building isolated release: $RELEASE_DIR"
git archive --format=tar "origin/$APP_BRANCH" | tar -xf - -C "$RELEASE_BUILD_DIR"
cp -p -- "$APP_DIR/.env.local" "$RELEASE_BUILD_DIR/.env.local"

cd "$RELEASE_BUILD_DIR"
npm ci

if [ -f "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
  chmod +x "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" || true
  write_env_value "FFMPEG_PATH" "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" "$RELEASE_BUILD_DIR/.env.local"
elif command -v ffmpeg >/dev/null 2>&1; then
  write_env_value "FFMPEG_PATH" "$(command -v ffmpeg)" "$RELEASE_BUILD_DIR/.env.local"
else
  echo "[deploy] warning: ffmpeg binary not found; intro video uploads will not transcode"
fi

node scripts/check-supabase-health.mjs
npm run build

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

DEPLOY_HEALTHY=1
pm2 save

safe_remove_release_path "$RELEASE_BUILD_DIR"
cleanup_old_releases

if [ "$PREVIOUS_RUNTIME_DIR" = "$APP_DIR" ]; then
  rm -rf -- "$APP_DIR/.next" "$APP_DIR/node_modules"
fi

trap - EXIT
report_disk_status
echo "[deploy] deploy finished: $RELEASE_NAME"
