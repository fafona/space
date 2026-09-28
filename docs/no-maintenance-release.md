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

## Curated runtime-performance no-database lane (2026-09-27)

`runtime-performance` is a separate exact 22-file allowlist, selected only by
`src/lib/merchantCustomerSearch.ts`, before the older performance lane. Its
application scope is customer request lifecycle, bounded lazy customer search,
and public page/product render reuse: four runtime files, four acceptance files
and three original notes. The release note plus six already-reviewed static
recovery/tool files complete the closure from live application `1740b254` through
main `975935b4`. Four retirement controller/policy/test files implement the
subsequently approved single-slot lifecycle below. Neither revision is a substitute for rechecking the actual live
baseline and reviewed current-main target when staging.

No API, authentication, source store, booking authority, shadow schema, worker,
dependency or Web Push change is admitted. Other lanes keep their existing
allowlists. The static recovery files are present because of the live-to-main
diff, not permission to rerun the historical `retry-static` incident.

Use `stage TARGET LIVE_BASELINE`, then `activate TARGET` after
`ready-no-database`. The database action, migration target and pending-migration
helpers reject this lane before backup, migrations or pilot operations. Existing
analytics, retention and signing secret are inherited without rotation, and the
existing `10000000` order-attention pilot is preserved. Stage and candidate
verification fail closed on missing/changed required analytics or pilot state.
Only the new web candidate pauses background jobs; retained workers are untouched.

Stage runs the four new actual component/search suites, existing customer and
public-catalog compatibility, release-baseline/static-recovery tests and the
unchanged three release safety suites. It checks the exact candidate HEAD and
clean worktree before tests and again after the real production build, before
starting the candidate. Later candidate verification repeats the source check.
Environment/build guards, bundle budget, process/configuration ownership, public
smoke, additive immutable assets and owned rollback all remain in force.
Before publishing any static asset or changing an upstream, this lane checks
every saved before/after proxy file against the recorded old/new hashes. Its
rollback checks every saved before file before writing any proxy configuration,
in addition to the unchanged current-proxy ownership guard. Each phase writes
the exact contents it just validated, without rereading the saved files between
validation and writing. A missing or drifted snapshot fails without partial proxy
writes or nginx reload; older lanes keep their original behavior.

This lane does not automatically stop any process or expand the port range.
An unavailable port remains a blocker unless the separate, approved retirement
controller has completed its checks and issued the exact single-slot receipt.

### Approved first historical-web retirement (2026-09-27)

The user approved the explained scope: initially stop **one** vetted historical
web process, preserve current web, preceding rollback web, original base/card/web
services and background jobs, and retain all business data and files. This is
not permission for batch cleanup, file deletion, maintenance or new public ports.

`online-release-retirement.mjs inspect|retire CODE_SHA LIVE_SHA VICTIM_SHA`
runs from exact reviewed current-main source. Retirement shares the deployment
and maintenance operation locks. It requires canonical process/source identities,
paused background jobs, no PM2 watch/cron restart, normal Next signal handling,
no effective nginx references and repeated observations without connections.
It saves private recovery/evidence records before stopping only the selected
PM2 ID, preserves the stopped registration, and checks every other process,
listener, protected application version and PM2 persistence before issuing a
completed receipt. A partial attempt blocks automatic retry; it is not success.

The receipt authorizes only the exact original process identity in three named
release contexts: current web, its predecessor and the one new target. Historical
release snapshots are not rewritten. Missing/replaced/restarted processes and
unrelated stopped processes still fail. New snapshots omit only the certified
stopped entry, so its port can be reused while its source/assets remain intact.
Use the new reviewed controller for rollback: new target to current, then current
to its retained predecessor. Old immutable controllers deliberately retain their
strict checks; this is no promise of arbitrary rollback into the retired version.

PM2 uses its already configured termination timeout, not a guessed stop-command
flag. No active connection or task may be sacrificed to force a slot free. The
stopped record must have watch/cron disabled so saving/restoring PM2 cannot
silently start it on a reassigned port. This first receipt does not authorize a
second retirement or silently broaden its target scope for a later release.

## Booking merge CPU no-database lane and bounded rolling retention (2026-09-27)

`booking-merge-cpu` is selected only by
`src/lib/merchantBookingPersistenceStore.ts`. Its exact 19-path closure contains
the four CPU implementation/test/evidence files, six already-reviewed CI files
between live `0004c202` and CPU candidate `82a9c13e`, these four release-policy
files, four new rolling-policy/controller/test files and the booking release
note. Stage still checks the actual current-main target and live baseline: these
historical revisions are evidence, not permission to stage a different diff.
Adjacent booking capacity, writes, authentication, APIs, migrations/SQL, workers,
dependencies and the original retirement modules are not in this allowlist.

