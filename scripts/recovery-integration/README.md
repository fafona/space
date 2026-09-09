# Recovery-content PostgreSQL acceptance

This opt-in suite uses two new **empty disposable** databases, real migrations
044–047, real `pg_dump` and `pg_restore`, and synthetic records only. It does not
read application env files, existing backups, credentials or production data.

Local connections are restricted to `127.0.0.1:56461`; the actual server data
directory must be this worktree's `.runtime/recovery-test-pg`. The required
database names are `faolla_recovery_source_test` and
`faolla_recovery_target_test`. The runner checks both databases before writing
and refuses nonempty databases. It never creates, drops or resets a database.

```powershell
$env:RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:RECOVERY_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
$env:RECOVERY_TEST_PG_DUMP = 'C:\upos-runtime\pgsql\bin\pg_dump.exe'
$env:RECOVERY_TEST_PG_RESTORE = 'C:\upos-runtime\pgsql\bin\pg_restore.exe'
npm.cmd run test:recovery-database
```

CI has a separate PostgreSQL 15 service and two disposable databases on port
5432. The Ubuntu 24.04 job explicitly selects its PostgreSQL 16 client binaries
rather than an unversioned pg_dump/pg_restore that could drift independently.
Their cross-version dump/restore must pass the job; it is not assumed from mocks.
The runner is excluded from automatic unit tests. Adding the job does not
mean remote CI has run; local PostgreSQL 13.15 results must be labeled as such.

The suite verifies explicit pre-migration absence, post-migration empty tables,
real pending/committed/cancelled/acknowledged states, rotation of a synthetic QR,
all-page and operation/context content digests, and a full single-database dump
and restore into the empty target. After restore it checks replay is read-only,
cancelled replay stays blocked, unacknowledged uniqueness, RLS, table grants,
internal writer denial, and the public commit RPC's service-only permission.

Fault injection runs only in rollback transactions on the disposable target:
changed balances, coupon state, QR token, operation fingerprint, acknowledgement,
lost cancellation tombstones and a missing table with recorded migration are
rejected. The actual `psql --command` transaction wrapper must emit parseable JSON.

Synthetic databases and timestamped `.runtime/recovery-integration/*.dump`
artifacts remain for inspection; they can be recreated by this fixture after an
explicitly scoped reset. Stop only the dedicated instance after acceptance.

This is **not** a production disaster-recovery rehearsal. It does not execute the
encrypted Docker archive workflow, self-hosted Supabase extensions, remote
storage restore, real identities or HTTP authorization. Fingerprints establish
selected content equality, not schema/ACL safety; the listed ACL checks are
separate behavioral checks, not a complete audit of every function/trigger.
`pg_dumpall` performs per-database dumps; neither that nor sequential storage
archiving provides a unified cluster-and-file snapshot. No automatic token
rotation, cancellation removal, acknowledgement or ledger repair is performed.

## Version 2 and snapshot-restore receipts

The current content proof is schema version 2 with a fixed five-relation roster.
All five digest domains use `faolla:recovery-content:v2:<relation>:`. The original
`run.mjs` fixture does not install the snapshot-restore receipt candidate, so its
fifth relation is explicitly absent; this is not receipt recovery acceptance.
Strict historical version-1/four-relation proofs remain recognizable in archives,
but cannot match current proofs or create/re-sign new backup attestations.
Legacy rehearsals retain a `legacy_profile` or `legacy_missing` content status,
never current `verified` evidence. An existing signed release attestation does
not embed this proof version, so this change does not automatically revoke old
signatures; existing target-SHA, expiry and workflow/run release gates still apply.

`receipt-run.mjs` is a separate opt-in local acceptance suite. It requires two
new empty databases, `faolla_receipt_recovery_source_test` and
`faolla_receipt_recovery_target_test`, on `127.0.0.1:56511`, with the real server
directory fixed to this worktree's `.runtime/receipt-recovery-test-pg`. On Windows
it uses the executables under `C:\upos-runtime\pgsql\bin`. It does not start an
instance or create/reset/drop databases, read app env files, or accept alternate
host/database/file/reset arguments. The operator must provision the dedicated
empty fixture first and stop only that verified instance afterward.

```powershell
node scripts/recovery-integration/receipt-run.mjs --check-guards
$env:RECEIPT_RECOVERY_ALLOW_DISPOSABLE_DATABASE = '1'
node scripts/recovery-integration/receipt-run.mjs
```

The runner installs hash-pinned candidate SQL only, without migration registry
entries; receipt presence is checked independently of migrations 044–047. It
commits a real metadata-only receipt through the service RPC, performs a custom
`pg_dump` and transactional `pg_restore`, compares all five proofs, and verifies
historical lookup and replay perform no additional writes after restoration.
Rollback-only faults cover same-count identity/plan/result/timestamp changes,
a missing row, a missing table, and absent versus present-empty storage. Restored
RLS and selected actual table/RPC permission checks are separate from the hashes.

The fixed `.runtime/receipt-recovery-integration/synthetic-receipt-recovery.dump`
is created exclusively and never overwritten, including after a failed run.
Synthetic source/target databases and dump evidence remain afterward; rerunning
against these nonempty databases is deliberately refused. The 2026-09-09 local
PostgreSQL 13.15 run passed 8 groups and the instance was stopped. This does not
run the older migration fixture, remote PG15 CI, encrypted Supabase/Docker DR,
cluster-role restoration, storage recovery, real Auth/PostgREST/HTTP or a complete
schema/ACL audit. The receipt suite is excluded from automatic unit-test discovery.
