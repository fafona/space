# CI startup fixture: one observation per logical fact

Baseline: `28c136d27d6f235683cb2eadbf2a5f1fceb34bac`.
Scope: CI-only acceptance fixture, pure test helper, regression tests and this note.
No production source, process-capture guard, workflow, dependency, historical
recovery authority, saved data or live process change is included.

## Evidence and root cause boundary

The exact-tree PR CI run `36095005277` passed all ten jobs. Its post-merge duplicate
`36097154477` failed at `process_identity_drift` during initial `fact(row.pid)`,
before the observation loop. The production capture guard correctly rejects a
process that changes within a guarded read. The log does not identify which field
changed or which capture invocation encountered it. The passing run observed
startup command-line digest transitions followed by verified direct ownership
and health; a title-transition race is supported, but not uniquely proven.

The fixture has a separately provable defect: constructing one ten-field fact
calls `captureProcessFact(pid)` ten times. Its result can combine ten different
moments and expands the race exposure. Regression tests against that exact old
projection failed with ten reads instead of one, and twenty instead of two
across successive observations.

The new CI-only helper captures once, then projects the same ten fields from
that snapshot. Each invocation remains fresh. Capture exceptions propagate
unchanged; there is no catch, retry, delay, cache, partial success or guard bypass.
Raw command-line arguments and extra fields remain excluded from projected facts.

## Safety and acceptance

The real hosted Linux fixture imports the tested helper. Existing root/hosted-runner
opt-ins, process generation/UID/parent/cwd/executable comparisons, PM2 registry
equality, owned direct listener requirement, two healthy verified observations,
deadline and cleanup ownership check remain intact. Production capture bytes and
historical reviewed fixtures are unchanged. This also reduces repeated reads in
the CI fixture, not application database/API requests.

Tests verify coherent single capture, fresh subsequent captures, unchanged error
identity and call count, exact keys/types, input immutability, no raw argv output,
actual fixture wiring and refusal of implicit fixture execution.

This corrects the known mixed-snapshot defect; it does not guarantee that a
legitimate within-capture identity change can never occur. Such a change must
continue to fail closed. New exact-head hosted CI is required before considering
the correction accepted. Previous failed CI remains failed historical evidence.

This change is not a website release and needs no production deployment or
maintenance. Record new PR/main CI results separately after completion.
