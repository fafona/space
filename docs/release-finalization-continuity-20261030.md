# Release finalization: bounded immutable checks and parent-exit capture

## Evidence and scope

This tool-only change follows the audited independent recovery of publication
`5871a892-48f7-4c14-a4e8-40e8f2111953`. The recovered old application is still
public. The failed publication, original operation inode, partial retention
journal, immutable application builds and backups remain preserved.

Two distinct problems were reproduced:

1. Finalization nested the same historical tool scan and complete application /
   dependency / build byte scan inside repeated live observations. The original
   watchdog reached its 420-second recovery boundary with an unfinished journal.
2. The general strict process collector rejects PPID changing between its two
   reads. That is correct for strict ownership chains, but the inherited
   supervisor explicitly permits its own parent to exit. Comparing with a
   reparentable policy *after* the strict capture cannot handle that transition.

The historical error was `process_identity_drift`; its exact field was not
logged. A real parent-exit reproduction proves this failure mode, not that this
was uniquely the historical drift field.

## Changes

- The general supervision collector is unchanged. A dedicated read-only double
  capture permits only PPID differences, with no retry or discarded failure.
  Same birth, UID, proc identity, exact command bytes/digest, executable and cwd
  identities are still required. Only existing reparentable policies use it.
- A private, non-serializable operation context fully byte-attests the two fixed
  retained builds **before** opening the mutable publication window. Each use
  checks nanosecond file/tree witnesses, path ancestry, internal symlinks,
  actual Git HEAD and clean status. Source/dependency/build changes fail closed.
  Only the original `.next/cache` and `.next/trace` exclusions remain. The
  context closes after its operation; standalone observers still scan bytes.
- A historical closure lookup may reuse the genuine reviewed execution source
  context, which still checks CI freshness and every source/directory witness.
  Without that context it executes the original full source inspection.
- Every canonical publication stage writes fixed-name start/end timing records
  once its private publication directory exists. Failures retain the existing
  original error path; no automatic retry or deadline extension was added.

The original 600-second window, 420-second watchdog boundary, recovery reserve,
90-second drain, all-worker origin gate, fresh backup, actual database / PM2 /
FD / TLS checks and independent public verification remain unchanged.

## Measured owned checks (not publication acceptance)

On the actual Node 20.20.1 host, using only disposable owned subprocesses and
read-only application access:

- Strict capture rejected actual parent exit inside one capture.
- Dedicated capture accepted that same-birth parent transition.
- Dedicated capture still rejected an actual command transition.
- Original full retained-application scan: 8,024.6 ms.
- New one-time admission, outside the mutable window: 10,088.5 ms.
- Six repeated continuity checks: 468.7–485.8 ms; all returned exactly the
  independently byte-verified application result.

These measurements do **not** prove the complete publication budget or close
the pending journal. Full path acceptance and the separate audited disposition
of the recovered incomplete records are required before a new publication.

## Completion criteria

Do not describe the release path as mature or the booking release as published
until all of these are true:

1. Local and exact PR/main CI tests, real kernel/process/native acceptance and
   independently inspected artifacts pass.
2. Recovered incomplete records have an audited disposition, preserving original
   files/inodes and without fabricating the failed publication's certificate.
3. Current-state preparation, qualification and worker provenance are verified
   before a fresh window. No old lease, source, backup or activation is replayed.
4. The complete actual publication fits the unchanged time bounds and writes a
   genuine retention certificate, worker-gate receipt and final completion.
5. Both public domains serve the new retained build, its natural background
   worker cycle is observed, and mail remains disabled.
