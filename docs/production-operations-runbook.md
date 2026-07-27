# Production Operations Runbook

This runbook covers the read-only production monitor and backup recovery
rehearsal. Neither scheduled job writes to production data.

Both GitHub Actions workflows connect to the production host over SSH and run
the checked-in scripts from the deployed application directory. The scripts
load the server's existing `.env.local`; production database credentials are
not copied into GitHub. Only the bounded, redacted report output is returned
to the workflow log and artifact.

## Scheduled checks

### Production Monitor

Workflow: `.github/workflows/production-monitor.yml`

Frequency: hourly at minute 17.

Checks:

| Check | Failure meaning |
| --- | --- |
| `public_site` | Public pages, Next.js assets, or dynamic chunks cannot be loaded consistently. |
| `supabase_auth` | Supabase Auth is unavailable or the configured public key is invalid. |
| `legacy_pages` | The current `pages` persistence table cannot be read with the service role. |
| `booking_persistence` | One of the three required booking stores is missing or malformed. |
| `v1_migrations` | Reports whether all repository V1 migrations are registered in production. |
| `outbox_v1` | Checked only after all V1 migrations are ready. Dead letters, expired leases, unknown events, and overdue work are blockers. |

`v1_migrations=not_ready` and `outbox_v1=not_ready` are deliberately
non-blocking while the legacy persistence path remains primary. They must not
be treated as permission to enable any V1 read or dual-write flag.

Run locally:

```powershell
node --env-file=.env.local scripts/check-production-operations.mjs --json
```

Require V1 readiness only during a controlled V1 rollout:

```powershell
node --env-file=.env.local scripts/check-production-operations.mjs --require-v1-ready
```

### Backup Recovery Rehearsal

Workflow: `.github/workflows/backup-recovery-rehearsal.yml`

Frequency: daily at 03:41 UTC.

The rehearsal:

1. Reads the primary and secondary platform-admin backup rows.
2. Validates the latest backup structure.
3. Performs an in-memory JSON round trip.
4. Simulates extraction of the `user_manage` and `support_messages` restore scopes.
5. Fails when the latest backup is older than 96 hours or cannot be validated.
6. Fails the scheduled workflow when the latest entry is not present in both copies.

Run locally:

```powershell
node --env-file=.env.local scripts/check-production-backup-recovery.mjs --fail-on-degraded --json
```

## Alert response

### Production monitor is critical

1. Open the failed GitHub Actions run and inspect the JSON summary.
2. Re-run the workflow once to rule out a short network interruption.
3. If `public_site` failed after a deployment, inspect the deployment workflow and roll back to the last verified commit when the failure is reproducible.
4. If `supabase_auth`, `legacy_pages`, or `booking_persistence` failed, check Supabase service status and credentials before changing application code.
5. Keep all V1 read and dual-write flags off until the migration and outbox checks are healthy.

### Backup rehearsal is critical

1. Do not run a production restore merely to test the failure.
2. Confirm the `pages` table is readable and the platform-admin backup rows still exist.
3. After the underlying service is healthy, create a fresh platform-admin backup through the existing controlled backup flow.
4. Re-run the rehearsal and confirm both copies contain the same latest backup.
5. Preserve the failed report artifact for diagnosis.

## Coverage boundary

The platform-admin backup is not a full business database backup.

| Data area | Covered by this rehearsal |
| --- | --- |
| Platform state, merchant account inventory, published merchant snapshot/config archive | Yes |
| Platform support inbox | Yes |
| Orders, bookings, members, points, recharge/redemption records, coupons, conversations, logs, printer settings, and other merchant operational stores | No |
| Supabase database-level backup or point-in-time recovery | No |

The next data-safety phase must add an independently retained database backup
or provider point-in-time recovery process and perform a restore into an
isolated environment. Until then, a healthy rehearsal proves only that the
existing platform-admin backup is readable and internally restorable.

## Encrypted database backup

Workflow: `.github/workflows/database-backup.yml`

The workflow remains manual until its first successful production run. It:

1. Discovers the running self-hosted Supabase database and Storage containers
   without copying container secrets into GitHub.
2. Streams a full `pg_dumpall` role/database dump from the database container.
3. Archives local Storage objects, the `pgsodium_root.key`, Supabase Compose
   configuration, and the deployed application's `.env.local`.
4. Writes per-file SHA-256 checksums, source image tags, and the Storage
   backend into a manifest.
5. Encrypts the complete disaster-recovery archive before it leaves the
   production host.
6. Transfers only the encrypted archive to GitHub Actions.
7. Decrypts a temporary copy on the runner and validates the outer allowlist,
   manifest, sizes, checksums, gzip stream, nested archive paths, recovery key,
   and required configuration files.
8. Starts the recorded Supabase Postgres image in an ephemeral Docker
   container with networking disabled, restores the complete SQL dump, and
   verifies aggregate counts for schemas, tables, `public.pages`,
   `auth.users`, and `storage.objects`.
9. Extracts Storage into an isolated temporary directory and verifies its
   aggregate file count and bytes.
10. Stores the encrypted artifact off-host for 30 days and deletes every
    plaintext directory, temporary container, Docker volume, and transferred
    copy after completion or failure.

The production host does not need a separate database URL or host PostgreSQL
client. It needs the deployed self-hosted Supabase containers, Docker,
OpenSSL, `tar`, and `gzip`. The database container must provide `pg_dumpall`
and the file-backed Storage container must provide `tar`.

Required GitHub Actions secret:

```text
DATABASE_BACKUP_PASSPHRASE
```

The passphrase must contain at least 24 characters. It is sent to the backup
process over SSH standard input and is never included in a command argument or
report.

A Windows DPAPI-protected recovery copy is stored outside the repository at:

```text
D:\merchant-backups\FAOLLA_DATABASE_BACKUP_KEY.dpapi.txt
```

Only the same Windows account on this computer can decrypt that copy:

```powershell
$lines = Get-Content 'D:\merchant-backups\FAOLLA_DATABASE_BACKUP_KEY.dpapi.txt'
$secure = ConvertTo-SecureString $lines[-1]
$credential = [pscredential]::new('backup', $secure)
$credential.GetNetworkCredential().Password
```

Do not place the decrypted value in the repository, a ticket, chat, workflow
log, or shell history. A second protected copy must be kept in the operator's
off-machine password manager; the local DPAPI copy alone is not sufficient if
the workstation is lost.

Run the non-secret readiness check after changing backup configuration:

```powershell
npm run check:database-backup-readiness
```

Do not add a schedule until a manual run creates, transfers, and verifies an
encrypted artifact and completes the isolated restore successfully. The first
successful run establishes the current full-backup RPO; until a daily schedule
is enabled, this workflow provides no automatic recovery point.

This logical disaster-recovery archive is independent from the application
level platform-admin backup, but it is not point-in-time recovery. WAL
archiving/PITR remains a separate follow-up control for reducing data loss
below the scheduled full-backup interval.

## Security

Reports contain statuses, timestamps, counts, and bounded error codes only.
They must not include service-role keys, access tokens, response bodies, chat
content, member details, or other customer data.
