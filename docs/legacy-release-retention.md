# Legacy release cleanup without service interruption

The target retention policy is the current public application plus one verified
stable rollback. Supporting worker, contact-card and static-serving processes
are not disposable application backups. This first cleanup only removes
unreferenced pre-online release trees; it does not claim that the online process
retention policy has already converged to two versions.

## Scope and evidence

`scripts/legacy-release-cleanup.mjs` accepts only exact direct children of
`/www/wwwroot/merchant-space.releases` named `12hex-14digits`. It cannot remove
online/route releases, Git worktrees, shared business data, active code or backups.
The tool must run from the clean source-only tool for current `origin/main`.

Read-only inspection checks live and saved PM2 state, process references,
Nginx/static paths, mounts, schedulers, containers, Git worktrees, shared links,
online rollback proofs and historical maintenance/recovery evidence. An archived
failed operation is closed only by its exact immutable restoration/abort proof;
its records are never rewritten or deleted. Unknown or changing evidence fails
closed. Dates alone never authorize deletion.

Inspection writes a private plan under `/var/lib/faolla-legacy-release-audit`.
Before any deletion, all regular files other than generated `node_modules` and
`.next` runtime output are preserved in a content-addressed, deduplicated archive.
This includes source, configuration snapshots, public assets, diagnostic files
and **all `.next/static` files**. Archive files are mode 0600 inside mode 0700
directories; they can contain private configuration and must never be published.
Manifests record original paths, permissions and hashes. Blob contents and
directory entries are fsynced before deletion may start.

## Explicit two-step operation

Run low priority with a bounded Node heap, using the reviewed full tool SHA:

```sh
nice -n 15 ionice -c 2 -n 7 node --max-old-space-size=256 \
  /var/lib/faolla-online-code/TOOL_SHA/scripts/legacy-release-cleanup.mjs inspect TOOL_SHA
```

Review the exact candidate paths, excluded references, preserved archive size and
returned plan ID/hash. Apply only that unchanged plan, within 24 hours:

```sh
nice -n 15 ionice -c 2 -n 7 node --max-old-space-size=256 \
  /var/lib/faolla-online-code/TOOL_SHA/scripts/legacy-release-cleanup.mjs apply TOOL_SHA PLAN_ID PLAN_SHA256
```

Apply holds the existing deployment and operation locks, revalidates every tree
and archive, then unlinks only approved leaves bottom-up. It never follows the
`.runtime` link into business data. Every removed tree has a receipt. Changes or
partial failure stop the operation; an attempted plan cannot be rerun silently.
There is no recursive shell deletion, service restart, maintenance mode, database
write, PM2 mutation, Nginx mutation or historical-proof rewrite.

Afterwards verify unchanged live release/PIDs, maintenance ended, public health
and actual filesystem free space. Report archive overhead separately from
removed logical bytes. Removed runtime trees are no longer instant rollback
targets: preserved files can be reconstructed from manifests, while dependencies
and server build output require a rebuild. Current and verified rollback runtimes
remain untouched.

## Remaining online retention work

Reducing online versions requires a versioned append-only retention contract
across publication, activation, rollback, process retirement and cleanup. Old
certificates and recovery identities must remain valid. Never substitute an
age-based deletion loop or change a numeric retention constant in isolation.
Source-only operational updates do not rebuild or redeploy the application.
