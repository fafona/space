# One-time legacy personal recovery configuration

This workflow only discovers and verifies one fixed legacy personal candidate and creates a one-day encrypted artifact. It never binds an account, changes an Auth user, writes repository secrets, enables recovery, or deploys the application. Keep `ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED=false` until the separate supervised recovery window is approved.

## Preconditions

- The exact workflow commit is the current `main` commit and has already passed CI and the normal disabled production deployment.
- Migrations `202608190037` (system-site isolation) and `202608190038` (service-only per-target recovery observer) are live, and the authoritative readiness RPC is green.
- Repository secret `SSH_KNOWN_HOSTS` contains the independently verified pinned host key for `SSH_HOST` and `SSH_PORT`. Do not create it with `ssh-keyscan` inside the workflow.
- The legacy email and personal ID are handled only on the operator workstation. Do not paste them into workflow inputs, issue comments, pull requests, chat, logs, or artifacts.
- The operator has a locally authenticated `gh` session that can write Actions secrets. The workflow token is intentionally read-only and cannot write secrets.
- The workflow does not use a GitHub Environment as a security boundary and does not create one. If a genuinely protected Environment is configured later, attach it only in a separately reviewed change. The current boundary is the administrator-set fixed public-key secret, short-lived candidate secrets, and the read-only workflow token.

## Prepare the fixed key and temporary inputs locally

Generate an ephemeral RSA-3072 key pair on the operator workstation. Keep the private key outside the repository and runner:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out recovery-operator-private.pem
chmod 600 recovery-operator-private.pem
openssl pkey -in recovery-operator-private.pem -pubout -out recovery-operator-public.pem
```

Encode the public PEM as one canonical Base64 line and set the fixed repository secret over stdin. Never put a public key in a dispatch input:

```bash
openssl base64 -A -in recovery-operator-public.pem \
  | gh secret set ORDINARY_LEGACY_PERSONAL_RECOVERY_OPERATOR_PUBLIC_KEY_PEM_BASE64 --repo OWNER/REPO
```

The workflow rejects a missing, non-canonical, non-RSA, or weaker-than-3072-bit key before SSH. Normalize the email exactly as `trim().toLowerCase()`, SHA-256 it locally, and pipe the lowercase 64-hex digest and eight-digit personal ID into their temporary secrets:

```bash
printf '%s' "$candidate_email_sha256" \
  | gh secret set ORDINARY_LEGACY_PERSONAL_RECOVERY_CANDIDATE_EMAIL_SHA256 --repo OWNER/REPO
printf '%s' "$candidate_personal_account_id" \
  | gh secret set ORDINARY_LEGACY_PERSONAL_RECOVERY_CANDIDATE_PERSONAL_ACCOUNT_ID --repo OWNER/REPO
```

The personal ID must be in the personal range (`50010105` through `59999999`).

Dispatch `Legacy Personal Recovery Encrypted Config` on `main` with:

- `expected_sha`: the exact current 40-character `main` SHA;
- `confirmation`: `GENERATE_LEGACY_PERSONAL_RECOVERY_ENCRYPTED_CONFIG`.

The job is serialized with production deploys, has a ten-minute limit, uses pinned SSH trust with `StrictHostKeyChecking=yes`, and uploads only `legacy-personal-recovery-config.enc.json` in a one-day artifact. A failure is closed and produces no artifact.

After downloading a successful artifact, immediately delete both temporary candidate secrets. They are not needed for local decryption; create them again only if a new run is required.

## Decrypt directly into repository secrets

Download the artifact to the operator workstation. From the exact checked-out commit, run the local installer. The secret values travel to `gh secret set` over stdin and are never printed or placed in process arguments:

```bash
node scripts/install-legacy-personal-recovery-secrets.mjs \
  --envelope /absolute/path/legacy-personal-recovery-config.enc.json \
  --private-key /absolute/path/recovery-operator-private.pem \
  --repo OWNER/REPO
```

This writes only:

- `ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON` (compact JSON with exactly `caseId`, `authUserId`, `personalAccountId`, `emailSha256`, and `expiresAt`);
- `ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET` (an independent random lowercase 64-hex secret).

It does not enable or deploy recovery. Review the fixed case expiry and then perform enablement as a separate supervised change. The user must still complete a fresh OTP and the super-admin must approve through the recovery UI.

After the encrypted artifact has been successfully installed into the two final repository secrets, delete `ORDINARY_LEGACY_PERSONAL_RECOVERY_OPERATOR_PUBLIC_KEY_PEM_BASE64` and securely delete the local private/public key pair together.

## Mandatory cleanup

After success or abandonment:

1. Set `ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED=false`, delete both final recovery secrets, and deploy the closed state.
2. Confirm the recovery endpoints return `410` and authoritative readiness remains safe.
3. Delete the fixed public-key secret, the two temporary candidate secrets, the downloaded encrypted artifact, and the ephemeral local private/public key using the workstation's approved secure-delete or credential-handling procedure.
4. Remove this one-time workflow, its three transport/generator scripts, the local installer, its contract test and `test:operations` registration, and this runbook in the cleanup PR.
5. Confirm no unexpired recovery artifact remains in GitHub Actions.
