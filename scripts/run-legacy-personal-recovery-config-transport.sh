#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf '[legacy-personal-recovery-ops] result=%s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 0 ]; then
  fail secret_argv_forbidden
fi

required_environment=(
  GITHUB_REF
  GITHUB_SHA
  GITHUB_RUN_ID
  RECOVERY_OPS_EXPECTED_SHA
  RECOVERY_OPS_CONFIRMATION
  RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64
  RECOVERY_OPS_CANDIDATE_EMAIL_SHA256
  RECOVERY_OPS_CANDIDATE_PERSONAL_ACCOUNT_ID
  RECOVERY_OPS_SSH_HOST
  RECOVERY_OPS_SSH_PORT
  RECOVERY_OPS_SSH_USER
  RECOVERY_OPS_APP_DIR
  RECOVERY_OPS_KNOWN_HOSTS_FILE
  RECOVERY_OPS_SSH_PRIVATE_KEY_FILE
  RUNNER_TEMP
)
for environment_name in "${required_environment[@]}"; do
  if [ -z "${!environment_name:-}" ]; then
    fail required_configuration_missing
  fi
done
unset environment_name required_environment

candidate_email_sha256="$RECOVERY_OPS_CANDIDATE_EMAIL_SHA256"
candidate_personal_account_id="$RECOVERY_OPS_CANDIDATE_PERSONAL_ACCOUNT_ID"
operator_public_key_pem_base64="$RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64"
expected_sha="$RECOVERY_OPS_EXPECTED_SHA"
confirmation="$RECOVERY_OPS_CONFIRMATION"
ssh_host="$RECOVERY_OPS_SSH_HOST"
ssh_port="$RECOVERY_OPS_SSH_PORT"
ssh_user="$RECOVERY_OPS_SSH_USER"
app_dir="$RECOVERY_OPS_APP_DIR"
known_hosts_file="$RECOVERY_OPS_KNOWN_HOSTS_FILE"
ssh_private_key_file="$RECOVERY_OPS_SSH_PRIVATE_KEY_FILE"
runner_temp="$RUNNER_TEMP"
github_ref="$GITHUB_REF"
github_sha="$GITHUB_SHA"
github_run_id="$GITHUB_RUN_ID"

unset RECOVERY_OPS_CANDIDATE_EMAIL_SHA256
unset RECOVERY_OPS_CANDIDATE_PERSONAL_ACCOUNT_ID
unset RECOVERY_OPS_OPERATOR_PUBLIC_KEY_PEM_BASE64
unset RECOVERY_OPS_EXPECTED_SHA RECOVERY_OPS_CONFIRMATION
unset RECOVERY_OPS_SSH_HOST RECOVERY_OPS_SSH_PORT RECOVERY_OPS_SSH_USER
unset RECOVERY_OPS_APP_DIR RECOVERY_OPS_KNOWN_HOSTS_FILE
unset RECOVERY_OPS_SSH_PRIVATE_KEY_FILE

if [ "$github_ref" != "refs/heads/main" ] \
  || ! [[ "$github_sha" =~ ^[0-9a-f]{40}$ ]] \
  || [ "$expected_sha" != "$github_sha" ]; then
  fail main_sha_required
fi
if [ "$confirmation" != "GENERATE_LEGACY_PERSONAL_RECOVERY_ENCRYPTED_CONFIG" ]; then
  fail confirmation_invalid