The lane runs the exact seven CPU/customer suites (78 tests at the CPU checkpoint),
customer/public compatibility, CI contracts, auth/QR/static safety and both old
and new retirement suites before the actual guarded production build. Required
CI is not replaced by these focused tests. Exact clean source HEAD checks run
before tests, after build and during later candidate verification. Ignored build
output is not an untracked-source failure. Stage and activation use
`ready-no-database`; all database entrypoints reject this lane before backup,
migration or pilot operations. Analytics, retention, signing secret and existing
pilot are inherited; only the candidate's background jobs are paused. Candidate
checks reject drift in these settings. Saved before/after proxy hashes, immutable
assets, public smoke and ownership-checked rollback use the same protected path
as the runtime-performance lane.

The separately approved `online-release-rolling.mjs` controller may stop one
explicitly vetted historical web process per new release, while preserving the
current and two preceding rollback processes, base services, background jobs,
all data, registrations, source trees and assets. It is never invoked implicitly
by stage. No available port remains a stage blocker until a separate approved
retirement has completed. The original single-slot policy and its certificates
are unchanged; their allowed release contexts are never extended.

Only complete, privately owned and hash-bound rolling history is accepted.
Partial attempts block instead of falling back to older history. Each new stage
records the selected history head and every normalized retained process field;
in-progress stage/finish/activation cannot adopt a later head. Completed active
historical states may be used only for explicit, owned rollback with their
original birth head (or the initial legacy contexts), verified ancestry and the
latest allowed rollback edge. Historical state files are not rewritten. Every
certified stopped registration and all three pre-switch anchors remain exact,
including the third anchor after cutover; later retirement requires a new full
proof. Rollback may follow only the actual adjacent baseline edges within the
new release and three recorded pre-switch anchors. Skipping/reversing that chain
or reaching any older release is rejected. This also preserves both existing
rollback steps before the new candidate has switched traffic.

See [the scoped booking release evidence](booking-merge-release-2026-09-27.md).

### Exact pre-build booking-stage recovery

The first `57dbac3ab07899fcca03a17d149c3c717b805d63` stage stopped during focused
tests, before building or starting a candidate. A Linux PM2 fixture creates a
temporary `scripts/pm2-fake-*/alias.sock` symlink; concurrently running test
discovery correctly rejected it. The booking lane now runs its unchanged 26
focused test files with `--test-concurrency=1`. Discovery restrictions, tests,
other lanes and the existing `finish-stage` missing-build rejection are unchanged.

`resume-booking-stage TARGET BASELINE` is a separate, one-attempt recovery for
that original candidate and live baseline
`0004c202f1c75bce4241c4185aeb16eb1724b177`. It must run from a clean, root-owned
current-main tool worktree under `/var/lib/faolla-online-code/TOOL_SHA`. The tool
must descend from the original candidate with changes restricted to the three
online release scripts and two existing release notes. It is not a new
application target, does not rewrite candidate source or historical certificates,
does not retire another process and does not reset the original preparing state.

Read-only incident hashes pin the original state (including start time), private
runtime/environment files, retained-history head, candidate tree and complete
dependency contents. Ordinary internal `node_modules/.bin` links remain valid;
escaping links, wrong owners/modes, unexpected artifacts or dependency changes
fail. All old/live and saved before/after proxy checks apply. Candidate identity
and its reserved port must be absent before build and again before start.

Only after preflight does the tool write a new private attempt receipt, run the
original candidate's 26 focused and four retirement suites serially, and test
the newer tool in its own worktree. It rechecks all proofs, performs the real
guarded build with umask 022, rechecks proofs and tool authority, then follows the
existing candidate start/smoke/ready gates. Original private environment bytes
are reused without generating new timestamps or secrets. There is no traffic
switch in this action. Any failure leaves evidence and blocks automatic reentry;
no cleanup, false ready state or `retry-static` substitution is permitted.

### One additional booking probe-failure continuation

The first `resume-booking-stage` attempt passed its tests but failed a baseline
HTTP probe before build. Its original `booking-stage-resume-before.json` and
`booking-stage-resume-failure.json` remain immutable; the original action still
rejects reentry. The separately approved `resume-booking-probe-stage TARGET
BASELINE` permits one additional attempt for the same application `57dbac3a`
and baseline `0004c202`, not an arbitrary failed release.

The new tool must be clean current main, descend from both the application and
prior tool `3d73d081beacdd1856c9170a08294e5a1507be25`, and satisfy the same exact
five operational-file scope. Before writing its own receipt, it verifies both
original receipts' pinned raw-byte hashes, root ownership, 0600 mode, single
links and exact incident fields. The original failure must be `fetch failed`
at `2026-09-27T21:32:51.679Z`. The original state, environment, dependencies,
candidate source, retained-history head and owned proxy checks still apply.

The fixed new receipt names are `booking-stage-probe-resume-before.json` and
`booking-stage-probe-resume-failure.json`; creation is exclusive and either
existing path blocks another attempt. Old receipts are rechecked after tests,
after the real build and immediately before saving ready state. No original
receipt, candidate source, preparing timestamp or certificate is rewritten.
All original suites, build, vacant-port/process checks, smoke and ready gates
remain mandatory. There is no additional stop, automatic retry or traffic
switch, and the ordinary `finish-stage` build requirement is unchanged.

## Customer read CPU/payload code-only lane (2026-09-28)

