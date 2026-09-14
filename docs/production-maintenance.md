# Protected production maintenance

This protocol is for the coordinated client-write ACL cutover. It is not a
general-purpose remote shell, a substitute for backup, or a claim that a server
has entered maintenance merely because a workflow input was confirmed.

When runtime capture is unsupported, use the separately confirmed
**diagnose-runtime** action before retrying the maintenance plan. It inspects
existing disk/process metadata without invoking the PM2 CLI or RPC. Its strict
report contains only fixed classifications, booleans and bounded counts, never
raw environment values, paths, process arguments or credentials. It creates no
maintenance operation, never reports `held`, and cannot authorize a backup,
migration or deployment. Unverified observations remain unverified.
This diagnostic action does not repair or approve the existing PM2 control
transport. Do not retry `plan` or start `prepare` until that transport is bound
to the verified daemon without automatic daemon creation and the reported
runtime compatibility failures have been addressed.

The version 2 diagnostic adds bounded version strings and metadata-only
observations of the daemon's fixed socket/PID paths, native worker descendants,
and a fixed trusted Python interpreter's Unix-socket API availability. It does
not connect to PM2 or execute native worker binaries. `verified` endpoint
metadata is not peer authentication; native classifications are not stop or
restart approval. Missing, unsafe and unreadable observations stay distinct.
The report still cannot establish a maintenance operation or authorize changes.

Version 3 introduced the first fixed rejection reason for Python and a fixed set of
reason counts for unclassified native descendants. The counts must sum to the
unknown descendant count. No path, PID, argument, file content or raw exception
is included. A failed gate stops that observation; collecting reasons does not
permit probing beyond it. Detected identity drift still discards the whole
diagnostic. An unverified executable does not mean Python is absent or that its
socket APIs were tested. These reasons never relax the existing path, owner,
link-count, permission, size or executable checks, and cannot authorize a retry,
peer connection, maintenance operation or release. Consumers reject older or
inconsistent diagnostic schemas instead of silently dropping the reason fields.

Version 4 adds separate `layoutEvidence`, without changing either refusal.
For `target_path`, Python evidence reports a fixed installation-location class,
a strictly bounded filename suffix (NOT an executed Python version), and a
metadata assessment. Only fixed `/usr/bin` and `/usr/local/bin` Python targets
receive further root-owned, canonical-directory and file-attribute checks;
other locations are classified without probing their target. No new interpreter
is executed. Native `file_links` objects receive separate link-count and outcome
counts; each map must sum to the number of rejected objects, not to a guessed
number of filesystem links. Only three fixed esbuild/platform-package pairs
(root, nested, or nested-wrapper with hoisted platform package) are considered.
Both trusted paths must be ordinary executable files with the same device/inode
and exactly two links before their bounded package metadata is read. The two
package names, versions, exact optional dependency and process arguments must
match. A `matched` layout is neither binary provenance nor permission to stop
that process: the original unknown count and `file_links` refusal remain intact.
All private witnesses, including rejected Python target changes and paired-file
changes, participate in the two-observation stability check. Neither layout
evidence nor its matching result may authorize PM2 access, maintenance or release.

Both diagnostic consumers use one metadata-only trusted-Python verifier. Its
entry is fixed at `/usr/bin/python3`. Private proof version 2 explicitly selects
either the ordinary canonical target `/usr/bin/python3` or `/usr/bin/python3.N`
(N is 0 through 9999 with no leading zero), or the one reviewed EL8 layout:
`/usr/libexec/platform-python3.6` paired with
`/usr/libexec/platform-python3.6m`. The latter is never itself an execution
target. Both EL8 files must have identical complete eight-field identities,
including the same device/inode and exactly two links; a third link, different
pair, symlinked pair or changed directory chain is rejected. Ordinary targets
still require one link. No `/usr/local` exception, PATH search, environment
override or fallback is permitted. The proof freezes the fixed entry, target,
optional pair and their root-owned canonical directory chains. Files must be
root-owned, executable, non-writable by other users, and between 1 byte and
64 MiB. The helper never executes a process; package ownership or a layout match
alone grants no maintenance permission.
Consumers recheck the proof immediately before and after their bounded isolated
Python call. Runtime diagnostics also reconcile earlier metadata before the
call; detected drift discards the complete report, never retries the call, and
never exposes the private proof. These checks detect sampled changes; they do
not prevent a privileged writer from racing after verification.
If the fixed entry resolves to an unsupported layout, obtain its canonical
target through the operator's private server terminal before proposing a narrow
compatibility change. Do not guess another path, change the system link, install
an interpreter, or publish arbitrary host paths in the diagnostic log.

## Read-only PM2 peer diagnosis

**diagnose-pm2-peer** is a separate, manually confirmed action using the exact
phrase `CHECK_PRODUCTION_PM2_PEER`. It requires current main, successful push CI
for that exact target, and the exact old build. Operation UUID and deployment
run/attempt inputs must be empty. Unlike metadata-only `diagnose-runtime`, this
action connects to the frozen daemon's fixed Unix socket, authenticates its
process identity, and makes one fixed read-only `getVersion` request. It does
not invoke or initialize the PM2 CLI, create a daemon, choose another socket,
retry a connection, or perform a process mutation.

Its public report has state `pm2-peer-diagnosed` and no operation UUID.
`diagnostics` contains only `version: 1`, `maintenance: "not_verified"`,
`peerVerified: true | null`, and a strict PM2 version string or `null`. Paths,
PIDs, UIDs, environment values and raw RPC responses are never public. An
unconfirmed observation remains unknown, not a successful peer verification.

Even a successful result proves only the sampled peer identity and version.
It is not `held` evidence, does not approve arbitrary PM2 methods, and cannot
authorize prepare, backup, migration, deployment or end. It does not repair or
approve the broader maintenance control transport. No diagnostic result
automatically retries `plan` or starts maintenance.

## Bound maintenance process control

