# Protected production maintenance

This protocol is for the coordinated client-write ACL cutover. It is not a
general-purpose remote shell, a substitute for backup, or a claim that a server
has entered maintenance merely because a workflow input was confirmed.

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