The user approved this separate publication scope after being told that the
existing lanes reject the customer optimization files. `customer-code-performance`
uses its own exact 57-path allowlist, selected by `merchantCustomerListView.ts`
before older overlapping anchors. No older allowlist is widened. The closure
includes the seven reviewed local checkpoints and the five already-reviewed
operational-only changes since live application `57dbac3a`.

This is a **code-only** release. Use `stage SHA BASELINE`, then `activate SHA`;
staging produces `ready-no-database`, which activation requires. Every database helper
and the controller database action reject this lane before backup, migration,
pilot or enablement operations. Migration 060 is present as inactive source,
not applied. No 053-059 authority branch, authentication change, dependency
change, worker change, cleanup or broader schema authority is included.

The baseline's PM2 environment, actual process environment and saved `.env.local`
must have both membership projection settings absent or explicitly disabled.
Unexpected enabled/nonempty/noncanonical values are rejected before creating
release state; they are not silently overwritten. Only the new candidate gets
`MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED=0` and an empty
`MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS`. Both candidate configuration
files are rechecked before tests/build/start; runtime acceptance additionally
checks PM2 and the actual process environment. Analytics/signing key, retention
and the existing fafona order-attention pilot remain unchanged. Only the new web
candidate has background jobs disabled; original services/workers are untouched.

The 81 exact focused files plus three common release checks run serially, as do
the four existing retirement/rolling suites. Native database runner entrypoints
are not executed. The full exact-main CI, real protected production build,
candidate/public smoke, dependency equality, maintenance-state/process/proxy
ownership, saved before/after configuration hashes and immutable asset checks
remain mandatory. Candidate and public customer GET probes include both full
and manager-v1 unauthenticated requests, which must return 401.

Rollback remains available even if the new candidate's settings are faulty: it
restores only hash-verified owned proxy configurations and does not depend on
the candidate projection flags. No business records or database objects are
rolled back. If a slot is needed, use only the already-approved explicit rolling
inspection/retirement workflow, preserving the live release, two rollback
anchors, all original services and all files. Staging never retires a process
implicitly. See [this release's evidence](customer-code-release-2026-09-28.md).

Every controller HTTP probe now explicitly sends `Connection: close`, including
when caller headers use another capitalization. This avoids reusing an idle
connection across long synchronous test/build children. Host, manual redirects,
allowed status checks and the 20-second timeout remain unchanged. A failed
fetch is not retried by the request helper; its diagnostic contains only the
pathname and bounded identifier-shaped error code/name, never the query,
headers, body, environment or original exception message. Existing outer
candidate/public smoke polling is unchanged.

## Explicit static permission incident recovery (2026-09-25)

The user approved a narrow retry after candidate `1740b254851c11302b6c7fef536cf9ef92d75637`
passed its build, 250 focused tests and candidate smoke, but public verification
automatically rolled back to `28c136d27d6f235683cb2eadbf2a5f1fceb34bac`.
The setup wrapper had leaked umask 077 into the build. The newly copied public
assets were root-owned 0600, so nginx returned 403. No application or data defect
was identified. This does not authorize bypassing the ordinary ready-state guard.

`retry-static TARGET BASELINE` is a separate, one-incident command. Use the
reviewed current-main recovery controller from a clean detached worktree at
`/var/lib/faolla-online-code/TOOL_SHA`, under the existing root-only parent.
It preserves the same deploy/operation locks and rejects any target, baseline,
lane, process identity, rollback timestamp or original resource count other than
the recorded incident. The current main tool revision must descend from the
already-built application target with only six exact operational file changes;
candidate source and tree remain unchanged. The tool and application identities
are recorded separately. No application rebuild or candidate restart is needed.

Before touching file permissions, the command rechecks the still-owned old active
release, source/dependencies, all prior processes, maintenance/marker/link hashes,
saved and current proxy hashes, candidate environment, complete focused tests,
recovery tool tests, bundle budget and candidate smoke. It then builds a readonly
manifest of exact file paths, content hashes, birth/ctime window, ownership, mode,
inode, device and link count. The 191 private public assets must match candidate
bytes, be newly created during this incident, and be absent from every other
retained static root. All roots/ancestors are checked without following symlinks.
Unknown/unowned entries, hardlinks, mismatches and writable directories fail closed.

For this incident, the public directories are already 0755: the controller
requires zero directory changes and permits only those 191 ordinary public files
to change 0600 to 0644. The helper revalidates the entire manifest, pins all target
descriptors with O_NOFOLLOW, then changes only their modes. It never changes file
bytes, owner, old assets, candidate source, environment or credential permissions.
Before/after evidence is saved in root-only files; the original rollback remains
recorded. There is no manual state rewrite, reset, cleanup or transition to a fake
ready status.

Every repaired asset is fetched publicly and its bytes verified while old traffic
is still live. All original candidate/ownership checks then run again, followed
by the same normal activation and owned automatic rollback implementation.
Any new failure stops the attempt; do not broaden the manifest or bypass a guard.
The successful application build remains TARGET, not the newer operational tool
commit. Future builds explicitly scope umask 022 to the synchronous build child
and restore the caller's umask afterwards; all private files retain explicit 0600.