The protected maintenance path uses a connect-only transport for the explicitly
supported PM2 `6.0.14` daemon. It derives the fixed socket from independently
checked daemon metadata, verifies Unix peer credentials and process generation
on that same connection, and verifies the version before each bounded operation.
It never invokes ambient `pm2`, changes `PM2_HOME`, starts another daemon, or
falls back to a CLI. Only the fixed registry reads, exact stop/delete, and the
three fixed candidate/final-Web/final-worker launch configurations are supported.
Unknown metadata, watched/cron-managed processes or incompatible identities are
refused. A pre-read is not a PM2 server-side atomic compare-and-swap; old writer
drain and the independently verified ingress fence remain required.

Native worker evidence retains complete eight-field file and directory identities.
Live capture and live verification compare all fields. Only files-only historical
verification, used alongside independent stopped-process checks, allows entry
metadata changes in strict ancestors of the frozen runtime: shared ancestors
remain bound by device, inode, owner and full mode, with fresh directory-type,
ownership, non-writability and canonical-path checks. Their historical size,
mtime, ctime and link count may change when sibling releases are built or renamed.
The runtime directory itself, all descendants, binaries and package metadata
remain fully bound. Both fresh observations still compare all eight fields,
and the stored proof is never refreshed. This does not prove process absence,
authorize a live-process rebind, or detect every transient ancestor ABA change.

Controller source worktrees for maintenance, backup, migration and readiness
live under `/var/lib/faolla-maintenance-code/`, not beneath writable `/tmp`.
Creation requires canonical root-owned ancestors with no group/other write,
an existing safe or newly created root-only `0700` source root, and a new `0700`
worktree for the exact run/attempt. Existing unsafe directories are rejected,
never repaired with `chmod`. Cleanup rechecks the fixed path, ownership, exact
commit and clean worktree; it does not remove operation state or change the
application directory's permissions. Temporary output capture is not executable
controller source and remains separately scoped.

New private operations use version 2 and include `revision`, `launchDisk`,
`launchJournal` and `finalDump`. The separately confirmed recovery below is the
only version 2 to version 3 conversion; older state is never silently migrated.
All replacements use the same existing operation lock and the actual previous
revision and byte digest; they require file fsync, atomic rename, parent fsync
and exact readback. This is not filesystem CAS against unrelated root writers,
a power-loss acceptance result, or permission to steal a stale lock.

## One explicit post-launch attempt recovery

`recover-attempt` is a separate, single-use transition for failed Deploy
`34781392661`, attempt 1, against T5
`f3104de19aa59e527c7b94a99850d151448da8cd`. Unlike the older build incident,
this candidate was launched and its confirmed journal cannot be discarded.
Only the exact version 5 `failed-held` revision 15 state with SHA-256
`d8e8abb8926441caef71867c15539fdafcb7cc9dbe0f77bd84ebc9548d39a0f8`
is eligible. Its current symlink points to the **stopped T5 release**, not O.
The operation UUID, original creation, boot, runtime and all four prior audit
objects remain unchanged. Neither T5 nor O may be restarted to recover it.

The separately confirmed deadline is **2026-09-14 04:00 UTC / 06:00 Madrid**.
The authorization was recorded at tool-confirmed 2026-09-13 22:15:38 UTC,
not asserted as an exact user-message timestamp. The fixed confirmation is
`RECOVER_ATTEMPT_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z`.
This does not renew ordinary expired v5 operations or expose configurable TTL,
operation identity, attempt count or deadline inputs. The historical v5 audit
is checked at its recorded observation time only as an immutable predecessor;
every present-time inspection, transition and active v6 operation independently
checks the real clock against the new fixed authorization.

The locked workflow requires a new exact current-main SHA and successful CI,
the allowed T5 source delta, unchanged complete SQL catalog and 56 migration
registry entries (including the original migration execution timestamps).
It revalidates the signed B5/R5 bindings, the separately audited historical
scheduled backup, and the complete fixed deployment history. Downloads precede
the private inspection so the stopped baseline and subsequent history evidence
can remain within their five-minute freshness limits. Inspection proves both
historical process generations stopped, no application listener, the frozen
daemon, registry, files and exact T5 current-link identity. It never starts a
process, changes the symlink or writes the operation state.

One existing-lock, raw-byte/revision compare-and-replace appends v6. The entire
original v5 object, including all consumed launch fields, is stored in the
immutable `attemptRecovery.predecessor`. The flat active fields belong to
`activeAttempt: 1`, initially with no launch; they do not erase attempt 0.
Every writer preserves the predecessor and audits. Only the exact v5-to-v6
builder permits this append, and v6 cannot be reset for another attempt or
target. New nonces cannot reuse predecessor nonces. The existing durable
planned/attempted/confirmed journal and lost-ACK handling still gate every send.
Failures remain closed and cannot automatically authorize another attempt.

Private deployment handoff retains the original O proof separately, while its
27 `PREVIOUS_*` disk/environment fields identify the actual stopped T5 release.
Its environment identities are T5's, never O's identities mixed with a T5 path;
the original worker's enabled/stopped semantics remain those frozen from O.
This is a disk baseline, not permission to restart either historical writer.
Ordinary non-recovery handoff remains unchanged. Fresh backup, readiness and
deployment certificates must bind the new unique, immutable target and the
same operation; certificates for failed T5 cannot finish active attempt 1.
The existing final worker, persisted dump, signed-deploy and public checks are
still required before ending maintenance.

The active checks also continue to exclude the stopped T5 generation after the
new candidate and final worker start. This historical-generation observation
does not assert an empty port: the existing candidate proof separately binds
the new listener. Frozen T5 files, original PID generation, cwd scan and two
stable complete registry observations must still match.

If an already-authorized v6 start/end/fail-held invocation fails after its
deadline, that same in-memory object may make **one protective reclosure** under
its still-owned operation lock. The capability is anchored to the previously
validated WeakMap snapshot, original ingress/runtime/token and real boot; it
does not reload an expired state or substitute an old clock. Its once-only flag
is consumed before the installation attempt. It cannot restore entry, start a
process, extend authority, save expired state or certify held. An uncertain
ordinary save must not prevent this narrowly scoped closure. This is not crash
recovery: after SIGKILL, a lost lock or a new expired invocation, that in-memory
capability is unavailable and independent operator recovery remains necessary.

