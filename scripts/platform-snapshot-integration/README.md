# Platform snapshot atomic candidate: isolated PostgreSQL acceptance

Current status (batch 14, 2026-09-09): the local atomic PATCH/UI now uses the
durable receipt protocol and explicit read-only lookup; default mode remains off
and strict production checks still reject atomic. Batch 13 upgraded disaster
recovery content proofs to version 2/five tables including restore receipts.
The older batch-specific notes below are historical, not current capability
claims. Page operation state is still memory-only: it is not automatically
recovered after reload, and lookup never unlocks an unknown writer.

This standalone runner tests the local **candidate**, not an installed application
migration. `platform_snapshot_atomic_v1.candidate.sql` is intentionally outside
`scripts/supabase-migrations`; it is not registered or automatically applied.
The runner does not change package scripts or CI and is not run by `npm test`.

## Safety and execution

An operator must first create and start a separate disposable local PostgreSQL
instance. This script **does not** start a server, create/reset a database, read
`.env` files, read application credentials, use a database URL, or access backups.
It accepts only all of:

- Explicit `PLATFORM_SNAPSHOT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1`.
- `127.0.0.1:56471`, database `faolla_platform_snapshot_test`, user `postgres`.
- Actual server `data_directory` resolving to this worktree's
  `.runtime/platform-snapshot-test-pg` (no alternate instance/CI exception).
- An initially empty database: no user relations or public functions.

```powershell
$env:PLATFORM_SNAPSHOT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:PLATFORM_SNAPSHOT_TEST_PORT = '56471'
$env:PLATFORM_SNAPSHOT_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
node scripts/platform-snapshot-integration/run.mjs
```

The `psql` child receives an explicit minimal OS environment, fixed local
connection options, no password/service settings and no password file. SQL is
provided on stdin. Connection/statement/lock/process timeouts limit failed tests.
The runner checks all instance guards before writing fixtures.

Synthetic rows and candidate objects remain for inspection. Only precisely
identified synthetic preflight rows and named test triggers/functions are removed
during scenarios. There is no broad reset. A rerun against the populated database
is refused; a separately authorized reset of this exact synthetic database is
required. Other instances, production data and the original workspace are not
touched.

## Contract and coverage

The candidate exposes service-only `faolla_read_platform_snapshot_rows_v1` and
`faolla_commit_platform_snapshot_rows_v1`. Its three fixed scopes contain 6
configuration rows, 3 support rows, and 2 backup-catalog rows. Every request uses
the complete sorted scope, including explicit absent rows; CAS compares physical
ID, raw JSON and timestamp, not a normalized business view.

The suite verifies:

- Installation refuses duplicate/foreign-owner protected physical rows and a
  same-named index with the wrong definition.
- Security-definer RPCs have fixed search paths, allow `service_role` only, and
  deny actual calls from `anon`, `authenticated` and an unrelated test role.
- Physical arrays/objects, unknown fields and empty directories with retained
  history round-trip without app normalization. `fixtures.mjs` exports these
  synthetic payloads without connecting to a database.
- A valid no-op retains IDs/timestamps but still requires matching CAS.
- Two independent sessions using the same prepared snapshot, including missing
  rows, cannot both commit. Tests observe a real ungranted PostgreSQL lock before
  releasing the first transaction, not an assumed sleep-based race.
- Invalid shapes, incomplete/duplicate sets, unauthorized slugs and stale
  ID/content/version cause no changes to any page or timestamp.
- Raised, suppressed, body-modified and ID-replacing writes at every one of the
  11 row boundaries, and last-row AFTER triggers altering an earlier row, roll
  back the full scope. A separate case changes only an earlier timestamp after
  that row's write, with IDs/document bodies untouched, and also rolls back.
- Foreign ownership is rejected after installation; a partial unique index
  prevents duplicate protected null-owner rows.
- Candidate reapplication preserves all data, removes drifted function grants,
  and leaves unrelated pages intact.

A deliberate **negative** test also demonstrates the remaining rollout risk:
a powerful old direct writer can wait on a row lock then overwrite the new RPC's
committed value without participating in its CAS/advisory protocol. Candidate
transaction success is not proof of coordinated application cutover or global
stopping/draining of old writers.

Results report the actual PostgreSQL version and candidate SHA-256. Local
PostgreSQL 13 results do not prove PostgreSQL 15 CI or real Supabase compatibility.
This fixture covers `pages`, roles, and the candidate only, not Auth, PostgREST,
existing RLS policies/extensions, full-database restore, storage, production-scale
capacity, browser confirmation, operator permissions or deployment readiness.

