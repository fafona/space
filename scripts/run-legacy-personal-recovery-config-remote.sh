#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf '[legacy-personal-recovery-config] result=%s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 0 ]; then
  fail secret_argv_forbidden
fi

IFS= read -r frame_magic || fail input_frame_invalid
IFS= read -r expected_sha || fail input_frame_invalid
IFS= read -r candidate_email_sha256 || fail input_frame_invalid
IFS= read -r candidate_personal_account_id || fail input_frame_invalid
IFS= read -r operator_public_key_base64 || fail input_frame_invalid
if IFS= read -r unexpected_extra_line; then
  fail input_frame_invalid
fi
unset unexpected_extra_line

if [ "$frame_magic" != "FAOLLA_LEGACY_PERSONAL_RECOVERY_REMOTE_FRAME_V1" ] \
  || ! [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] \
  || ! [[ "$candidate_email_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || ! [[ "$candidate_personal_account_id" =~ ^[0-9]{8}$ ]] \
  || ! [[ "$operator_public_key_base64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] \
  || [ "${#operator_public_key_base64}" -gt 24576 ]; then
  fail input_frame_invalid
fi
candidate_personal_account_number=$((10#$candidate_personal_account_id))
if [ "$candidate_personal_account_number" -lt 50010105 ] \
  || [ "$candidate_personal_account_number" -gt 59999999 ]; then
  fail input_frame_invalid
fi
unset candidate_personal_account_number

command -v git >/dev/null 2>&1 || fail runtime_invalid
command -v node >/dev/null 2>&1 || fail runtime_invalid
command -v timeout >/dev/null 2>&1 || fail runtime_invalid

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || fail repository_state_invalid
if [ "$(pwd -P)" != "$(cd -- "$repository_root" && pwd -P)" ]; then
  fail repository_state_invalid
fi
if [ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "main" ]; then
  fail repository_state_invalid
fi
actual_sha="$(git rev-parse HEAD 2>/dev/null)" || fail repository_state_invalid
if [ "$actual_sha" != "$expected_sha" ]; then
  fail repository_sha_mismatch
fi
for tracked_file in \
  scripts/generate-legacy-personal-recovery-encrypted-config.mjs \
  scripts/run-legacy-personal-recovery-config-remote.sh; do
  git cat-file -e "HEAD:${tracked_file}" 2>/dev/null \
    || fail repository_state_invalid
done
git diff --quiet HEAD -- \
  scripts/generate-legacy-personal-recovery-encrypted-config.mjs \
  scripts/run-legacy-personal-recovery-config-remote.sh \
  || fail repository_state_invalid
git diff --cached --quiet HEAD -- \
  scripts/generate-legacy-personal-recovery-encrypted-config.mjs \
  scripts/run-legacy-personal-recovery-config-remote.sh \
  || fail repository_state_invalid
if [ ! -f .env.local ] || [ -L .env.local ]; then
  fail production_config_invalid
fi

set +e
{
  printf '%s\n' "FAOLLA_LEGACY_PERSONAL_RECOVERY_CONFIG_INPUT_V1"
  printf '%s\n' "$candidate_email_sha256"
  printf '%s\n' "$candidate_personal_account_id"
  printf '%s\n' "$operator_public_key_base64"
} | timeout \
  --signal=TERM \
  --kill-after=5s \
  420s \
  node scripts/generate-legacy-personal-recovery-encrypted-config.mjs
transport_status=("${PIPESTATUS[@]}")
set -e

frame_status="${transport_status[0]:-1}"
generator_status="${transport_status[1]:-1}"
unset candidate_email_sha256 candidate_personal_account_id
unset operator_public_key_base64 expected_sha actual_sha frame_magic
if [ "$frame_status" != "0" ]; then
  fail input_frame_failed
fi
if [ "$generator_status" != "0" ]; then
  exit "$generator_status"
fi
