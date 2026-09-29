# Current + one stable rollback (online retention v2)

## Scope and invariants

This is an operational tool change, not an application release. Install the
reviewed, merged source-only tool; do not rebuild the site or enter maintenance
to enable it. The website, database, uploads, nginx configuration, workers and
historical v1 proofs are not modified by the retention writer.

The protected **online web** window is the current public release plus one
verified stable rollback. Base/automation/contact-card/supporting-web processes
are separate dependencies, not disposable old web versions. They stay protected.
An old `status: active` state alone does not mean a version is currently serving.

Initialization records the existing adjacent current/rollback window without
stopping anything. Retirement requires a complete observation proving the
specific extra web process is outside that window, is an ancestor of the current
release, has no proxy route or established connection, and runs only paused web
work. Each operation stops exactly one PM2 id and persists the result. All other
PM2 identities, source/environment proofs and relevant host state must remain
unchanged. It neither deletes the PM2 registration nor its files.

## Reviewed installation and initial convergence

Use the existing `prepare-online-release-tool.mjs` to prepare the exact merged
`origin/main` revision at `/var/lib/faolla-online-code/TOOL_SHA`. Do not patch a
prepared tool, alter the live base checkout, or pass a tool SHA as a fake future
application release. Retention separates tool revision from actual application
revision explicitly.

```sh
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-retention-writer.mjs inspect initialize TOOL_SHA ACTIVE_SHA
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-retention-writer.mjs initialize TOOL_SHA ACTIVE_SHA
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-retention-writer.mjs inspect retire TOOL_SHA ACTIVE_SHA OLD_SHA
node /var/lib/faolla-online-code/TOOL_SHA/scripts/online-release-retention-writer.mjs retire TOOL_SHA ACTIVE_SHA OLD_SHA
```

`inspect` is read-only. Execute retirement only for the exact inspected candidate
within the approved cleanup scope. Historic excess versions are inspected
individually, never stopped by an unbounded loop. After each operation verify the
receipt, current public build, unchanged retained processes and the remaining
window. Busy locks, unexpected references or changed state stop the operation.

## Subsequent publication and rollback

The publisher holds the deployment flock and operation lock through every
awaited step. It snapshots the retention head when staging. A successfully
published application first passes the existing public checks and persists its
active state. Only then does post-publication housekeeping advance the window
and retire the single now-obsolete rollback process. A housekeeping failure is
reported as pending; it does **not** roll back a healthy application or repeat a
stop. More than one historic extra requires explicit inspection.

Restoring the stable rollback records the exact current retention head in the
failed release state. The next publication must carry that failed state and its
original before/after proxy evidence. It retains the restored stable release,
not the failed newer release, as the next rollback. A failed or interrupted
candidate is not silently certified as stable. Unknown leftover candidates or
incomplete operations fail closed and require diagnosis.

`onlinePublicationLane` removes only an exact reviewed list of operational
support paths before applying the unchanged application lane policy. An
ops-only diff still cannot initiate an application build. Unknown scripts,
authentication, migrations and dependency changes do not gain new permission.

## Durable evidence and interrupted operations

Evidence is private and append-only under `/var/lib/faolla-online-retention`.
Each numbered entry contains preparation, before/after observations, recovery
PM2 data and a completion certificate. A separately stored durable head at
`/var/lib/faolla-online-retention.head.json` binds the complete history, detecting
tail removal and preventing fallback to legacy behavior when v2 is malformed.

The writer fsyncs and reads back evidence before advancing the head. Public
readers reject incomplete entries and mismatched pins. No automatic stop retry,
history deletion or permission relaxation is provided. If **all five** evidence
files were completed but the head update was interrupted, the explicit
`reconcile TOOL_SHA` command can advance only that exact prior pin after proving
the complete tail and unchanged host again. It does not stop, save or restart
any process. Earlier partial attempts require separate manual diagnosis.

## Disk cleanup is a distinct operation

Stopping old processes releases runtime resources; it is not a claim that their
disk trees were deleted. The cache observer understands complete v2 certificates
and protects current + one (instead of the old three-anchor policy), while
retaining all existing mount/process/scheduler/static/pending-operation guards.
An exactly certified stopped process can become eligible for the existing
explicit webpack-cache cleanup plan/apply flow.

Full old online runtime/dependency removal is **not** authorized by a stop
certificate alone. PM2 persistence, recovery records, worktree registration and
old-browser static resources require a separate archival cleanup proof. Do not
delete those trees or claim that only two directories remain. The completed
15-directory legacy cleanup is recorded separately in
`release-space-cleanup-20260929.md`.
