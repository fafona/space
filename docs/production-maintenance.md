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

The private operation state is version 2 and includes `revision`, `launchDisk`,
`launchJournal` and `finalDump`. Older state is rejected, not silently migrated.
All replacements use the same existing operation lock and the actual previous
revision and byte digest; they require file fsync, atomic rename, parent fsync
and exact readback. This is not filesystem CAS against unrelated root writers,
a power-loss acceptance result, or permission to steal a stale lock.

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
