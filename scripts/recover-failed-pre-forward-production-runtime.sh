#!/usr/bin/env bash
set -Eeuo pipefail

# Incident-only recovery for the failed pre-forward deploy named below.  This
# script intentionally cannot build, switch releases, acquire/release a fence,
# terminate a database session, or recursively remove anything.
umask 077

readonly EXPECTED_INCIDENT_DEPLOY_RUN_ID="32574586077"
readonly EXPECTED_INCIDENT_SHA="4381e6b555262d7fba696825c125c7793d6515f5"
readonly EXPECTED_INCIDENT_READINESS_RUN_ID="32574534420"
readonly EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT="1"
readonly EXPECTED_OLD_BUILD_ID="2a121454a18a16ae30e356977ca82b24a310e8e5"
readonly EXPECTED_CONFIRMATION="RECOVER_FAILED_PRE_FORWARD_DEPLOY_32574586077"

RECOVERY_PAYLOAD_FILE="${FAOLLA_RECOVERY_PAYLOAD_FILE:-}"
WEB_START_ATTEMPTED=0
WORKER_START_ATTEMPTED=0
PM2_SAVE_ATTEMPTED=0
RECOVERY_COMPLETE=0
FENCE_CLEANUP_STARTED=0
FENCE_CLEANUP_VERIFIED=0
RECOVERY_FAILURE_STAGE="input"
STARTED_WEB_PID=""
STARTED_WEB_START_TICKS=""
STARTED_WEB_PROCESS_IDENTITY=""
STARTED_WEB_CWD_IDENTITY=""
STARTED_WORKER_PID=""
STARTED_WORKER_START_TICKS=""
STARTED_WORKER_PROCESS_IDENTITY=""
STARTED_WORKER_CWD_IDENTITY=""

port_is_free() {
  local state
  state="$(timeout --signal=TERM --kill-after=1s 3s ss -H -ltn \
    "( sport = :${APP_PORT:-0} )" 2>/dev/null)" || return 1
  [ -z "$state" ]
}

wait_for_port_free_bounded() {
  local attempt
  for attempt in $(seq 1 15); do
    if port_is_free; then return 0; fi
    [ "$attempt" -eq 15 ] || sleep 1
  done
  return 1
}

cleanup_started_process() {
  local name="$1"
  local pid="$2"
  local start_ticks="$3"
  local process_identity="$4"
  local cwd_identity="$5"
  local require_free_port="$6"
  local current_state=""
  current_state="$(pm2_process_snapshot "$name" 2>/dev/null || true)"
  if [ -z "$pid" ] || [ -z "$start_ticks" ] \
    || [ -z "$process_identity" ] || [ -z "$cwd_identity" ]; then
    [ "$current_state" = "absent" ] || return 1
    [ "$require_free_port" = "0" ] || wait_for_port_free_bounded
    return
  fi
  case "$current_state" in
    "running:$pid")
      started_process_identity_matches "$name" "$pid" "$start_ticks" \
        "$process_identity" "$cwd_identity" || return 1
      timeout --signal=TERM --kill-after=5s 25s pm2 delete "$name" \
        >/dev/null 2>&1 || return 1
      ;;
    absent) ;;
    *) return 1 ;;
  esac
  [ "$(pm2_process_snapshot "$name" 2>/dev/null || true)" = "absent" ] \
    || return 1
  [ "$(linux_process_start_ticks "$pid" 2>/dev/null || true)" != "$start_ticks" ] \
    || return 1
  [ "$require_free_port" = "0" ] || wait_for_port_free_bounded
}

finish_recovery() {
  local status=$?
  local cleanup_status=0
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$RECOVERY_COMPLETE" -ne 1 ]; then
    if [ "$FENCE_CLEANUP_STARTED" -eq 1 ] \
      && [ "$FENCE_CLEANUP_VERIFIED" -ne 1 ]; then
      cleanup_status=1
    fi
    if [ "$WORKER_START_ATTEMPTED" -eq 1 ]; then
      cleanup_started_process "${AUTOMATION_WORKER_NAME:-invalid}" \
        "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
        "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" 0 \
        || cleanup_status=1
    fi
    if [ "$WEB_START_ATTEMPTED" -eq 1 ]; then
      cleanup_started_process "${APP_NAME:-invalid}" \
        "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
        "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" 1 \
        || cleanup_status=1
    fi
    if [ "$PM2_SAVE_ATTEMPTED" -eq 1 ] && [ "$cleanup_status" -eq 0 ]; then
      timeout --signal=TERM --kill-after=2s 10s pm2 save >/dev/null 2>&1 \
        || cleanup_status=1
    fi
    if [ "$cleanup_status" -ne 0 ]; then
      printf '%s\n' 'cleanup_unverified' >&2
    else
      case "$RECOVERY_FAILURE_STAGE" in
        input)
          printf '%s\n' 'recovery_failed_pre_runtime_input' >&2
          ;;
        repository)
          printf '%s\n' 'recovery_failed_pre_runtime_repository' >&2
          ;;
        deploy_lock)
          printf '%s\n' 'recovery_failed_pre_runtime_deploy_lock' >&2
          ;;
        helpers)
          printf '%s\n' 'recovery_failed_pre_runtime_helpers' >&2
          ;;
        legacy_release)
          printf '%s\n' 'recovery_failed_pre_runtime_legacy_release' >&2
          ;;
        legacy_environment)
          printf '%s\n' 'recovery_failed_pre_runtime_legacy_environment' >&2
          ;;
        database_preflight)
          printf '%s\n' 'recovery_failed_pre_runtime_database_preflight' >&2
          ;;
        runtime)
          printf '%s\n' 'recovery_failed' >&2
          ;;
        *)
          printf '%s\n' 'recovery_failed_stage_invalid' >&2
          ;;
      esac
    fi
  fi
  if [ -n "${RECOVERY_PAYLOAD_FILE:-}" ]; then
    rm -f -- "$RECOVERY_PAYLOAD_FILE" >/dev/null 2>&1 || true
  fi
  unset \
    PREVIOUS_SUPABASE_INTERNAL_URL \
    PREVIOUS_NEXT_PUBLIC_SUPABASE_URL \
    PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SNAPSHOT_INTERNAL_URL_B64 \
    SNAPSHOT_PUBLIC_URL_B64 \
    SNAPSHOT_ANON_KEY_B64
  exit "$status"
}
trap finish_recovery EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1
}

for required_command in \
  base64 basename curl date dirname docker find flock git id node pm2 readlink \
  rmdir seq sleep ss stat timeout unlink; do
  require_command "$required_command" || exit 1
done

if [ -z "$RECOVERY_PAYLOAD_FILE" ] \
  || [ ! -f "$RECOVERY_PAYLOAD_FILE" ] \
  || [ -L "$RECOVERY_PAYLOAD_FILE" ]; then
  exit 1