Booking verification now emits only bounded fixed stage/code/elapsed diagnostics
to the workflow's strict filter. Raw SQL errors, environment values and process
identities are not published. The SQL, 60-second deadline and decision order
are unchanged. Candidate snapshots avoid the controller's duplicate candidate
verification because the mandatory runtime snapshot reader already performs
the complete verification and a final fresh registry read. No cross-call cache
or "already verified" bypass is introduced. Timing diagnostics showed a real
duplicate cost; they do not uniquely establish the previous failure's cause.

## Explicit failed-build compatibility recovery

`recover-build` is a third, separate audited transition for the failed T3 build
`34728263285`, attempt 1. It does not retry or broaden either earlier recovery.
The exact GNU SWC 16.3.4 binary requires GLIBC 2.29 and 2.30, while this EL8 host
provides 2.28. The compatible build uses `next build --webpack` and the exact
integrity-pinned `@next/swc-wasm-nodejs` 16.3.4 development dependency. Before
building, `prepare-next-wasm.mjs` checks the lock and all five package file hashes
and prepares Next's normal fallback directory. It does not patch Next, upgrade
host libraries, disable type checking or change application authorization.

Webpack also validates route-module exports. The 51 affected routes retain their
complete original implementation byte-for-byte in sibling `route-handler.ts`
files. Each route entry retains exactly its original configuration literals and
HTTP method exports. The associated tests change only these fixed import/source
paths. A separate source proof verifies every original-handler blob, exact route
facade and fixed test mapping; this is not permission for other application edits.
The async bundle check retains the original 1250/760 KiB limits. A Webpack global
manifest is restricted to `app/admin/AdminClientLoader.tsx -> ./AdminClient`;
missing/invalid evidence is not replaced with an unrelated smaller entry. The
legacy per-admin manifest retains its original largest-entry selection.

The action requires `RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T220000Z`, original U/O,
previous target `46f007fbd9e417f93c01e398c77cf38ec814547d`, and a distinct T5
which is current main with exact successful push CI. Only version 4 failed-held
revision 7 with state digest
`56d5c39c287ec24ce96fb40943d283bee19a950462e7c384934b6461b42c5ffa`
and five null launch fields is admitted. Boot, original creation time,
frozen runtime/ingress/database proofs and both previous audits remain intact.
Historical T4 `13df917416cf06ce27fce021460b08caf50f6165` identifies the separately
reviewed scheduled-backup source, not the new T5 deployment target.
The user explicitly authorized the current extension at `2026-09-13T17:08:40.000Z`
until **`2026-09-13T22:00:00.000Z` (2026-09-14 00:00 Madrid)**. The immutable
version 2 `deadlineExtension` also retains `priorAuthorization` with the earlier
`2026-09-13T05:45:22.000Z` authorization and `2026-09-13T10:00:00.000Z` cutoff.
That earlier recovery failed during read-only inspection, so its extension was
not persisted. The original deadline `2026-09-13T06:00:34.129Z`, U, T3 and exact
predecessor digest remain recorded without resetting `createdAt`. It is a
fixed incident audit, not a configurable duration or permission to renew again.
Only the explicit build-recovery actions for this exact predecessor, and valid
version 5 states carrying this exact audit, use the new deadline. Ordinary
version 2/3/4 commands retain their original expiry. At the new deadline, the
operation is expired (the comparison is exclusive, with no extra 34 seconds).

The old audit chain is structurally validated with an explicitly named
`historicalAuditClock`, fixed at `priorAuthorization.authorizedAt` within the old
validity window, not the new 17:08:40 authorization. This is not a current-health
check and never replaces the real clock:
all actual-clock/boot checks, fresh held probes, five-minute evidence freshness
and persistence checks still use the present time and fixed new deadline.

The PM2 compatibility exception is restricted to the original pinned boot and
original frozen daemon digest
`940d18ed1876a97c6523b56bc213be2c426c89348630527392d9d795dadef6c4`.
Only the historical `/proc` virtual inode number, modification timestamp and
change timestamp may differ. All other nine process fields and the five
remaining procfs identity components (device, size, link count, UID and mode)
remain exact. This comparison does not establish process-control authority:
fresh-to-fresh identity checks, actual boot checks and the authenticated PM2 peer
checks remain unchanged. Candidate proofs retain the original daemon proof;
neither a new observation nor this exception refreshes the persisted proof.
The source allowlist adds only the continuity helper, runtime and PM2 adapter
with their corresponding tests; it does not admit adjacent process tools.

Read-only inspection and final transition each recheck the actual held ingress,
stopped runtime, quiet database, narrow source delta and unchanged complete
56-entry migration registry. Package changes admit only the exact build command
and one pinned WASM package; no existing dependency may change. The original
044-048 migration run/window below remains authoritative and is not rerun.
Under the shared production lock, the runner verifies the signed original T3
backup (`34724943157`) and readiness (`34728212357`) bindings without retargeting
them. Complete paginated B/M/R/D history preserves the seven known incident
runs B2/M/R2/D2/B3/R3/D3 after the original cutoff and permits only the separately
authorized scheduled backup `34745334237`, attempt 1, from exact T4. Its fixed
job/timestamps, three skipped held checks, off-mode binding with null operation
and old-SHA fields, hosted-runner signatures, live artifact metadata and eight
hard-pinned small evidence files must agree. This exception neither replaces
B3/R3 nor downloads the database payload. Its specification and verified
evidence digests are retained in the immutable build-recovery audit. Every other
new run, scheduled backup, queued work, cancellation or rerun still fails closed.

A five-minute grant binds that evidence, exact state bytes/revision, both prior
audit digests, exact extension digest and current source/registry/CI. One existing-lock compare-and-replace
produces version 5 held revision 8 and adds an immutable `buildRecovery` audit
and the fixed `deadlineExtension`. All subsequent state and launch-journal
writes preserve all four audits. An
uncertain write is not replayed or cleaned up by guessing. No process starts and
no ingress opens during recovery. There is no UUID replacement, creation-time
reset, automatic renewal or extension beyond the specifically authorized cutoff.

