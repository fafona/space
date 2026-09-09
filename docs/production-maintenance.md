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
entry is fixed at `/usr/bin/python3`; canonical targets remain limited to that
path or `/usr/bin/python3.N`, where N is 0 through 9999 with no leading zero.
There is no `/usr/local` exception, PATH search, environment override or fallback.
The private proof freezes both canonical directory chains and the entry/target
identities (device, inode, size, modification/change times, link count, UID and
mode). Files must be root-owned, single-link, executable, non-writable by other
users, and between 1 byte and 64 MiB. The helper never executes a process.
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

## Release order

1. Merge the reviewed exact candidate and require successful push CI, including
   the disposable PostgreSQL acceptance jobs.
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
   runtime, reopens the identified ingress, then performs real public smoke.

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
