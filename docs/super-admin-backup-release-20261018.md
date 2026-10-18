# Super-admin backup acknowledgement release (2026-10-18)

User-approved, no-maintenance, no-database publication from the live
`9a877c86de64b094aa9268d9c03fb0ccec57b926` application. Only two runtime files and
their three regression files are allowed. Existing merged checker-only changes
must match the pinned reviewed revision. No authentication, restore journal,
unknown-result protection, database, dependency or worker changes are admitted.

The automatic snapshot normalizer must omit absent optional public image keys.
The client accepts only the exact declared backupScope contract on successful
backup acknowledgements; unexpected or ambiguous responses still stop writes.

Use normal PR and required CI, verify main CI for the exact merged SHA, then the
reviewed sparse controller: `stage SHA BASELINE`, followed by `activate SHA`.
The database action is forbidden. One separate candidate uses unchanged copied
dependencies and the existing enforced build sandbox (4 GiB memory, 3072 MiB
Node heap, one CPU, 128 tasks, 20 minutes, no swap, private network). Admission
requires at least 6 GiB available memory and 20 GiB free disk. Never lower these
limits, stop production services, or reset failed release state.

Seal the inherited runtime configuration and exact environment-file delta;
only candidate identity, PWD and the existing worker-pause controls may differ.
Recheck source, dependency and build evidence before switching. Candidate and
public checks cover unauthenticated backup API denial, the existing contact
card/vCard, attendance 401s and test-harness 404s. Never submit a production
backup or merchant configuration merely as a smoke test. Successful publication
updates only retention bookkeeping; no automatic retirement or artifact cleanup.
Ownership-checked nginx reload and rollback, old static assets and live workers
remain unchanged. Preserve all failure evidence; this lane grants no recovery
bypass or automatic retry of an unfinished candidate.