After confirmed recovery, use a **fresh T5 backup**, **fresh T5 readiness**, normal
deployment and signed deploy verification before explicit `end` and public smoke.
The earlier artifacts remain incident evidence, not a reusable T5 release chain.

## Explicit post-migration unlaunched continuation

`continue-held` is a separate, manually confirmed incident transition. It does
not broaden `recover-held` or reinterpret its pre-migration evidence. It exists
for operation `eb81284a-09c4-4514-8f16-38eaf6acc1e4`, whose T2 deployment
`34721317710`, attempt 1, failed before any candidate was launched. The diagnosed
cause was the deploy handoff child's fixed `/usr/bin:/bin` PATH: EL8's ingress
verification tools reside in `/usr/sbin` and `/sbin`. The corrected child uses
the fixed `/usr/sbin:/usr/bin:/sbin:/bin`, never the caller's ambient PATH.
A failed handoff emits only `deploy_preflight_maintenance_handoff_failed`.

The action requires `CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE`, original U/O,
previous target `b7c3d57f4739846fb45f236ef83b97b7ff21a7cf`, and a distinct T3
which is current main with exact successful push CI. Only the original version
3 held revision 4 is admitted; all five launch fields must remain null. The
original T1-to-T2 recovery audit, boot, runtime, ingress, database identity,
creation time and twelve-hour deadline remain unchanged.

Under the shared production workflow lock, a read-only `inspect-continuation`
checks the real held state and an exact deployment/controller/evidence/test/docs
source allowlist. T2 and T3 migration Git objects must be identical. A bounded
read-only registry transaction requires the entire exact 56-entry ordered
registry, not just migration 048: the first 51 entries predate U, and migrations
044 through 048 must fall within the independently verified migration run
`34721155156` apply step, `[2026-09-12T21:52:38Z, 2026-09-12T21:52:46Z)`.

The runner verifies the original signed T2 backup binding (`34715932102`) and
readiness binding (`34721256683`) through exact GitHub workflow/source/ref
attestation policy. Complete paginated B/M/R/D histories must contain precisely
those known incident attempts during this maintenance window; other runs must
have completed before U's entire creation second. Exact job outcomes and step
timings prove migration completion and the failed deployment's pre-launch
position. Unknown activity, reruns, missing pages or shifted identities refuse
continuation. The five-minute grant binds these proofs, original state byte
digest/revision, original recovery digest, registry/source digests and new CI.

`continue-held` rechecks source, registry and full held evidence, then performs
one locked compare-and-replace to version 4 held revision 5, target T3. It retains
the immutable original recovery audit and adds a separate immutable continuation
audit. It neither changes migration results nor launches or opens anything.
Every subsequent launch-journal/state update must preserve both audits.
An uncertain result requires read-only reconciliation, never a blind replay.

After the confirmed transition, create a **fresh T3 backup** and **fresh T3
readiness**, then use normal deployment and verified `end`. Do not rerun the
already applied, unchanged migrations. Original T2 artifacts are incident
evidence only and cannot be relabeled or used as the T3 release chain. There is
no automatic retarget, TTL extension, new UUID, downgrade or old-runtime reopen.

## Explicit pre-migration failed-held recovery

`recover-held` is a one-time, manually confirmed transition, not a retry of
`prepare`, an arbitrary retarget, or permission to reopen production. It requires
`RECOVER_PRODUCTION_MAINTENANCE`, the original operation UUID and old build, the
original `previous_target_sha` (T1), and an exact current-main target (T2) with
successful push CI. It runs only on attempt 1 under the same `production-deploy`
workflow concurrency lock as backup, migration, readiness and deployment.

The remote `inspect-recovery` phase is read-only. Only an unexpired version 2
`failed-held` operation on the original boot is eligible; candidate, resumed,
launch-disk, launch-journal and final-dump fields must all still be null. Actual
ingress isolation, stopped original processes and database quiet must pass.
The executing clean T2 checkout must descend from T1 and differ only through
the exact recovery/probe/controller/test/documentation file allowlist. No app,
migration, dependency, deletion, rename, symlink or file-mode change is accepted.
The source proof binds the exact old/new Git blob IDs, not just file names.

The database proof uses a fixed read-only, timeout-bounded transaction against
the frozen database identity. It hashes the complete ordered migration registry
metadata, refuses any applied timestamp later than the original operation
creation (including microseconds), and requires the cutover migration to remain
absent. It never reads application records or executes a migration.

The runner then independently rechecks current main and successful exact CI,
and reads complete, bounded GitHub histories for backup, migration, readiness
and deployment through the configured authenticated API. Any run/attempt active
or updated in the original maintenance window is refused regardless of outcome;
missing pages, inventory changes and unknown metadata fail closed. The resulting
five-minute grant binds U, O, T1, T2, the original state bytes/revision/creation,
source and registry digests, this workflow run/attempt, CI run and history digest.
An inspection or a well-shaped grant is not itself a `held` receipt.

The remote `recover-held` phase rechecks those original bytes/revision and fresh
source, registry, ingress, process and database evidence under the existing
private operation lock. A single compare-and-replace writes version 3 `held`
with target T2 and an immutable recovery audit. All original frozen identities,
credentials, operation UUID and creation time remain unchanged. The original
12-hour maintenance deadline is never extended. Subsequent state replacements
must retain the recovery audit; downgrade, rebind and replay are refused.

No service start, ingress opening, backup, migration or automatic retry occurs
during recovery. Unknown write/SSH outcomes require read-only reconciliation,
not another recovery invocation. After a verified T2 `held` receipt, start a
**new** backup and the normal migration/readiness/deployment chain bound to
T2/U/O. T1 artifacts cannot be reused. Only normal verified `end` may reopen.