fi
if ! [[ "$candidate_email_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || ! [[ "$candidate_personal_account_id" =~ ^[0-9]{8}$ ]]; then
  fail candidate_input_invalid
fi
candidate_personal_account_number=$((10#$candidate_personal_account_id))
if [ "$candidate_personal_account_number" -lt 50010105 ] \
  || [ "$candidate_personal_account_number" -gt 59999999 ]; then
  fail candidate_input_invalid
fi
unset candidate_personal_account_number
if [ "${#operator_public_key_pem_base64}" -lt 256 ] \
  || [ "${#operator_public_key_pem_base64}" -gt 24576 ] \
  || ! [[ "$operator_public_key_pem_base64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  fail public_key_invalid
fi
if ! [[ "$ssh_port" =~ ^[0-9]{1,5}$ ]] \
  || [ "$ssh_port" -lt 1 ] \
  || [ "$ssh_port" -gt 65535 ] \
  || [[ "$ssh_host" =~ [[:space:][:cntrl:]] ]] \
  || [[ "$ssh_user" =~ [[:space:][:cntrl:]@] ]] \
  || [[ "$app_dir" =~ [[:cntrl:]] ]]; then
  fail ssh_configuration_invalid
fi
if [ ! -f "$known_hosts_file" ] || [ -L "$known_hosts_file" ]; then
  fail known_hosts_invalid
fi
if [ ! -f "$ssh_private_key_file" ] || [ -L "$ssh_private_key_file" ]; then
  fail ssh_private_key_invalid
fi
if [ ! -d "$runner_temp" ] || [ -L "$runner_temp" ]; then
  fail runner_temp_invalid
fi
command -v node >/dev/null 2>&1 || fail node_unavailable
if ! node -e '
const { createPublicKey } = require("node:crypto");
const { readFileSync } = require("node:fs");
try {
  let encoded = readFileSync(0, "utf8");
  if (!encoded.endsWith("\n")) process.exit(1);
  encoded = encoded.slice(0, -1);
  if (
    encoded.length < 256 ||
    encoded.length > 24576 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) process.exit(1);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 256 || bytes.length > 16384 || bytes.toString("base64") !== encoded) {
    bytes.fill(0);
    process.exit(1);
  }
  const pem = bytes.toString("utf8");
  bytes.fill(0);
  if (
    !/^-----BEGIN (?:RSA )?PUBLIC KEY-----\n[\s\S]+\n-----END (?:RSA )?PUBLIC KEY-----\n?$/.test(pem) ||
    /PRIVATE KEY/.test(pem)
  ) process.exit(1);
  const key = createPublicKey(pem);
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "rsa" ||
    !Number.isSafeInteger(key.asymmetricKeyDetails?.modulusLength) ||
    key.asymmetricKeyDetails.modulusLength < 3072
  ) process.exit(1);
} catch {
  process.exit(1);
}
' <<<"$operator_public_key_pem_base64" >/dev/null 2>&1; then
  fail public_key_invalid
fi
command -v ssh >/dev/null 2>&1 || fail ssh_unavailable
command -v base64 >/dev/null 2>&1 || fail base64_unavailable

encrypted_artifact="$runner_temp/legacy-personal-recovery-config.enc.json"
artifact_complete=0
cleanup_incomplete_artifact() {
  if [ "$artifact_complete" != "1" ] && [ -f "$encrypted_artifact" ]; then
    rm -f -- "$encrypted_artifact"
  fi
}
trap cleanup_incomplete_artifact EXIT
if [ -e "$encrypted_artifact" ] || [ -L "$encrypted_artifact" ]; then
  fail artifact_path_not_empty
fi

candidate_email_sha256_base64="$(
  printf '%s' "$candidate_email_sha256" | base64 -w0
)"
candidate_personal_account_id_base64="$(
  printf '%s' "$candidate_personal_account_id" | base64 -w0
)"
printf -v remote_app_dir '%q' "$app_dir"
remote_command="cd -- ${remote_app_dir} && exec bash scripts/run-legacy-personal-recovery-config-remote.sh"

printf '[legacy-personal-recovery-ops] run=%s\n' "$github_run_id"
printf '[legacy-personal-recovery-ops] sha=%s\n' "$expected_sha"

set +e
{
  printf '%s\n' "FAOLLA_LEGACY_PERSONAL_RECOVERY_REMOTE_FRAME_V1"
  printf '%s\n' "$expected_sha"
  printf '%s\n' "$candidate_email_sha256"
  printf '%s\n' "$candidate_personal_account_id"
  printf '%s\n' "$operator_public_key_pem_base64"
} | ssh \
  -T \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  -o ConnectionAttempts=1 \
  -o GlobalKnownHostsFile=/dev/null \
  -o IdentitiesOnly=yes \
  -o KnownHostsCommand=none \
  -o StrictHostKeyChecking=yes \
  -o UpdateHostKeys=no \
  -o VerifyHostKeyDNS=no \
  -o "UserKnownHostsFile=$known_hosts_file" \
  -i "$ssh_private_key_file" \
  -p "$ssh_port" \
  "$ssh_user@$ssh_host" \
  "$remote_command" \
  > "$encrypted_artifact" \
  2>/dev/null
pipeline_status=("${PIPESTATUS[@]}")
set -e
frame_status="${pipeline_status[0]:-1}"
ssh_status="${pipeline_status[1]:-1}"
if [ "$frame_status" != "0" ]; then
  fail input_frame_failed
fi
if [ "$ssh_status" != "0" ]; then
  fail remote_generation_failed
fi

encrypted_artifact_contents="$(<"$encrypted_artifact")"
case "$encrypted_artifact_contents" in
  *"$candidate_email_sha256"*|*"$candidate_personal_account_id"*|*"$candidate_email_sha256_base64"*|*"$candidate_personal_account_id_base64"*|*"$operator_public_key_pem_base64"*)
    fail plaintext_artifact_forbidden
    ;;
esac

unset candidate_email_sha256 candidate_personal_account_id
unset candidate_email_sha256_base64 candidate_personal_account_id_base64
unset operator_public_key_pem_base64
unset encrypted_artifact_contents

if ! node --input-type=module - "$encrypted_artifact" <<'NODE'
import { readFile } from "node:fs/promises";
import { parseEncryptedRecoveryEnvelope } from "./scripts/generate-legacy-personal-recovery-encrypted-config.mjs";

try {
  if (process.argv.length !== 3) process.exit(1);
  const raw = await readFile(process.argv[2], "utf8");
  parseEncryptedRecoveryEnvelope(raw);
} catch {
  process.exit(1);
}
NODE
then
  fail encrypted_artifact_invalid
fi
chmod 600 "$encrypted_artifact"
artifact_complete=1
printf '[legacy-personal-recovery-ops] result=encrypted_config_created\n'
