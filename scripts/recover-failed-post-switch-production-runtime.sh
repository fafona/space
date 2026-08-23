#!/usr/bin/env bash
set -Eeuo pipefail

# Incident-only recovery for the failed post-switch deploy named below.
umask 077
unset NODE_OPTIONS NODE_PATH npm_config_node_options NPM_CONFIG_NODE_OPTIONS \
  BASH_ENV ENV

readonly EXPECTED_INCIDENT_DEPLOY_RUN_ID="32625801433"
readonly EXPECTED_INCIDENT_SHA="58c26e178faeb3eee0172a2e0aa487084f6910e4"
readonly EXPECTED_INCIDENT_READINESS_RUN_ID="32625773494"
readonly EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT="1"
readonly EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ID="32627378516"
readonly EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ATTEMPT="1"
readonly EXPECTED_PRIOR_FAILED_RECOVERY_SHA="870e79ac1b5fd036bfd08b895284bc6a754a102a"
readonly EXPECTED_CANDIDATE_BUILD_ID="58c26e178faeb3eee0172a2e0aa487084f6910e4"
readonly EXPECTED_OLD_BUILD_ID="2a121454a18a16ae30e356977ca82b24a310e8e5"
readonly EXPECTED_OLD_PACKAGE_BLOB="4aa8c7a442b6bc8926e74322503f91b28359fd3e"
readonly EXPECTED_OLD_PACKAGE_SHA256="ecbbce22ad2cb0ce4d616726b8d024f454a2aeef48270eee241bb25553740b31"
readonly EXPECTED_OLD_PACKAGE_BYTES="21229"
readonly EXPECTED_OLD_SMOKE_HELPER_BLOB="c3e8ac359279879970530c40ee446ea25bc4ac9c"
readonly EXPECTED_OLD_SMOKE_HELPER_SHA256="cf25612c2a9051bc3cb36516b23955f0fb32c39579fbc8f38377c23344b36da3"
readonly EXPECTED_OLD_SMOKE_HELPER_BYTES="12565"
readonly EXPECTED_OLD_WORKER_BLOB="e575042993f18c2ed24f876afdb6de567db8bce0"
readonly EXPECTED_OLD_WORKER_SHA256="99596c2bfe070a8f9c6fa01b9bfbd310de6a0ba296ab9289db2cd911b013fa74"
readonly EXPECTED_OLD_WORKER_BYTES="28125"
readonly EXPECTED_CONFIRMATION="RECOVER_FAILED_POST_SWITCH_DEPLOY_32625801433"
readonly CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE="candidate_env_snapshot_contract"

RECOVERY_PAYLOAD_FILE="${FAOLLA_RECOVERY_PAYLOAD_FILE:-}"
WEB_START_ATTEMPTED=0
WORKER_START_ATTEMPTED=0
PM2_SAVE_ATTEMPTED=0
PM2_STATE_MUTATED=0
RECOVERY_COMPLETE=0
RECOVERY_SIGNAL_PENDING=0
FENCE_CLEANUP_STARTED=0
FENCE_CLEANUP_VERIFIED=0
RECOVERY_FAILURE_STAGE="input"
CURRENT_SWITCH_COMPLETED=0
CURRENT_SWITCH_ARMED=0
CANDIDATE_WEB_STOPPED=0
CANDIDATE_WORKER_STOPPED=0
CANDIDATE_PREFLIGHT_VERIFIED=0
FROZEN_RESUME_PREFLIGHT_VERIFIED=0
FROZEN_WEB_COMMITTED=0
STARTED_WEB_PID=""
STARTED_WEB_START_TICKS=""
STARTED_WEB_PROCESS_IDENTITY=""
STARTED_WEB_CWD_IDENTITY=""
STARTED_WORKER_PID=""
STARTED_WORKER_START_TICKS=""
STARTED_WORKER_PROCESS_IDENTITY=""
STARTED_WORKER_CWD_IDENTITY=""
SWITCH_TEMP_LINK=""
SWITCH_TEMP_LINK_IDENTITY=""
SWITCH_TEMP_LINK_OBJECT_IDENTITY=""
CURRENT_LINK_IDENTITY=""
FROZEN_CURRENT_LINK_IDENTITY=""
COMPENSATION_TEMP_LINK=""
COMPENSATION_TEMP_LINK_IDENTITY=""
COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=""
CANDIDATE_WEB_PM2_SNAPSHOT=""
CANDIDATE_WEB_PID=""
CANDIDATE_WEB_START_TICKS=""
CANDIDATE_WEB_PROCESS_IDENTITY=""
CANDIDATE_WEB_CWD_IDENTITY=""
CANDIDATE_WORKER_PM2_SNAPSHOT=""
CANDIDATE_WORKER_PID=""
CANDIDATE_WORKER_START_TICKS=""
CANDIDATE_WORKER_PROCESS_IDENTITY=""
CANDIDATE_WORKER_CWD_IDENTITY=""
CANDIDATE_NEXT_BUILD_SNAPSHOT=""
FROZEN_NEXT_BUILD_SNAPSHOT=""
INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT=""
CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY=""
CANDIDATE_ENVIRONMENT_FILE_IDENTITY=""
CANDIDATE_ENVIRONMENT_SHA256=""
INITIAL_CURRENT_STATE=""
INITIAL_CURRENT_RAW_TARGET=""
INITIAL_CURRENT_RESOLVED_TARGET=""
INITIAL_CURRENT_LINK_IDENTITY=""

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

trusted_symlink_identity() {
  local path="$1"
  local identity
  local link_uid
  local link_raw_mode
  local link_count
  [ -L "$path" ] || return 1
  identity="$(stat -c '%d:%i:%s:%Y:%Z:%u:%f:%h' -- "$path" 2>/dev/null || true)"
  [[ "$identity" =~ ^([0-9]+:){6}[0-9a-fA-F]+:[0-9]+$ ]] || return 1
  IFS=: read -r _ _ _ _ _ link_uid link_raw_mode link_count <<< "$identity"
  [ "$link_uid" = "$(id -u)" ] && [ "$link_count" = "1" ] \
    && (( (16#$link_raw_mode & 0170000) == 0120000 )) || return 1
  printf '%s' "$identity"
}

symlink_object_identity_from_full() {
  local identity="$1"
  local device
  local inode
  local size
  local link_uid
  local link_raw_mode
  local link_count
  [[ "$identity" =~ ^([0-9]+:){6}[0-9a-fA-F]+:[0-9]+$ ]] || return 1
  IFS=: read -r device inode size _ _ link_uid link_raw_mode link_count \
    <<< "$identity"
  [ "$link_uid" = "$(id -u)" ] && [ "$link_count" = "1" ] \
    && (( (16#$link_raw_mode & 0170000) == 0120000 )) || return 1
  printf '%s:%s:%s:%s:%s:%s' \
    "$device" "$inode" "$size" "$link_uid" "$link_raw_mode" "$link_count"
}

trusted_symlink_object_identity() {
  local identity
  identity="$(trusted_symlink_identity "$1")" || return 1
  symlink_object_identity_from_full "$identity"
}

trusted_directory_object_identity() {
  local path="$1"
  local identity
  local directory_uid
  local directory_raw_mode
  local directory_links
  local directory_mode
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -c '%d:%i:%u:%f:%h:%a' -- "$path" 2>/dev/null || true)"
  [[ "$identity" =~ ^([0-9]+:){3}[0-9a-fA-F]+:[0-9]+:[0-7]{3,4}$ ]] \
    || return 1
  IFS=: read -r _ _ directory_uid directory_raw_mode directory_links \
    directory_mode <<< "$identity"
  (( (16#$directory_raw_mode & 0170000) == 0040000 )) || return 1
  [ "$directory_uid" = "$(id -u)" ] \
    && [ "$directory_links" -ge 1 ] \
    && [ $((8#$directory_mode & 8#022)) -eq 0 ] \
    || return 1
  printf '%s' "$identity"
}

capture_trusted_temp_symlink_snapshot() {
  local path="$1"
  local expected_target="$2"
  local full_variable="$3"
  local object_variable="$4"
  local first_full_identity
  local first_object_identity
  local second_full_identity
  local second_object_identity
  if [ "$path" = "$EXPECTED_SWITCH_TEMP_LINK" ]; then
    [ "$expected_target" = "$FROZEN_RUNTIME_DIR" ] \
      && [ "$full_variable" = "SWITCH_TEMP_LINK_IDENTITY" ] \
      && [ "$object_variable" = "SWITCH_TEMP_LINK_OBJECT_IDENTITY" ] \
      || return 1
  elif [ "$path" = "$EXPECTED_COMPENSATION_TEMP_LINK" ]; then
    [ "$expected_target" = "$CANDIDATE_RUNTIME_DIR" ] \
      && [ "$full_variable" = "COMPENSATION_TEMP_LINK_IDENTITY" ] \
      && [ "$object_variable" = "COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ] \
      || return 1
  else
    return 1
  fi
  revalidate_current_link_parent \
    && [ -L "$path" ] \
    && [ "$(readlink -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    && [ "$(readlink -f -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    || return 1
  first_full_identity="$(trusted_symlink_identity "$path")" || return 1
  first_object_identity="$(symlink_object_identity_from_full \
    "$first_full_identity")" || return 1
  revalidate_current_link_parent \
    && [ "$(readlink -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    && [ "$(readlink -f -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    || return 1
  second_full_identity="$(trusted_symlink_identity "$path")" || return 1
  second_object_identity="$(symlink_object_identity_from_full \
    "$second_full_identity")" || return 1
  [ "$second_full_identity" = "$first_full_identity" ] \
    && [ "$second_object_identity" = "$first_object_identity" ] \
    && revalidate_current_link_parent \
    && [ "$(readlink -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    && [ "$(readlink -f -- "$path" 2>/dev/null || true)" = "$expected_target" ] \
    || return 1
  printf -v "$full_variable" '%s' "$second_full_identity"
  printf -v "$object_variable" '%s' "$second_object_identity"
}

revalidate_current_link_parent() {
  [ -n "${CURRENT_LINK_PARENT_DIR:-}" ] \
    && [ -n "${CURRENT_LINK_PARENT_IDENTITY:-}" ] \
    && [ "$(readlink -f -- "$CURRENT_LINK_PARENT_DIR" 2>/dev/null || true)" = \
      "$CURRENT_LINK_PARENT_DIR" ] \
    && [ "$(trusted_directory_object_identity \
      "$CURRENT_LINK_PARENT_DIR" 2>/dev/null || true)" = \
      "$CURRENT_LINK_PARENT_IDENTITY" ] \
    && [ "$(dirname -- "${CURRENT_LINK:-invalid}")" = \
      "$CURRENT_LINK_PARENT_DIR" ] \
    && [ "$(dirname -- "${EXPECTED_SWITCH_TEMP_LINK:-invalid}")" = \
      "$CURRENT_LINK_PARENT_DIR" ] \
    && [ "$(dirname -- "${EXPECTED_COMPENSATION_TEMP_LINK:-invalid}")" = \
      "$CURRENT_LINK_PARENT_DIR" ]
}

cleanup_started_process() {
  local kind="$1"
  local name="$2"
  local pid="$3"
  local start_ticks="$4"
  local process_identity="$5"
  local cwd_identity="$6"
  local require_free_port="$7"
  local current_state=""
  local identity_state="partial"
  if [ -z "$pid" ] && [ -z "$start_ticks" ] \
    && [ -z "$process_identity" ] && [ -z "$cwd_identity" ]; then
    identity_state="empty"
  elif [ -n "$pid" ] && [ -n "$start_ticks" ] \
    && [ -n "$process_identity" ] && [ -n "$cwd_identity" ]; then
    identity_state="complete"
  else
    return 1
  fi
  current_state="$(started_pm2_state "$kind" 2>/dev/null || true)"
  case "$current_state" in
    "running:$pid")
      [ "$identity_state" = "complete" ] || return 1
      started_process_identity_matches "$name" "$pid" "$start_ticks" \
        "$process_identity" "$cwd_identity" || return 1
      PM2_STATE_MUTATED=1
      timeout --signal=TERM --kill-after=5s 25s pm2 delete "$name" \
        >/dev/null 2>&1 || return 1
      ;;
    inactive)
      [ "$(started_pm2_state "$kind" 2>/dev/null || true)" = "inactive" ] \
        || return 1
      PM2_STATE_MUTATED=1
      timeout --signal=TERM --kill-after=5s 25s pm2 delete "$name" \
        >/dev/null 2>&1 || return 1
      ;;
    absent) ;;
    *) return 1 ;;
  esac
  [ "$(pm2_process_snapshot "$name" 2>/dev/null || true)" = "absent" ] \
    || return 1
  if [ "$identity_state" = "complete" ]; then
    [ "$(linux_process_start_ticks "$pid" 2>/dev/null || true)" != "$start_ticks" ] \
      || return 1
  fi
  [ "$require_free_port" = "0" ] || wait_for_port_free_bounded
}

finish_recovery() {
  local status=$?
  local cleanup_status=0
  local cleanup_reason=""
  local failure_stage="${RECOVERY_FAILURE_STAGE:-invalid}"
  local candidate_restore_failed=0
  record_cleanup_failure() {
    local reason="$1"
    case "$reason" in
      switch_temp|compensation_temp|fence_incomplete|worker_cleanup|web_cleanup|\
      candidate_restore|precommit_verify|pm2_save) ;;
      *) reason="invalid" ;;
    esac
    if [ -z "$cleanup_reason" ]; then cleanup_reason="$reason"; fi
    cleanup_status=1
  }
  trap - EXIT
  trap '' HUP INT TERM
  if [ -n "${SWITCH_TEMP_LINK:-}" ] && [ -L "$SWITCH_TEMP_LINK" ] \
    && revalidate_current_link_parent \
    && [ -n "${SWITCH_TEMP_LINK_IDENTITY:-}" ] \
    && [ -n "${SWITCH_TEMP_LINK_OBJECT_IDENTITY:-}" ] \
    && [ "$(trusted_symlink_identity "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "$SWITCH_TEMP_LINK_IDENTITY" ] \
    && [ "$(trusted_symlink_object_identity \
      "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "$SWITCH_TEMP_LINK_OBJECT_IDENTITY" ] \
    && [ "$(readlink -- "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "${FROZEN_RUNTIME_DIR:-invalid}" ] \
    && [ "$(readlink -f -- "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "${FROZEN_RUNTIME_DIR:-invalid}" ]; then
    if unlink -- "$SWITCH_TEMP_LINK" >/dev/null 2>&1 \
      && revalidate_current_link_parent \
      && [ ! -e "$SWITCH_TEMP_LINK" ] && [ ! -L "$SWITCH_TEMP_LINK" ]; then
      :
    else
      record_cleanup_failure switch_temp
    fi
  elif [ -n "${SWITCH_TEMP_LINK:-}" ] \
    && { [ -e "$SWITCH_TEMP_LINK" ] || [ -L "$SWITCH_TEMP_LINK" ]; }; then
    record_cleanup_failure switch_temp
  fi
  if [ "$status" -ne 0 ] && [ "$RECOVERY_COMPLETE" -ne 1 ]; then
    if [ "$FENCE_CLEANUP_STARTED" -eq 1 ] \
      && [ "$FENCE_CLEANUP_VERIFIED" -ne 1 ]; then
      record_cleanup_failure fence_incomplete
    fi
    if [ "$WORKER_START_ATTEMPTED" -eq 1 ]; then
      cleanup_started_process worker "${AUTOMATION_WORKER_NAME:-invalid}" \
        "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
        "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" 0 \
        || record_cleanup_failure worker_cleanup
    fi
    if [ "$WEB_START_ATTEMPTED" -eq 1 ] && [ "$FROZEN_WEB_COMMITTED" -ne 1 ]; then
      cleanup_started_process web "${APP_NAME:-invalid}" \
        "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
        "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" 1 \
        || record_cleanup_failure web_cleanup
    fi
    if [ "$FROZEN_WEB_COMMITTED" -ne 1 ] \
      && [ "$CURRENT_SWITCH_ARMED" -eq 1 ] \
      && [ "$cleanup_status" -eq 0 ]; then
      restore_candidate_before_web_commit \
        || candidate_restore_failed=1
    fi
    if [ -n "${COMPENSATION_TEMP_LINK:-}" ] && [ -L "$COMPENSATION_TEMP_LINK" ] \
      && revalidate_current_link_parent \
      && [ -n "${COMPENSATION_TEMP_LINK_IDENTITY:-}" ] \
      && [ -n "${COMPENSATION_TEMP_LINK_OBJECT_IDENTITY:-}" ] \
      && [ "$(trusted_symlink_identity "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
        "$COMPENSATION_TEMP_LINK_IDENTITY" ] \
      && [ "$(trusted_symlink_object_identity \
        "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
        "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ] \
      && [ "$(readlink -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
        "${CANDIDATE_RUNTIME_DIR:-invalid}" ] \
      && [ "$(readlink -f -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
        "${CANDIDATE_RUNTIME_DIR:-invalid}" ]; then
      if unlink -- "$COMPENSATION_TEMP_LINK" >/dev/null 2>&1 \
        && revalidate_current_link_parent \
        && [ ! -e "$COMPENSATION_TEMP_LINK" ] \
        && [ ! -L "$COMPENSATION_TEMP_LINK" ]; then
        COMPENSATION_TEMP_LINK=""
        COMPENSATION_TEMP_LINK_IDENTITY=""
        COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=""
      else
        record_cleanup_failure compensation_temp
      fi
    elif [ -n "${COMPENSATION_TEMP_LINK:-}" ] \
      && { [ -e "$COMPENSATION_TEMP_LINK" ] \
        || [ -L "$COMPENSATION_TEMP_LINK" ]; }; then
      record_cleanup_failure compensation_temp
    fi
    [ "$candidate_restore_failed" -eq 0 ] \
      || record_cleanup_failure candidate_restore
    if [ "$FROZEN_WEB_COMMITTED" -ne 1 ] \
      && { [ "$CANDIDATE_PREFLIGHT_VERIFIED" -eq 1 ] \
        || [ "$FROZEN_RESUME_PREFLIGHT_VERIFIED" -eq 1 ]; } \
      && [ "$cleanup_status" -eq 0 ]; then
      verify_precommit_safe_state || record_cleanup_failure precommit_verify
    fi
    if [ "$PM2_STATE_MUTATED" -eq 1 ] && [ "$cleanup_status" -eq 0 ]; then
      timeout --signal=TERM --kill-after=2s 10s pm2 save >/dev/null 2>&1 \
        || record_cleanup_failure pm2_save
    fi
    case "$failure_stage" in
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
        candidate_inventory)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_inventory' >&2
          ;;
        frozen_inventory)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_inventory' >&2
          ;;
        initial_current_target)
          printf '%s\n' 'recovery_failed_pre_runtime_initial_current_target' >&2
          ;;
        initial_current_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_initial_current_identity' >&2
          ;;
        initial_current_compatibility)
          printf '%s\n' 'recovery_failed_pre_runtime_initial_current_compatibility' >&2
          ;;
        initial_current_temporary_links)
          printf '%s\n' 'recovery_failed_pre_runtime_initial_current_temporary_links' >&2
          ;;
        candidate_structure)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_structure' >&2
          ;;
        incident_env_helper_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_incident_env_helper_identity' >&2
          ;;
        candidate_env_file_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_env_file_identity' >&2
          ;;
        candidate_env_encoding)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_env_encoding' >&2
          ;;
        candidate_env_server_build_binding)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_env_server_build_binding' >&2
          ;;
        candidate_env_public_build_binding)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_env_public_build_binding' >&2
          ;;
        candidate_env_snapshot_contract)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_env_snapshot_contract' >&2
          ;;
        candidate_next_build_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_candidate_next_build_identity' >&2
          ;;
        frozen_release_structure)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_release_structure' >&2
          ;;
        frozen_scripts_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_scripts_identity' >&2
          ;;
        frozen_smoke_helper_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_smoke_helper_identity' >&2
          ;;
        frozen_package_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_package_identity' >&2
          ;;
        frozen_worker_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_worker_identity' >&2
          ;;
        frozen_env_build_binding)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_env_build_binding' >&2
          ;;
        frozen_next_build_identity)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_next_build_identity' >&2
          ;;
        frozen_environment)
          printf '%s\n' 'recovery_failed_pre_runtime_frozen_environment' >&2
          ;;
        database_preflight)
          printf '%s\n' 'recovery_failed_pre_runtime_database_preflight' >&2
          ;;
        fence_cleanup)
          printf '%s\n' 'recovery_failed_runtime_fence_cleanup' >&2
          ;;
        fence_unlink)
          printf '%s\n' 'recovery_failed_runtime_fence_unlink' >&2
          ;;
        fence_rmdir)
          printf '%s\n' 'recovery_failed_runtime_fence_rmdir' >&2
          ;;
        fence_post_inventory)
          printf '%s\n' 'recovery_failed_runtime_fence_post_inventory' >&2
          ;;
        fence_post_database)
          printf '%s\n' 'recovery_failed_runtime_fence_post_database' >&2
          ;;
        candidate_process_preflight)
          printf '%s\n' 'recovery_failed_runtime_candidate_process_preflight' >&2
          ;;
        candidate_stop)
          printf '%s\n' 'recovery_failed_runtime_candidate_stop' >&2
          ;;
        current_switch)
          printf '%s\n' 'recovery_failed_runtime_current_switch' >&2
          ;;
        current_resume)
          printf '%s\n' 'recovery_failed_runtime_current_resume' >&2
          ;;
        web_start)
          printf '%s\n' 'recovery_failed_runtime_web_start' >&2
          ;;
        web_stability)
          printf '%s\n' 'recovery_failed_runtime_web_stability' >&2
          ;;
        web_identity)
          printf '%s\n' 'recovery_failed_runtime_web_identity' >&2
          ;;
        web_environment)
          printf '%s\n' 'recovery_failed_runtime_web_environment' >&2
          ;;
        web_launch_contract)
          printf '%s\n' 'recovery_failed_runtime_web_launch_contract' >&2
          ;;
        local_smoke)
          printf '%s\n' 'recovery_failed_runtime_local_smoke' >&2
          ;;
        worker_preflight)
          printf '%s\n' 'recovery_failed_runtime_worker_preflight' >&2
          ;;
        worker_start)
          printf '%s\n' 'recovery_failed_runtime_worker_start' >&2
          ;;
        worker_stability)
          printf '%s\n' 'recovery_failed_runtime_worker_stability' >&2
          ;;
        worker_identity)
          printf '%s\n' 'recovery_failed_runtime_worker_identity' >&2
          ;;
        worker_environment)
          printf '%s\n' 'recovery_failed_runtime_worker_environment' >&2
          ;;
        worker_flags)
          printf '%s\n' 'recovery_failed_runtime_worker_flags' >&2
          ;;
        worker_launch_contract)
          printf '%s\n' 'recovery_failed_runtime_worker_launch_contract' >&2
          ;;
        worker_disabled_absence)
          printf '%s\n' 'recovery_failed_runtime_worker_disabled_absence' >&2
          ;;
        persist_and_verify)
          printf '%s\n' 'recovery_failed_runtime_persist_and_verify' >&2
          ;;
        *)
          printf '%s\n' 'recovery_failed_stage_invalid' >&2
          ;;
    esac
    if [ "$cleanup_status" -ne 0 ]; then
      case "$cleanup_reason" in
        switch_temp)
          printf '%s\n' 'cleanup_failed_reason_switch_temp' >&2
          ;;
        compensation_temp)
          printf '%s\n' 'cleanup_failed_reason_compensation_temp' >&2
          ;;
        fence_incomplete)
          printf '%s\n' 'cleanup_failed_reason_fence_incomplete' >&2
          ;;
        worker_cleanup)
          printf '%s\n' 'cleanup_failed_reason_worker_cleanup' >&2
          ;;
        web_cleanup)
          printf '%s\n' 'cleanup_failed_reason_web_cleanup' >&2
          ;;
        candidate_restore)
          printf '%s\n' 'cleanup_failed_reason_candidate_restore' >&2
          ;;
        precommit_verify)
          printf '%s\n' 'cleanup_failed_reason_precommit_verify' >&2
          ;;
        pm2_save)
          printf '%s\n' 'cleanup_failed_reason_pm2_save' >&2
          ;;
        *)
          printf '%s\n' 'cleanup_failed_reason_invalid' >&2
          ;;
      esac
    fi
  fi
  if [ -n "${RECOVERY_PAYLOAD_FILE:-}" ]; then
    rm -f -- "$RECOVERY_PAYLOAD_FILE" >/dev/null 2>&1 || true
  fi
  unset \
    FROZEN_SUPABASE_INTERNAL_URL \
    FROZEN_NEXT_PUBLIC_SUPABASE_URL \
    FROZEN_NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SNAPSHOT_INTERNAL_URL_B64 \
    SNAPSHOT_PUBLIC_URL_B64 \
    SNAPSHOT_ANON_KEY_B64
  exit "$status"
}
trap finish_recovery EXIT
handle_recovery_signal() {
  trap '' HUP INT TERM
  exit 1
}
defer_recovery_signal() {
  RECOVERY_SIGNAL_PENDING=1
}
trap handle_recovery_signal HUP INT TERM

