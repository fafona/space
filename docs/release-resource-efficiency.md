# Release time and storage: bounded, no-maintenance workflow

## Root causes and actual scope

The 2026-09-28 audit found copies of tracked download installers in each
controller worktree (244,668,216 content bytes, about 233 MiB per copy), retained
webpack compilation caches, and independent dependency trees in old application
releases. Old directories are not all garbage: live workers, static asset roots,
rollback anchors and historical recovery certificates still reference them.

This change removes the installer copy from **new tools** and provides explicit
reclamation of **inactive webpack caches only**. It does not delete application
releases, stop PM2 registrations, edit certificates, prune assets, remove backups
or claim all historical storage is reclaimable. Logical file bytes are not the
same as measured filesystem space freed.

## Choose the smallest publication path

1. Inspect the diff once. Separate scripts/docs-only changes from runtime,
   dependency and database changes. Record the exact base and target SHAs.
2. Run focused local checks once after the last relevant edit. Reuse an already
   clean local worktree and the verified dependency environment where supported.
   Never build through a dependency symlink when the native build guard forbids it.
3. Use the normal PR and mandatory CI. Existing partitions already execute each
   unit/contract file once. Do not skip required checks, weaken branch protection
   or reuse artifacts from a different SHA/run/environment to save time.
4. Scripts/docs-only: prepare and verify the reviewed tool, run only the requested
   operation, and verify affected operational facts. **No app build or switch.**
5. Runtime: prepare one candidate for the reviewed SHA. Existing online stage
   reuses dependencies only when the lockfile matches; it still performs its
   production build and focused checks. A ready candidate is inspected/reused,
   not blindly staged again. Failed/unfinished states require diagnosis, not reset.
6. Switch only after readiness passes; verify version and affected public routes.
   Do not repeat the entire site probe suite after an unchanged observation.
7. Report target SHA, checks, actual build/switch times and net space change.
   A fixed wall-clock promise is inappropriate while CI is queued or guards fail.

Unchanged dependencies are already reused by the online controller. Do not add
another `npm ci` there. Do not introduce shared mutable `node_modules`, hardlinks
or symlinks: the WASM/native preparation checks require independent safe files.
Cross-job build reuse and reusable compiler-cache pools are **not implemented**
by this change; they require exact provenance and compatibility design first.

## Slim controller checkout

Run the reviewed script as root through the pinned SSH connection:

```sh
node /path/to/clean-reviewed-main/scripts/prepare-online-release-tool.mjs TOOL_SHA
```

`TOOL_SHA` must equal the server's `origin/main`. The helper may run from a clean
root-owned ancestral checkout only when its own bytes exactly match the target
Git blob; a changed helper must first be bootstrapped from the reviewed target.
The destination is fixed to `/var/lib/faolla-online-code/TOOL_SHA`.
The helper never fetches credentials/remotes, runs npm, builds, switches traffic
or changes the database. It uses `worktree add --detach --no-checkout`, installs
the fixed non-cone sparse policy, then materializes HEAD. Downloads are not
copied temporarily and removed afterward. Every retained tracked blob, sparse
index bit, directory ownership and ignored-artifact absence is verified.

An existing complete slim tool is verified and reused. An existing full/dirty/
partial directory is rejected and left intact, not repaired or overwritten.
For first installation or a changed helper, use a clean root-owned temporary
helper-only sparse worktree from reviewed Git objects. Invoke its exact verified
helper to prepare the final tool through the shared locks. Git 2.27 requires the
non-cone setting to be saved explicitly, which the helper now does. After success,
verify the temporary worktree's exact path, identity and clean status before normal
`git worktree remove` (without force); its source remains recoverable from Git.
Do not modify the live base checkout or create a second full source copy merely
to bootstrap a tool. An incomplete final tool still requires diagnosis, not an
automatic overwrite or deletion.
The next application lane must explicitly account for these exact already-reviewed
operational files in its base-to-target diff. Do not hide them with a generic
`scripts/**` exclusion or widen an existing lane without its own scope review.

## Explicit inactive-cache reclamation

Prepare the reviewed slim tool. Both commands must use its exact current-main SHA:

```sh
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-cache-cleanup.mjs inspect TOOL_SHA
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-cache-cleanup.mjs apply TOOL_SHA PLAN_UUID PLAN_SHA256
```

`inspect` reads the live state and hashes candidate contents, then writes a
root-only audit plan under `/var/lib/faolla-release-resource-audit/PLAN_UUID`.
It deletes nothing. It excludes current/live paths, resolved static and `.current`
roots, immediate rollback anchors, pending/failed release references, scheduled
references and additional mounts inside release roots. It validates the immutable
rolling history rather than inferring safety from an old `status: active` file.

PM2 registrations are protected by default. The only cache-only exception is a
stopped registration with PID zero, no watch or scheduled restart, and an exact
full match to the stopped-process record in a completed, fully validated legacy
or rolling retirement certificate. Its victim identity must match the canonical
release, name, PM2 id and port. All other reference protections still take
precedence. The observation explicitly records these certified stopped paths;
neither the registration, recovery records nor restartable runtime are removed.

`apply` requires the exact plan digest, same tool/host/boot/reference observation,
unchanged candidates and a plan less than 24 hours old. It holds the **existing**
deployment flock and operation lock; a busy lock is a stop condition. All caches
are verified before the first deletion and rechecked immediately before use.
Only the prelisted regular files and empty child directories in an exact
`.next/cache/webpack` subtree are removed. The webpack root remains. Links,
hardlinks, wrong ownership/modes, changed files and mount/reference drift fail
closed. No recursive removal or glob-based deletion is used.

Keep `plan.json`, preparation, per-cache and completion/failure receipts. A failed
attempt can be partially applied; the current attempted cache is identified and
the same plan cannot be retried. Investigate, then create a new inspected plan
under the existing authorization. Do not delete receipts to enable a retry.

The locks serialize cooperating deployment tools; they are not a claim of
atomic protection against unrelated privileged filesystem writers. Unsupported
system-config layouts fail closed and must be diagnosed, never chmodded to fit.

After success compare filesystem available bytes, current version, PM2 identities,
proxy/static references and history hashes. Compilation caches are regenerable;
runtime code, `.next/static`, `.next/server`, fetch/image caches, source, dependencies,
environment, merchant uploads, backups and all business records are untouched.

## Retention discipline

- Keep current runtime, the current policy's three rollback anchors, worker/static
  roots and anything referenced by incomplete operations or immutable recovery.
- Do not equate the count of directories with the count of removable versions.
- Inspect cache growth after significant release accumulation or disk thresholds;
  do not rehash all history and perform full-disk scans after every small edit.
- Full release retirement must advance its ownership/recovery proof first; this
  cache-only tool is not authorization for full release or dependency deletion.
- No automatic destructive post-deploy hook is added. Use explicit recorded
  reclamation within the user's authorized storage-cleanup scope.
