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