require_command() {
  command -v "$1" >/dev/null 2>&1
}

for required_command in \
  base64 basename curl date dirname docker find flock git id ln mv node pm2 readlink \
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
    READINESS_RUN_ID|READINESS_RUN_ATTEMPT|PRIOR_FAILED_RECOVERY_RUN_ID|\
    PRIOR_FAILED_RECOVERY_RUN_ATTEMPT|PRIOR_FAILED_RECOVERY_SHA|CONFIRMATION)
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
  "PRIOR_FAILED_RECOVERY_RUN_ATTEMPT",
  "PRIOR_FAILED_RECOVERY_RUN_ID",
  "PRIOR_FAILED_RECOVERY_SHA",
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

[ "$loaded_count" -eq 19 ] || exit 1
[ "$INCIDENT_DEPLOY_RUN_ID" = "$EXPECTED_INCIDENT_DEPLOY_RUN_ID" ] || exit 1
[ "$INCIDENT_SHA" = "$EXPECTED_INCIDENT_SHA" ] || exit 1
[ "$READINESS_RUN_ID" = "$EXPECTED_INCIDENT_READINESS_RUN_ID" ] || exit 1
[ "$READINESS_RUN_ATTEMPT" = "$EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT" ] || exit 1
[ "$PRIOR_FAILED_RECOVERY_RUN_ID" = "$EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ID" ] || exit 1
[ "$PRIOR_FAILED_RECOVERY_RUN_ATTEMPT" = "$EXPECTED_PRIOR_FAILED_RECOVERY_RUN_ATTEMPT" ] || exit 1
[ "$PRIOR_FAILED_RECOVERY_SHA" = "$EXPECTED_PRIOR_FAILED_RECOVERY_SHA" ] || exit 1
[ "$CONFIRMATION" = "$EXPECTED_CONFIRMATION" ] || exit 1
[[ "$APP_DIR" == /* ]] || exit 1
[[ "$APP_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || exit 1
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
readonly EXPECTED_SWITCH_TEMP_LINK="${CURRENT_LINK}.recover-${EXPECTED_INCIDENT_DEPLOY_RUN_ID}"
readonly EXPECTED_COMPENSATION_TEMP_LINK="${CURRENT_LINK}.compensate-${EXPECTED_INCIDENT_DEPLOY_RUN_ID}"
readonly ENV_HELPER_RELATIVE="scripts/read-production-supabase-environment.mjs"
readonly FENCE_HELPER_RELATIVE="scripts/hold-ordinary-account-cutover-readiness-fence.mjs"
readonly SMOKE_HELPER_RELATIVE="scripts/check-production-smoke.mjs"
readonly PACKAGE_RELATIVE="package.json"
readonly WORKER_RELATIVE="scripts/run-merchant-enterprise-automation-worker.ts"
readonly INCIDENT_ENV_HELPER="$APP_DIR/$ENV_HELPER_RELATIVE"
readonly INCIDENT_FENCE_HELPER="$APP_DIR/$FENCE_HELPER_RELATIVE"

CURRENT_LINK_PARENT_DIR="$(dirname -- "$CURRENT_LINK")"
[ "$(readlink -f -- "$CURRENT_LINK_PARENT_DIR" 2>/dev/null || true)" = \
  "$CURRENT_LINK_PARENT_DIR" ] || exit 1
CURRENT_LINK_PARENT_IDENTITY="$(trusted_directory_object_identity \
  "$CURRENT_LINK_PARENT_DIR")" || exit 1
readonly CURRENT_LINK_PARENT_DIR CURRENT_LINK_PARENT_IDENTITY
revalidate_current_link_parent || exit 1

[ -d "$RELEASES_DIR" ] && [ ! -L "$RELEASES_DIR" ] || exit 1
[ -d "$SHARED_RUNTIME_DIR" ] && [ ! -L "$SHARED_RUNTIME_DIR" ] || exit 1
for protected_root in "$RELEASES_DIR" "$(dirname -- "$SHARED_RUNTIME_DIR")" "$SHARED_RUNTIME_DIR"; do
  [ "$(readlink -f -- "$protected_root" 2>/dev/null || true)" = "$protected_root" ] || exit 1
  protected_identity="$(stat -c '%u:%a' -- "$protected_root" 2>/dev/null || true)"
  IFS=: read -r protected_uid protected_mode <<< "$protected_identity"
  [ "$protected_uid" = "$(id -u)" ] && [[ "$protected_mode" =~ ^[0-7]{3,4}$ ]] || exit 1
  [ $((8#$protected_mode & 8#022)) -eq 0 ] || exit 1
done
[ -f "$INCIDENT_FENCE_HELPER" ] && [ ! -L "$INCIDENT_FENCE_HELPER" ] || exit 1
for helper_path in "$FENCE_HELPER_RELATIVE"; do
  git -C "$APP_DIR" diff --quiet -- "$helper_path" >/dev/null 2>&1 || exit 1
  git -C "$APP_DIR" diff --cached --quiet -- "$helper_path" >/dev/null 2>&1 || exit 1
  helper_blob="$(git -C "$APP_DIR" rev-parse "$EXPECTED_INCIDENT_SHA:$helper_path" 2>/dev/null || true)"
  [[ "$helper_blob" =~ ^[0-9a-f]{40,64}$ ]] || exit 1
  [ "$(git -C "$APP_DIR" hash-object "$APP_DIR/$helper_path" 2>/dev/null || true)" = "$helper_blob" ] || exit 1
done

verify_deploy_lock_permissions() {
  local deploy_lock_links
  local deploy_lock_mode
  local deploy_lock_observed_identity
  local deploy_lock_raw_mode
  local deploy_lock_uid

  [ -f "$DEPLOY_LOCK_FILE" ] && [ ! -L "$DEPLOY_LOCK_FILE" ] \
    && [ -f "/proc/$$/fd/9" ] || return 1
  deploy_lock_observed_identity="$(stat -c '%d:%i:%h:%u:%f:%a' -- "$DEPLOY_LOCK_FILE" 2>/dev/null || true)"
  [[ "$deploy_lock_observed_identity" =~ ^([0-9]+:){4}[0-9a-fA-F]+:[0-9]+$ ]] \
    || return 1
  [ "$deploy_lock_observed_identity" = "$(stat -Lc '%d:%i:%h:%u:%f:%a' -- "/proc/$$/fd/9" 2>/dev/null || true)" ] \
    || return 1
  IFS=: read -r _ _ deploy_lock_links \
    deploy_lock_uid deploy_lock_raw_mode deploy_lock_mode \
    <<< "$deploy_lock_observed_identity"
  (( (16#$deploy_lock_raw_mode & 0170000) == 0100000 )) || return 1
  [ "$deploy_lock_links" = "1" ] && [ "$deploy_lock_uid" = "$(id -u)" ] \
    || return 1
  [ "$deploy_lock_mode" = "600" ] || return 1
  [ -f "$DEPLOY_LOCK_FILE" ] && [ ! -L "$DEPLOY_LOCK_FILE" ] \
    && [ -f "/proc/$$/fd/9" ] \
    && [ "$(stat -c '%d:%i:%h:%u:%f:%a' -- "$DEPLOY_LOCK_FILE" 2>/dev/null || true)" = "$deploy_lock_observed_identity" ] \
    && [ "$(stat -Lc '%d:%i:%h:%u:%f:%a' -- "/proc/$$/fd/9" 2>/dev/null || true)" = "$deploy_lock_observed_identity" ] \
    || return 1
  DEPLOY_LOCK_IDENTITY="$deploy_lock_observed_identity"
}

RECOVERY_FAILURE_STAGE="deploy_lock"

[ ! -L "$DEPLOY_LOCK_FILE" ] || exit 1
if ! { exec 9<"$DEPLOY_LOCK_FILE"; } 2>/dev/null; then exit 1; fi
flock -w 1 9 >/dev/null 2>&1 || exit 1
verify_deploy_lock_permissions || exit 1

revalidate_deploy_lock() {
  [ -f "$DEPLOY_LOCK_FILE" ] && [ ! -L "$DEPLOY_LOCK_FILE" ] \
    && [ -f "/proc/$$/fd/9" ] \
    && [ "$(stat -c '%d:%i:%h:%u:%f:%a' -- "$DEPLOY_LOCK_FILE" 2>/dev/null || true)" = "$DEPLOY_LOCK_IDENTITY" ] \
    && [ "$(stat -Lc '%d:%i:%h:%u:%f:%a' -- "/proc/$$/fd/9" 2>/dev/null || true)" = "$DEPLOY_LOCK_IDENTITY" ]
}

frozen_tracked_file_contract() {
  local helper_relative="$1"
  case "$helper_relative" in
    "$SMOKE_HELPER_RELATIVE")
      printf '%s\n%s\n%s' \
        "$EXPECTED_OLD_SMOKE_HELPER_BLOB" \
        "$EXPECTED_OLD_SMOKE_HELPER_SHA256" \
        "$EXPECTED_OLD_SMOKE_HELPER_BYTES"
      ;;
    "$PACKAGE_RELATIVE")
      printf '%s\n%s\n%s' \
        "$EXPECTED_OLD_PACKAGE_BLOB" \
        "$EXPECTED_OLD_PACKAGE_SHA256" \
        "$EXPECTED_OLD_PACKAGE_BYTES"
      ;;
    "$WORKER_RELATIVE")
      printf '%s\n%s\n%s' \
        "$EXPECTED_OLD_WORKER_BLOB" \
        "$EXPECTED_OLD_WORKER_SHA256" \
        "$EXPECTED_OLD_WORKER_BYTES"
      ;;
    *) return 1 ;;
  esac
}

harden_frozen_scripts_directory() {
  local scripts_path="$FROZEN_RUNTIME_DIR/scripts"
  [ "$(dirname -- "$scripts_path")" = "$FROZEN_RUNTIME_DIR" ] || return 1
  [ "$(readlink -f -- "$scripts_path" 2>/dev/null || true)" = "$scripts_path" ] \
    || return 1
  revalidate_deploy_lock || return 1
  if ! FAOLLA_FROZEN_SCRIPTS_PATH="$scripts_path" \
    FAOLLA_REQUIRE_ALREADY_HARDENED="$([ "$INITIAL_CURRENT_STATE" = "frozen" ] && printf true || printf false)" \
    timeout --signal=TERM --kill-after=1s 5s node --input-type=module <<'NODE'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
} from "node:fs";

const fail = () => process.exit(1);
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs && left.nlink === right.nlink &&
  left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
const sameStableIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.nlink === right.nlink && left.uid === right.uid && left.gid === right.gid;
let descriptor;
try {
  const path = process.env.FAOLLA_FROZEN_SCRIPTS_PATH ?? "";
  const requireAlreadyHardened = process.env.FAOLLA_REQUIRE_ALREADY_HARDENED;
  if (
    !path.endsWith("/scripts") || typeof process.getuid !== "function" ||
    typeof process.getgid !== "function" ||
    !["true", "false"].includes(requireAlreadyHardened) ||
    !Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_DIRECTORY)
  ) fail();
  const before = lstatSync(path, { bigint: true });
  const permissions = before.mode & 0o7777n;
  if (
    before.isSymbolicLink() || !before.isDirectory() || before.nlink < 1n ||
    before.uid !== BigInt(process.getuid()) ||
    before.gid !== BigInt(process.getgid()) ||
    (requireAlreadyHardened === "true"
      ? permissions !== 0o700n
      : ![0o775n, 0o700n].includes(permissions))
  ) fail();
  descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const opened = fstatSync(descriptor, { bigint: true });
  if (!opened.isDirectory() || !sameIdentity(before, opened)) fail();
  if (permissions === 0o775n) fchmodSync(descriptor, 0o700);
  const hardened = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  if (
    !hardened.isDirectory() || current.isSymbolicLink() || !current.isDirectory() ||
    !sameStableIdentity(before, hardened) || !sameIdentity(hardened, current) ||
    (hardened.mode & 0o7777n) !== 0o700n || hardened.ctimeNs < before.ctimeNs
  ) fail();
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
  then
    return 1
  fi
  revalidate_deploy_lock
}

harden_frozen_tracked_file() {
  local helper_path="$1"
  local helper_relative="$2"
  local contract
  local -a contract_parts=()
  [ "$helper_path" = "$FROZEN_RUNTIME_DIR/$helper_relative" ] || return 1
  case "$helper_relative" in
    "$SMOKE_HELPER_RELATIVE"|"$PACKAGE_RELATIVE"|"$WORKER_RELATIVE") ;;
    *) return 1 ;;
  esac
  contract="$(frozen_tracked_file_contract "$helper_relative")" || return 1
  mapfile -t contract_parts <<< "$contract"
  [ "${#contract_parts[@]}" -eq 3 ] \
    && [[ "${contract_parts[0]}" =~ ^[0-9a-f]{40}$ ]] \
    && [[ "${contract_parts[1]}" =~ ^[0-9a-f]{64}$ ]] \
    && [[ "${contract_parts[2]}" =~ ^[1-9][0-9]*$ ]] \
    || return 1
  revalidate_deploy_lock || return 1
  if ! FAOLLA_FROZEN_TRACKED_PATH="$helper_path" \
    FAOLLA_REQUIRE_ALREADY_HARDENED="$([ "$INITIAL_CURRENT_STATE" = "frozen" ] && printf true || printf false)" \
    FAOLLA_EXPECTED_BLOB="${contract_parts[0]}" \
    FAOLLA_EXPECTED_SHA256="${contract_parts[1]}" \
    FAOLLA_EXPECTED_BYTES="${contract_parts[2]}" \
    timeout --signal=TERM --kill-after=1s 5s node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

const fail = () => process.exit(1);
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs && left.nlink === right.nlink &&
  left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
const sameStableIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.nlink === right.nlink && left.uid === right.uid && left.gid === right.gid;
const readExact = (descriptor, size) => {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) fail();
    offset += count;
  }
  const extra = Buffer.alloc(1);
  if (readSync(descriptor, extra, 0, 1, size) !== 0) fail();
  return bytes;
};
const verifyBytes = (bytes, expectedBlob, expectedSha256) => {
  const blob = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (blob !== expectedBlob || sha256 !== expectedSha256) fail();
};
let descriptor;
try {
  const path = process.env.FAOLLA_FROZEN_TRACKED_PATH ?? "";
  const expectedBlob = process.env.FAOLLA_EXPECTED_BLOB ?? "";
  const expectedSha256 = process.env.FAOLLA_EXPECTED_SHA256 ?? "";
  const expectedBytes = process.env.FAOLLA_EXPECTED_BYTES ?? "";
  const requireAlreadyHardened = process.env.FAOLLA_REQUIRE_ALREADY_HARDENED;
  if (
    !/^[0-9a-f]{40}$/.test(expectedBlob) ||
    !/^[0-9a-f]{64}$/.test(expectedSha256) ||
    !/^[1-9][0-9]*$/.test(expectedBytes) ||
    typeof process.getuid !== "function" || typeof process.getgid !== "function" ||
    !["true", "false"].includes(requireAlreadyHardened) ||
    !Number.isInteger(constants.O_NOFOLLOW)
  ) fail();
  const size = Number(expectedBytes);
  if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024) fail();
  const before = lstatSync(path, { bigint: true });
  const permissions = before.mode & 0o7777n;
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid()) ||
    before.gid !== BigInt(process.getgid()) || before.size !== BigInt(size) ||
    (requireAlreadyHardened === "true"
      ? permissions !== 0o600n
      : ![0o664n, 0o600n].includes(permissions))
  ) fail();
  descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const opened = fstatSync(descriptor, { bigint: true });
  if (!opened.isFile() || !sameIdentity(before, opened)) fail();
  const bytesBefore = readExact(descriptor, size);
  verifyBytes(bytesBefore, expectedBlob, expectedSha256);
  const afterRead = fstatSync(descriptor, { bigint: true });
  const currentBefore = lstatSync(path, { bigint: true });
  if (!sameIdentity(before, afterRead) || !sameIdentity(afterRead, currentBefore)) fail();
  if (permissions === 0o664n) fchmodSync(descriptor, 0o600);
  const hardened = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  if (
    !hardened.isFile() || current.isSymbolicLink() || !current.isFile() ||
    !sameStableIdentity(before, hardened) || !sameIdentity(hardened, current) ||
    (hardened.mode & 0o7777n) !== 0o600n || hardened.ctimeNs < before.ctimeNs
  ) fail();
  const bytesAfter = readExact(descriptor, size);
  if (!bytesAfter.equals(bytesBefore)) fail();
  verifyBytes(bytesAfter, expectedBlob, expectedSha256);
  const finalOpened = fstatSync(descriptor, { bigint: true });
  const finalCurrent = lstatSync(path, { bigint: true });
  if (!sameIdentity(hardened, finalOpened) || !sameIdentity(finalOpened, finalCurrent)) fail();
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
  then
    return 1
  fi
  revalidate_deploy_lock
}

trusted_helper_snapshot() {
  local helper_path="$1"
  local helper_relative="$2"
  local expected_commit="$3"
  local expected_root="$4"
  local contract
  local -a contract_parts=()
  local expected_blob
  local snapshot
  case "$helper_relative" in
    "$ENV_HELPER_RELATIVE"|"$FENCE_HELPER_RELATIVE"|"$SMOKE_HELPER_RELATIVE"|\
    "$PACKAGE_RELATIVE"|"$WORKER_RELATIVE") ;;
    *) return 1 ;;
  esac
  case "$expected_commit:$expected_root" in
    "$EXPECTED_INCIDENT_SHA:$APP_DIR"|\
    "$EXPECTED_OLD_BUILD_ID:${FROZEN_RUNTIME_DIR:-__frozen_unset__}") ;;
    *) return 1 ;;
  esac
  [ "$helper_path" = "$expected_root/$helper_relative" ] || return 1
  revalidate_deploy_lock || return 1
  [ "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)" = "$EXPECTED_INCIDENT_SHA" ] \
    || return 1
  [ -f "$helper_path" ] && [ ! -L "$helper_path" ] || return 1
  if [ "$expected_root" = "$APP_DIR" ]; then
    git -C "$APP_DIR" diff --quiet -- "$helper_relative" >/dev/null 2>&1 \
      || return 1
    git -C "$APP_DIR" diff --cached --quiet -- "$helper_relative" >/dev/null 2>&1 \
      || return 1
    expected_blob="$(git -C "$APP_DIR" rev-parse \
      "$expected_commit:$helper_relative" 2>/dev/null || true)"
  else
    contract="$(frozen_tracked_file_contract "$helper_relative")" || return 1
    mapfile -t contract_parts <<< "$contract"
    [ "${#contract_parts[@]}" -eq 3 ] || return 1
    expected_blob="${contract_parts[0]}"
  fi
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
  local expected_commit="$3"
  local expected_root="$4"
  local frozen_snapshot="$5"
  local current_snapshot
  [[ "$frozen_snapshot" =~ ^([0-9]+:){7}[0-9]+:[0-9a-f]{40,64}:[0-9a-f]{64}$ ]] \
    || return 1
  current_snapshot="$(trusted_helper_snapshot "$helper_path" "$helper_relative" \
    "$expected_commit" "$expected_root")" \
    || return 1
  [ "$current_snapshot" = "$frozen_snapshot" ]
}

RECOVERY_FAILURE_STAGE="helpers"

INCIDENT_FENCE_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot \
  "$INCIDENT_FENCE_HELPER" "$FENCE_HELPER_RELATIVE" \
  "$EXPECTED_INCIDENT_SHA" "$APP_DIR")" || exit 1
readonly INCIDENT_FENCE_HELPER_FROZEN_SNAPSHOT

RECOVERY_FAILURE_STAGE="incident_env_helper_identity"
INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot \
  "$INCIDENT_ENV_HELPER" "$ENV_HELPER_RELATIVE" \
  "$EXPECTED_INCIDENT_SHA" "$APP_DIR")" || exit 1
readonly INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT

RECOVERY_FAILURE_STAGE="candidate_inventory"

capture_trusted_release_environment_helper_output() {
  local output_name="$1"
  local timeout_seconds="$2"
  local helper_path="$3"
  local expected_commit="$4"
  local expected_root="$5"
  local helper_snapshot="$6"
  shift 6
  local captured=""
  local helper_status=0
  [[ "$output_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || return 1
  trusted_helper_matches \
    "$helper_path" "$ENV_HELPER_RELATIVE" \
    "$expected_commit" "$expected_root" "$helper_snapshot" \
    || return 1
  if captured="$(timeout --signal=TERM --kill-after=1s \
    "${timeout_seconds}s" node "$helper_path" "$@" 2>/dev/null)"; then
    helper_status=0
  else
    helper_status=$?
  fi
  trusted_helper_matches \
    "$helper_path" "$ENV_HELPER_RELATIVE" \
    "$expected_commit" "$expected_root" "$helper_snapshot" \
    || return 1
  [ "$helper_status" -eq 0 ] || return 1
  printf -v "$output_name" '%s' "$captured"
}

capture_trusted_environment_helper_output() {
  local output_name="$1"
  local timeout_seconds="$2"
  shift 2
  capture_trusted_release_environment_helper_output \
    "$output_name" "$timeout_seconds" \
    "$INCIDENT_ENV_HELPER" "$EXPECTED_INCIDENT_SHA" \
    "$APP_DIR" "$INCIDENT_ENV_HELPER_FROZEN_SNAPSHOT" "$@"
}

RELEASES_REAL="$(readlink -f -- "$RELEASES_DIR" 2>/dev/null || true)"
[ "$RELEASES_REAL" = "$RELEASES_DIR" ] || exit 1

find_unique_release() {
  local build_prefix="$1"
  local sentinel="__faolla_release_inventory_complete__"
  local -a matches=()
  [[ "$build_prefix" =~ ^[0-9a-f]{12}$ ]] || return 1
  mapfile -d '' -t matches < <(
    if find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d \
      -name "${build_prefix}-*" -print0 2>/dev/null; then
      printf '%s\0' "$sentinel"
    fi
  )
  [ "${#matches[@]}" -ge 1 ] && [ "${matches[-1]}" = "$sentinel" ] || return 1
  unset 'matches[-1]'
  [ "${#matches[@]}" -eq 1 ] || return 1
  [ "$(dirname -- "${matches[0]}")" = "$RELEASES_REAL" ] || return 1
  [[ "$(basename -- "${matches[0]}")" =~ ^${build_prefix}-[0-9]{14}$ ]] || return 1
  [ "$(readlink -f -- "${matches[0]}" 2>/dev/null || true)" = "${matches[0]}" ] \
    || return 1
  printf '%s' "${matches[0]}"
}

trusted_directory_identity() {
  local path="$1"
  local identity
  local directory_uid
  local directory_raw_mode
  local directory_links
  local directory_mode
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -c '%d:%i:%Y:%Z:%u:%f:%h:%a' -- "$path" 2>/dev/null || true)"
  [[ "$identity" =~ ^([0-9]+:){5}[0-9a-fA-F]+:[0-9]+:[0-7]{3,4}$ ]] \
    || return 1
  IFS=: read -r _ _ _ _ directory_uid directory_raw_mode directory_links \
    directory_mode <<< "$identity"
  (( (16#$directory_raw_mode & 0170000) == 0040000 )) || return 1
  [ "$directory_uid" = "$(id -u)" ] \
    && [ "$directory_links" -ge 1 ] \
    && [ $((8#$directory_mode & 8#022)) -eq 0 ] \
    || return 1
  printf '%s' "$identity"
}

release_structure_identity() {
  local runtime_dir="$1"
  local expected_build="$2"
  local identity
  local next_identity
  local modules_identity
  local runtime_link_identity
  [[ "$expected_build" =~ ^[0-9a-f]{40}$ ]] || return 1
  [ "$(dirname -- "$runtime_dir")" = "$RELEASES_REAL" ] || return 1
  [[ "$(basename -- "$runtime_dir")" =~ ^${expected_build:0:12}-[0-9]{14}$ ]] \
    || return 1
  [ "$(readlink -f -- "$runtime_dir" 2>/dev/null || true)" = "$runtime_dir" ] \
    || return 1
  [ -d "$runtime_dir" ] && [ ! -L "$runtime_dir" ] || return 1
  [ -d "$runtime_dir/.next" ] && [ ! -L "$runtime_dir/.next" ] || return 1
  [ -f "$runtime_dir/.next/BUILD_ID" ] && [ ! -L "$runtime_dir/.next/BUILD_ID" ] \
    || return 1
  [ -f "$runtime_dir/.env.local" ] && [ ! -L "$runtime_dir/.env.local" ] || return 1
  [ -f "$runtime_dir/package.json" ] && [ ! -L "$runtime_dir/package.json" ] || return 1
  [ -d "$runtime_dir/node_modules" ] && [ ! -L "$runtime_dir/node_modules" ] || return 1
  [ -L "$runtime_dir/.runtime" ] || return 1
  [ "$(readlink -f -- "$runtime_dir/.runtime" 2>/dev/null || true)" = "$SHARED_RUNTIME_DIR" ] \
    || return 1
  identity="$(trusted_directory_identity "$runtime_dir")" || return 1
  next_identity="$(trusted_directory_identity "$runtime_dir/.next")" || return 1
  modules_identity="$(trusted_directory_identity "$runtime_dir/node_modules")" \
    || return 1
  runtime_link_identity="$(trusted_symlink_identity "$runtime_dir/.runtime")" \
    || return 1
  printf '%s/%s/%s/%s' \
    "$identity" "$next_identity" "$modules_identity" "$runtime_link_identity"
}

candidate_environment_build_binding_result() {
  local runtime_dir="$1"
  local expected_build="$2"
  local result
  result="$(FAOLLA_EXPECTED_BUILD_ID="$expected_build" \
    timeout --signal=TERM --kill-after=1s 5s node --input-type=module - \
      "$runtime_dir/.env.local" "$runtime_dir" 2>/dev/null <<'NODE'
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname } from "node:path";

const TOKENS = new Set([
  "candidate_env_file_identity",
  "candidate_env_encoding",
  "candidate_env_server_build_binding",
  "candidate_env_public_build_binding",
  "candidate_env_snapshot_contract",
]);
let failureToken = "candidate_env_snapshot_contract";
let descriptor;
let emitted = false;
const reject = () => {
  throw new Error("candidate_environment_rejected");
};
const emit = (value) => {
  if (emitted) process.exit(1);
  process.stdout.write(value);
  emitted = true;
};
const sameFile = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs && left.nlink === right.nlink &&
  left.uid === right.uid && left.mode === right.mode;
const sameDirectory = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
  left.nlink === right.nlink && left.uid === right.uid && left.mode === right.mode;
const directoryIdentity = (value) => [
  value.dev, value.ino, value.mtimeNs, value.ctimeNs,
  value.nlink, value.uid, value.mode,
].map(String).join(":");
const fileIdentity = (value) => [
  value.dev, value.ino, value.size, value.mtimeNs,
  value.ctimeNs, value.nlink, value.uid, value.mode,
].map(String).join(":");
const safeDirectory = (value) =>
  !value.isSymbolicLink() && value.isDirectory() && value.nlink >= 1n &&
  typeof process.getuid === "function" && value.uid === BigInt(process.getuid()) &&
  (value.mode & 0o022n) === 0n;
const safeFile = (value) =>
  !value.isSymbolicLink() && value.isFile() && value.nlink === 1n &&
  value.size > 0n && value.size <= 1024n * 1024n &&
  typeof process.getuid === "function" && value.uid === BigInt(process.getuid()) &&
  (value.mode & 0o777n) === 0o600n;
const exactAssignmentMatches = (lines, key, expected) => {
  const prefix = `${key}=`;
  const values = lines.filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  return values.length === 1 && values[0].length > 0 && values[0] === expected;
};

try {
  const path = process.argv[2];
  const runtime = process.argv[3];
  const expected = process.env.FAOLLA_EXPECTED_BUILD_ID ?? "";
  if (
    !/^[0-9a-f]{40}$/.test(expected) ||
    typeof path !== "string" || typeof runtime !== "string" ||
    path !== `${runtime}/.env.local` || dirname(path) !== runtime ||
    !Number.isInteger(constants.O_NOFOLLOW) || typeof process.getuid !== "function"
  ) reject();

  failureToken = "candidate_env_file_identity";
  if (realpathSync(runtime) !== runtime) reject();
  const directoryBefore = lstatSync(runtime, { bigint: true });
  const before = lstatSync(path, { bigint: true });
  if (!safeDirectory(directoryBefore) || !safeFile(before)) reject();
  descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  const opened = fstatSync(descriptor, { bigint: true });
  if (!safeFile(opened) || !sameFile(before, opened)) reject();
  const bytes = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  const directoryAfter = lstatSync(runtime, { bigint: true });
  if (
    BigInt(bytes.length) !== opened.size || !sameFile(opened, after) ||
    !safeFile(current) || !sameFile(opened, current) ||
    !safeDirectory(directoryAfter) || !sameDirectory(directoryBefore, directoryAfter)
  ) reject();

  failureToken = "candidate_env_encoding";
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.includes("\0")) reject();
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r" && source[index + 1] !== "\n") reject();
  }
  const lines = source.split("\n").map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line
  );
  if (lines.some((line) => line.includes("\r"))) reject();

  failureToken = "candidate_env_server_build_binding";
  if (!exactAssignmentMatches(lines, "FAOLLA_WEB_BUILD_ID", expected)) reject();
  failureToken = "candidate_env_public_build_binding";
  if (!exactAssignmentMatches(lines, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID", expected)) reject();

  failureToken = "candidate_env_snapshot_contract";
  emit([
    "candidate_env_snapshot_ok",
    directoryIdentity(directoryBefore),
    fileIdentity(opened),
    createHash("sha256").update(bytes).digest("hex"),
  ].join("\n"));
} catch {
  if (!TOKENS.has(failureToken)) failureToken = "candidate_env_snapshot_contract";
  if (!emitted) emit(failureToken);
} finally {
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch {
      process.exitCode = 1;
    }
  }
}
NODE
  )" || return 1
  case "$result" in
    candidate_env_snapshot_ok$'\n'*) ;;
    candidate_env_file_identity|candidate_env_encoding|\
    candidate_env_server_build_binding|candidate_env_public_build_binding|\
    candidate_env_snapshot_contract) ;;
    *) return 1 ;;
  esac
  printf '%s' "$result"
}

candidate_environment_build_binding_snapshot() {
  local runtime_dir="$1"
  local expected_build="$2"
  local result
  local -a parts=()
  result="$(candidate_environment_build_binding_result \
    "$runtime_dir" "$expected_build")" || return 1
  mapfile -t parts <<< "$result"
  [ "${#parts[@]}" -eq 4 ] \
    && [ "${parts[0]}" = "candidate_env_snapshot_ok" ] \
    && [[ "${parts[1]}" =~ ^([0-9]+:){6}[0-9]+$ ]] \
    && [[ "${parts[2]}" =~ ^([0-9]+:){7}[0-9]+$ ]] \
    && [[ "${parts[3]}" =~ ^[0-9a-f]{64}$ ]] \
    || return 1
  printf '%s\n%s\n%s' "${parts[1]}" "${parts[2]}" "${parts[3]}"
}

environment_build_binding_snapshot() {
  local runtime_dir="$1"
  local expected_build="$2"
  local snapshot
  local -a parts=()
  [[ "$expected_build" =~ ^[0-9a-f]{40}$ ]] || return 1
  snapshot="$(FAOLLA_EXPECTED_BUILD_ID="$expected_build" \
    timeout --signal=TERM --kill-after=1s 5s node --input-type=module - \
      "$runtime_dir/.env.local" "$runtime_dir" 2>/dev/null <<'NODE'
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname } from "node:path";

const fail = () => process.exit(1);
const sameFile = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs && left.nlink === right.nlink &&
  left.uid === right.uid && left.mode === right.mode;
const sameDirectory = (left, right) =>
  left.dev === right.dev && left.ino === right.ino &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
  left.nlink === right.nlink && left.uid === right.uid && left.mode === right.mode;
const directoryIdentity = (value) => [
  value.dev, value.ino, value.mtimeNs, value.ctimeNs,
  value.nlink, value.uid, value.mode,
].map(String).join(":");
const fileIdentity = (value) => [
  value.dev, value.ino, value.size, value.mtimeNs,
  value.ctimeNs, value.nlink, value.uid, value.mode,
].map(String).join(":");
const safeDirectory = (value) =>
  !value.isSymbolicLink() && value.isDirectory() && value.nlink >= 1n &&
  typeof process.getuid === "function" && value.uid === BigInt(process.getuid()) &&
  (value.mode & 0o022n) === 0n;
const safeFile = (value) =>
  !value.isSymbolicLink() && value.isFile() && value.nlink === 1n &&
  value.size > 0n && value.size <= 1024n * 1024n &&
  typeof process.getuid === "function" && value.uid === BigInt(process.getuid()) &&
  (value.mode & 0o777n) === 0o600n;
const exactAssignment = (lines, key) => {
  const prefix = `${key}=`;
  const values = lines.filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  if (values.length !== 1 || values[0].length === 0) fail();
  return values[0];
};

let descriptor;
try {
  const path = process.argv[2];
  const runtime = process.argv[3];
  const expected = process.env.FAOLLA_EXPECTED_BUILD_ID ?? "";
  if (
    !/^[0-9a-f]{40}$/.test(expected) ||
    typeof path !== "string" || path !== `${runtime}/.env.local` ||
    dirname(path) !== runtime || realpathSync(runtime) !== runtime ||
    !Number.isInteger(constants.O_NOFOLLOW) || typeof process.getuid !== "function"
  ) fail();
  const directoryBefore = lstatSync(runtime, { bigint: true });
  const before = lstatSync(path, { bigint: true });
  if (!safeDirectory(directoryBefore) || !safeFile(before)) fail();
  descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  const opened = fstatSync(descriptor, { bigint: true });
  if (!safeFile(opened) || !sameFile(before, opened)) fail();
  const bytes = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  const directoryAfter = lstatSync(runtime, { bigint: true });
  if (
    BigInt(bytes.length) !== opened.size || !sameFile(opened, after) ||
    !safeFile(current) || !sameFile(opened, current) ||
    !safeDirectory(directoryAfter) || !sameDirectory(directoryBefore, directoryAfter)
  ) fail();
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.includes("\0") || source.includes("\r")) fail();
  const lines = source.split("\n");
  if (
    exactAssignment(lines, "FAOLLA_WEB_BUILD_ID") !== expected ||
    exactAssignment(lines, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID") !== expected
  ) fail();
  process.stdout.write([
    directoryIdentity(directoryBefore),
    fileIdentity(opened),
    createHash("sha256").update(bytes).digest("hex"),
  ].join("\n"));
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
  )" || return 1
  mapfile -t parts <<< "$snapshot"
  [ "${#parts[@]}" -eq 3 ] \
    && [[ "${parts[0]}" =~ ^([0-9]+:){6}[0-9]+$ ]] \
    && [[ "${parts[1]}" =~ ^([0-9]+:){7}[0-9]+$ ]] \
    && [[ "${parts[2]}" =~ ^[0-9a-f]{64}$ ]] \
    || return 1
  printf '%s' "$snapshot"
}

next_build_identity() {
  local runtime_dir="$1"
  local snapshot
  snapshot="$(timeout --signal=TERM --kill-after=1s 3s node --input-type=module - \
    "$runtime_dir/.next/BUILD_ID" 2>/dev/null <<'NODE'
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

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
  if (typeof process.getuid !== "function" || !Number.isInteger(constants.O_NOFOLLOW)) fail();
  const before = lstatSync(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid()) || (before.mode & 0o022n) !== 0n ||
    before.size <= 0n || before.size > 129n
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
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = decoded.endsWith("\n") ? decoded.slice(0, -1) : decoded;
  if (
    (decoded !== value && decoded !== `${value}\n`) ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(value)
  ) fail();
  process.stdout.write(
    `${identity(opened)}:${createHash("sha256").update(bytes).digest("hex")}`,
  );
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
NODE
  )" || return 1
  [[ "$snapshot" =~ ^([0-9]+:){7}[0-9]+:[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$snapshot"
}

RECOVERY_FAILURE_STAGE="candidate_inventory"
CANDIDATE_RUNTIME_DIR="$(find_unique_release "${EXPECTED_CANDIDATE_BUILD_ID:0:12}")" || exit 1

RECOVERY_FAILURE_STAGE="frozen_inventory"
FROZEN_RUNTIME_DIR="$(find_unique_release "${EXPECTED_OLD_BUILD_ID:0:12}")" || exit 1
[ "$CANDIDATE_RUNTIME_DIR" != "$FROZEN_RUNTIME_DIR" ] || exit 1

RECOVERY_FAILURE_STAGE="initial_current_target"
INITIAL_CURRENT_RAW_TARGET="$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)"
INITIAL_CURRENT_RESOLVED_TARGET="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
if [ "$INITIAL_CURRENT_RAW_TARGET" = "$CANDIDATE_RUNTIME_DIR" ] \
  && [ "$INITIAL_CURRENT_RESOLVED_TARGET" = "$CANDIDATE_RUNTIME_DIR" ]; then
  INITIAL_CURRENT_STATE="candidate"
elif [ "$INITIAL_CURRENT_RAW_TARGET" = "$FROZEN_RUNTIME_DIR" ] \
  && [ "$INITIAL_CURRENT_RESOLVED_TARGET" = "$FROZEN_RUNTIME_DIR" ]; then
  INITIAL_CURRENT_STATE="frozen"
else
  exit 1
fi

RECOVERY_FAILURE_STAGE="initial_current_identity"
INITIAL_CURRENT_LINK_IDENTITY="$(trusted_symlink_identity "$CURRENT_LINK")" || exit 1
[ "$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)" = \
  "$INITIAL_CURRENT_RAW_TARGET" ] \
  && [ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" = \
    "$INITIAL_CURRENT_RESOLVED_TARGET" ] || exit 1
readonly INITIAL_CURRENT_STATE INITIAL_CURRENT_RAW_TARGET \
  INITIAL_CURRENT_RESOLVED_TARGET INITIAL_CURRENT_LINK_IDENTITY

revalidate_initial_current_target() {
  revalidate_current_link_parent \
    && [ "$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)" = \
    "$INITIAL_CURRENT_RAW_TARGET" ] \
    && [ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$INITIAL_CURRENT_RESOLVED_TARGET" ]
}

revalidate_initial_current_identity() {
  [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
    "$INITIAL_CURRENT_LINK_IDENTITY" ] \
    && revalidate_initial_current_target
}

revalidate_initial_current_compatibility() {
  [ -L "$APP_DIR/.next" ] \
    && [ "$(readlink -- "$APP_DIR/.next" 2>/dev/null || true)" = \
      "$CURRENT_LINK/.next" ] \
    && [ -L "$APP_DIR/node_modules" ] \
    && [ "$(readlink -- "$APP_DIR/node_modules" 2>/dev/null || true)" = \
      "$CURRENT_LINK/node_modules" ] \
    && [ ! -e "$APP_DIR/.next.pre-atomic-deploy" ] \
    && [ ! -L "$APP_DIR/.next.pre-atomic-deploy" ] \
    && [ ! -e "$APP_DIR/node_modules.pre-atomic-deploy" ] \
    && [ ! -L "$APP_DIR/node_modules.pre-atomic-deploy" ]
}

revalidate_initial_current_temporary_links() {
  revalidate_current_link_parent \
    && [ ! -e "$EXPECTED_SWITCH_TEMP_LINK" ] \
    && [ ! -L "$EXPECTED_SWITCH_TEMP_LINK" ] \
    && [ ! -e "$EXPECTED_COMPENSATION_TEMP_LINK" ] \
    && [ ! -L "$EXPECTED_COMPENSATION_TEMP_LINK" ]
}

revalidate_initial_current_observation() {
  revalidate_initial_current_target \
    && revalidate_initial_current_identity \
    && revalidate_initial_current_compatibility \
    && revalidate_initial_current_temporary_links
}

RECOVERY_FAILURE_STAGE="initial_current_compatibility"
revalidate_initial_current_compatibility || exit 1

RECOVERY_FAILURE_STAGE="initial_current_temporary_links"
revalidate_initial_current_temporary_links || exit 1
revalidate_initial_current_observation || exit 1

RECOVERY_FAILURE_STAGE="candidate_structure"
git -C "$APP_DIR" cat-file -e "$EXPECTED_CANDIDATE_BUILD_ID^{commit}" >/dev/null 2>&1 \
  || exit 1
[ "$(git -C "$APP_DIR" rev-parse "$EXPECTED_CANDIDATE_BUILD_ID^{commit}" 2>/dev/null || true)" = \
  "$EXPECTED_CANDIDATE_BUILD_ID" ] || exit 1
CANDIDATE_RUNTIME_IDENTITY="$(release_structure_identity \
  "$CANDIDATE_RUNTIME_DIR" "$EXPECTED_CANDIDATE_BUILD_ID")" || exit 1

RECOVERY_FAILURE_STAGE="candidate_env_file_identity"
CANDIDATE_ENVIRONMENT_RESULT_STATUS=0
CANDIDATE_ENVIRONMENT_RESULT="$(candidate_environment_build_binding_result \
  "$CANDIDATE_RUNTIME_DIR" "$EXPECTED_CANDIDATE_BUILD_ID")" \
  || CANDIDATE_ENVIRONMENT_RESULT_STATUS=$?
mapfile -t CANDIDATE_ENVIRONMENT_RESULT_PARTS <<< "$CANDIDATE_ENVIRONMENT_RESULT"
if [ "$CANDIDATE_ENVIRONMENT_RESULT_STATUS" -ne 0 ]; then
  CANDIDATE_ENVIRONMENT_RESULT_PARTS=(candidate_env_snapshot_contract)
fi
case "${CANDIDATE_ENVIRONMENT_RESULT_PARTS[0]:-}" in
  candidate_env_snapshot_ok)
    if [ "${#CANDIDATE_ENVIRONMENT_RESULT_PARTS[@]}" -ne 4 ]; then
      RECOVERY_FAILURE_STAGE="$CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE"
      exit 1
    fi
    CANDIDATE_ENVIRONMENT_SNAPSHOT="$(printf '%s\n%s\n%s' \
      "${CANDIDATE_ENVIRONMENT_RESULT_PARTS[1]}" \
      "${CANDIDATE_ENVIRONMENT_RESULT_PARTS[2]}" \
      "${CANDIDATE_ENVIRONMENT_RESULT_PARTS[3]}")"
    ;;
  candidate_env_file_identity)
    [ "${#CANDIDATE_ENVIRONMENT_RESULT_PARTS[@]}" -eq 1 ] || \
      RECOVERY_FAILURE_STAGE="$CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE"
    [ "$RECOVERY_FAILURE_STAGE" = "candidate_env_snapshot_contract" ] || \
      RECOVERY_FAILURE_STAGE="candidate_env_file_identity"
    exit 1
    ;;
  candidate_env_encoding)
    [ "${#CANDIDATE_ENVIRONMENT_RESULT_PARTS[@]}" -eq 1 ] || \
      RECOVERY_FAILURE_STAGE="$CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE"
    [ "$RECOVERY_FAILURE_STAGE" = "candidate_env_snapshot_contract" ] || \
      RECOVERY_FAILURE_STAGE="candidate_env_encoding"
    exit 1
    ;;
  candidate_env_server_build_binding)
    [ "${#CANDIDATE_ENVIRONMENT_RESULT_PARTS[@]}" -eq 1 ] || \
      RECOVERY_FAILURE_STAGE="$CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE"
    [ "$RECOVERY_FAILURE_STAGE" = "candidate_env_snapshot_contract" ] || \
      RECOVERY_FAILURE_STAGE="candidate_env_server_build_binding"
    exit 1
    ;;
  candidate_env_public_build_binding)
    [ "${#CANDIDATE_ENVIRONMENT_RESULT_PARTS[@]}" -eq 1 ] || \
      RECOVERY_FAILURE_STAGE="$CANDIDATE_ENVIRONMENT_SNAPSHOT_CONTRACT_STAGE"
    [ "$RECOVERY_FAILURE_STAGE" = "candidate_env_snapshot_contract" ] || \
      RECOVERY_FAILURE_STAGE="candidate_env_public_build_binding"
    exit 1
    ;;
  *)
    RECOVERY_FAILURE_STAGE="candidate_env_snapshot_contract"
    exit 1
    ;;
esac
mapfile -t CANDIDATE_ENVIRONMENT_PARTS <<< "$CANDIDATE_ENVIRONMENT_SNAPSHOT"
[ "${#CANDIDATE_ENVIRONMENT_PARTS[@]}" -eq 3 ] || {
  RECOVERY_FAILURE_STAGE="candidate_env_snapshot_contract"
  exit 1
}
CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY="${CANDIDATE_ENVIRONMENT_PARTS[0]}"
CANDIDATE_ENVIRONMENT_FILE_IDENTITY="${CANDIDATE_ENVIRONMENT_PARTS[1]}"
CANDIDATE_ENVIRONMENT_SHA256="${CANDIDATE_ENVIRONMENT_PARTS[2]}"
[[ "$CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY" =~ ^([0-9]+:){6}[0-9]+$ ]] \
  || {
    RECOVERY_FAILURE_STAGE="candidate_env_snapshot_contract"
    exit 1
  }
[[ "$CANDIDATE_ENVIRONMENT_FILE_IDENTITY" =~ ^([0-9]+:){7}[0-9]+$ ]] \
  || {
    RECOVERY_FAILURE_STAGE="candidate_env_snapshot_contract"
    exit 1
  }
[[ "$CANDIDATE_ENVIRONMENT_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
  RECOVERY_FAILURE_STAGE="candidate_env_snapshot_contract"
  exit 1
}
unset CANDIDATE_ENVIRONMENT_RESULT CANDIDATE_ENVIRONMENT_RESULT_PARTS \
  CANDIDATE_ENVIRONMENT_RESULT_STATUS CANDIDATE_ENVIRONMENT_SNAPSHOT \
  CANDIDATE_ENVIRONMENT_PARTS
readonly CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY \
  CANDIDATE_ENVIRONMENT_FILE_IDENTITY CANDIDATE_ENVIRONMENT_SHA256

RECOVERY_FAILURE_STAGE="candidate_next_build_identity"
CANDIDATE_NEXT_BUILD_SNAPSHOT="$(next_build_identity "$CANDIDATE_RUNTIME_DIR")" \
  || exit 1
readonly CANDIDATE_NEXT_BUILD_SNAPSHOT

RECOVERY_FAILURE_STAGE="frozen_release_structure"
FROZEN_RUNTIME_IDENTITY="$(release_structure_identity \
  "$FROZEN_RUNTIME_DIR" "$EXPECTED_OLD_BUILD_ID")" || exit 1
[ "$(stat -Lc '%d:%i' -- "$CANDIDATE_RUNTIME_DIR" 2>/dev/null || true)" != \
  "$(stat -Lc '%d:%i' -- "$FROZEN_RUNTIME_DIR" 2>/dev/null || true)" ] || exit 1
readonly FROZEN_SMOKE_HELPER="$FROZEN_RUNTIME_DIR/$SMOKE_HELPER_RELATIVE"
readonly FROZEN_PACKAGE_FILE="$FROZEN_RUNTIME_DIR/$PACKAGE_RELATIVE"
readonly FROZEN_WORKER_FILE="$FROZEN_RUNTIME_DIR/$WORKER_RELATIVE"

verify_frozen_resume_path_permissions() {
  local path="$1"
  local kind="$2"
  local expected_mode="$3"
  local expected_owner="$(id -u):$(id -g)"
  [ "$INITIAL_CURRENT_STATE" = "frozen" ] || return 0
  case "$kind:$expected_mode" in
    directory:700) [ -d "$path" ] ;;
    file:600) [ -f "$path" ] ;;
    *) return 1 ;;
  esac
  [ ! -L "$path" ] \
    && [ "$(stat -c '%u:%g:%a' -- "$path" 2>/dev/null || true)" = \
      "$expected_owner:$expected_mode" ]
}

verify_frozen_resume_permissions() {
  verify_frozen_resume_path_permissions \
    "$FROZEN_RUNTIME_DIR/scripts" directory 700 \
    && verify_frozen_resume_path_permissions "$FROZEN_SMOKE_HELPER" file 600 \
    && verify_frozen_resume_path_permissions "$FROZEN_PACKAGE_FILE" file 600 \
    && verify_frozen_resume_path_permissions "$FROZEN_WORKER_FILE" file 600
}

RECOVERY_FAILURE_STAGE="frozen_scripts_identity"
verify_frozen_resume_path_permissions \
  "$FROZEN_RUNTIME_DIR/scripts" directory 700 || exit 1
harden_frozen_scripts_directory || exit 1
FROZEN_SCRIPTS_IDENTITY="$(trusted_directory_identity \
  "$FROZEN_RUNTIME_DIR/scripts")" || exit 1
readonly FROZEN_SCRIPTS_IDENTITY

RECOVERY_FAILURE_STAGE="frozen_smoke_helper_identity"
verify_frozen_resume_path_permissions "$FROZEN_SMOKE_HELPER" file 600 || exit 1
harden_frozen_tracked_file "$FROZEN_SMOKE_HELPER" "$SMOKE_HELPER_RELATIVE" \
  || exit 1
FROZEN_SMOKE_HELPER_SNAPSHOT="$(trusted_helper_snapshot \
  "$FROZEN_SMOKE_HELPER" "$SMOKE_HELPER_RELATIVE" \
  "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR")" || exit 1

RECOVERY_FAILURE_STAGE="frozen_package_identity"
verify_frozen_resume_path_permissions "$FROZEN_PACKAGE_FILE" file 600 || exit 1
harden_frozen_tracked_file "$FROZEN_PACKAGE_FILE" "$PACKAGE_RELATIVE" || exit 1
FROZEN_PACKAGE_SNAPSHOT="$(trusted_helper_snapshot \
  "$FROZEN_PACKAGE_FILE" "$PACKAGE_RELATIVE" \
  "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR")" || exit 1

RECOVERY_FAILURE_STAGE="frozen_worker_identity"
verify_frozen_resume_path_permissions "$FROZEN_WORKER_FILE" file 600 || exit 1
harden_frozen_tracked_file "$FROZEN_WORKER_FILE" "$WORKER_RELATIVE" || exit 1
FROZEN_WORKER_SNAPSHOT="$(trusted_helper_snapshot \
  "$FROZEN_WORKER_FILE" "$WORKER_RELATIVE" \
  "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR")" || exit 1
readonly FROZEN_SMOKE_HELPER_SNAPSHOT FROZEN_PACKAGE_SNAPSHOT \
  FROZEN_WORKER_SNAPSHOT

RECOVERY_FAILURE_STAGE="frozen_env_build_binding"

ROLLBACK_SNAPSHOT=""
capture_trusted_environment_helper_output ROLLBACK_SNAPSHOT 5 \
  rollback-snapshot "$FROZEN_RUNTIME_DIR/.env.local" "$EXPECTED_OLD_BUILD_ID" \
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
FROZEN_BUILD_BINDING_SNAPSHOT="$(environment_build_binding_snapshot \
  "$FROZEN_RUNTIME_DIR" "$EXPECTED_OLD_BUILD_ID")" || exit 1
mapfile -t FROZEN_BUILD_BINDING_PARTS <<< "$FROZEN_BUILD_BINDING_SNAPSHOT"
[ "${#FROZEN_BUILD_BINDING_PARTS[@]}" -eq 3 ] \
  && [ "${FROZEN_BUILD_BINDING_PARTS[0]}" = "$ENVIRONMENT_DIRECTORY_IDENTITY" ] \
  && [ "${FROZEN_BUILD_BINDING_PARTS[1]}" = "$ENVIRONMENT_FILE_IDENTITY" ] \
  && [ "${FROZEN_BUILD_BINDING_PARTS[2]}" = "$ENVIRONMENT_SHA256" ] \
  || exit 1
unset FROZEN_BUILD_BINDING_SNAPSHOT FROZEN_BUILD_BINDING_PARTS

RECOVERY_FAILURE_STAGE="frozen_next_build_identity"
FROZEN_NEXT_BUILD_SNAPSHOT="$(next_build_identity "$FROZEN_RUNTIME_DIR")" || exit 1
readonly FROZEN_NEXT_BUILD_SNAPSHOT

RECOVERY_FAILURE_STAGE="frozen_environment"

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

FROZEN_SUPABASE_INTERNAL_URL="$(decode_strict_base64 "$SNAPSHOT_INTERNAL_URL_B64")" || exit 1
FROZEN_NEXT_PUBLIC_SUPABASE_URL="$(decode_strict_base64 "$SNAPSHOT_PUBLIC_URL_B64")" || exit 1
FROZEN_NEXT_PUBLIC_SUPABASE_ANON_KEY="$(decode_strict_base64 "$SNAPSHOT_ANON_KEY_B64")" || exit 1

WORKER_CONFIGURATION="$(
  timeout --signal=TERM --kill-after=1s 3s node --input-type=module - \
    "$FROZEN_RUNTIME_DIR/.env.local" \
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

revalidate_incident_release_pair() {
  local candidate_snapshot
  local current_snapshot
  local -a candidate_parts=()
  local -a current_parts=()
  [ "$(find_unique_release "${EXPECTED_CANDIDATE_BUILD_ID:0:12}")" = \
    "$CANDIDATE_RUNTIME_DIR" ] \
    && [ "$(find_unique_release "${EXPECTED_OLD_BUILD_ID:0:12}")" = \
      "$FROZEN_RUNTIME_DIR" ] \
    && [ -L "$APP_DIR/.next" ] \
    && [ "$(readlink -- "$APP_DIR/.next" 2>/dev/null || true)" = "$CURRENT_LINK/.next" ] \
    && [ -L "$APP_DIR/node_modules" ] \
    && [ "$(readlink -- "$APP_DIR/node_modules" 2>/dev/null || true)" = "$CURRENT_LINK/node_modules" ] \
    && [ ! -e "$APP_DIR/.next.pre-atomic-deploy" ] \
    && [ ! -L "$APP_DIR/.next.pre-atomic-deploy" ] \
    && [ ! -e "$APP_DIR/node_modules.pre-atomic-deploy" ] \
    && [ ! -L "$APP_DIR/node_modules.pre-atomic-deploy" ] \
    || return 1
  [ "$(release_structure_identity "$CANDIDATE_RUNTIME_DIR" "$EXPECTED_CANDIDATE_BUILD_ID")" = \
    "$CANDIDATE_RUNTIME_IDENTITY" ] || return 1
  [ "$(release_structure_identity "$FROZEN_RUNTIME_DIR" "$EXPECTED_OLD_BUILD_ID")" = \
    "$FROZEN_RUNTIME_IDENTITY" ] || return 1
  [ "$(trusted_directory_identity "$FROZEN_RUNTIME_DIR/scripts")" = \
    "$FROZEN_SCRIPTS_IDENTITY" ] || return 1
  candidate_snapshot=""
  candidate_snapshot="$(candidate_environment_build_binding_snapshot \
    "$CANDIDATE_RUNTIME_DIR" "$EXPECTED_CANDIDATE_BUILD_ID")" || return 1
  mapfile -t candidate_parts <<< "$candidate_snapshot"
  [ "${#candidate_parts[@]}" -eq 3 ] \
    && [ "${candidate_parts[0]}" = "$CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY" ] \
    && [ "${candidate_parts[1]}" = "$CANDIDATE_ENVIRONMENT_FILE_IDENTITY" ] \
    && [ "${candidate_parts[2]}" = "$CANDIDATE_ENVIRONMENT_SHA256" ] \
    || return 1
  trusted_helper_matches \
    "$FROZEN_SMOKE_HELPER" "$SMOKE_HELPER_RELATIVE" \
    "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR" \
    "$FROZEN_SMOKE_HELPER_SNAPSHOT" || return 1
  trusted_helper_matches \
    "$FROZEN_PACKAGE_FILE" "$PACKAGE_RELATIVE" \
    "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR" \
    "$FROZEN_PACKAGE_SNAPSHOT" || return 1
  trusted_helper_matches \
    "$FROZEN_WORKER_FILE" "$WORKER_RELATIVE" \
    "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR" \
    "$FROZEN_WORKER_SNAPSHOT" || return 1
  current_snapshot=""
  capture_trusted_environment_helper_output current_snapshot 5 snapshot \
    "$FROZEN_RUNTIME_DIR/.env.local" "$EXPECTED_OLD_BUILD_ID" \
    || return 1
  mapfile -t current_parts <<< "$current_snapshot"
  [ "${#current_parts[@]}" -eq 3 ] \
    && [ "${current_parts[0]}" = "$ENVIRONMENT_DIRECTORY_IDENTITY" ] \
    && [ "${current_parts[1]}" = "$ENVIRONMENT_FILE_IDENTITY" ] \
    && [ "${current_parts[2]}" = "$ENVIRONMENT_SHA256" ] \
    || return 1
  [ "$(next_build_identity "$CANDIDATE_RUNTIME_DIR")" = \
    "$CANDIDATE_NEXT_BUILD_SNAPSHOT" ] || return 1
  [ "$(next_build_identity "$FROZEN_RUNTIME_DIR")" = \
    "$FROZEN_NEXT_BUILD_SNAPSHOT" ]
}

revalidate_incident_runtimes() {
  local expected_current="$CANDIDATE_RUNTIME_DIR"
  local expected_identity="$CURRENT_LINK_IDENTITY"
  if [ "$CURRENT_SWITCH_COMPLETED" -eq 1 ]; then
    expected_current="$FROZEN_RUNTIME_DIR"
    expected_identity="$FROZEN_CURRENT_LINK_IDENTITY"
  fi
  revalidate_current_link_parent \
    && [ -n "$expected_identity" ] \
    && [ -L "$CURRENT_LINK" ] \
    && [ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" = "$expected_current" ] \
    && [ "$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)" = "$expected_current" ] \
    && [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$expected_identity" ] \
    || return 1
  revalidate_incident_release_pair \
    && revalidate_initial_current_temporary_links
}

current_link_is_exact() {
  local expected_target="$1"
  [ "$expected_target" = "$CANDIDATE_RUNTIME_DIR" ] \
    || [ "$expected_target" = "$FROZEN_RUNTIME_DIR" ] || return 1
  revalidate_current_link_parent \
    && [ -L "$CURRENT_LINK" ] \
    && [ "$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)" = "$expected_target" ] \
    && [ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" = "$expected_target" ] \
    || return 1
  trusted_symlink_identity "$CURRENT_LINK" >/dev/null
}

capture_relocated_symlink_identity() {
  local source_path="$1"
  local destination_path="$2"
  local expected_target="$3"
  local expected_object_identity="$4"
  local first_full_identity
  local first_object_identity
  local second_full_identity
  local second_object_identity
  [ "$source_path" = "$EXPECTED_SWITCH_TEMP_LINK" ] \
    || [ "$source_path" = "$EXPECTED_COMPENSATION_TEMP_LINK" ] || return 1
  [ "$destination_path" = "$CURRENT_LINK" ] || return 1
  [ "$expected_target" = "$CANDIDATE_RUNTIME_DIR" ] \
    || [ "$expected_target" = "$FROZEN_RUNTIME_DIR" ] || return 1
  [ -n "$expected_object_identity" ] || return 1
  revalidate_current_link_parent \
    && [ ! -e "$source_path" ] && [ ! -L "$source_path" ] \
    && [ -L "$destination_path" ] \
    && [ "$(readlink -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] \
    && [ "$(readlink -f -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] || return 1
  first_full_identity="$(trusted_symlink_identity "$destination_path")" \
    || return 1
  first_object_identity="$(symlink_object_identity_from_full \
    "$first_full_identity")" || return 1
  [ "$first_object_identity" = "$expected_object_identity" ] || return 1
  revalidate_current_link_parent \
    && [ ! -e "$source_path" ] && [ ! -L "$source_path" ] \
    && [ "$(readlink -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] \
    && [ "$(readlink -f -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] || return 1
  second_full_identity="$(trusted_symlink_identity "$destination_path")" \
    || return 1
  second_object_identity="$(symlink_object_identity_from_full \
    "$second_full_identity")" || return 1
  [ "$second_full_identity" = "$first_full_identity" ] \
    && [ "$second_object_identity" = "$expected_object_identity" ] \
    && revalidate_current_link_parent \
    && [ ! -e "$source_path" ] && [ ! -L "$source_path" ] \
    && [ "$(readlink -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] \
    && [ "$(readlink -f -- "$destination_path" 2>/dev/null || true)" = \
      "$expected_target" ] || return 1
  printf '%s' "$second_full_identity"
}

cleanup_compensation_pending() {
  revalidate_current_link_parent \
    && [ -n "$COMPENSATION_TEMP_LINK" ] \
    && [ -n "$COMPENSATION_TEMP_LINK_IDENTITY" ] \
    && [ -n "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ] \
    && [ "$(trusted_symlink_identity "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
      "$COMPENSATION_TEMP_LINK_IDENTITY" ] \
    && [ "$(trusted_symlink_object_identity \
      "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
      "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ] \
    && [ "$(readlink -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
      "$CANDIDATE_RUNTIME_DIR" ] \
    && [ "$(readlink -f -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
      "$CANDIDATE_RUNTIME_DIR" ] || return 1
  unlink -- "$COMPENSATION_TEMP_LINK" >/dev/null 2>&1 || return 1
  revalidate_current_link_parent \
    && [ ! -e "$COMPENSATION_TEMP_LINK" ] \
    && [ ! -L "$COMPENSATION_TEMP_LINK" ] \
    || return 1
  COMPENSATION_TEMP_LINK=""
  COMPENSATION_TEMP_LINK_IDENTITY=""
  COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=""
}

restore_candidate_before_web_commit() {
  local observed_current="unknown"
  local observed_identity=""
  local relocated_identity=""
  local compensation_link_status=0
  [ "$FROZEN_WEB_COMMITTED" -eq 0 ] || return 1
  revalidate_current_link_parent || return 1
  revalidate_deploy_lock || return 1
  port_is_free || return 1
  revalidate_incident_release_pair || return 1
  if current_link_is_exact "$CANDIDATE_RUNTIME_DIR"; then
    [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$CURRENT_LINK_IDENTITY" ] || return 1
    observed_current="candidate"
  elif current_link_is_exact "$FROZEN_RUNTIME_DIR"; then
    observed_identity="$(trusted_symlink_identity "$CURRENT_LINK")" || return 1
    if [ -n "$FROZEN_CURRENT_LINK_IDENTITY" ]; then
      [ "$observed_identity" = "$FROZEN_CURRENT_LINK_IDENTITY" ] || return 1
    else
      [ -n "$SWITCH_TEMP_LINK_OBJECT_IDENTITY" ] || return 1
      relocated_identity="$(capture_relocated_symlink_identity \
        "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK" \
        "$FROZEN_RUNTIME_DIR" "$SWITCH_TEMP_LINK_OBJECT_IDENTITY")" \
        || return 1
      FROZEN_CURRENT_LINK_IDENTITY="$relocated_identity"
      CURRENT_SWITCH_COMPLETED=1
      SWITCH_TEMP_LINK=""
      SWITCH_TEMP_LINK_IDENTITY=""
      SWITCH_TEMP_LINK_OBJECT_IDENTITY=""
    fi
    observed_current="frozen"
  else
    return 1
  fi
  case "$observed_current" in
    candidate)
      CURRENT_SWITCH_COMPLETED=0
      CURRENT_SWITCH_ARMED=0
      ;;
    frozen)
      COMPENSATION_TEMP_LINK="$EXPECTED_COMPENSATION_TEMP_LINK"
      revalidate_current_link_parent \
        && [ ! -e "$COMPENSATION_TEMP_LINK" ] \
        && [ ! -L "$COMPENSATION_TEMP_LINK" ] \
        || return 1
      ln -s -- "$CANDIDATE_RUNTIME_DIR" "$COMPENSATION_TEMP_LINK" \
        >/dev/null 2>&1 || compensation_link_status=$?
      if ! capture_trusted_temp_symlink_snapshot \
        "$COMPENSATION_TEMP_LINK" "$CANDIDATE_RUNTIME_DIR" \
        COMPENSATION_TEMP_LINK_IDENTITY \
        COMPENSATION_TEMP_LINK_OBJECT_IDENTITY; then
        if capture_trusted_temp_symlink_snapshot \
          "$COMPENSATION_TEMP_LINK" "$CANDIDATE_RUNTIME_DIR" \
          COMPENSATION_TEMP_LINK_IDENTITY \
          COMPENSATION_TEMP_LINK_OBJECT_IDENTITY; then
          cleanup_compensation_pending || true
        fi
        return 1
      fi
      if [ "$compensation_link_status" -ne 0 ]; then
        cleanup_compensation_pending || true
        return 1
      fi
      if ! revalidate_current_link_parent \
        || [ "$(readlink -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" != \
          "$CANDIDATE_RUNTIME_DIR" ] \
        || [ "$(readlink -f -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" != \
          "$CANDIDATE_RUNTIME_DIR" ]; then
        cleanup_compensation_pending || true
        return 1
      fi
      current_link_is_exact "$FROZEN_RUNTIME_DIR" \
        && [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
          "$FROZEN_CURRENT_LINK_IDENTITY" ] \
        && revalidate_incident_release_pair \
        && revalidate_deploy_lock \
        && port_is_free \
        && [ "$(trusted_symlink_identity "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
          "$COMPENSATION_TEMP_LINK_IDENTITY" ] \
        && [ "$(trusted_symlink_object_identity \
          "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
          "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY" ] \
        && [ "$(readlink -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
          "$CANDIDATE_RUNTIME_DIR" ] \
        && [ "$(readlink -f -- "$COMPENSATION_TEMP_LINK" 2>/dev/null || true)" = \
          "$CANDIDATE_RUNTIME_DIR" ] \
        || { cleanup_compensation_pending || true; return 1; }
      if mv -T -- "$COMPENSATION_TEMP_LINK" "$CURRENT_LINK" \
        >/dev/null 2>&1; then
        :
      fi
      relocated_identity="$(capture_relocated_symlink_identity \
        "$EXPECTED_COMPENSATION_TEMP_LINK" "$CURRENT_LINK" \
        "$CANDIDATE_RUNTIME_DIR" "$COMPENSATION_TEMP_LINK_OBJECT_IDENTITY")" \
        || {
          if [ -e "$COMPENSATION_TEMP_LINK" ] \
            || [ -L "$COMPENSATION_TEMP_LINK" ]; then
            cleanup_compensation_pending || true
          fi
          return 1
        }
      CURRENT_LINK_IDENTITY="$relocated_identity"
      CURRENT_SWITCH_COMPLETED=0
      CURRENT_SWITCH_ARMED=0
      COMPENSATION_TEMP_LINK=""
      COMPENSATION_TEMP_LINK_IDENTITY=""
      COMPENSATION_TEMP_LINK_OBJECT_IDENTITY=""
      ;;
    *) return 1 ;;
  esac
  current_link_is_exact "$CANDIDATE_RUNTIME_DIR" \
    && [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$CURRENT_LINK_IDENTITY" ] \
    && revalidate_current_link_parent \
    && revalidate_incident_release_pair \
    && revalidate_deploy_lock \
    && port_is_free
}

RECOVERY_FAILURE_STAGE="initial_current_target"
revalidate_initial_current_target || exit 1
RECOVERY_FAILURE_STAGE="initial_current_identity"
revalidate_initial_current_identity || exit 1
RECOVERY_FAILURE_STAGE="initial_current_compatibility"
revalidate_initial_current_compatibility || exit 1
RECOVERY_FAILURE_STAGE="initial_current_temporary_links"
revalidate_initial_current_temporary_links || exit 1
revalidate_incident_release_pair || exit 1
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
RECOVERY_FAILURE_STAGE="initial_current_target"
revalidate_initial_current_target || exit 1
RECOVERY_FAILURE_STAGE="initial_current_identity"
revalidate_initial_current_identity || exit 1
RECOVERY_FAILURE_STAGE="initial_current_compatibility"
revalidate_initial_current_compatibility || exit 1
RECOVERY_FAILURE_STAGE="initial_current_temporary_links"
revalidate_initial_current_temporary_links || exit 1
revalidate_incident_release_pair || exit 1
revalidate_deploy_lock || exit 1
RECOVERY_FAILURE_STAGE="database_preflight"
verify_database_fence_clear || exit 1
case "$INITIAL_CURRENT_STATE" in
  candidate)
    CURRENT_LINK_IDENTITY="$INITIAL_CURRENT_LINK_IDENTITY"
    CURRENT_SWITCH_COMPLETED=0
    CURRENT_SWITCH_ARMED=0
    ;;
  frozen)
    FROZEN_CURRENT_LINK_IDENTITY="$INITIAL_CURRENT_LINK_IDENTITY"
    CURRENT_SWITCH_COMPLETED=1
    CURRENT_SWITCH_ARMED=0
    ;;
  *) exit 1 ;;
esac
revalidate_incident_runtimes || exit 1

RECOVERY_FAILURE_STAGE="fence_cleanup"

# The failed helper normally removes marker/release request but can leave its
# canonical failure log and private directory.  Permit exactly that one shape,
# time-bind it to the failed run, and use only unlink(1)+rmdir(1).
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
[ "$INITIAL_CURRENT_STATE" = "candidate" ] \
  || [ "${#fence_entries[@]}" -eq 0 ] || exit 1
if [ "${#fence_entries[@]}" -eq 1 ]; then
  [ "$INITIAL_CURRENT_STATE" = "candidate" ] || exit 1
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
    "$INCIDENT_FENCE_HELPER" "$FENCE_HELPER_RELATIVE" \
    "$EXPECTED_INCIDENT_SHA" "$APP_DIR" \
    "$INCIDENT_FENCE_HELPER_FROZEN_SNAPSHOT" \
    || exit 1
  fence_parser_status=0
  timeout --signal=TERM --kill-after=1s 3s node --input-type=module - \
    "$stale_log" "$INCIDENT_FENCE_HELPER" >/dev/null 2>&1 <<'NODE' \
    || fence_parser_status=$?
import { pathToFileURL } from "node:url";
const [logPath, modulePath] = process.argv.slice(2);
const helper = await import(pathToFileURL(modulePath).href);
const record = await helper.readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath);
if (!record || record.ok !== false || typeof record.error !== "string") process.exit(1);
NODE
  trusted_helper_matches \
    "$INCIDENT_FENCE_HELPER" "$FENCE_HELPER_RELATIVE" \
    "$EXPECTED_INCIDENT_SHA" "$APP_DIR" \
    "$INCIDENT_FENCE_HELPER_FROZEN_SNAPSHOT" \
    || exit 1
  [ "$fence_parser_status" -eq 0 ] || exit 1
  [ "$(stat -c '%d:%i:%s:%Y:%Z:%h:%u:%a' -- "$stale_log" 2>/dev/null || true)" = "$stale_log_identity" ] || exit 1
  [ "$(stat -c '%d:%i:%Y:%Z:%u:%a' -- "$stale_dir" 2>/dev/null || true)" = "$stale_dir_identity" ] || exit 1
  revalidate_incident_runtimes || exit 1
  revalidate_deploy_lock || exit 1
  verify_database_fence_clear || exit 1
  revalidate_incident_runtimes || exit 1
  revalidate_deploy_lock || exit 1
  trusted_helper_matches \
    "$INCIDENT_FENCE_HELPER" "$FENCE_HELPER_RELATIVE" \
    "$EXPECTED_INCIDENT_SHA" "$APP_DIR" \
    "$INCIDENT_FENCE_HELPER_FROZEN_SNAPSHOT" \
    || exit 1
  [ "$(stat -c '%d:%i:%s:%Y:%Z:%h:%u:%a' -- "$stale_log" 2>/dev/null || true)" = "$stale_log_identity" ] || exit 1
  [ "$(stat -c '%d:%i:%Y:%Z:%u:%a' -- "$stale_dir" 2>/dev/null || true)" = "$stale_dir_identity" ] || exit 1
  FENCE_CLEANUP_STARTED=1
  FENCE_CLEANUP_VERIFIED=0
  RECOVERY_FAILURE_STAGE="fence_unlink"
  unlink -- "$stale_log" >/dev/null 2>&1 || exit 1
  RECOVERY_FAILURE_STAGE="fence_rmdir"
  rmdir -- "$stale_dir" >/dev/null 2>&1 || exit 1
fi
RECOVERY_FAILURE_STAGE="fence_post_inventory"
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
RECOVERY_FAILURE_STAGE="fence_post_database"
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
      const related = list.filter((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        (entry.name === name || entry.pm2_env?.name === name)
      );
      if (related.length === 0) process.stdout.write("absent");
      else if (related.length !== 1) process.exit(1);
      else if (
        related[0].name !== name ||
        related[0].pm2_env === null || typeof related[0].pm2_env !== "object" ||
        Array.isArray(related[0].pm2_env) || related[0].pm2_env.name !== name
      ) process.exit(1);
      else if (related[0].pm2_env.status === "online" && Number.isSafeInteger(related[0].pid) && related[0].pid > 0) {
        process.stdout.write(`running:${related[0].pid}`);
      } else if (related[0].pm2_env.status === "stopped" && related[0].pid === 0) {
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
  [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$FROZEN_RUNTIME_DIR" ] \
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
    && [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$FROZEN_RUNTIME_DIR" ]
}

NPM_COMMAND_PATH="$(command -v npm 2>/dev/null || true)"
NPM_REAL_PATH="$(readlink -f -- "$NPM_COMMAND_PATH" 2>/dev/null || true)"
[[ "$NPM_COMMAND_PATH" == /* ]] && [[ "$NPM_REAL_PATH" == /* ]] \
  && [ -f "$NPM_REAL_PATH" ] || exit 1
NODE_EXEC_PATH="$(node -p 'process.execPath' 2>/dev/null || true)"
NODE_EXEC_PATH="$(readlink -f -- "$NODE_EXEC_PATH" 2>/dev/null || true)"
[[ "$NODE_EXEC_PATH" == /* ]] && [ -f "$NODE_EXEC_PATH" ] || exit 1
readonly NPM_COMMAND_PATH NPM_REAL_PATH NODE_EXEC_PATH

started_pm2_state() {
  local kind="$1"
  local name
  local process_list
  case "$kind" in
    web) name="$APP_NAME" ;;
    worker) name="$AUTOMATION_WORKER_NAME" ;;
    *) return 1 ;;
  esac
  process_list="$(PM2_SILENT=true timeout --signal=TERM --kill-after=2s 5s \
    pm2 jlist 2>/dev/null)" || return 1
  FAOLLA_PM2_KIND="$kind" \
    FAOLLA_EXPECTED_NAME="$name" \
    FAOLLA_EXPECTED_CWD="$FROZEN_RUNTIME_DIR" \
    FAOLLA_EXPECTED_PORT="$APP_PORT" \
    FAOLLA_EXPECTED_NPM="$NPM_REAL_PATH" \
    FAOLLA_EXPECTED_TSX="$FROZEN_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs" \
    FAOLLA_EXPECTED_WORKER="$FROZEN_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts" \
    timeout --signal=TERM --kill-after=1s 3s node -e '
      const fs = require("node:fs");
      let list;
      try { list = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
      const kind = process.env.FAOLLA_PM2_KIND;
      const name = process.env.FAOLLA_EXPECTED_NAME;
      const cwd = process.env.FAOLLA_EXPECTED_CWD;
      if (!Array.isArray(list) || !["web", "worker"].includes(kind) || !name || !cwd) process.exit(1);
      const related = list.filter((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        (entry.name === name || entry.pm2_env?.name === name)
      );
      if (related.length === 0) { process.stdout.write("absent"); process.exit(0); }
      if (related.length !== 1) process.exit(1);
      const entry = related[0];
      if (
        entry.name !== name || entry.pm2_env === null || typeof entry.pm2_env !== "object" ||
        Array.isArray(entry.pm2_env) || entry.pm2_env.name !== name
      ) process.exit(1);
      const env = entry.pm2_env;
      const args = kind === "web"
        ? ["start", "--", "-p", process.env.FAOLLA_EXPECTED_PORT]
        : [process.env.FAOLLA_EXPECTED_WORKER];
      const execPath = kind === "web"
        ? process.env.FAOLLA_EXPECTED_NPM
        : process.env.FAOLLA_EXPECTED_TSX;
      if (
        !Number.isSafeInteger(entry.pm_id) || entry.pm_id < 0 || env.pm_id !== entry.pm_id ||
        env.pm_cwd !== cwd || env.pm_exec_path !== execPath ||
        env.exec_interpreter !== "node" || env.exec_mode !== "fork_mode" ||
        !Array.isArray(env.args) || env.args.length !== args.length ||
        env.args.some((value, index) => value !== args[index]) ||
        !Array.isArray(env.node_args) || env.node_args.length !== 0
      ) process.exit(1);
      if (env.status === "online" && Number.isSafeInteger(entry.pid) && entry.pid > 0) {
        process.stdout.write(`running:${entry.pid}`);
      } else if (env.status === "stopped" && entry.pid === 0) {
        process.stdout.write("inactive");
      } else process.exit(1);
    ' 2>/dev/null <<< "$process_list"
}

candidate_pm2_state() {
  local kind="$1"
  local name
  local process_list
  case "$kind" in
    web) name="$APP_NAME" ;;
    worker) name="$AUTOMATION_WORKER_NAME" ;;
    *) return 1 ;;
  esac
  process_list="$(PM2_SILENT=true timeout --signal=TERM --kill-after=2s 5s \
    pm2 jlist 2>/dev/null)" || return 1
  FAOLLA_PM2_KIND="$kind" \
    FAOLLA_EXPECTED_NAME="$name" \
    FAOLLA_EXPECTED_CWD="$CANDIDATE_RUNTIME_DIR" \
    FAOLLA_EXPECTED_PORT="$APP_PORT" \
    FAOLLA_EXPECTED_NPM_COMMAND="$NPM_COMMAND_PATH" \
    FAOLLA_EXPECTED_NPM_REAL="$NPM_REAL_PATH" \
    FAOLLA_EXPECTED_NODE_EXEC="$NODE_EXEC_PATH" \
    FAOLLA_EXPECTED_TSX="$CANDIDATE_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs" \
    FAOLLA_EXPECTED_WORKER="$CANDIDATE_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts" \
    timeout --signal=TERM --kill-after=1s 3s node -e '
      const fs = require("node:fs");
      let list;
      try { list = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
      const kind = process.env.FAOLLA_PM2_KIND;
      const name = process.env.FAOLLA_EXPECTED_NAME;
      const cwd = process.env.FAOLLA_EXPECTED_CWD;
      if (!Array.isArray(list) || !["web", "worker"].includes(kind) || !name || !cwd) process.exit(1);
      const related = list.filter((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        (entry.name === name || entry.pm2_env?.name === name)
      );
      if (related.length === 0) { process.stdout.write("absent"); process.exit(0); }
      if (related.length !== 1) process.exit(1);
      const entry = related[0];
      if (
        entry.name !== name || entry.pm2_env === null || typeof entry.pm2_env !== "object" ||
        Array.isArray(entry.pm2_env) || entry.pm2_env.name !== name
      ) process.exit(1);
      const env = entry.pm2_env;
      const expectedArgs = kind === "web"
        ? ["start", "--", "-p", process.env.FAOLLA_EXPECTED_PORT]
        : [process.env.FAOLLA_EXPECTED_WORKER];
      const allowedExecPaths = kind === "web"
        ? new Set([process.env.FAOLLA_EXPECTED_NPM_COMMAND, process.env.FAOLLA_EXPECTED_NPM_REAL])
        : new Set([process.env.FAOLLA_EXPECTED_TSX]);
      const allowedInterpreters = kind === "web"
        ? new Set(["node", process.env.FAOLLA_EXPECTED_NODE_EXEC])
        : new Set(["node"]);
      if (
        !Number.isSafeInteger(entry.pm_id) || entry.pm_id < 0 || env.pm_id !== entry.pm_id ||
        entry.pid !== 0 || env.status !== "stopped" || env.pm_cwd !== cwd ||
        !allowedInterpreters.has(env.exec_interpreter) || env.exec_mode !== "fork_mode" ||
        !allowedExecPaths.has(env.pm_exec_path) || !Array.isArray(env.args) ||
        env.args.length !== expectedArgs.length ||
        env.args.some((value, index) => value !== expectedArgs[index]) ||
        !Array.isArray(env.node_args) || env.node_args.length !== 0
      ) process.exit(1);
      process.stdout.write("inactive");
    ' 2>/dev/null <<< "$process_list"
}

remove_exact_inactive_candidate_process() {
  local kind="$1"
  local name
  local state
  case "$kind" in
    web) name="$APP_NAME" ;;
    worker) name="$AUTOMATION_WORKER_NAME" ;;
    *) return 1 ;;
  esac
  state="$(candidate_pm2_state "$kind")" || return 1
  case "$state" in
    absent) return 0 ;;
    inactive)
      [ "$(candidate_pm2_state "$kind")" = "inactive" ] || return 1
      PM2_STATE_MUTATED=1
      timeout --signal=TERM --kill-after=5s 25s pm2 delete "$name" \
        >/dev/null 2>&1 || return 1
      [ "$(candidate_pm2_state "$kind")" = "absent" ]
      ;;
    *) return 1 ;;
  esac
}

verify_precommit_safe_state() {
  local web_state
  local worker_state
  [ "$FROZEN_WEB_COMMITTED" -eq 0 ] || return 1
  case "$INITIAL_CURRENT_STATE" in
    candidate)
      [ "$CANDIDATE_PREFLIGHT_VERIFIED" -eq 1 ] \
        && [ "$FROZEN_RESUME_PREFLIGHT_VERIFIED" -eq 0 ] \
        && current_link_is_exact "$CANDIDATE_RUNTIME_DIR" \
        && [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
          "$CURRENT_LINK_IDENTITY" ] \
        && revalidate_incident_release_pair \
        && revalidate_deploy_lock \
        && verify_database_fence_clear \
        && port_is_free || return 1
      web_state="$(candidate_pm2_state web)" || return 1
      worker_state="$(candidate_pm2_state worker)" || return 1
      case "$CANDIDATE_WEB_PM2_SNAPSHOT:$web_state" in
        absent:absent|inactive:inactive|inactive:absent) ;;
        *) return 1 ;;
      esac
      case "$CANDIDATE_WORKER_PM2_SNAPSHOT:$worker_state" in
        absent:absent|inactive:inactive|inactive:absent) ;;
        *) return 1 ;;
      esac
      ;;
    frozen)
      [ "$CANDIDATE_PREFLIGHT_VERIFIED" -eq 0 ] \
        && [ "$FROZEN_RESUME_PREFLIGHT_VERIFIED" -eq 1 ] \
        && [ "$CURRENT_SWITCH_COMPLETED" -eq 1 ] \
        && [ "$CURRENT_SWITCH_ARMED" -eq 0 ] \
        && revalidate_incident_runtimes \
        && verify_frozen_resume_permissions \
        && revalidate_deploy_lock \
        && verify_database_fence_clear \
        && port_is_free || return 1
      web_state="$(pm2_process_snapshot "$APP_NAME")" || return 1
      worker_state="$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" || return 1
      [ "$CANDIDATE_WEB_PM2_SNAPSHOT:$web_state" = "absent:absent" ] \
        && [ "$CANDIDATE_WORKER_PM2_SNAPSHOT:$worker_state" = "absent:absent" ] \
        || return 1
      ;;
    *) return 1 ;;
  esac
  port_is_free && revalidate_incident_runtimes \
    && revalidate_deploy_lock && verify_database_fence_clear
}

RECOVERY_FAILURE_STAGE="candidate_process_preflight"
revalidate_incident_runtimes || exit 1
revalidate_deploy_lock || exit 1
verify_database_fence_clear || exit 1
case "$INITIAL_CURRENT_STATE" in
  candidate)
    CANDIDATE_WEB_PM2_SNAPSHOT="$(candidate_pm2_state web)" || exit 1
    CANDIDATE_WORKER_PM2_SNAPSHOT="$(candidate_pm2_state worker)" || exit 1
    case "$CANDIDATE_WEB_PM2_SNAPSHOT:$CANDIDATE_WORKER_PM2_SNAPSHOT" in
      absent:absent|absent:inactive|inactive:absent|inactive:inactive) ;;
      *) exit 1 ;;
    esac
    ;;
  frozen)
    [ "$CURRENT_SWITCH_COMPLETED" -eq 1 ] \
      && [ "$CURRENT_SWITCH_ARMED" -eq 0 ] \
      && verify_frozen_resume_permissions || exit 1
    CANDIDATE_WEB_PM2_SNAPSHOT="$(pm2_process_snapshot "$APP_NAME")" || exit 1
    CANDIDATE_WORKER_PM2_SNAPSHOT="$(pm2_process_snapshot \
      "$AUTOMATION_WORKER_NAME")" || exit 1
    [ "$CANDIDATE_WEB_PM2_SNAPSHOT:$CANDIDATE_WORKER_PM2_SNAPSHOT" = \
      "absent:absent" ] || exit 1
    ;;
  *) exit 1 ;;
esac
port_state="$(timeout --signal=TERM --kill-after=1s 3s ss -H -ltn \
  "( sport = :$APP_PORT )" 2>/dev/null)" || exit 1
[ -z "$port_state" ] || exit 1
if [ "$INITIAL_CURRENT_STATE" = "candidate" ]; then
  CANDIDATE_PREFLIGHT_VERIFIED=1
else
  FROZEN_RESUME_PREFLIGHT_VERIFIED=1
fi
revalidate_incident_runtimes || exit 1
revalidate_deploy_lock || exit 1
verify_database_fence_clear || exit 1
printf '%s\n' 'candidate_state_verified'

RECOVERY_FAILURE_STAGE="candidate_stop"
if [ "$INITIAL_CURRENT_STATE" = "candidate" ]; then
  remove_exact_inactive_candidate_process worker || exit 1
  CANDIDATE_WORKER_STOPPED=1
  remove_exact_inactive_candidate_process web || exit 1
  CANDIDATE_WEB_STOPPED=1
  [ "$(candidate_pm2_state web)" = "absent" ] || exit 1
  [ "$(candidate_pm2_state worker)" = "absent" ] || exit 1
else
  [ "$INITIAL_CURRENT_STATE" = "frozen" ] \
    && [ "$(pm2_process_snapshot "$APP_NAME")" = "absent" ] \
    && [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] \
    || exit 1
fi
port_is_free || exit 1
revalidate_incident_runtimes || exit 1
revalidate_deploy_lock || exit 1
verify_database_fence_clear || exit 1
printf '%s\n' 'candidate_processes_stopped'

case "$INITIAL_CURRENT_STATE" in
  candidate)
    RECOVERY_FAILURE_STAGE="current_switch"
    revalidate_current_link_parent || exit 1
    revalidate_incident_runtimes || exit 1
    revalidate_deploy_lock || exit 1
    verify_database_fence_clear || exit 1
    [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$CURRENT_LINK_IDENTITY" ] || exit 1
    [ "$(readlink -- "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$CANDIDATE_RUNTIME_DIR" ] || exit 1
    revalidate_incident_release_pair || exit 1
    SWITCH_TEMP_LINK="$EXPECTED_SWITCH_TEMP_LINK"
    revalidate_current_link_parent \
      && [ ! -e "$SWITCH_TEMP_LINK" ] && [ ! -L "$SWITCH_TEMP_LINK" ] \
      || exit 1
    trap defer_recovery_signal HUP INT TERM
    switch_link_status=0
    ln -s -- "$FROZEN_RUNTIME_DIR" "$SWITCH_TEMP_LINK" \
      >/dev/null 2>&1 || switch_link_status=$?
    if ! capture_trusted_temp_symlink_snapshot \
      "$SWITCH_TEMP_LINK" "$FROZEN_RUNTIME_DIR" \
      SWITCH_TEMP_LINK_IDENTITY SWITCH_TEMP_LINK_OBJECT_IDENTITY; then
      capture_trusted_temp_symlink_snapshot \
        "$SWITCH_TEMP_LINK" "$FROZEN_RUNTIME_DIR" \
        SWITCH_TEMP_LINK_IDENTITY SWITCH_TEMP_LINK_OBJECT_IDENTITY || true
      exit 1
    fi
    [ "$switch_link_status" -eq 0 ] || exit 1
    CURRENT_SWITCH_ARMED=1
    trap handle_recovery_signal HUP INT TERM
    [ "$RECOVERY_SIGNAL_PENDING" -eq 0 ] || exit 1
    revalidate_incident_release_pair || exit 1
    revalidate_deploy_lock || exit 1
    [ "$(candidate_pm2_state web)" = "absent" ] || exit 1
    [ "$(candidate_pm2_state worker)" = "absent" ] || exit 1
    port_is_free || exit 1
    verify_database_fence_clear || exit 1
    current_link_is_exact "$CANDIDATE_RUNTIME_DIR" || exit 1
    [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$CURRENT_LINK_IDENTITY" ] || exit 1
    [ "$(readlink -- "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "$FROZEN_RUNTIME_DIR" ] || exit 1
    [ "$(readlink -f -- "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "$FROZEN_RUNTIME_DIR" ] || exit 1
    [ "$(trusted_symlink_identity "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
      "$SWITCH_TEMP_LINK_IDENTITY" ] \
      && [ "$(trusted_symlink_object_identity \
        "$SWITCH_TEMP_LINK" 2>/dev/null || true)" = \
        "$SWITCH_TEMP_LINK_OBJECT_IDENTITY" ] \
      && revalidate_current_link_parent || exit 1
    if mv -T -- "$SWITCH_TEMP_LINK" "$CURRENT_LINK" >/dev/null 2>&1; then
      :
    fi
    relocated_switch_identity="$(capture_relocated_symlink_identity \
      "$EXPECTED_SWITCH_TEMP_LINK" "$CURRENT_LINK" \
      "$FROZEN_RUNTIME_DIR" "$SWITCH_TEMP_LINK_OBJECT_IDENTITY")" || exit 1
    FROZEN_CURRENT_LINK_IDENTITY="$relocated_switch_identity"
    CURRENT_SWITCH_COMPLETED=1
    SWITCH_TEMP_LINK=""
    SWITCH_TEMP_LINK_IDENTITY=""
    SWITCH_TEMP_LINK_OBJECT_IDENTITY=""
    [ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
      "$FROZEN_CURRENT_LINK_IDENTITY" ] || exit 1
    revalidate_incident_runtimes || exit 1
    revalidate_deploy_lock || exit 1
    verify_database_fence_clear || exit 1
    ;;
  frozen)
    RECOVERY_FAILURE_STAGE="current_resume"
    [ "$CURRENT_SWITCH_COMPLETED" -eq 1 ] \
      && [ "$CURRENT_SWITCH_ARMED" -eq 0 ] \
      && [ "$CANDIDATE_PREFLIGHT_VERIFIED" -eq 0 ] \
      && [ "$FROZEN_RESUME_PREFLIGHT_VERIFIED" -eq 1 ] \
      || exit 1
    revalidate_incident_runtimes || exit 1
    verify_frozen_resume_permissions || exit 1
    revalidate_deploy_lock || exit 1
    [ "$(pm2_process_snapshot "$APP_NAME")" = "absent" ] || exit 1
    [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
    port_is_free || exit 1
    verify_database_fence_clear || exit 1
    revalidate_incident_runtimes || exit 1
    verify_frozen_resume_permissions || exit 1
    revalidate_deploy_lock || exit 1
    [ "$(pm2_process_snapshot "$APP_NAME")" = "absent" ] || exit 1
    [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
    port_is_free || exit 1
    verify_database_fence_clear || exit 1
    ;;
  *) exit 1 ;;
esac
printf '%s\n' 'current_frozen_release_verified'

RECOVERY_FAILURE_STAGE="web_start"
WEB_START_ATTEMPTED=1
PM2_STATE_MUTATED=1
set +e
(
  cd "$FROZEN_RUNTIME_DIR"
  export SUPABASE_INTERNAL_URL="$FROZEN_SUPABASE_INTERNAL_URL"
  export NEXT_PUBLIC_SUPABASE_URL="$FROZEN_NEXT_PUBLIC_SUPABASE_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$FROZEN_NEXT_PUBLIC_SUPABASE_ANON_KEY"
  NODE_OPTIONS="" NODE_PATH="" \
    npm_config_node_options="" NPM_CONFIG_NODE_OPTIONS="" \
  MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    PORT="$APP_PORT" timeout --signal=TERM --kill-after=5s 30s \
      pm2 start "$NPM_REAL_PATH" --name "$APP_NAME" \
        --interpreter node --cwd "$FROZEN_RUNTIME_DIR" \
        -- start -- -p "$APP_PORT" \
      >/dev/null 2>&1
) >/dev/null 2>&1
web_start_status=$?
set -e

RECOVERY_FAILURE_STAGE="web_stability"
web_pid=""
for _ in $(seq 1 30); do
  web_state="$(started_pm2_state web)" || exit 1
  case "$web_state" in
    running:[1-9][0-9]*) web_pid="${web_state#running:}" ;;
    *) web_pid="" ;;
  esac
  if [ -n "$web_pid" ]; then break; fi
  sleep 1
done
[[ "$web_pid" =~ ^[1-9][0-9]*$ ]] || exit 1
capture_started_process_identity STARTED_WEB "$web_pid" || exit 1
[ "$web_start_status" -eq 0 ] || exit 1

verify_local_four_route_old_build() {
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || return 1
  trusted_helper_matches \
    "$FROZEN_SMOKE_HELPER" "$SMOKE_HELPER_RELATIVE" \
    "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR" \
    "$FROZEN_SMOKE_HELPER_SNAPSHOT" || return 1
  timeout --signal=TERM --kill-after=5s 150s \
    node "$FROZEN_SMOKE_HELPER" \
      --origin "http://127.0.0.1:${APP_PORT}" \
      --paths /,/login,/10909094,/admin \
      --expected-build "$EXPECTED_OLD_BUILD_ID" \
      --attempts 4 --delay-ms 1000 --timeout-ms 8000 \
      >/dev/null 2>&1 || return 1
  trusted_helper_matches \
    "$FROZEN_SMOKE_HELPER" "$SMOKE_HELPER_RELATIVE" \
    "$EXPECTED_OLD_BUILD_ID" "$FROZEN_RUNTIME_DIR" \
    "$FROZEN_SMOKE_HELPER_SNAPSHOT" || return 1
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY"
}

verify_process_environment() {
  local pid="$1"
  local expected_start_ticks="$2"
  local snapshot
  local -a parts=()
  [ "$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)" = "$FROZEN_RUNTIME_DIR" ] \
    || return 1
  snapshot=""
  capture_trusted_environment_helper_output snapshot 5 process-snapshot \
    "$pid" "$FROZEN_RUNTIME_DIR" || return 1
  mapfile -t parts <<< "$snapshot"
  [ "${#parts[@]}" -eq 5 ] \
    && [ "${parts[0]}" = "present" ] \
    && [ "${parts[1]}" = "$expected_start_ticks" ] \
    && [ "${parts[2]}" = "$SNAPSHOT_INTERNAL_URL_B64" ] \
    && [ "${parts[3]}" = "$SNAPSHOT_PUBLIC_URL_B64" ] \
    && [ "${parts[4]}" = "$SNAPSHOT_ANON_KEY_B64" ] || return 1
  timeout --signal=TERM --kill-after=1s 3s node -e '
    const fs = require("node:fs");
    const entries = fs.readFileSync(`/proc/${process.argv[1]}/environ`)
      .toString("utf8").split("\0").filter(Boolean);
    for (const key of [
      "NODE_OPTIONS", "NODE_PATH", "npm_config_node_options", "NPM_CONFIG_NODE_OPTIONS",
    ]) {
      const prefix = `${key}=`;
      const values = entries.filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length));
      if (values.length > 1 || (values.length === 1 && values[0] !== "")) process.exit(1);
    }
  ' "$pid" >/dev/null 2>&1 || return 1
  [ "$(linux_process_start_ticks "$pid" 2>/dev/null || true)" = "$expected_start_ticks" ]
}

verify_web_flags() {
  local pid="$1"
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || return 1
  FAOLLA_EXPECTED_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    FAOLLA_EXPECTED_PORT="$APP_PORT" \
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
        exact("PORT") !== process.env.FAOLLA_EXPECTED_PORT
      ) process.exit(1);
    ' "$pid" >/dev/null 2>&1 || return 1
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY"
}

verify_web_launch_contract() {
  local pid="$1"
  local process_list
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || return 1
  process_list="$(PM2_SILENT=true timeout --signal=TERM --kill-after=2s 5s \
    pm2 jlist 2>/dev/null)" || return 1
  FAOLLA_EXPECTED_WEB_NAME="$APP_NAME" \
    FAOLLA_EXPECTED_WEB_PID="$pid" \
    FAOLLA_EXPECTED_NPM="$NPM_REAL_PATH" \
    FAOLLA_EXPECTED_CWD="$FROZEN_RUNTIME_DIR" \
    FAOLLA_EXPECTED_PORT="$APP_PORT" \
    timeout --signal=TERM --kill-after=1s 3s node -e '
      const fs = require("node:fs");
      let list;
      try { list = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
      const name = process.env.FAOLLA_EXPECTED_WEB_NAME;
      const pid = process.env.FAOLLA_EXPECTED_WEB_PID;
      const npm = process.env.FAOLLA_EXPECTED_NPM;
      const cwd = process.env.FAOLLA_EXPECTED_CWD;
      const args = ["start", "--", "-p", process.env.FAOLLA_EXPECTED_PORT];
      if (!Array.isArray(list)) process.exit(1);
      const related = list.filter((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        (entry.name === name || entry.pm2_env?.name === name)
      );
      if (related.length !== 1) process.exit(1);
      const entry = related[0];
      if (
        entry.name !== name || entry.pm2_env === null || typeof entry.pm2_env !== "object" ||
        Array.isArray(entry.pm2_env) || entry.pm2_env.name !== name
      ) process.exit(1);
      const env = entry.pm2_env;
      if (
        !/^[1-9][0-9]*$/.test(pid || "") || String(entry.pid) !== pid ||
        !Number.isSafeInteger(entry.pm_id) || entry.pm_id < 0 || env.pm_id !== entry.pm_id ||
        env.status !== "online" || env.pm_exec_path !== npm || env.pm_cwd !== cwd ||
        env.exec_interpreter !== "node" || env.exec_mode !== "fork_mode" ||
        !Array.isArray(env.args) || env.args.length !== args.length ||
        env.args.some((value, index) => value !== args[index]) ||
        !Array.isArray(env.node_args) || env.node_args.length !== 0
      ) process.exit(1);
    ' >/dev/null 2>&1 <<< "$process_list" || return 1
  started_process_identity_matches "$APP_NAME" \
    "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
    "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY"
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

verify_worker_launch_contract() {
  local pid="$1"
  local tsx_entry="$FROZEN_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs"
  local worker_entry="$FROZEN_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts"
  local process_list
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || return 1
  process_list="$(PM2_SILENT=true timeout --signal=TERM --kill-after=2s 5s \
    pm2 jlist 2>/dev/null)" || return 1
  FAOLLA_EXPECTED_WORKER_NAME="$AUTOMATION_WORKER_NAME" \
    FAOLLA_EXPECTED_WORKER_PID="$pid" \
    FAOLLA_EXPECTED_TSX="$tsx_entry" \
    FAOLLA_EXPECTED_WORKER="$worker_entry" \
    FAOLLA_EXPECTED_CWD="$FROZEN_RUNTIME_DIR" \
    timeout --signal=TERM --kill-after=1s 3s node -e '
      const fs = require("node:fs");
      let list;
      try { list = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(1); }
      const expectedName = process.env.FAOLLA_EXPECTED_WORKER_NAME;
      const expectedPid = process.env.FAOLLA_EXPECTED_WORKER_PID;
      const expectedTsx = process.env.FAOLLA_EXPECTED_TSX;
      const expectedWorker = process.env.FAOLLA_EXPECTED_WORKER;
      const expectedCwd = process.env.FAOLLA_EXPECTED_CWD;
      if (
        !Array.isArray(list) ||
        !expectedName ||
        !/^[1-9][0-9]*$/.test(expectedPid || "") ||
        !expectedTsx ||
        !expectedWorker ||
        !expectedCwd
      ) process.exit(1);
      const related = list.filter((entry) =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry.name === expectedName || entry.pm2_env?.name === expectedName)
      );
      if (related.length !== 1) process.exit(1);
      const entry = related[0];
      if (
        entry.name !== expectedName ||
        entry.pm2_env === null || typeof entry.pm2_env !== "object" ||
        Array.isArray(entry.pm2_env) || entry.pm2_env.name !== expectedName
      ) process.exit(1);
      const environment = entry.pm2_env;
      if (
        !Number.isSafeInteger(entry.pid) ||
        String(entry.pid) !== expectedPid ||
        !Number.isSafeInteger(entry.pm_id) ||
        entry.pm_id < 0 ||
        environment.pm_id !== entry.pm_id ||
        environment.status !== "online" ||
        environment.pm_exec_path !== expectedTsx ||
        environment.pm_cwd !== expectedCwd ||
        environment.exec_interpreter !== "node" ||
        environment.exec_mode !== "fork_mode" ||
        !Array.isArray(environment.args) ||
        environment.args.length !== 1 ||
        environment.args[0] !== expectedWorker ||
        !Array.isArray(environment.node_args) ||
        environment.node_args.length !== 0
      ) process.exit(1);
    ' >/dev/null 2>&1 <<< "$process_list" || return 1
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY"
}

RECOVERY_FAILURE_STAGE="web_identity"
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
RECOVERY_FAILURE_STAGE="web_environment"
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
verify_web_flags "$web_pid" || exit 1
RECOVERY_FAILURE_STAGE="web_launch_contract"
verify_web_launch_contract "$web_pid" || exit 1
RECOVERY_FAILURE_STAGE="local_smoke"
revalidate_incident_runtimes || exit 1
verify_local_four_route_old_build || exit 1
revalidate_incident_runtimes || exit 1
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
verify_web_flags "$web_pid" || exit 1
verify_web_launch_contract "$web_pid" || exit 1
FROZEN_WEB_COMMITTED=1
printf '%s\n' 'frozen_web_restored'

RECOVERY_FAILURE_STAGE="worker_preflight"
if [ "$AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$INVITATION_WORKER_ENABLED" = "true" ]; then
  [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
  tsx_entry="$FROZEN_RUNTIME_DIR/node_modules/tsx/dist/cli.mjs"
  worker_entry="$FROZEN_RUNTIME_DIR/scripts/run-merchant-enterprise-automation-worker.ts"
  [ -f "$tsx_entry" ] && [ -f "$worker_entry" ] || exit 1
  revalidate_incident_runtimes || exit 1
  RECOVERY_FAILURE_STAGE="worker_start"
  WORKER_START_ATTEMPTED=1
  PM2_STATE_MUTATED=1
  set +e
  (
    cd "$FROZEN_RUNTIME_DIR"
    export SUPABASE_INTERNAL_URL="$FROZEN_SUPABASE_INTERNAL_URL"
    export NEXT_PUBLIC_SUPABASE_URL="$FROZEN_NEXT_PUBLIC_SUPABASE_URL"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY="$FROZEN_NEXT_PUBLIC_SUPABASE_ANON_KEY"
    NODE_OPTIONS="" NODE_PATH="" \
      npm_config_node_options="" NPM_CONFIG_NODE_OPTIONS="" \
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="$INVITATION_WORKER_ENABLED" \
      timeout --signal=TERM --kill-after=5s 30s \
        pm2 start "$tsx_entry" \
          --name "$AUTOMATION_WORKER_NAME" \
          --interpreter node \
          --cwd "$FROZEN_RUNTIME_DIR" \
          --kill-timeout 180000 \
          --restart-delay 5000 \
          --wait-ready \
          --listen-timeout 20000 \
          -- "$worker_entry" >/dev/null 2>&1
  ) >/dev/null 2>&1
  worker_start_status=$?
  set -e
  RECOVERY_FAILURE_STAGE="worker_stability"
  worker_pid=""
  stable_worker_checks=0
  previous_worker_pid=""
  for _ in $(seq 1 20); do
    worker_state="$(started_pm2_state worker)" || exit 1
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
  RECOVERY_FAILURE_STAGE="worker_identity"
  capture_started_process_identity STARTED_WORKER "$worker_pid" || exit 1
  [ "$worker_start_status" -eq 0 ] || exit 1
  for _ in 1 2 3; do
    RECOVERY_FAILURE_STAGE="worker_identity"
    started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
      "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
      "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || exit 1
    RECOVERY_FAILURE_STAGE="worker_environment"
    verify_process_environment "$worker_pid" "$STARTED_WORKER_START_TICKS" || exit 1
    RECOVERY_FAILURE_STAGE="worker_flags"
    verify_worker_flags "$worker_pid" || exit 1
    sleep 1
  done
  RECOVERY_FAILURE_STAGE="worker_environment"
  verify_process_environment "$worker_pid" "$STARTED_WORKER_START_TICKS" || exit 1
  RECOVERY_FAILURE_STAGE="worker_flags"
  verify_worker_flags "$worker_pid" || exit 1
  RECOVERY_FAILURE_STAGE="worker_launch_contract"
  verify_worker_launch_contract "$worker_pid" || exit 1
else
  RECOVERY_FAILURE_STAGE="worker_disabled_absence"
  [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
fi
printf '%s\n' 'worker_state_restored'
RECOVERY_FAILURE_STAGE="persist_and_verify"

revalidate_incident_runtimes || exit 1
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
verify_web_flags "$web_pid" || exit 1
verify_web_launch_contract "$web_pid" || exit 1
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
revalidate_deploy_lock || exit 1
PM2_SAVE_ATTEMPTED=1
timeout --signal=TERM --kill-after=2s 10s pm2 save >/dev/null 2>&1 || exit 1
revalidate_incident_runtimes || exit 1
verify_process_environment "$web_pid" "$STARTED_WEB_START_TICKS" || exit 1
verify_web_flags "$web_pid" || exit 1
verify_web_launch_contract "$web_pid" || exit 1
started_process_identity_matches "$APP_NAME" \
  "$STARTED_WEB_PID" "$STARTED_WEB_START_TICKS" \
  "$STARTED_WEB_PROCESS_IDENTITY" "$STARTED_WEB_CWD_IDENTITY" || exit 1
revalidate_deploy_lock || exit 1
verify_local_four_route_old_build || exit 1
if [ "$AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$INVITATION_WORKER_ENABLED" = "true" ]; then
  started_process_identity_matches "$AUTOMATION_WORKER_NAME" \
    "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" \
    "$STARTED_WORKER_PROCESS_IDENTITY" "$STARTED_WORKER_CWD_IDENTITY" || exit 1
  verify_process_environment "$STARTED_WORKER_PID" "$STARTED_WORKER_START_TICKS" || exit 1
  verify_worker_flags "$STARTED_WORKER_PID" || exit 1
  verify_worker_launch_contract "$STARTED_WORKER_PID" || exit 1
else
  [ "$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")" = "absent" ] || exit 1
fi
[ "$(trusted_symlink_identity "$CURRENT_LINK" 2>/dev/null || true)" = \
  "$FROZEN_CURRENT_LINK_IDENTITY" ] || exit 1
revalidate_incident_runtimes || exit 1
verify_database_fence_clear || exit 1

RECOVERY_COMPLETE=1
printf '%s\n' 'recovery_complete'
