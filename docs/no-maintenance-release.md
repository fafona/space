# Default: no-maintenance publication

User authorized this default and an additive analytics-capable lane on 2026-09-23.
This is not permission to skip tests, authentication checks, backups or ownership checks.

`online-traffic-release.mjs` supports `stage SHA BASELINE`, `database SHA`,
`activate SHA`, `status SHA`, `rollback SHA`. Run through pinned SSH as root with
source from reviewed current main. Do not use the historical full deploy script.

- Stage creates a detached candidate worktree; reuses unchanged dependencies,
  runs focused tests and a production build. The live web and workers stay online.
- Database step dry-runs the registry and refuses anything except 049/050/051;
  creates and verifies an encrypted existing-format disaster-recovery backup,
  then applies compatible new analytics objects. No retention cleanup is enabled.
  Backup key and reports remain root-only in the per-release directory; copy to
  the established off-host backup custody separately. This is not an off-host backup.
- Enable collection only in the candidate after schema completion. No saved card,
  destination, account, business transaction or legacy analytics row is rewritten.
- Activate rechecks original process identities and exact nginx hashes, publishes
  immutable assets additively, validates nginx and gracefully switches upstreams.
  Failed public verification restores only configurations this operation owns.
- Original release markers, state, processes, assets and database are retained.
  Rollback switches web traffic; it does not restore/drop database tables or erase
  new data. No automatic release/disk cleanup is included.
- Future changes outside this explicitly scoped lane need a reviewed scope update;
  incompatible data changes require a separate plan, never automatic maintenance.

Until activation and public checks finish, do not call the feature deployed.

## Export-only QR UI lane (2026-09-23)

The requested standalone QR export is a separate exact file allowlist selected
by `onlineReleaseLane`. It admits the four client feature/test files, its notes,
this controller and previously merged historical test-fixture corrections only.
API, authentication, merchant permissions, migrations and dependency changes are
rejected. The source remains reviewed current main.

Use `stage SHA BASELINE`, then `activate SHA`: stage runs QR-focused tests and the
production build and marks `ready-no-database` only after candidate smoke passes.
`database` explicitly refuses this lane. Existing analytics configuration and
signing secret are inherited unchanged; no backup/migration or candidate restart
is needed for a UI-only release. All original ownership, maintenance-state,
process-identity, nginx hash, asset collision, public smoke and rollback checks
remain mandatory. No live workers are stopped or restarted.

## Performance phase 1 no-database lane (2026-09-24)

After the exact narrow performance publication scope was explained, the user
authorized continuing until optimization is complete. This lane covers only
the phase 1 admin attention polling, telemetry sampling metadata, customer
aggregation/list rendering and deferred spreadsheet loading, their exact tests,
local browser fixture/harness and the phase 1/release notes.
Two separately reviewed historical CI corrections are also admitted by exact
test filename: `repair-unlaunched-transport.test.mjs` freezes the original
migration-era fixture, and `merchantBusinessCardWebsiteRoute.test.ts` checks the
actual destination independently of analytics attribute ordering. Neither
production implementation is admitted by this exception.

`onlineReleaseLane` detects this lane from six explicit runtime file anchors and
checks a separate exact file allowlist. Mixing in even a file admitted by the
analytics or QR lane is rejected. API routes, authentication, permissions,
database schema/migrations, transaction stores, dependencies, workers and
arbitrary new files remain outside its authorization. Later optimization stages
need their own reviewed scope; this is not a generic performance wildcard.

Use `stage SHA BASELINE`, then `activate SHA`. The stage runs focused phase 1
tests plus existing customer and admin regressions, the unchanged guarded
production build and candidate smoke, then enters `ready-no-database`.
`database` fails before any migration, backup or database operation for this
lane. Existing analytics settings and signing secret are inherited unchanged;
the candidate must match the enabled analytics baseline. There is no secret
rotation, business data backfill, retention cleanup or worker restart.

The browser harness is an isolated local/mock acceptance tool, not a production
route or a command run by the release controller. Production still verifies
the exact current main source, dependency equality, owned baseline and all
process/configuration hashes, maintenance state, immutable assets, public smoke
and ownership-checked rollback. Status and rollback remain available; no legacy
state, old process, asset or saved record is removed.

## Fafona owner order-attention pilot lane (2026-09-24)

The user separately approved the derived owner order-attention summary for
merchant `10000000` only. `order-attention` has its own exact file allowlist,
selected by migration 052 or `merchantOrderAttention.server.ts` before the
shared admin-performance anchor. Other migrations, auth/permissions, the old
order/membership writer, booking automation, customer stores, dependencies and
unrelated files remain rejected. None of the three existing lanes is expanded.

Use `stage SHA BASELINE`, `database SHA`, then `activate SHA`:

- Stage retains every original source/process/proxy/maintenance guard, focused
  regression tests and the production build. The new candidate has
  `FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=0`, background jobs paused, and unchanged
  analytics settings and signing secret. It is only `staged`, not DB-ready.
- Database requires the exact 052 version, name and filename; any earlier or
  other pending migration is refused. The existing encrypted backup and backup
  verification run before applying a pending migration. No source order,
  membership, history or V1 data is migrated. The trigger and derived singleton
  start disabled, and rerunning the migration retires prior projection tokens.