fi

loaded_count=0
while IFS= read -r -d '' payload_key \
  && IFS= read -r -d '' payload_value; do
  case "$payload_key" in
    APP_DIR|APP_NAME|APP_PORT|DATABASE_CONTAINER_ID|DATABASE_CONTAINER_NAME|\
    DATABASE_NAME|DATABASE_OID|\
    DATABASE_PRIMARY|DATABASE_SYSTEM_ID|FAILED_RUN_STARTED_EPOCH|\
    FAILED_RUN_COMPLETED_EPOCH|INCIDENT_DEPLOY_RUN_ID|INCIDENT_SHA|\
    READINESS_RUN_ID|READINESS_RUN_ATTEMPT|CONFIRMATION)
      printf -v "$payload_key" '%s' "$payload_value"
      loaded_count=$((loaded_count + 1))
      ;;
    *) exit 1 ;;
  esac
done < <(
  node --input-type=module - "$RECOVERY_PAYLOAD_FILE" <<'NODE'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const fail = () => process.exit(1);
const expectedKeys = [
  "APP_DIR",
  "APP_NAME",
  "APP_PORT",
  "CONFIRMATION",
  "DATABASE_CONTAINER_ID",
  "DATABASE_CONTAINER_NAME",
  "DATABASE_NAME",
  "DATABASE_OID",
  "DATABASE_PRIMARY",
  "DATABASE_SYSTEM_ID",
  "FAILED_RUN_COMPLETED_EPOCH",
  "FAILED_RUN_STARTED_EPOCH",
  "INCIDENT_DEPLOY_RUN_ID",
  "INCIDENT_SHA",
  "READINESS_RUN_ATTEMPT",
  "READINESS_RUN_ID",
].sort();
let descriptor;
try {
  const path = process.argv[2];
  const before = lstatSync(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size <= 0n || before.size > 65536n ||
    (process.platform !== "win32" && (
      typeof process.getuid !== "function" || before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o777n) !== 0o600n
    ))
  ) fail();
  descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = fstatSync(descriptor, { bigint: true });
  if (
    !opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
    opened.size !== before.size || opened.mtimeNs !== before.mtimeNs ||
    opened.nlink !== 1n
  ) fail();
  const bytes = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  if (
    BigInt(bytes.length) !== opened.size || after.dev !== opened.dev ||
    after.ino !== opened.ino || after.size !== opened.size ||
    after.mtimeNs !== opened.mtimeNs || current.isSymbolicLink() ||
    !current.isFile() || current.nlink !== 1n || current.dev !== opened.dev ||
    current.ino !== opened.ino || current.size !== opened.size ||
    current.mtimeNs !== opened.mtimeNs
  ) fail();
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) fail();
  const canonical = Buffer.from(`${JSON.stringify(Object.fromEntries(keys.map((key) => [key, value[key]])))}\n`, "utf8");
  if (!bytes.equals(canonical)) fail();
  for (const key of expectedKeys) {
    if (typeof value[key] !== "string" || value[key].includes("\0")) fail();
    process.stdout.write(`${key}\0${value[key]}\0`);
  }
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
)
rm -f -- "$RECOVERY_PAYLOAD_FILE" >/dev/null 2>&1
RECOVERY_PAYLOAD_FILE=""

