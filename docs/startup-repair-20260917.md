# Startup attribution repair — 2026-09-17

Authorized incident: deploy 35165126333, attempt 1, operation
78124069-9a5c-4eb5-aaaf-fe80ef1db2b1. The exact predecessor is v3/revision 17,
failed-held, digest bc0bad0e702c17a544cbbffc8e16682b839abecf73b001d25971bc8dfdecce73.
Its paused-web launch was confirmed during failure reconciliation and then stopped.
The current link names dd05aa7ba128-20260917000706; it is NOT an unlaunched build.

## Reproduction and correction

A private, synthetic Next 16.3.4 application was built with the same installed
dependencies, with its own PM2 daemon, random test port and no business data or
database credentials. The first real socket snapshot reported `mismatch` while
the version endpoint was already healthy; subsequent snapshots reported a single
directly owned listener with the same process generation and PM2 metadata.
A plain HTTP fixture did not show that startup transition.

The old parser conflated nonempty `ss` output with no visible PID and multiple
known PIDs. These now have distinct `unattributed` and `mismatch` states.
Only absent/unattributed observations can wait, within the original 60-second
budget and same immutable launch. No additional launch is sent. Known foreign or
multiple owners, restart/generation changes, and expired budgets still fail.
An unattributed socket never satisfies steady-state supervision, capture or
confirmation. Synthetic negative tests and real Next startup CI are mandatory.

The first main CI exposed a harness ownership mismatch: hosted checkouts are
runner-owned, while the actual production adapter requires root-owned helper
files and every ancestor. The mandatory acceptance now uses a fresh private
root-owned copy of scripts, installed dependencies and the same Node binary on
the disposable hosted runner. It does not change checkout ownership, override
helper proofs or weaken the production adapter. Its opt-in also requires the
hosted-runner marker and root identity. Production state was not changed by
this failed CI.
The private toolchain copy includes npm, invoked explicitly with the copied Node
binary rather than relying on the runner's PATH. This acceptance runs before the
long maintenance regression, while all existing checks remain mandatory.

## Recovery boundaries

One hosted, signed repair is bound to the exact failed run, source delta, all ten
successful main CI jobs, original signed backup 35163641695 and readiness
35165044304, and the unchanged complete migration ledger. It holds both original
locks, verifies ingress, old runtime, failed candidate and database quiet twice,
and archives the complete predecessor and authority without overwriting.

Only after those checks, it atomically restores the current link to the frozen
old, stopped a06a5921e2fa-20260916054114 release. It does not start it. Then the
original bytes/revision CAS writes revision 18, held, a new reviewed target,
empty active launch slots and an immutable startupRepair audit containing the
ENTIRE consumed predecessor. Original token, deadline, database, ingress and
both older recovery audits remain intact. All later state writes validate this
audit. All held/candidate/end gates also reject reappearance of the retired
candidate. No release or database is deleted by the repair.

A crash between link replacement and state CAS stays closed and requires explicit
diagnosis; it never permits automatic launch or a blind rerun. Deployment still
requires a fresh complete backup and readiness chain, followed by ordinary signed
deployment and maintenance-end. Do not run end or the old pinned postcheck before
the matching new deployment succeeds. Actual Google authorization remains an
independent browser/user verification after the site reopens.