The REST root health probe retains a fresh nonce and no-cache headers but uses
PostgREST filter syntax `faolla_maintenance_probe=eq.<uuid>`. A raw UUID is parsed
as an invalid filter by PostgREST, not as an ignored cache-buster. The scheduler
CI fixture includes a separate real PostgREST 14.5 regression against only its
owned disposable network-none database namespace; this proves REST parser
compatibility, not the production Kong/Nginx path or production maintenance.

Positive Auth settings and REST root probes have a 15-second whole-request and
body-read deadline: the observed cold gateway path can return valid JSON just
after eight seconds. All blocked-route probes, including the token-bearing
out-of-allowlist negative, retain eight seconds. Status, body shape, nonce,
credential scope, redirect refusal and zero-retry requirements are unchanged;
test-only timeout injection can only shorten these deadlines. This is a bounded
probe-budget correction, not evidence that gateway DNS latency has been repaired.
Recovery still requires actual successful fresh requests and the original TTL.

Before sending a launch, one unique nonce is persisted through separate empty,
planned and attempted journal states. Only an acknowledged attempted write
permits one send. Lost ACKs and unknown outcomes never authorize another launch;
reconciliation may only confirm the original nonce, environment digest and
complete observed process generation. Confirmation records identity, not health
or `held`. Registration verifies an already journaled candidate rather than
adopting an independently started process. During partial final-resume cleanup,
the runtime checkpoints actual complete Web/worker proofs, including controlled
native descendants, into this same state before deleting them. A failed
checkpoint remains unknown; missing proofs are never fabricated from a PID or
an error string.

Before reopening ingress, `end` saves and verifies the final PM2 dump using the
same bound peer. The fixed private `dump.pm2` and `dump.pm2.bak` files retain the
full non-module process environments, while public receipts contain only
identities, hashes and counts. The previous primary is backed up before the
new primary is replaced. Current restart configuration is compared privately,
not merely its filtered public metadata: only the four top-level `axm_actions`,
`axm_monitor`, `axm_options` and `axm_dynamic` telemetry fields, which PM2 6.0.14
reinitializes on launch, are excluded from that comparison. The saved file
still retains their original full bytes under its exact hash/identity; nested
environment fields with those names and every other configuration field remain
strictly compared. Both file persistence and subsequent exact
verification must succeed before ingress restoration. The two-file sequence is
not a transaction: ambiguous replacement never triggers an automatic retry,
rollback to an older dump, or reopening. The verified dump proof is saved as
`finalDump` in the operation state; it is not itself a health certificate.

## Release order

1. Merge the reviewed exact candidate and require successful push CI, including
   the disposable PostgreSQL and isolated maintenance-ingress acceptance jobs.
2. Run **Production Maintenance / plan** with the exact candidate and old build.
   It only captures the runtime, routing, firewall and database prerequisites.
   Unsupported topology is a stop condition before traffic or services change.
3. Announce the agreed maintenance window, then run **prepare**. Preserve its
   operation UUID. Only `held` confirms identified old writers are stopped,
   old Nginx workers have drained, ingress has real closed-response evidence,
   and the database quiet/scheduler checks passed.
4. Run the protected encrypted backup and isolated restore rehearsal, controlled
   migrations, readiness and deployment with that same UUID and exact candidate.
   Every new run has a signed explicit maintenance/off binding. Missing binding
   is never interpreted as permission to fall back to an online release.
5. The deployment verifies the new Web with background work paused and keeps
   the independent worker stopped. Internal REST/Auth and application checks
   remain real; ordinary external access remains closed.
6. Run **end** only with the exact successful maintenance deployment run and
   attempt. It checks the final ACL boundary, resumes only the verified new
   runtime, durably saves and verifies its PM2 dump, reopens the identified
   ingress, then performs real public smoke.

`check-runtime-held` is an internal deployment checkpoint paired with the
separately verified readiness transaction. It does **not** certify database
quiet and cannot replace `check-held` in backup or migration workflows.

## Safety and failure boundaries

- Private host state and the control token live under root-only
  `/var/lib/faolla-maintenance/<app>/`. They are not uploaded as release evidence.
  The token authorizes only narrowly specified real public-origin probes and is
  never placed in the application's environment or printed in logs.
- Only frozen runtime/process/container identities and exact owned firewall or
  Nginx changes may be acted on. Unknown services, changed configuration,
  unexpected database schedulers and unsupported network backends cause refusal.
- Failed transitions remain failures. `failed-held` means the closed/stopped
  state was independently rechecked; `failed-unknown` means it was not confirmed.
  A failed prepare still publishes only its bound operation UUID/build metadata
  for diagnosis. Never treat that diagnostic as release or backup evidence.
- There is no automatic restart of the old writer after migration. A failed
  window may therefore need a reviewed forward repair and exceed the estimate.
  There is no general pre-migration abort/resume-old command in this version.
- Do not reboot the host, restart its process manager, change Docker networking
  or alter Nginx/firewall configuration during the window. A boot or identity
  change invalidates the operation. This version does not promise automatic
  host-reboot recovery or persistence of the transient firewall rules.
- Workflow cancellation attempts to reclose an already-opened end transition;
  a forcibly terminated runner/SSH session cannot guarantee remote cleanup.
- Operation locks are never stolen automatically. Completed operation evidence
  is deliberately not overwritten; a later window needs separately reviewed
  archival. Retained root-only Nginx includes permit exact failure reclosure.

Pure tests use injected hosts and never operate production. Passing them is not
proof that the real host is supported: the real read-only plan is mandatory.

## Existing Nginx and nf_tables compatibility

The ingress adapter preserves the installed network architecture. Nginx has two
closed profiles: `/usr/sbin/nginx` with `/etc/nginx/nginx.conf`, or the BaoTa
binary and configuration under `/www/server/nginx`. The latter may read only
its fixed configuration root and the panel's `vhost/nginx` and `vhost/rewrite`
roots. The host network namespace, master process generation and executable
are bound before using the same absolute binary for tests or reloads. Container
OpenResty masters and their workers are not part of that host process proof.