[ "$loaded_count" -eq 16 ] || exit 1
[ "$INCIDENT_DEPLOY_RUN_ID" = "$EXPECTED_INCIDENT_DEPLOY_RUN_ID" ] || exit 1
[ "$INCIDENT_SHA" = "$EXPECTED_INCIDENT_SHA" ] || exit 1
[ "$READINESS_RUN_ID" = "$EXPECTED_INCIDENT_READINESS_RUN_ID" ] || exit 1
[ "$READINESS_RUN_ATTEMPT" = "$EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT" ] || exit 1
[ "$CONFIRMATION" = "$EXPECTED_CONFIRMATION" ] || exit 1
[[ "$APP_DIR" == /* ]] || exit 1
[[ "$APP_NAME" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || exit 1
[[ "$APP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || exit 1
[ "$APP_PORT" -le 65535 ] || exit 1
[[ "$DATABASE_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ "$DATABASE_CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
[[ "$DATABASE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$ ]] || exit 1
[[ "$DATABASE_OID" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$DATABASE_SYSTEM_ID" =~ ^[1-9][0-9]{9,19}$ ]] || exit 1
[ "$DATABASE_PRIMARY" = "true" ] || exit 1
node -e '
  const value = process.argv[1];
  if (BigInt(value) > 18_446_744_073_709_551_615n) process.exit(1);
' "$DATABASE_SYSTEM_ID" >/dev/null 2>&1 || exit 1
[[ "$FAILED_RUN_STARTED_EPOCH" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$FAILED_RUN_COMPLETED_EPOCH" =~ ^[1-9][0-9]*$ ]] || exit 1
[ "$FAILED_RUN_STARTED_EPOCH" -lt "$FAILED_RUN_COMPLETED_EPOCH" ] || exit 1
[ $((FAILED_RUN_COMPLETED_EPOCH - FAILED_RUN_STARTED_EPOCH)) -le 10800 ] || exit 1
RECOVERY_NOW_EPOCH="$(date +%s 2>/dev/null || true)"
[[ "$RECOVERY_NOW_EPOCH" =~ ^[1-9][0-9]*$ ]] || exit 1
[ "$RECOVERY_NOW_EPOCH" -ge $((FAILED_RUN_COMPLETED_EPOCH + 1390)) ] || exit 1

RECOVERY_FAILURE_STAGE="repository"

APP_DIR_REAL="$(readlink -f -- "$APP_DIR" 2>/dev/null || true)"
[ "$APP_DIR_REAL" = "$APP_DIR" ] || exit 1
[ -d "$APP_DIR/.git" ] || exit 1
[ "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)" = "$EXPECTED_INCIDENT_SHA" ] || exit 1

readonly RELEASES_DIR="${APP_DIR}.releases"
readonly CURRENT_LINK="${APP_DIR}.current"
readonly SHARED_RUNTIME_DIR="${APP_DIR}.shared/.runtime"
readonly DEPLOY_LOCK_FILE="${APP_DIR}.deploy.lock"
readonly AUTOMATION_WORKER_NAME="${APP_NAME}-enterprise-automation-worker"
readonly ENV_HELPER_RELATIVE="scripts/read-production-supabase-environment.mjs"
readonly FENCE_HELPER_RELATIVE="scripts/hold-ordinary-account-cutover-readiness-fence.mjs"
readonly ENV_HELPER="$APP_DIR/scripts/read-production-supabase-environment.mjs"
readonly FENCE_HELPER="$APP_DIR/scripts/hold-ordinary-account-cutover-readiness-fence.mjs"

[ -d "$RELEASES_DIR" ] && [ ! -L "$RELEASES_DIR" ] || exit 1
[ -d "$SHARED_RUNTIME_DIR" ] && [ ! -L "$SHARED_RUNTIME_DIR" ] || exit 1
for protected_root in "$RELEASES_DIR" "$(dirname -- "$SHARED_RUNTIME_DIR")" "$SHARED_RUNTIME_DIR"; do
  [ "$(readlink -f -- "$protected_root" 2>/dev/null || true)" = "$protected_root" ] || exit 1
  protected_identity="$(stat -c '%u:%a' -- "$protected_root" 2>/dev/null || true)"
  IFS=: read -r protected_uid protected_mode <<< "$protected_identity"
  [ "$protected_uid" = "$(id -u)" ] && [[ "$protected_mode" =~ ^[0-7]{3,4}$ ]] || exit 1
  [ $((8#$protected_mode & 8#022)) -eq 0 ] || exit 1
done
[ -f "$ENV_HELPER" ] && [ ! -L "$ENV_HELPER" ] || exit 1
[ -f "$FENCE_HELPER" ] && [ ! -L "$FENCE_HELPER" ] || exit 1
for helper_path in \
  "$ENV_HELPER_RELATIVE" \
  "$FENCE_HELPER_RELATIVE"; do
  git -C "$APP_DIR" diff --quiet -- "$helper_path" >/dev/null 2>&1 || exit 1
  git -C "$APP_DIR" diff --cached --quiet -- "$helper_path" >/dev/null 2>&1 || exit 1
  helper_blob="$(git -C "$APP_DIR" rev-parse "$EXPECTED_INCIDENT_SHA:$helper_path" 2>/dev/null || true)"
  [[ "$helper_blob" =~ ^[0-9a-f]{40,64}$ ]] || exit 1
  [ "$(git -C "$APP_DIR" hash-object "$APP_DIR/$helper_path" 2>/dev/null || true)" = "$helper_blob" ] || exit 1
done

RECOVERY_FAILURE_STAGE="deploy_lock"

[ -L "$CURRENT_LINK" ] || exit 1
[ ! -L "$DEPLOY_LOCK_FILE" ] || exit 1
if ! { exec 9>"$DEPLOY_LOCK_FILE"; } 2>/dev/null; then exit 1; fi
flock -w 1 9 >/dev/null 2>&1 || exit 1
DEPLOY_LOCK_IDENTITY="$(stat -c '%d:%i:%h:%u:%a' -- "$DEPLOY_LOCK_FILE" 2>/dev/null || true)"
[[ "$DEPLOY_LOCK_IDENTITY" =~ ^([0-9]+:){4}[0-9]+$ ]] || exit 1
[ "$DEPLOY_LOCK_IDENTITY" = "$(stat -Lc '%d:%i:%h:%u:%a' -- "/proc/$$/fd/9" 2>/dev/null || true)" ] || exit 1
IFS=: read -r _ _ deploy_lock_links deploy_lock_uid deploy_lock_mode <<< "$DEPLOY_LOCK_IDENTITY"
[ "$deploy_lock_links" = "1" ] && [ "$deploy_lock_uid" = "$(id -u)" ] \
  && [ "$deploy_lock_mode" = "600" ] || exit 1

revalidate_deploy_lock() {
  [ ! -L "$DEPLOY_LOCK_FILE" ] \
    && [ "$(stat -c '%d:%i:%h:%u:%a' -- "$DEPLOY_LOCK_FILE" 2>/dev/null || true)" = "$DEPLOY_LOCK_IDENTITY" ] \
    && [ "$(stat -Lc '%d:%i:%h:%u:%a' -- "/proc/$$/fd/9" 2>/dev/null || true)" = "$DEPLOY_LOCK_IDENTITY" ]
}

trusted_helper_snapshot() {
  local helper_path="$1"
  local helper_relative="$2"
  local expected_blob
  local snapshot
  case "$helper_relative" in
    "$ENV_HELPER_RELATIVE"|"$FENCE_HELPER_RELATIVE") ;;
    *) return 1 ;;
  esac
  [ "$helper_path" = "$APP_DIR/$helper_relative" ] || return 1
  revalidate_deploy_lock || return 1
  [ "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)" = "$EXPECTED_INCIDENT_SHA" ] \
    || return 1
  [ -f "$helper_path" ] && [ ! -L "$helper_path" ] || return 1
  git -C "$APP_DIR" diff --quiet -- "$helper_relative" >/dev/null 2>&1 \
    || return 1
  git -C "$APP_DIR" diff --cached --quiet -- "$helper_relative" >/dev/null 2>&1 \
    || return 1
  expected_blob="$(git -C "$APP_DIR" rev-parse \
    "$EXPECTED_INCIDENT_SHA:$helper_relative" 2>/dev/null || true)"
  [[ "$expected_blob" =~ ^[0-9a-f]{40,64}$ ]] || return 1
  snapshot="$(FAOLLA_EXPECTED_HELPER_BLOB="$expected_blob" \
    timeout --signal=TERM --kill-after=1s 5s node --input-type=module - \
      "$helper_path" 2>/dev/null <<'NODE'
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const fail = () => process.exit(1);
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs && left.nlink === right.nlink &&
  left.uid === right.uid && left.mode === right.mode;
const identity = (value) => [
  value.dev, value.ino, value.size, value.mtimeNs,
  value.ctimeNs, value.nlink, value.uid, value.mode,
].map(String).join(":");
let descriptor;
try {
  const path = process.argv[2];
  const expectedBlob = process.env.FAOLLA_EXPECTED_HELPER_BLOB ?? "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedBlob)) fail();
  if (typeof process.getuid !== "function" || !Number.isInteger(constants.O_NOFOLLOW)) fail();
  const before = lstatSync(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid()) || (before.mode & 0o022n) !== 0n ||
    before.size <= 0n || before.size > 1024n * 1024n
  ) fail();
  descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const opened = fstatSync(descriptor, { bigint: true });
  if (!opened.isFile() || !sameIdentity(before, opened)) fail();
  const bytes = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  if (
    BigInt(bytes.length) !== opened.size || !sameIdentity(opened, after) ||
    current.isSymbolicLink() || !current.isFile() ||
    !sameIdentity(opened, current)
  ) fail();
  const algorithm = expectedBlob.length === 40 ? "sha1" : "sha256";
  const actualBlob = createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  if (actualBlob !== expectedBlob) fail();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  process.stdout.write(`${identity(opened)}:${actualBlob}:${sha256}`);
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
  )" || return 1
  [[ "$snapshot" =~ ^([0-9]+:){7}[0-9]+:[0-9a-f]{40,64}:[0-9a-f]{64}$ ]] \
    || return 1
  printf '%s' "$snapshot"
}

trusted_helper_matches() {
  local helper_path="$1"
  local helper_relative="$2"
  local frozen_snapshot="$3"
  local current_snapshot
  [[ "$frozen_snapshot" =~ ^([0-9]+:){7}[0-9]+:[0-9a-f]{40,64}:[0-9a-f]{64}$ ]] \
    || return 1
  current_snapshot="$(trusted_helper_snapshot "$helper_path" "$helper_relative")" \
    || return 1
  [ "$current_snapshot" = "$frozen_snapshot" ]
}

RECOVERY_FAILURE_STAGE="helpers"

ENV_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot \
  "$ENV_HELPER" "$ENV_HELPER_RELATIVE")" || exit 1
FENCE_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot \
  "$FENCE_HELPER" "$FENCE_HELPER_RELATIVE")" || exit 1
readonly ENV_HELPER_FROZEN_SNAPSHOT FENCE_HELPER_FROZEN_SNAPSHOT

RECOVERY_FAILURE_STAGE="legacy_release"

capture_trusted_environment_helper_output() {
  local output_name="$1"
  local timeout_seconds="$2"
  shift 2
  local captured=""
  local helper_status=0
  [[ "$output_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || return 1
  trusted_helper_matches \
    "$ENV_HELPER" "$ENV_HELPER_RELATIVE" "$ENV_HELPER_FROZEN_SNAPSHOT" \
    || return 1
  if captured="$(timeout --signal=TERM --kill-after=1s \
    "${timeout_seconds}s" node "$ENV_HELPER" "$@" 2>/dev/null)"; then
    helper_status=0
  else
    helper_status=$?
  fi
  trusted_helper_matches \
    "$ENV_HELPER" "$ENV_HELPER_RELATIVE" "$ENV_HELPER_FROZEN_SNAPSHOT" \
    || return 1
  [ "$helper_status" -eq 0 ] || return 1
  printf -v "$output_name" '%s' "$captured"
}

RELEASES_REAL="$(readlink -f -- "$RELEASES_DIR" 2>/dev/null || true)"
PREVIOUS_RUNTIME_DIR="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
[ -n "$RELEASES_REAL" ] && [ -n "$PREVIOUS_RUNTIME_DIR" ] || exit 1
[ "$(dirname -- "$PREVIOUS_RUNTIME_DIR")" = "$RELEASES_REAL" ] || exit 1
PREVIOUS_RELEASE_NAME="$(basename -- "$PREVIOUS_RUNTIME_DIR")"
[[ "$PREVIOUS_RELEASE_NAME" =~ ^2a121454a18a-[0-9]{14}$ ]] || exit 1
[ -d "$PREVIOUS_RUNTIME_DIR/.next" ] && [ ! -L "$PREVIOUS_RUNTIME_DIR/.next" ] || exit 1
[ -f "$PREVIOUS_RUNTIME_DIR/package.json" ] && [ ! -L "$PREVIOUS_RUNTIME_DIR/package.json" ] || exit 1
[ -d "$PREVIOUS_RUNTIME_DIR/node_modules" ] && [ ! -L "$PREVIOUS_RUNTIME_DIR/node_modules" ] || exit 1
[ -L "$PREVIOUS_RUNTIME_DIR/.runtime" ] || exit 1
[ "$(readlink -f -- "$PREVIOUS_RUNTIME_DIR/.runtime" 2>/dev/null || true)" = "$SHARED_RUNTIME_DIR" ] || exit 1
[ "$(readlink -f -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_DIR" ] || exit 1

CURRENT_LINK_IDENTITY="$(stat -c '%d:%i:%s:%Y:%Z:%u' -- "$CURRENT_LINK" 2>/dev/null || true)"
PREVIOUS_RUNTIME_IDENTITY="$(stat -Lc '%d:%i:%Y:%Z:%u:%a' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)"
[[ "$CURRENT_LINK_IDENTITY" =~ ^([0-9]+:){5}[0-9]+$ ]] || exit 1
[[ "$PREVIOUS_RUNTIME_IDENTITY" =~ ^([0-9]+:){5}[0-9]+$ ]] || exit 1
IFS=: read -r _ _ _ _ previous_runtime_uid previous_runtime_mode <<< "$PREVIOUS_RUNTIME_IDENTITY"
[ "$previous_runtime_uid" = "$(id -u)" ] && [[ "$previous_runtime_mode" =~ ^[0-7]{3,4}$ ]] || exit 1
[ $((8#$previous_runtime_mode & 8#022)) -eq 0 ] || exit 1

RECOVERY_FAILURE_STAGE="legacy_environment"

ROLLBACK_SNAPSHOT=""
capture_trusted_environment_helper_output ROLLBACK_SNAPSHOT 5 \
  rollback-snapshot "$PREVIOUS_RUNTIME_DIR/.env.local" "$EXPECTED_OLD_BUILD_ID" \
  || exit 1
mapfile -t ROLLBACK_PARTS <<< "$ROLLBACK_SNAPSHOT"
[ "${#ROLLBACK_PARTS[@]}" -eq 6 ] || exit 1
ENVIRONMENT_DIRECTORY_IDENTITY="${ROLLBACK_PARTS[0]}"
ENVIRONMENT_FILE_IDENTITY="${ROLLBACK_PARTS[1]}"
ENVIRONMENT_SHA256="${ROLLBACK_PARTS[2]}"
SNAPSHOT_INTERNAL_URL_B64="${ROLLBACK_PARTS[3]}"
SNAPSHOT_PUBLIC_URL_B64="${ROLLBACK_PARTS[4]}"
SNAPSHOT_ANON_KEY_B64="${ROLLBACK_PARTS[5]}"
unset ROLLBACK_SNAPSHOT ROLLBACK_PARTS
[[ "$ENVIRONMENT_DIRECTORY_IDENTITY" =~ ^([0-9]+:){6}[0-9]+$ ]] || exit 1
[[ "$ENVIRONMENT_FILE_IDENTITY" =~ ^([0-9]+:){7}[0-9]+$ ]] || exit 1
[[ "$ENVIRONMENT_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 1

decode_strict_base64() {
  local encoded="$1"
  local decoded
  [ -n "$encoded" ] && [[ "$encoded" =~ ^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ ]] \
    || return 1
  decoded="$(printf '%s' "$encoded" | base64 -d 2>/dev/null)" || return 1
  [ -n "$decoded" ] || return 1
  [ "$(printf '%s' "$decoded" | base64 -w0)" = "$encoded" ] || return 1
  printf '%s' "$decoded"
}

PREVIOUS_SUPABASE_INTERNAL_URL="$(decode_strict_base64 "$SNAPSHOT_INTERNAL_URL_B64")" || exit 1
PREVIOUS_NEXT_PUBLIC_SUPABASE_URL="$(decode_strict_base64 "$SNAPSHOT_PUBLIC_URL_B64")" || exit 1
PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY="$(decode_strict_base64 "$SNAPSHOT_ANON_KEY_B64")" || exit 1

WORKER_CONFIGURATION="$(
  timeout --signal=TERM --kill-after=1s 3s node --input-type=module - \
    "$PREVIOUS_RUNTIME_DIR/.env.local" \
    "$ENVIRONMENT_FILE_IDENTITY" "$ENVIRONMENT_SHA256" 2>/dev/null <<'NODE'
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
const [path, expectedIdentity, expectedSha256] = process.argv.slice(2);
const identity = (value) => [
  value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.nlink, value.uid, value.mode,
].map(String).join(":");
let descriptor;
let bytes;
try {
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || identity(before) !== expectedIdentity) process.exit(1);
  descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = fstatSync(descriptor, { bigint: true });
  if (identity(opened) !== expectedIdentity) process.exit(1);
  bytes = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  if (
    identity(after) !== expectedIdentity || identity(current) !== expectedIdentity ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  ) process.exit(1);
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
if (source.includes("\0") || source.includes("\r")) process.exit(1);
const lines = source.split("\n");
const exact = (key) => {
  const prefix = `${key}=`;
  const values = lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
  if (values.length !== 1 || !["true", "false"].includes(values[0])) process.exit(1);
  return values[0];
};
process.stdout.write(`${exact("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED")}\n${exact("MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED")}`);
NODE
)" || exit 1
mapfile -t WORKER_CONFIGURATION_PARTS <<< "$WORKER_CONFIGURATION"
[ "${#WORKER_CONFIGURATION_PARTS[@]}" -eq 2 ] || exit 1
AUTOMATION_WORKER_ENABLED="${WORKER_CONFIGURATION_PARTS[0]}"
INVITATION_WORKER_ENABLED="${WORKER_CONFIGURATION_PARTS[1]}"
unset WORKER_CONFIGURATION WORKER_CONFIGURATION_PARTS

revalidate_frozen_runtime() {
  local current_snapshot
  local -a current_parts=()
  [ -L "$CURRENT_LINK" ] \
    && [ "$(stat -c '%d:%i:%s:%Y:%Z:%u' -- "$CURRENT_LINK" 2>/dev/null || true)" = "$CURRENT_LINK_IDENTITY" ] \
    && [ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_DIR" ] \
    && [ "$(stat -Lc '%d:%i:%Y:%Z:%u:%a' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_IDENTITY" ] \
    || return 1
  current_snapshot=""
  capture_trusted_environment_helper_output current_snapshot 5 snapshot \
    "$PREVIOUS_RUNTIME_DIR/.env.local" "$EXPECTED_OLD_BUILD_ID" \
    || return 1
  mapfile -t current_parts <<< "$current_snapshot"
  [ "${#current_parts[@]}" -eq 3 ] \
    && [ "${current_parts[0]}" = "$ENVIRONMENT_DIRECTORY_IDENTITY" ] \
    && [ "${current_parts[1]}" = "$ENVIRONMENT_FILE_IDENTITY" ] \
    && [ "${current_parts[2]}" = "$ENVIRONMENT_SHA256" ]
}

revalidate_frozen_runtime || exit 1
revalidate_deploy_lock || exit 1

RECOVERY_FAILURE_STAGE="database_preflight"

# Prove that no readiness-fence database state remains.  This query is
# observational only: it contains no cancellation or termination primitive.
verify_database_fence_clear() {
  local container_identity
  local database_fence_state
  container_identity="$(docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Running}}' \
    "$DATABASE_CONTAINER_ID" 2>/dev/null || true)"
  [ "$container_identity" = "$DATABASE_CONTAINER_ID|/$DATABASE_CONTAINER_NAME|true" ] \
    || return 1
  database_fence_state="$(
    timeout --signal=TERM --kill-after=3s 15s \
      docker exec --interactive \
      --env "FAOLLA_EXPECTED_DATABASE_NAME=$DATABASE_NAME" \
      --env "FAOLLA_EXPECTED_DATABASE_OID=$DATABASE_OID" \
      --env "FAOLLA_EXPECTED_DATABASE_SYSTEM_ID=$DATABASE_SYSTEM_ID" \
      --env "FAOLLA_EXPECTED_DATABASE_PRIMARY=$DATABASE_PRIMARY" \
      "$DATABASE_CONTAINER_ID" sh -c '
      set -eu
      : "${POSTGRES_PASSWORD:?}"
      : "${POSTGRES_DB:?}"
      : "${FAOLLA_EXPECTED_DATABASE_NAME:?}"
      : "${FAOLLA_EXPECTED_DATABASE_OID:?}"
      : "${FAOLLA_EXPECTED_DATABASE_SYSTEM_ID:?}"
      : "${FAOLLA_EXPECTED_DATABASE_PRIMARY:?}"
      test "$POSTGRES_DB" = "$FAOLLA_EXPECTED_DATABASE_NAME"
      test "$FAOLLA_EXPECTED_DATABASE_PRIMARY" = "true"
      export PGPASSWORD="$POSTGRES_PASSWORD"
      export PGOPTIONS="-c lock_timeout=5s -c statement_timeout=10s"
      exec psql --host=localhost --username=supabase_admin \
        --dbname="$FAOLLA_EXPECTED_DATABASE_NAME" \
        --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
        --set=expected_database_name="$FAOLLA_EXPECTED_DATABASE_NAME" \
        --set=expected_database_oid="$FAOLLA_EXPECTED_DATABASE_OID" \
        --set=expected_database_system_id="$FAOLLA_EXPECTED_DATABASE_SYSTEM_ID" \
        --quiet --tuples-only --no-align
    ' 2>/dev/null <<'SQL'
WITH matching_sessions AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.datid = (
      SELECT database.oid
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = pg_catalog.current_database()
    )
    AND activity.pid <> pg_catalog.pg_backend_pid()
    AND activity.application_name OPERATOR(pg_catalog.~)
      '^faolla_readiness_fence_[1-9][0-9]*_[0-9a-f]{24}$'
), blocked_waiters AS MATERIALIZED (
  SELECT DISTINCT waiter.pid
  FROM pg_catalog.pg_stat_activity AS waiter
  CROSS JOIN matching_sessions AS holder
  WHERE waiter.pid <> holder.pid
    AND holder.pid = ANY(pg_catalog.pg_blocking_pids(waiter.pid))
)
SELECT
  pg_catalog.current_database()
  || ':' ||
  (SELECT database.oid::text
   FROM pg_catalog.pg_database AS database
   WHERE database.datname = pg_catalog.current_database()
     AND database.datname = :'expected_database_name'::name
     AND database.oid = :'expected_database_oid'::oid)
  || ':' ||
  (SELECT control.system_identifier::numeric::text
   FROM pg_catalog.pg_control_system() AS control
   WHERE control.system_identifier::numeric = :'expected_database_system_id'::numeric)
  || ':' ||
  (NOT pg_catalog.pg_is_in_recovery())::text
  || ':' ||
  (SELECT pg_catalog.count(*)::text FROM matching_sessions)
  || ':' ||
  (SELECT pg_catalog.count(*)::text FROM blocked_waiters);
SQL
  )" || return 1
  [ "$database_fence_state" = "$DATABASE_NAME:$DATABASE_OID:$DATABASE_SYSTEM_ID:true:0:0" ]
}

verify_database_fence_clear || exit 1

RECOVERY_FAILURE_STAGE="runtime"

# The failed helper normally removes marker/release request but can leave its
# canonical failure log and private directory.  Permit exactly that one shape,
# time-bind it to the failed run, and use only unlink(1)+rmdir(1).
FENCE_CLEANUP_STARTED=1
FENCE_CLEANUP_VERIFIED=0
mapfile -d '' -t fence_entries < <(
  if find "$SHARED_RUNTIME_DIR" -mindepth 1 -maxdepth 1 \
    -name '.readiness-fence.*' -print0 2>/dev/null; then
    printf '%s\0' '__faolla_fence_inventory_complete__'
  fi
)
[ "${#fence_entries[@]}" -ge 1 ] \
  && [ "${fence_entries[-1]}" = "__faolla_fence_inventory_complete__" ] || exit 1
unset 'fence_entries[-1]'
[ "${#fence_entries[@]}" -le 1 ] || exit 1
if [ "${#fence_entries[@]}" -eq 1 ]; then
  stale_dir="${fence_entries[0]}"
  [ "$(dirname -- "$stale_dir")" = "$SHARED_RUNTIME_DIR" ] || exit 1
  [[ "$(basename -- "$stale_dir")" =~ ^\.readiness-fence\.[A-Za-z0-9]{6}$ ]] || exit 1
  [ -d "$stale_dir" ] && [ ! -L "$stale_dir" ] || exit 1
  stale_dir_identity="$(stat -c '%d:%i:%Y:%Z:%u:%a' -- "$stale_dir" 2>/dev/null || true)"
  IFS=: read -r _ _ stale_dir_mtime stale_dir_ctime stale_dir_uid stale_dir_mode <<< "$stale_dir_identity"
  [ "$stale_dir_uid" = "$(id -u)" ] && [ "$stale_dir_mode" = "700" ] || exit 1
  for observed_time in "$stale_dir_mtime" "$stale_dir_ctime"; do
    [[ "$observed_time" =~ ^[1-9][0-9]*$ ]] || exit 1
    [ "$observed_time" -ge "$FAILED_RUN_STARTED_EPOCH" ] \
      && [ "$observed_time" -le $((FAILED_RUN_COMPLETED_EPOCH + 1500)) ] || exit 1
  done
  mapfile -d '' -t stale_children < <(
    if find "$stale_dir" -mindepth 1 -maxdepth 1 -print0 2>/dev/null; then
      printf '%s\0' '__faolla_stale_inventory_complete__'
    fi
  )
  [ "${#stale_children[@]}" -ge 1 ] \
    && [ "${stale_children[-1]}" = "__faolla_stale_inventory_complete__" ] || exit 1
  unset 'stale_children[-1]'
  [ "${#stale_children[@]}" -eq 1 ] || exit 1
  stale_log="${stale_children[0]}"
  [ "$stale_log" = "$stale_dir/helper.log" ] || exit 1
  [ -f "$stale_log" ] && [ ! -L "$stale_log" ] || exit 1
  stale_log_identity="$(stat -c '%d:%i:%s:%Y:%Z:%h:%u:%a' -- "$stale_log" 2>/dev/null || true)"
  IFS=: read -r _ _ stale_log_size stale_log_mtime stale_log_ctime stale_log_links stale_log_uid stale_log_mode <<< "$stale_log_identity"
  [[ "$stale_log_size" =~ ^[1-9][0-9]*$ ]] && [ "$stale_log_size" -le 512 ] || exit 1
  [ "$stale_log_links" = "1" ] && [ "$stale_log_uid" = "$(id -u)" ] \
    && [ "$stale_log_mode" = "600" ] || exit 1
  for observed_time in "$stale_log_mtime" "$stale_log_ctime"; do
    [[ "$observed_time" =~ ^[1-9][0-9]*$ ]] || exit 1
    [ "$observed_time" -ge "$FAILED_RUN_STARTED_EPOCH" ] \
      && [ "$observed_time" -le $((FAILED_RUN_COMPLETED_EPOCH + 1500)) ] || exit 1
  done
  trusted_helper_matches \
    "$FENCE_HELPER" "$FENCE_HELPER_RELATIVE" "$FENCE_HELPER_FROZEN_SNAPSHOT" \
    || exit 1
  fence_parser_status=0
  timeout --signal=TERM --kill-after=1s 3s node --input-type=module - \
    "$stale_log" "$FENCE_HELPER" >/dev/null 2>&1 <<'NODE' \
    || fence_parser_status=$?
import { pathToFileURL } from "node:url";
const [logPath, modulePath] = process.argv.slice(2);
const helper = await import(pathToFileURL(modulePath).href);
const record = await helper.readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath);
if (!record || record.ok !== false || typeof record.error !== "string") process.exit(1);
NODE
  trusted_helper_matches \
    "$FENCE_HELPER" "$FENCE_HELPER_RELATIVE" "$FENCE_HELPER_FROZEN_SNAPSHOT" \
    || exit 1
  [ "$fence_parser_status" -eq 0 ] || exit 1
  [ "$(stat -c '%d:%i:%s:%Y:%Z:%h:%u:%a' -- "$stale_log" 2>/dev/null || true)" = "$stale_log_identity" ] || exit 1
  [ "$(stat -c '%d:%i:%Y:%Z:%u:%a' -- "$stale_dir" 2>/dev/null || true)" = "$stale_dir_identity" ] || exit 1
  unlink -- "$stale_log" >/dev/null 2>&1 || exit 1
  rmdir -- "$stale_dir" >/dev/null 2>&1 || exit 1
fi
mapfile -d '' -t post_cleanup_fence_entries < <(
  if find "$SHARED_RUNTIME_DIR" -mindepth 1 -maxdepth 1 \
    -name '.readiness-fence.*' -print0 2>/dev/null; then
    printf '%s\0' '__faolla_post_cleanup_inventory_complete__'
  fi
)
[ "${#post_cleanup_fence_entries[@]}" -ge 1 ] \
  && [ "${post_cleanup_fence_entries[-1]}" = "__faolla_post_cleanup_inventory_complete__" ] || exit 1
unset 'post_cleanup_fence_entries[-1]'
[ "${#post_cleanup_fence_entries[@]}" -eq 0 ] || exit 1
verify_database_fence_clear || exit 1
FENCE_CLEANUP_VERIFIED=1
printf '%s\n' 'fence_cleanup_verified'

pm2_process_snapshot() {
  local name="$1"
  local process_list
  process_list="$(PM2_SILENT=true timeout --signal=TERM --kill-after=2s 5s pm2 jlist 2>/dev/null)" \
    || return 1
  FAOLLA_PM2_PROCESS_NAME="$name" timeout --signal=TERM --kill-after=1s 3s \
    node -e '
      const fs = require("node:fs");
      let list;
      try { list = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
      const name = process.env.FAOLLA_PM2_PROCESS_NAME;
      if (!Array.isArray(list) || !name) process.exit(1);
      const matches = list.filter((entry) => entry?.pm2_env?.name === name);
      if (matches.length === 0) process.stdout.write("absent");
      else if (matches.length !== 1) process.exit(1);
      else if (matches[0].pm2_env.status === "online" && Number.isSafeInteger(matches[0].pid) && matches[0].pid > 0) {
        process.stdout.write(`running:${matches[0].pid}`);
      } else if (matches[0].pm2_env.status === "stopped" && matches[0].pid === 0) {
        process.stdout.write("inactive");
      } else process.exit(1);
    ' 2>/dev/null <<< "$process_list"
}

linux_process_start_ticks() {
  local pid="$1"
  local raw
  local remainder
  local -a fields=()
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  raw="$(<"/proc/$pid/stat")" 2>/dev/null || return 2
  remainder="${raw##*) }"
  read -r -a fields <<< "$remainder"
  [ "${#fields[@]}" -ge 20 ] && [[ "${fields[19]}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "${fields[19]}"
}

capture_started_process_identity() {
  local prefix="$1"
  local pid="$2"
  local start_ticks
  local process_identity
  local cwd_identity
  [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_DIR" ] \
    || return 1
  start_ticks="$(linux_process_start_ticks "$pid")" || return 1
  process_identity="$(stat -Lc '%d:%i' -- "/proc/$pid" 2>/dev/null || true)"
  cwd_identity="$(stat -Lc '%d:%i:%Z' -- "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$process_identity" =~ ^[0-9]+:[0-9]+$ ]] \
    && [[ "$cwd_identity" =~ ^[0-9]+:[0-9]+:[0-9]+$ ]] || return 1
  printf -v "${prefix}_PID" '%s' "$pid"
  printf -v "${prefix}_START_TICKS" '%s' "$start_ticks"
  printf -v "${prefix}_PROCESS_IDENTITY" '%s' "$process_identity"
  printf -v "${prefix}_CWD_IDENTITY" '%s' "$cwd_identity"
}

started_process_identity_matches() {
  local name="$1"
  local pid="$2"
  local start_ticks="$3"
  local process_identity="$4"
  local cwd_identity="$5"
  [ "$(pm2_process_snapshot "$name")" = "running:$pid" ] \
    && [ "$(linux_process_start_ticks "$pid" 2>/dev/null || true)" = "$start_ticks" ] \
    && [ "$(stat -Lc '%d:%i' -- "/proc/$pid" 2>/dev/null || true)" = "$process_identity" ] \
    && [ "$(stat -Lc '%d:%i:%Z' -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$cwd_identity" ] \
    && [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_DIR" ]
}

remove_inactive_process() {
  local name="$1"
  local state
  state="$(pm2_process_snapshot "$name")" || return 1
  case "$state" in
    absent) return 0 ;;
    inactive)
      timeout --signal=TERM --kill-after=5s 25s pm2 delete "$name" \
        >/dev/null 2>&1 || return 1
      [ "$(pm2_process_snapshot "$name")" = "absent" ]
      ;;
    *) return 1 ;;
  esac
}

revalidate_frozen_runtime || exit 1
revalidate_deploy_lock || exit 1
verify_database_fence_clear || exit 1
remove_inactive_process "$APP_NAME" || exit 1
worker_state="$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" || exit 1
case "$worker_state" in absent|inactive) ;; *) exit 1 ;; esac
port_state="$(timeout --signal=TERM --kill-after=1s 3s ss -H -ltn "( sport = :$APP_PORT )" 2>/dev/null)" \
  || exit 1
[ -z "$port_state" ] || exit 1
revalidate_frozen_runtime || exit 1
revalidate_deploy_lock || exit 1

WEB_START_ATTEMPTED=1
(
  cd "$PREVIOUS_RUNTIME_DIR"
  export SUPABASE_INTERNAL_URL="$PREVIOUS_SUPABASE_INTERNAL_URL"
  export NEXT_PUBLIC_SUPABASE_URL="$PREVIOUS_NEXT_PUBLIC_SUPABASE_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY"
  MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    PORT="$APP_PORT" timeout --signal=TERM --kill-after=5s 30s \
      pm2 start npm --name "$APP_NAME" -- start -- -p "$APP_PORT" \
      >/dev/null 2>&1
) >/dev/null 2>&1 || exit 1

web_pid=""
for _ in $(seq 1 30); do
  web_state="$(pm2_process_snapshot "$APP_NAME")" || exit 1
  case "$web_state" in
    running:[1-9][0-9]*) web_pid="${web_state#running:}" ;;
    *) web_pid="" ;;
  esac
  if [ -n "$web_pid" ]; then break; fi
  sleep 1
done
[[ "$web_pid" =~ ^[1-9][0-9]*$ ]] || exit 1
capture_started_process_identity STARTED_WEB "$web_pid" || exit 1

verify_stable_local_old_build() {
  local response
  local stable_health_checks=0
  for _ in $(seq 1 30); do
    if started_process_identity_matches "$APP_NAME" \
        "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
        "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" \
      && response="$(curl -fsS --max-time 4 "http://127.0.0.1:${APP_PORT}/api/app-web-version" 2>/dev/null)" \
      && FAOLLA_EXPECTED_BUILD_ID="$EXPECTED_OLD_BUILD_ID" \
        node -e '
          const fs = require("node:fs");
          let value;
          try { value = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
          if (value?.buildId !== process.env.FAOLLA_EXPECTED_BUILD_ID) process.exit(1);
        ' >/dev/null 2>&1 <<< "$response"
    then
      stable_health_checks=$((stable_health_checks + 1))
      if [ "$stable_health_checks" -ge 3 ]; then return 0; fi
    else
      stable_health_checks=0
    fi
    sleep 1
  done
  return 1
}

verify_stable_local_old_build || exit 1

verify_process_environment() {
  local pid="$1"
  local expected_start_ticks="$2"
  local snapshot
  local -a parts=()
  [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$PREVIOUS_RUNTIME_DIR" ] \
    || return 1
  snapshot=""
  capture_trusted_environment_helper_output snapshot 5 process-snapshot \
    "$pid" "$PREVIOUS_RUNTIME_DIR" || return 1
  mapfile -t parts <<< "$snapshot"
  [ "${#parts[@]}" -eq 5 ] \
    && [ "${parts[0]}" = "present" ] \
    && [ "${parts[1]}" = "$expected_start_ticks" ] \
    && [ "${parts[2]}" = "$SNAPSHOT_INTERNAL_URL_B64" ] \
    && [ "${parts[3]}" = "$SNAPSHOT_PUBLIC_URL_B64" ] \
    && [ "${parts[4]}" = "$SNAPSHOT_ANON_KEY_B64" ]
}

verify_worker_flags() {
  local pid="$1"
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || return 1
  FAOLLA_EXPECTED_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    FAOLLA_EXPECTED_INVITATION_WORKER_ENABLED="$INVITATION_WORKER_ENABLED" \
    timeout --signal=TERM --kill-after=1s 3s node -e '
      const fs = require("node:fs");
      const entries = fs.readFileSync(`/proc/${process.argv[1]}/environ`)
        .toString("utf8").split("\0").filter(Boolean);
      const exact = (key) => {
        const prefix = `${key}=`;
        const values = entries.filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length));
        if (values.length !== 1) process.exit(1);
        return values[0];
      };
      if (
        exact("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED") !==
          process.env.FAOLLA_EXPECTED_AUTOMATION_WORKER_ENABLED ||
        exact("MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED") !==
          process.env.FAOLLA_EXPECTED_INVITATION_WORKER_ENABLED
      ) process.exit(1);
    ' "$pid" >/dev/null 2>&1 || return 1
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY"
}

verify_worker_command_line() {
  local pid="$1"
  local tsx_entry="$PREVIOUS_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs"
  local worker_entry="$PREVIOUS_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts"
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || return 1
  FAOLLA_EXPECTED_TSX="$tsx_entry" FAOLLA_EXPECTED_WORKER="$worker_entry" \
    node --input-type=module - "$pid" >/dev/null 2>&1 <<'NODE' || return 1
import { readFileSync } from "node:fs";
const entries = readFileSync(`/proc/${process.argv[2]}/cmdline`).toString("utf8").split("\0").filter(Boolean);
if (!entries.includes(process.env.FAOLLA_EXPECTED_TSX) || !entries.includes(process.env.FAOLLA_EXPECTED_WORKER)) process.exit(1);
NODE
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY"
}

verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
revalidate_frozen_runtime || exit 1
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
printf '%s\n' 'frozen_runtime_restored'

if [ "$AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$INVITATION_WORKER_ENABLED" = "true" ]; then
  remove_inactive_process "$AUTOMATION_WORKER_NAME" || exit 1
  tsx_entry="$PREVIOUS_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs"
  worker_entry="$PREVIOUS_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts"
  [ -f "$tsx_entry" ] && [ -f "$worker_entry" ] || exit 1
  revalidate_frozen_runtime || exit 1
  WORKER_START_ATTEMPTED=1
  (
    cd "$PREVIOUS_RUNTIME_DIR"
    export SUPABASE_INTERNAL_URL="$PREVIOUS_SUPABASE_INTERNAL_URL"
    export NEXT_PUBLIC_SUPABASE_URL="$PREVIOUS_NEXT_PUBLIC_SUPABASE_URL"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY="$PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY"
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="$INVITATION_WORKER_ENABLED" \
      timeout --signal=TERM --kill-after=5s 30s \
        pm2 start "$tsx_entry" \
          --name "$AUTOMATION_WORKER_NAME" \
          --interpreter node \
          --cwd "$PREVIOUS_RUNTIME_DIR" \
          --kill-timeout 180000 \
          --restart-delay 5000 \
          --wait-ready \
          --listen-timeout 20000 \
          -- "$worker_entry" >/dev/null 2>&1
  ) >/dev/null 2>&1 || exit 1
  worker_pid=""
  stable_worker_checks=0
  previous_worker_pid=""
  for _ in $(seq 1 20); do
    worker_state="$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" || exit 1
    case "$worker_state" in
      running:[1-9][0-9]*) worker_pid="${worker_state#running:}" ;;
      *) worker_pid="" ;;
    esac
    if [ -n "$worker_pid" ] && [ "$worker_pid" = "$previous_worker_pid" ]; then
      stable_worker_checks=$((stable_worker_checks + 1))
    elif [ -n "$worker_pid" ]; then
      previous_worker_pid="$worker_pid"
      stable_worker_checks=1
    else
      previous_worker_pid=""
      stable_worker_checks=0
    fi
    [ "$stable_worker_checks" -ge 3 ] && break
    sleep 1
  done
  [ "$stable_worker_checks" -ge 3 ] || exit 1
  capture_started_process_identity STARTED_WORKER "$worker_pid" || exit 1
  for _ in 1 2 3; do
    started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
      "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
      "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || exit 1
    verify_process_environment "$worker_pid" "$STARTED_WORKER_START_TICKS" || exit 1
    verify_worker_flags "$worker_pid" || exit 1
    sleep 1
  done
  verify_process_environment "$worker_pid" "$STARTED_WORKER_START_TICKS" || exit 1
  verify_worker_flags "$worker_pid" || exit 1
  verify_worker_command_line "$worker_pid" || exit 1
else
  remove_inactive_process "$AUTOMATION_WORKER_NAME" || exit 1
  [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
fi
printf '%s\n' 'worker_state_restored'

revalidate_frozen_runtime || exit 1
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
revalidate_deploy_lock || exit 1
PM2_SAVE_ATTEMPTED=1
timeout --signal=TERM --kill-after=2s 10s pm2 save >/dev/null 2>&1 || exit 1
revalidate_frozen_runtime || exit 1
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
revalidate_deploy_lock || exit 1
verify_stable_local_old_build || exit 1
if [ "$AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$INVITATION_WORKER_ENABLED" = "true" ]; then
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || exit 1
  verify_process_environment "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" || exit 1
  verify_worker_flags "$STARTED_WORKER_PID" || exit 1
  verify_worker_command_line "$STARTED_WORKER_PID" || exit 1
else
  [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
fi

RECOVERY_COMPLETE=1
printf '%s\n' 'recovery_complete'