## Central business-store acceptance (batch 10)

`business-run.ts` is a separate opt-in runner using the actual central stores,
business builders/validators and atomic adapter with a local `psql` RPC bridge.
It is not a real PostgREST/HTTP/authentication test. The original 12-group
primitive runner above is not automatically repeated by this runner.

Only `PLATFORM_SNAPSHOT_BUSINESS_ALLOW_DISPOSABLE_DATABASE=1` enables it. It
accepts the fixed database `faolla_platform_snapshot_business_test`, loopback
port **56481**, and the actual data directory resolving to this worktree's
`.runtime/platform-snapshot-business-test-pg`. The database must initially have
no user relations or public functions; the runner does not start/reset it.
It uses no `.env`, database URL, password file or application credentials.

```powershell
$env:PLATFORM_SNAPSHOT_BUSINESS_ALLOW_DISPOSABLE_DATABASE = '1'
npx.cmd tsx scripts/platform-snapshot-integration/business-run.ts
```

Batch 10 verified **6 groups, exit 0**, PostgreSQL **13.15**, with the same
candidate SQL SHA-256 recorded below. It covers six-row configuration creation,
two central writers racing from identical physical baselines, support merge and
history rollback on a late trigger failure, stale catalog rejection, blocked
restore/shadow paths, and unrelated pages preserved. The standalone mode is
`atomic`; default application mode remains `off`, and strict release env checks
reject enabling this candidate before cutover readiness is implemented.

The initial run committed a synthetic catalog but rejected its receipt: naive
per-chunk `Buffer.toString()` split UTF-8 characters. A read-only diagnostic
observed 15 chunks/811,278 bytes, two replacement characters with naive decoding,
zero with combined decoding. Both runners now use stream UTF-8 decoding; a unit
regression test covers split Chinese characters. This was a test bridge issue,
not a production incident or a reason to retry uncertain writes automatically.

The initial database was retained under the exact name
`faolla_platform_snapshot_business_test_initial_diagnostic`, and a new empty
database was created for the final clean run. An intermediate setup stopped at
existing cluster roles; only its newly created, unused `pgcrypto` extension was
removed without CASCADE and recreated. No business data was deleted/reset.
Both synthetic databases remain in the dedicated instance, which the operator
has stopped and verified has no listener on 56481.

## Source-bound restore integration (batch 11)

`restore-run.ts` installs the unchanged v1 primitive and the additive
`platform_snapshot_restore_v1.candidate.sql` in a separately prepared empty
synthetic database. It exercises the actual TypeScript adapter and the restore
coordinator/UI result parser through a local psql bridge. It does not run an
HTTP server, authenticate a real user or restore browser-local state.

Required opt-in: `PLATFORM_SNAPSHOT_RESTORE_ALLOW_DISPOSABLE_DATABASE=1`.
The runner accepts only `127.0.0.1:56491`, database
`faolla_platform_snapshot_restore_test`, and a real data directory resolving to
this worktree's `.runtime/platform-snapshot-restore-test-pg`. It verifies no
user relations or public functions exist before setup, uses a minimal child
environment with no `.env`/application credentials, and does not start/reset/stop
the operator-owned instance. A used database must not be silently cleared to
rerun this script; preserve its synthetic evidence and prepare a new instance
only with an explicit, reviewed test setup.

```powershell
$env:PLATFORM_SNAPSHOT_RESTORE_ALLOW_DISPOSABLE_DATABASE = '1'
npx.cmd tsx scripts/platform-snapshot-integration/restore-run.ts
```

The 11 test groups cover service-only ACLs, both target scopes, a missing source
copy kept absent, invalid inputs, source/target CAS conflicts, two concurrent
restores, actual PostgreSQL lock waits, late trigger rollback, target triggers
tampering with the source, a lost transport ACK after a real commit, real
business restore coordination, and unrelated-page preservation. Some groups
contain several scenarios; this list is not a test-count calculation.

2026-09-09 (Europe/Madrid): **11 groups passed, exit 0**, PostgreSQL **13.15**.
The dedicated instance was stopped after verifying its actual data directory;
no listener remains on 56491. Synthetic data and logs are retained. Restore SQL
SHA-256: `02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb`.

The source catalog is read-only and verified before and after the target
transaction. No persistent restore receipt/ABA protection or old-writer cutover
is provided. The runtime mode remains off by default, and strict production
environment checks still reject atomic enablement. The new candidate is not
registered as a migration and is not automatically run by local tests or CI.

## Durable restore receipt candidate (batch 12, locally database-verified)

