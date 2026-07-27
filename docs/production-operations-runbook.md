# Production Operations Runbook

This runbook covers the read-only production monitor and backup recovery
rehearsal. Neither scheduled job writes to production data.

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

## Security

Reports contain statuses, timestamps, counts, and bounded error codes only.
They must not include service-role keys, access tokens, response bodies, chat
content, member details, or other customer data.