- The pinned candidate CLI `order-attention-pilot.ts enable` performs bounded
  source/projection reconciliation. The controller validates its exact JSON
  proof (merchant, enabled state, UUID epoch, lossless generation, bounded
  counts/bytes and hashes) before changing the candidate-only flag to
  `10000000` and restarting only that paused candidate. The operation target
  environment variable is passed to this CLI invocation only, never persisted.
- After candidate smoke, `database-ready` is recorded. Activate runs the CLI
  `verify` again before publishing static files or switching upstreams. A
  failed or malformed proof stops publication; exit status alone is not proof.

Owned-proxy rollback restores public traffic first, then clears this candidate's
flag and restarts only the candidate. It does not depend on database disable
succeeding. The prior web release never reads the pilot; all additive objects,
source data and old workers remain intact. No destructive DB rollback occurs.

Capture runs at transaction commit, so read/publish and reset/reconciliation
must be separate transactions, never mixed into an order source-write
transaction. A source write and its invalidation commit or roll back together;
capture errors are not swallowed into stale ready summaries. Privileged trigger
disable/re-enable or database restore requires explicit epoch reset and fresh
reconciliation before re-enabling. A current trigger-catalog check cannot prove
that no past capture interval was missed. Ordinary web rollback does not remove
capture; a capture-object fault needs an operator to repair the derived objects,
not overwrite or restore business rows.

## Bounded list lane (2026-09-25)

`bounded-lists` is a separate exact allowlist for customer/catalog display
pagination, complete order chunk reads, their focused tests, the isolated local
browser harness, and the exact CI inventory partition. It is selected only by
the new catalog list component or customer pagination helper. APIs, permissions,
source writers, migrations, dependencies and workers are not admitted.

Use `stage SHA BASELINE`, then `activate SHA`; never `database`. All database
entrypoints reject this lane before any backup, migration or pilot operation.
Stage requires the existing enabled analytics and fafona-only pilot; it inherits
their values without rotating keys or re-enabling/backfilling the projection.
Candidate verification checks pilot/analytics continuity. Only background jobs
in the new web candidate are paused. Focused read/UI tests, guarded build,
candidate/public smoke, existing process/configuration/maintenance ownership,
immutable asset collision protection and owned rollback remain unchanged.

## Read-only catalog resource index lane (2026-09-25)

`read-index` is selected only by `src/lib/merchantCatalogReadIndex.ts` and admits
ten exact files: this request-local helper and its test, the traffic resource
reader and its test, the synthetic benchmark, the phase notes, and the four
release policy/controller/test/documentation files. No old lane is expanded.
Source catalog normalization, source writers, stores, APIs, authorization,
dependencies, migrations and arbitrary neighboring files remain excluded.

Use `stage SHA BASELINE`, then `activate SHA`, with `ready-no-database` required.
Every database helper and the actual database action reject this lane before
backup, migration or pilot operations. Neither activation nor rollback invokes
the pilot CLI, resets its epoch, backfills data or restarts any original worker.
Stage requires enabled analytics, its existing nonempty signing secret, and the
existing `10000000` pilot flag; these are inherited unchanged and rechecked on
the candidate. Background work is paused only in the new candidate.

Focused acceptance includes the two new tests, every tracked `accountTraffic`
test, catalog/catalog-store/order-catalog and public-catalog regressions, plus
the three existing QR-preview, canonical-origin and release safety contracts.
The existing guarded build, exact main/ancestor/dependency checks, original
process identities, maintenance-state and proxy hashes, immutable asset
collision rules, public smoke and owned web rollback remain mandatory. No port
range, retention policy or cleanup authority changes in this lane.

## Public catalog batching lane (2026-09-25)

`public-catalog-batch` is a distinct exact allowlist selected only by
`src/app/api/orders/catalog/public/batch-route-handler.ts`. It admits the public
read POST, explicit public-page integration, protocol/coordinator/hook and their
tests, order-authority regression tests, the isolated browser harness and phase
notes, four release files, and the four already-reviewed startup fixture files
merged since the live baseline. It does not expand an older lane. The existing
GET route facade and handler, order writers, stores, permission logic, workflows, dependencies,
migrations and arbitrary neighboring paths remain excluded.

Use the actual owned live baseline, not an undeployed main commit. Run `stage`
then `activate`; successful staging enters `ready-no-database`, which activation
requires. Every database entrypoint
rejects this lane before backup, migration or pilot operations. Analytics must
remain enabled with its existing nonempty signing secret, and the existing
`10000000` attention pilot must remain enabled. Recheck those values against the
candidate runtime configuration. Do not alter retention or restart existing
workers; pause background work only in the new web candidate.

Stage runs batch/GET/protocol/coordinator/hook regressions, orders and product
catalog compatibility, read-index, startup helper unit tests and the unchanged
historical build/route evidence suites, followed
by the existing three QR-preview/origin/release safety tests. The real startup
acceptance fixture is not run on production. Existing guarded build, exact main
and dependency checks, process/configuration/maintenance ownership, candidate
and public smoke, immutable assets and owned rollback stay mandatory. This lane
does not extend the port range or authorize cleanup.