The additive `platform_snapshot_restore_receipts_v1.candidate.sql` stores only
operation/actor/scope/backup bindings, two SHA-256 digests, and an in-transaction
timestamp. The old two SQL files remain frozen. The new commit RPC is designed
to persist its receipt in the same transaction as the source-bound target
restore. An exact replay returns only historical metadata (`result: null`),
never a new restore or a copy of today's target. Missing lookup evidence remains
unknown, not permission to retry.

The TypeScript adapter and authenticated read-only GET are implemented locally;
the old restore endpoint and UI are NOT migrated to this protocol. The existing
unknown-write guard is deliberately unchanged. The receipt table is NOT covered
by the current four-table disaster-recovery content proof; upgrading that proof
is a release blocker. No TTL, automatic cleanup or application-snapshot rollback
of the receipt table is provided.

2026-09-09: **19 real PostgreSQL 13.15 groups passed, exit 0** using
`receipts-run.ts`: 13 original SQL groups, 2 additional fault groups and 4 actual
adapter/in-process GET/client bridge groups. A prior direct startup failed the
administrator-token check; after explicit user direction, standard `pg_ctl`
startup succeeded without disabling that check or registering a Windows service.
The exact dedicated target was `127.0.0.1:56501`, database
`faolla_platform_snapshot_receipts_test`, real data directory
`.runtime/platform-snapshot-receipts-test-pg`. After verifying that directory,
the instance was stopped normally. No listener remains; data and logs are retained.
Do not clear or reuse this nonempty evidence database to rerun the script.

The runner requires `PLATFORM_SNAPSHOT_RECEIPTS_ALLOW_DISPOSABLE_DATABASE=1`,
refuses nonempty databases or alternate CLI targets, checks the real directory,
and passes a minimal child environment without application credentials. A safe,
connection-free guard check is `npx.cmd tsx scripts/platform-snapshot-integration/receipts-run.ts --check-guards`.

Additional evidence covers rejected weak/expanded schema installation with full
rollback; unreadable current source/target still allowing only historical
receipt lookup/replay without repair; real ACK loss followed only by lookup;
and matching/wrong/revoked synthetic identity outcomes without unlocking the
client's existing unknown-write guard. The GET/client check is an in-process
Request/Response bridge, NOT real HTTP, signed Auth or PostgREST evidence.
The separate lookup-waiting-on-an-in-flight-commit/rollback scenario remains
untested; the tested two-connection concurrent restore is not that same scenario.

Candidate SHA-256:
`886754062EC8BB9558F87582180A6B548FDDA87B7DD5FC4610A2AEB0BFE189B2`.
This candidate is not a registered migration or automatically installed by CI.

## Local verification record

### In-flight receipt query acceptance (batch 14)

`receipts-query-run.mjs` uses only the dedicated empty database
`faolla_snapshot_receipt_query_test` on `127.0.0.1:56521`, real data directory
`.runtime/platform-snapshot-receipt-query-test-pg`. The operator must provision
and later stop that exact instance. The runner does not start/create/reset/drop
databases or load application credentials, and rejects alternate CLI targets.

```powershell
node scripts/platform-snapshot-integration/receipts-query-run.mjs --check-guards
$env:PLATFORM_SNAPSHOT_RECEIPT_QUERY_ALLOW_DISPOSABLE_DATABASE = '1'
node scripts/platform-snapshot-integration/receipts-query-run.mjs
```

On 2026-09-09 it passed **3 actual PostgreSQL 13.15 groups**: lookup blocked by
an in-flight restore returns the receipt after COMMIT; returns null after
ROLLBACK; and reports an error after actual lock timeout while the holder may
still commit afterward. Null is unknown, not permission to resend. Barriers use
observed backend/lock state, not assumed delays. Exactly 3 write RPCs, no
automatic resubmission, 2 retained committed receipts. The instance was stopped
after actual-directory verification; synthetic evidence remains, so a rerun
against it is refused. This is not signed Auth, PostgREST, HTTP, a full new
PATCH/UI real-database integration or PG15 evidence. All SQL hashes are frozen.

2026-09-08: the guarded standalone runner completed **12 groups, exit 0** against
the dedicated PostgreSQL **13.15** instance and candidate SHA-256:

```text
838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93
```

Each group contains multiple assertions; the 11-boundary fault group alone runs
four faults per slug. This is not a count of HTTP, browser or production tests.
The 64 MiB candidate input ceiling is not a production capacity benchmark, and
this run does not establish large-document latency or memory bounds. Synthetic
data remained in the local database after completion; the runner did not reset
it, stop the operator-owned instance or apply any registered migration.