Original configuration bytes (including CRLF), include membership, ownership
and parent identities remain frozen. Empty stream includes stay monitored;
adding a stream route invalidates the plan. An unselected cohost's conditional
Lua is parsed as opaque code and is never modified or admitted in a selected
Faolla server or inherited scope. This is routing separation, not a sandbox
against a malicious privileged cohost program. Control routes must resolve to
the frozen Kong target via proven exact or `^~` prefix locations; arbitrary
rewrites, scripts, URI remapping and ambiguous regex precedence are refused.
QUIC listeners must share their server and port with a verified TLS listener.

An existing runtime may retain a raw HTTP IPv4 Supabase endpoint while its
Faolla HTTPS browser session already uses the same-origin Nginx gateway.
Maintenance does not rewrite that runtime setting. Only the reviewed legacy
shape (global IPv4, HTTP port 8000, root path, no credentials/query/fragment)
selects the fixed `https://faolla.com/` maintenance candidate; all other HTTP
shapes are refused. The real ingress capture must then prove that candidate's
control routes reach the frozen Kong before persisting an operation. Readiness
probes and deployment endpoint hashes use this same active-state-bound HTTPS
gateway. Normal non-maintenance behavior, internal health endpoints and frozen
runtime/environment digests remain unchanged. The maintenance token is never
sent to the raw HTTP endpoint.

The nf_tables backend captures the full nft JSON ruleset plus all three
iptables/ip6tables/ebtables compatibility saves, including versions. Old nft
releases may report opaque `xt: null`; the complete compatibility saves are
therefore required, not discarded. Only recognized packet/byte counters and
save timestamps are normalized. An operation creates one independently owned
`inet` table at filter priority 200; existing tables, policies and firewalld or
Docker services are not changed. Later or colliding base chains, flowtables,
offload and unsupported expressions cause refusal. The fence covers published
ports and the thirteen frozen container destinations; only four explicit
service directions and their established reply direction remain allowed.

Before any Nginx write, the frozen baseline and any existing operation-owned
table must match exactly. Installation uses an atomic fail-if-present create
batch; a partial or foreign table is never adopted. Restore removes only that
verified table, then requires the original baseline again. It never flushes or
replays the host ruleset. The fixed nft batch uses the pre/post-verified Python
interpreter to provide a real OS pipe: Node's socket-backed stdin is rejected
by supported nft releases. Rule content is never placed in process arguments,
a shell command or a temporary file, and a failed write is not replayed.
Read-only interface and kernel qdisc observations also
reject XDP, ingress/clsact and unreviewed classifier-capable qdiscs. This uses
the fixed trusted Python interpreter and GET-only netlink, not installation of
`tc`, deletion of filters, or an assumption based on an `ip link` label.

