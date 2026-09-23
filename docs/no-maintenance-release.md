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
