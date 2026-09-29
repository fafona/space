# Bounded post-publication artifact reclamation

## Root cause and authorization

Process retirement already maintained current + one verified stable rollback,
but did not reclaim dependencies, webpack caches or repeated source/download
copies. Preparing each new source-only controller also left previous controllers
on disk. Stopping a process alone therefore did not bound deployment disk use.
PM2 `save` can leave a pre-stop online entry in its backup dump, which was a
separate recovery-reference blocker rather than permission to ignore the dump.

The user approved continuing from the completed historical cleanup to automatic
future publication housekeeping on 2026-09-29. This is a narrowly scoped exception
to the default no-automatic-destructive-cleanup rule, not permission to prune
business data, failed releases, Docker, logs, backups, workers or static assets.

## Application lifecycle

1. The existing candidate build, public checks and active-state persistence run
   unchanged while the previous application stays online.
2. Existing retention advances current + one stable rollback and certifies the
   single now-obsolete web process as stopped.
3. Only a `completed` retention result containing that **newly retired SHA** can
   invoke artifact reclamation. The latest validated v2 certificate, active SHA,
   full PM2 process set, protected paths and held lock capability must agree.
4. Preserve raw primary/backup PM2 dumps privately. If needed, atomically replace
   only the certified victim's stale backup entry with its verified stopped
   primary entry. No second `pm2 save`, restart or registration deletion occurs.
5. Remove only that exact worktree's `node_modules`, `.next/cache/webpack` and
   Git-identical materialized source. Four recovery/source manifests remain in
   sparse checkout; the root, `.git`, configuration, runtime link and complete
   non-webpack `.next` content, including old immutable static assets, remain.
6. Recheck unchanged operational observations and retained-content digests;
   record actual filesystem space before/after and a completion receipt.

The current and stable rollback runtimes remain complete and directly runnable.
The extra supporting processes (worker/base, contact-card, supporting web) are
not spare rollback versions and are not candidates. Historical reduced trees
require source restoration, dependency installation and a rebuild to run again.

The publisher holds the same deployment flock and operation lock throughout.
Housekeeping runs **outside** the activation rollback catch. Any failure reports
`online_artifact_housekeeping` with `status: pending`; it does not rewrite the
successful active state or withdraw a healthy release. A prepared/partial attempt
is retained for diagnosis, not erased or automatically retried. Rolled-back or
unresolved releases do not become stable merely because a cleanup was attempted.

## Reference and recovery proofs

- Reuse the strict history/resource observer: live processes, current/rollback,
  proxy/static roots, mounts, schedules, pending states and Git registrations.
- Check process environment/maps/FDs, both PM2 dumps, scheduled configuration and
  Docker mount/command references. Secrets are not printed.
- Inspect actual live consumer code roots for delayed-loading symlink references,
  including links into another known code root. Unknown external code-directory
  links defer reclamation; the declared shared runtime data link is never walked.
- Capture only the selected victim's source/blob manifest and generated-tree
  fingerprint. Internal hardlinks require every name to be inside the removed
  tree; unsafe owners/modes, external links, extra files or changed identities stop
  the operation. No permission repair is performed automatically.
- Delete individually checked leaves and empty child directories. Keep source
  objects reachable from main; do not copy whole source/build/dependency archives.
- Evidence is private under `/var/lib/faolla-online-artifact-reclaim/ACTIVE-VICTIM`.
  The original state/certificates and main dump are not rewritten. Configuration
  backups require the same access protection as other private operational data.

## Tool lifecycle

The existing synchronous tool preparation function still verifies/reuses the
exact reviewed main SHA. Its CLI subsequently loads housekeeping from that
verified prepared tool and reacquires the shared preparation locks.

Keep the new tool and nearest existing ancestor tool. At most one older source-only
tool is reclaimed per invocation, after exact detached registration, sparse index,
tracked blob, ignored-file and reference checks. Running tools and tools referenced
by unresolved operations are protected even if that temporarily exceeds two.
No `--force`, broad root removal or failed-attempt reset is available. Preparation
success remains success; deferred tool cleanup is separately reported.

## Installation and cost

This is scripts/docs-only. Use the normal reviewed merge and prepare the merged
source-only tool; **do not build/redeploy the application, run npm install on the
server or enter maintenance** to activate this behavior. The current manual online
entrypoint is `online-traffic-release.mjs`; the unrelated historical full-deploy
workflow is not modified or advertised as using this lifecycle.

Read-only installation acceptance:

```sh
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-artifact-cleanup.mjs inspect TOOL_SHA
```

This checks the installed tool and operational state without replaying a previous
retirement. The first real subsequent successful publication exercises the new
automatic removal path; fixture tests are not a claim of a real production removal.

There is one candidate, no historical batch scan of source/dependency contents,
no additional build/install, no copied runtime archive and no extra public probe
suite. Full operational/reference observations occur initially, immediately before
deletion and after it. Intermediate evidence/backup checks use the held lock and
saved-dump fingerprints. Live-consumer link metadata is checked without reading
regular file contents or traversing shared business data. A strict fixed elapsed
time is not promised.

The retained static files, certificates and small audit records can still grow;
this change prevents gigabyte-scale repeated runtime/tool accumulation, not every
possible byte of growth. Their independent retention policy must preserve old
browser compatibility and recovery/audit requirements.