Network proof version 2 has one narrowly reviewed exception: the exact kernel
`4.18.0-348.7.1.el8_5.x86_64` may have default `mq` roots and hidden `fq_codel`
children, all with handle zero. Every child must map exactly to `1..N`, where
`N` is the independently observed interface TX queue count, not the number of
returned qdisc rows. Two complete hidden-inclusive qdisc dumps and surrounding
interface observations must agree, and verification repeats the capture.
The evidence is named `kernel_default_mq_unaddressable`: the reviewed kernel
creates fresh, private classifier blocks for these children, and its TC API
cannot address them through the zero handle or `mq` root. It is not an empty
filter-query result. Root `fq_codel`, nonzero child handles, a different kernel,
missing queues or an attempted version-1 downgrade are refused. This relies on
the same trusted-OS assumption as the other host proofs, not protection against
kernel tampering or later privileged network changes.
The exact vendor source archive is bound by SHA-1
`a3793e19a4f8237adb530a9ea1230ccafdf2c2ff` in its
[source metadata](https://git.almalinux.org/jonathan/kernel/src/commit/ba708d9db898f657f7e2d80c39343f5e01f65fb2/.kernel.metadata);
the reviewed paths are `net/sched/{sch_api,cls_api,sch_mq,sch_generic,sch_fq_codel}.c`.

Public HTTP probes allow at most one permanent HTTP-to-HTTPS upgrade, without
credentials, to the same host, path and query on HTTPS port 443. The destination
must actually return 503. Control-token probes never follow a redirect. The
isolated Linux CI job tests real nft installation, data-plane blocking, limited
service connectivity, table restoration, and generated Nginx syntax/HTTP gates.
This dedicated Ubuntu 24.04 job suppresses package service startup and explicitly
loads `br_netfilter` once on its disposable CI host. The runner requires Linux
6.x before initializing the two per-network-namespace bridge sysctls inside its
independently verified new namespace. It reads the parent's original values and
requires them to remain unchanged even when the child fails; it never repairs
parent state. This CI setup is not a production action: production only reads
these prerequisites and refuses if they are unavailable or disabled.
Its disposable Ubuntu binary test is not a claim to have tested a production
BaoTa installation; the real protected plan and subsequent held checks remain
mandatory. No snapshot prevents a later privileged administrator or service
from changing the host: configuration changes during the window are prohibited
and invalidate the operation when detected.

## Incident-bound second attempt after D6

The `recover-second-attempt` action is a separate, one-use recovery for the
exact failed v6 operation at revision 23, digest
`785a4139be1cc78b42fd0a9e2dde619d995f0b2f1be521589ec31fd900c0db75`.
The authorization was acknowledged at 2026-09-14 02:01:33 UTC. It permits one
additional attempt before the unchanged 04:00 UTC deadline, not an extension.
The fixed confirmation is
`RECOVER_SECOND_ATTEMPT_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z`.

This creates v7/revision 24/activeAttempt 2 only through one raw-byte/revision
compare-and-swap under the existing operation lock. Its `secondAttemptRecovery`
audit retains the complete v6 predecessor, including the original v5 history
and both consumed launch journals. No journal is reset or hidden. The new
active launch fields begin empty; the old fields remain immutable in the
predecessor. All previous targets and nonces are forbidden for the new launch.
Any uncertain persistence result forbids a send or retry. A later failed
attempt cannot return to held or obtain another attempt through this action.

Before recovery, independently verify the exact stopped T6 current pointer,
O/T5/T6 process and disk identities, full database migration registry, original
ingress, fresh source delta and current-main CI. Verify signed B6/R6 bindings,
the earlier authorized scheduled-backup evidence and the complete workflow
history from the original operation cutoff. Additional scheduled runs are not
silently ignored or accepted by a broad history exception. Fresh backup and
readiness evidence must bind to the new exact target before deployment; old
B6/R6 artifacts are historical inputs only, not new-target release evidence.

The new held handoff returns a bounded version-2 report containing the same
27 typed deployment fields and a small exact baseline reference. The complete
private state stays on the server. The reader performs two real observations
and compares both reports; the 262144-byte limit is unchanged. Runtime checks
continuously reject revival of O, T5 and T6 while the new candidate is running,
including before dump, reopening ingress and confirming ended. The private
one-use failure reclose retains original anchors and cannot authorize a late
state write, restart, deadline extension or successful receipt.

The D6 operational failure remains unconfirmed: original inner errors were
not retained. The new fixed-stage fence diagnostics record only allowlisted
stage/result/elapsed values, never SQL, credentials, state tokens or raw errors.
SQL, lock policy, retry limits and deadlines are unchanged. Local simulations
and tests do not constitute production success; only the real deployment,
signed binding, normal maintenance end and public checks do so.

## Incident-bound budget recovery after D7

The separate `recover-budget` action is limited to the failed v7 operation at
revision 31, activeAttempt 2, with predecessor digest
`a7767b3e1e5a788282c16a57a91ed588821cb0b5894925fcff9d5e544e5d6003`
and target T7 `d9de5fe689226fcdd13a1e95039901b5d0f39167`.
The newly recorded authorization begins at 2026-09-14 07:13:57 UTC and expires
at **2026-09-14 10:00:00 UTC (Madrid 12:00)**, exclusive. It permits at most
one further deployment attempt. Its fixed confirmation is
`RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z`.
It does not alter any previous authorization, including the expired 04:00 UTC
deadline, and does not make ordinary commands on the expired v7 state valid.

D7 (`34802138869`, attempt 1) was rejected by the remaining-budget reserve
check before the booking-persistence SQL ran. This is evidence of a budget
gate failure, not a failed SQL query or database corruption. The earlier D6
inner failure remains unconfirmed; the D7 result does not retrospectively
identify its cause. The budget-remediation change combines the relevant Web
and worker snapshot observations while retaining their real identity, ingress,
generation and registry checks. It does not increase the existing deadlines,
reduce the required reserve, skip the persistence query, or authorize reuse
of cached host evidence. Local cost simulations are not a measurement of the
new candidate's production execution time.

Only `inspect-budget-recovery` and the explicit recovery path can validate
this exact expired predecessor under the new authorization. Historical
validation of the hash-pinned old audits is distinct from current authority:
fresh host observations and persistence use the actual current clock. The
transition creates v8/revision 32/activeAttempt 3, the fourth overall attempt,
through one raw-byte/revision compare-and-swap under the existing operation
lock. The `budgetRecovery` audit retains the complete v7 predecessor and its
consumed launch journal, including all earlier audits and authorizations.
The original operation UUID, creation time, old-runtime proof and existing
history cutoff remain unchanged. New active launch fields start empty; no
old journal, nonce or target becomes reusable. An uncertain save forbids a
send, and this action cannot recover a subsequent failed v8 attempt again.

Recovery requires fresh stopped-generation and disk/current-pointer evidence
for O/T5/T6/T7, the original ingress and database proofs, the complete migration
registry, exact allowed source delta, current-main CI and complete workflow
history. B7 (`34800653808`) and R7 (`34802075500`) must retain their verified
hosted signatures and T7/operation bindings; recovery `34800461043` and main
CI `34799821827` remain explicit historical evidence. Migration evidence still
binds to the original `34721155156` migration through 048. The one previously
authorized scheduled backup `34745334237` remains a fixed, separately verified
historical backup, not current release evidence. Its signed predicate expired
at 2026-09-14 08:12:11 UTC. Only this exact subject, with all eight loader file
size/hash pins and hosted-signature checks unchanged, is validated at the real
fixed run completion, 2026-09-13 08:12:22 UTC. The audit records this as
`validationPurpose: historical-only` and `historicalValidationAt`. Actual
current authorization and fresh backup/readiness/deploy expiry checks are not
changed, and no system clock or original record is rewritten.

A further narrowly recorded history authorization begins at 2026-09-14
08:24:49 UTC (the recorded tool-confirmation time). It accounts for exactly
two failed T8 runs, both attempt 1: scheduled backup `34820083043`, whose only
failure was the current-main CI check before SSH setup, and budget recovery
`34821029270`, whose history verification failed while the transition, end
check and reclose steps remained skipped. Each complete run/job/step projection,
including names, numbers, conclusions and timestamps, and its zero-artifact
inventory is pinned and read twice. Both records and this separate authorization
are included in the history digest. The scheduled failure is not a successful
backup; the failed recovery is not a consumed runtime launch. GitHub metadata
proves the step outcomes, while unchanged host state requires the independent
state-byte observation. Neither record creates a general exception for failed
or scheduled runs; all unknown activity still fails the original history gate.
The original 07:13:57 budget authorization, 10:00 UTC deadline, one-use runtime
budget and all earlier audit objects remain unchanged.

Implementation and local tests alone do not establish recovery or deployment
success. Real paired-check performance, successful recovery, a new exact-target
backup and readiness run, the single automatic deployment, signed deployment
binding, normal maintenance `end`, and final public checks remain pending until
each is actually observed and verified. B7/R7 are historical inputs, not
substitutes for those new release artifacts. Failure does not grant an automatic
retry or extend the 10:00 UTC deadline.

## One unused-attempt window renewal on 2026-09-14

The recorded authorization at `2026-09-14T12:31:04Z` permits the existing,
unused active attempt 3 only until `2026-09-14T16:00:00Z` (18:00 Madrid).
It does not add an attempt, reset a launch journal, or rewrite the expired
10:00 authorization. `renew-window` requires the fixed confirmation
`RENEW_PRODUCTION_MAINTENANCE_UNTIL_20260914T160000Z`, the same operation and
original build, previous target T9 `3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0`,
and a new exact main commit with all ten successful push-CI jobs.

The predecessor must be the exact initial held v8/revision 32, all five launch
fields null, 1,570,550 bytes and SHA256
`333658652c3dc9e244b7c30848abb716c133f3b5bf0220ea9deab255e696667e`.
The flat v9 audit reconstructs those entire predecessor bytes and retains all
earlier authorizations and evidence; it does not nest another full state copy.
Actual stopped-generation, ingress and database checks, fresh bounded evidence,
the existing operation lock and raw-byte/revision CAS remain required.

Historical recovery `34825984301/1` and its main CI `34824742841/1` are checked
again, including every recovery step and all ten CI jobs. Backup
`34826545330/1` transferred its encrypted payload, verified it and passed an
isolated restore, but failed the final held-maintenance check after 10:00;
its three maintenance-binding steps were skipped. Its exact thirty steps and
six-artifact inventory are historical failure evidence, **not a valid new
deployment backup**. No encrypted payload is downloaded by renewal verification.
The current host state is established by separate read-only checks, not inferred
from GitHub job conclusions.

The renewal history chains from the fixed successful v8 recovery at 09:04:41 UTC.
It enumerates every page of backup, migration, readiness, deploy and maintenance
activity twice. Unknown activity, an older run updated or retried across this
anchor, missing pages, changed totals or altered fixed records fail closed.
Only the exact currently running renewal workflow may be in progress. Earlier
history remains authenticated by the complete immutable predecessor hash.
Fresh backup, readiness, the one unused deployment and successful end are still
required; a renewal alone is not a deployment-completion claim. B8's transfer
alone took 1h44m36s, so completion within the new window is not guaranteed and
no deadline or verification may be bypassed to fit it.

The actual-shaped read-only preflight measured about 3.7 seconds per partial
snapshot before live-candidate I/O. Fifteen required snapshot boundaries would
leave insufficient margin inside the former 60-second whole-proof budget.
Maintenance mode therefore uses one fixed 120-second absolute deadline for the
entire booking proof; ordinary mode retains 60 seconds. This is not a longer SQL
timeout: the 10-second query timeout, 60-second per-verification cap, 20+5-second
minimum post-proof reserve and at most two read-only query attempts remain.
All before/after identity, fence, environment and health checks remain required.
Before initial maintenance web capture, the same fence calculation reserves the
full 120 seconds plus its unchanged 780-second cleanup allowance, checkpoint and
margin. The fence still has its original 1,320-second maximum and this operation
still expires at 16:00 UTC. A timeout or any drift fails closed; a larger bounded
proof budget is not permission to retry a process launch or omit verification.

## Fixed Supabase 15 scheduler compatibility

The exact `supabase/postgres:15.8.1.085` image uses an additional read-only
profile. Other images retain the original quiet SQL. A failed new-profile
observation never falls back to that original query or authorizes maintenance.
The profile requires PostgreSQL 15.8, Vault 0.3.1, the available TimescaleDB
2.16.1 and pg_tle 1.4.0 versions, and only the reviewed extension/preload sets.
Both databases reject unknown extensions; Vault, when present, must be 0.3.1.

Every initial capture and held quiet check requires precisely the two
connectable, non-template databases `postgres` and `_supabase`. Their names and
numeric OIDs are checked before and after that observation. Each database must
have complete read-only visibility, no TimescaleDB, TimescaleDB OSM or pg_tle
extension, and no TimescaleDB catalog/configuration schema. The caller binds
each query to the same frozen running container; the secondary connection uses
the existing configured database credential and a fixed database-name argument,
never SQL interpolation or a caller-selected endpoint.

The main-database query additionally requires both pg_tle authentication/password
features to be `off`, no pg_tle background worker, and no TimescaleDB worker
except its exact background launcher. It retains the absent cron job table,
matching cron database, disabled subscriptions, complete activity visibility,
cluster-wide transaction/prepared counts, and frozen primary database OID checks.
All queries use bounded read-only transactions and a catalog-only search path.
Unknown results, extra databases, incomplete visibility and observed drift fail
closed. No extension, configuration, job, credential or running database process
is modified to satisfy these checks.

This is a task-source check, not a claim that PostgreSQL has no background
processes or that independent database queries form one transaction snapshot.
The TimescaleDB launcher can still inspect catalogs; the reviewed loader starts
a scheduler only where its extension is installed. The secondary database OID
is checked within each observation, not persisted as an operation-wide snapshot.
Ingress closure, stopped business processes, repeated held checks and the ban
on concurrent privileged configuration changes remain mandatory.

The image's fixed build source is
[`b2c91b0a`](https://github.com/supabase/postgres/tree/b2c91b0a29332cec79473ee8a6dfa0e205cd0aaa).
The review follows its Nix extension pins, not unused Docker build arguments:
[TimescaleDB loader](https://github.com/timescale/timescaledb/blob/2.16.1/src/loader/bgw_launcher.c),
[pg_tle client authentication](https://github.com/aws/pg_tle/blob/v1.4.0/src/clientauth.c),
[pg_tle password checks](https://github.com/aws/pg_tle/blob/v1.4.0/src/passcheck.c),
[Vault initialization](https://github.com/supabase/vault/blob/6e0cd916242d922a646e4d611cc215e09dd429f4/src/supabase_vault.c),
[plan_filter](https://github.com/pgexperts/pg_plan_filter/blob/5081a7b5cb890876e67d8e7486b6a64c38c9a492/plan_filter.c),
and [plpgsql_check](https://github.com/okbob/plpgsql_check/tree/7e23f9daa6b5408151aaec197c6cf6c948e23957).
The latter hooks can perform synchronous work when explicitly invoked; they are
not described as universally read-only or a replacement for the writer fence.
