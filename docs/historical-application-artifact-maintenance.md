# Historical application artifact maintenance

The user approved keeping the current website and one verified stable rollback.
Independent booking/automation/contact/static-support processes are separate
dependencies and remain protected. This explicit maintenance entry does not
change the successful publisher or its just-retired-only housekeeping rules.

## Preconditions and scope

Install the reviewed, merged **source-only** revision after both full CI runs.
Do not rebuild/deploy the application, enable maintenance, change dependencies
or touch the database to install this tool. Its difference from the actual
published application is limited to this document and the three exact
`application-release-artifact-maintenance*` source/test files.

For one selected website target, the original complete retention reader and
current+stable window must validate; a unique original completed retirement
certificate and the established reboot/birth corridor must prove its current
stopped registration. Current, rollback, supporting processes, pending-state
references, mounts, schedules, Docker, lazy-loaded links, both PM2 dumps and all
other original reference guards remain blockers. Age or PID zero is not proof.

The published application's original independent auditor must pass before a
plan is issued. Do not pass a fake publication result, replay a stop, rewrite a
historical certificate/state, remove a PM2 registration, relax an old rule, or
reclassify an unresolved candidate as stable.

## Explicit plan and execution

From `/var/lib/faolla-online-code/TOOL_SHA`:

```text
/usr/bin/node scripts/application-release-artifact-maintenance.mjs inspect TOOL_SHA RETIRED_SHA
/usr/bin/node scripts/application-release-artifact-maintenance.mjs apply TOOL_SHA PLAN_ID PLAN_SHA256
```

Inspect the exact single target and returned plan/hash before apply. Apply is
one-shot within 24 hours; it rechecks the original tree, references, recovery
dumps, source and complete operational snapshot under the original deployment
and operation locks. Every attempt preserves private immutable evidence below
`/var/lib/faolla-historical-artifact-reclaim/PLAN_ID`. Failures/partial attempts
are retained and never retried automatically or relabelled as successful.

Only the most recent original retirement may repair its own stale online entry
in the backup PM2 dump, using the original exact single-row replacement helper;
raw primary/backup dumps are preserved first. Older online recovery entries
remain blockers. No `pm2 save`, stop, restart, registration deletion or other
backup-row rewrite is provided by this tool.

The existing checked tree applier removes only that target's dependencies,
webpack cache and Git-identical materialized source. It retains `.git`, four
source-recovery manifests, configuration, runtime data link, complete non-webpack
`.next` content and immutable static files. Source remains reachable from main;
older releases require source restoration, dependencies and rebuild, not instant
rollback. Current and stable rollback remain complete and immediately runnable.

Keep the launching SSH session open through both plan and durable execution
(`systemd-run --wait`, default journal output). On this host, SSH PAM exit removes
the `/run/user/0` tmpfs mount; that legitimately changes the original whole mount
snapshot and must still refuse cleanup. Holding the session stabilizes the host
without masking mount changes or modifying a guard. The durable unit continues
independently; a disconnect still fails closed if the snapshot changes.

After each target, verify its completion receipt and unchanged public version,
current/rollback, original workers, saved PM2 state and actual free disk. Small
static/recovery directories can remain; do not claim that only two directories
remain or silently delete audit logs, backups, isolated databases or user data.
