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

Frequency: daily at 02:17 UTC, with a manual dispatch option for controlled
recovery-point creation.

Production recovery evidence: manual GitHub Actions run `30299302673` on
2026-07-27 created and verified a 420,280,352-byte encrypted archive, then
restored it into an ephemeral no-network Postgres container. The rehearsal
verified 15 schemas, 117 tables, 58 page rows, 12 auth users, 3,850 Storage
metadata rows, and 3,850 Storage files.

The workflow:

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
10. Stores the encrypted artifact off-host for 7 days and deletes every
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

The schedule was enabled only after a manual production run created,
transferred, and verified an encrypted artifact and completed the isolated
restore successfully. A successful daily run provides a maximum full-backup
RPO of approximately 24 hours and retains the latest seven daily recovery
points. A failed scheduled run must be investigated before the next recovery
point is due.

This logical disaster-recovery archive is independent from the application
level platform-admin backup, but it is not point-in-time recovery. WAL
archiving/PITR remains a separate follow-up control for reducing data loss
below the scheduled full-backup interval.

## PostgreSQL point-in-time recovery

Workflow: `.github/workflows/pitr-readiness.yml`

Local or production-host check:

```powershell
npm run check:production-pitr-readiness
```

The check is read-only. It never enables PostgreSQL archiving, installs
software, creates a bucket, or changes retention. Add `--fail-on-blocked` only
when the workflow must enforce a complete recovery path.

The report fails closed unless all of the following are verified:

1. `/etc/faolla/pitr.env` exists with owner-only permissions.
2. The running Supabase PostgreSQL container is discoverable and queryable.
3. `wal_level` supports recovery, `archive_mode` is enabled, an archive
   destination is configured, and `archive_timeout` is bounded.
4. WAL-G and its owner-only configuration file are available inside the
   database container.
5. WAL-G can list the off-host repository without exposing credentials.
6. A recent physical base backup exists in that repository.
7. PostgreSQL has successfully archived WAL and has no failed latest attempt
   or unsafe `.ready` backlog.
8. The database filesystem has at least 8 GiB and 20 percent free.
9. A recent isolated, no-network PITR restore rehearsal has written valid
   evidence to
   `/var/lib/faolla-pitr/restore-rehearsal-evidence.json`.

As of 2026-07-27, production PITR is intentionally **blocked**, not silently
reported as protected:

- PostgreSQL `archive_mode` is `off` and `archive_timeout` is `0`.
- No WAL-G binary or off-host WAL repository is configured.
- No physical PITR base backup or isolated PITR restore evidence exists.
- The server filesystem is 40 GiB with approximately 11 GiB available.
  Supabase recommends at least 80 GiB for self-hosting, so disk expansion
  should precede production activation even though the readiness check also
  enforces free-space headroom.

The preferred target is a private S3-compatible bucket in a separate failure
domain. Cloudflare R2 is suitable, but activating R2 may create a billable
service and therefore requires an explicit operator decision. Use Standard
storage, a dedicated bucket, and an Object Read & Write token restricted to
that bucket. Store the Access Key ID and Secret Access Key only in the
owner-only WAL-G configuration mounted inside PostgreSQL; do not put either
value in the repository, application `.env.local`, workflow output, or shell
arguments.

Recommended activation order:

1. Expand the server disk to at least 80 GiB and verify free-space monitoring.
2. Create the private off-host bucket and bucket-scoped credentials.
3. Install a pinned WAL-G release into the PostgreSQL runtime and write its
   owner-only configuration.
4. Verify repository access with `wal-g backup-list`.
5. During a controlled maintenance window, enable `archive_mode`, set
   `archive_timeout` to no more than the target RPO, and restart PostgreSQL.
6. Create and verify a physical base backup.
7. Restore that backup plus WAL into an ephemeral no-network PostgreSQL
   instance and write the rehearsal evidence file.
8. Run the readiness workflow with `enforce_ready=true`. Schedule enforcement
   only after this run is ready or intentionally degraded with no blockers.

Do not enable `archive_mode` with a failing or local-only archive command.
PostgreSQL retains unarchived WAL until the command succeeds, so a broken
destination can consume the remaining production disk.

## Security

Reports contain statuses, timestamps, counts, and bounded error codes only.
They must not include service-role keys, access tokens, response bodies, chat
content, member details, or other customer data.
