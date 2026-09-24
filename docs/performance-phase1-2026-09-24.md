# Performance phase 1 — implementation and release evidence

## Scope and source

- Working tree: `D:/merchant-space-qr-export-release-20260923`.
- Starting commit: `9f99df06dbcc60ee2a2d2ff1732462e71d447ebc`.
- Its source tree matches the previously verified live release `4a7b2c52e1e02cbc3c1628d00224629e0a601224`.
- This batch does not change API authorization, database schema, saved business data,
  order/payment/points transactions, booking automation, dependencies, or workers.
- Production read-only audit at `2026-09-24T17:03:29Z` confirmed the live build
  above, maintenance `ended`, approximately 59 GiB available, and existing
  processes online. No cleanup or production load tests were run.
- Publication remains pending until the exact reviewed main build has passed
  candidate acceptance and public verification; local tests alone are not a release.

## Implemented root-cause fixes

### Attention refresh

The owner admin shell previously scheduled full booking/order list reads every
60 seconds regardless of visibility or an outstanding prior read. Responses
could write persistent cache before checking whether the old effect was cancelled.

`startVisiblePolling` now provides:

- One in-flight request per mounted effect, including loaders that ignore abort.
- No new polling while the document is hidden; an in-flight fetch is aborted.
- Coalesced visibility/focus/pageshow recovery without bypassing fresh intervals.
- Abort on cleanup, with the actual attention callbacks checking the signal after
  JSON parsing and before cache or React state changes.
- Explicit 20-second client request timeout; timeout does not prove server work
  was cancelled and does not authorize another overlapping client request.
- Successful refresh: next request 60 seconds after completion.
- Failed refresh: 120/240/300-second capped backoff, reset after success.
- Existing cold-start idle scheduling (2.4-second deadline, 1-second fallback),
  cached first display, endpoint authorization and order 403 behavior retained.

Hidden-page badge values remain at their last known value until foreground
refresh. Existing hidden/resume notification suppression is unchanged. This is
not a new summary API and does not remove full historical reads from the server.

### Intent-based loading

The admin shell no longer automatically loads the business-card editor and
printer panel after a fixed delay on every desktop workspace visit. Their
existing click, pointer-hover and keyboard-focus loading paths remain available.

### Customer management

- Customer identity groups now append to request-local arrays rather than
  copying a growing array for every historical activity. Candidate order,
  merge rules and all output fields are unchanged; tests retain pre-change
  full-output fingerprints including a 2,000-order customer.
- Spreadsheet parsing/template code is imported only upon an explicit action.
  A shared synchronous action lock, busy state and error recovery prevent
  duplicate preparation/submission. New asynchronous preparation is invalidated
  on unmount/site change; obsolete completion cannot unlock a newer operation.
- Exactly one responsive list is constructed. The existing large-screen
  breakpoint is retained with a hydration-safe external-store subscription;
  edit state remains outside the layout branch.

No server-side pagination, customer read model, or import data semantics changed.

### Measurement contract

Existing telemetry mixed uniform session sampling with always-reported slow/poor
events. New events carry `perf_v=2`, `sample=slo|diagnostic`, `sample_rate`,
`report_rate`, `sample_unit=session|event`, and an explicit timing phase.

- To compute an unweighted SLO distribution, select `perf_v=2` and `sample=slo`,
  separated by metric kind/name, phase, deployment/device and sampling unit.
  Slow/error events within the uniform cohort remain in that cohort.
- Diagnostic-only events are not another observation in the SLO cohort.
- Historical unlabelled events have not been rewritten or corrected.
- Existing `phase=headers` means fetch-to-response-headers. The customer GET now
  uses `fetchJsonWithAdminPerformance`, reporting `phase=json` through body
  download and parsing. It consumes the original body once, preserves the
  original Response/status, and sends at most one metric. Explicit null fallback
  preserves the customer's previous JSON-error handling; network errors still
  reject. Neither phase measures React commit or first usable content.
- No percentile dashboard changes are included here.
- Existing event transport and reporting probabilities are retained. Metadata
  honors the 240-character downstream reason limit including the rating prefix.
- Telemetry context failure cannot replace the original response/request error.

## Validation

- Candidate-focused suite: 114 passed before the final cross-site preparation
  regression fix. Final complete-suite and typecheck results are recorded below
  when complete; earlier checks must not be represented as final-code evidence.
- Targeted ESLint: zero errors; five existing navigation warnings in unchanged
  portions of `AdminClient.tsx`, one existing unused-variable warning in the
  release controller. New utility/customer/telemetry files are clean.
- `git diff --check` passed.
- Strict encoding check passed.
- Full-project `tsc --noEmit --incremental false` passed on the final runtime code.
- Isolated real-browser acceptance uses the actual customer component, installed
  Tailwind and synthetic customers, without credentials or production requests.
  Initial page and opening the import dialog request no spreadsheet chunk;
  clicking Download Template requests exactly one lazy spreadsheet chunk.
  Search narrows 36 records to one. At 390 x 844 the table is absent and the
  mobile article is present; the open editor's unsaved value survives the switch.
  The temporary viewport override was reset. This is not full admin-shell visual
  acceptance, authenticated production acceptance, or capacity validation.
- Independent review identified cancellation-state revival on A -> B -> A
  merchant switching during lazy preparation. Cancellation now clears only its
  matching UI token; file and template regressions failed before the fix and
  passed after it. Final independent runtime/release review: 50 tests passed.
  The rebuilt real-browser harness also verified delayed template preparation
  across A -> B -> A: both preparation controls remain enabled and the dialog
  can be closed. No browser console errors were observed.
- Historical CI failed on three assertions: a historical 56-migration repair
  fixture had started reading today's 59-entry directory, and two card tests
  assumed adjacent HTML attributes. Only those test files were corrected:
  the exact historical catalog is frozen and expanded catalogs still rejected;
  all website destinations and the analytics marker are asserted independent of
  attribute order. Runtime guards/navigation are unchanged. The 17 corrected
  tests passed; this does not retroactively mark earlier CI runs green.

Local dependencies are a junction to the existing hardening worktree, after
checking exact lockfile SHA-256 equality. This is suitable for unit tests and
typechecking only. The guarded build rejects dependency-directory junctions;
do not relax that guard or run the fallback preparation against shared deps.

## Publication boundary

The user's continuation in response to the prior explicit release-scope question
authorizes the narrow performance lane. A separate exact 22-file allowlist was
added; it does not widen the traffic or QR lanes. Tests reject database, API,
authentication, permission, dependency, transaction, worker and mixed-feature
changes. `database` fails before any backup/migration/candidate operation;
`stage -> ready-no-database -> activate` retains the guarded build, process/config
ownership checks, immutable assets, original workers, smoke tests and rollback.
Analytics settings and signing secrets are inherited without changes. Reconfirm
current main and live identity before staging; publish a clean main-based branch,
not the historical QR feature lineage. Do not bypass protected reviews/checks.

## Remaining optimization work

This is not completion of the overall performance plan. Lightweight indexed
summaries, genuine server-side customer/product pagination, indexed personal
orders, incremental customer aggregation, bounded order transactions, independent
booking scheduling, end-to-end experience baselines and scale validation remain
separate stages requiring their own correctness and publication review.

## Phase 1 production verification

- PR #161: all ten CI jobs passed on `173f5fe70999f7c6480c935baef115713f8b787b`
  ([run 36033644353](https://github.com/fafona/space/actions/runs/36033644353)).
- Squash main `eb55ee14ccac47f9573e8491516bd1c598c7eb32` was verified to have
  exactly the same source tree. Server-focused regressions passed 116/116;
  guarded build, private candidate smoke and public acceptance all passed.
- Activated at `2026-09-24T18:06:22.464Z`. Independent recheck at
  `2026-09-24T18:07:48.728Z` found the exact public build, HTTP 200 on merchant
  and console login, maintenance still `ended`, and every original PM2 process
  PID/cwd/status preserved. The controller checked 25 public static assets.
- The `database` action was not used. No saved data, schema, worker, old release
  or asset cleanup was performed. Approximately 56 GiB remained available.
- Admin async entry was 1,077.9 KiB before and 1,078.9 KiB after; both pass the
  existing budget. This is not a smaller admin entry bundle: the intended
  savings are avoided unsolicited lazy downloads, background work and repeated
  customer processing. No production latency percentage or capacity claim is
  inferred from these bytes.
- The actual webpack customer-manager async entry changed from 442,641 bytes
  across two files to 34,008 bytes in one file. The new explicit spreadsheet
  import entry is 415,662 bytes across two files. These are uncompressed build
  artifact sizes from the two retained releases, not measured transfer bytes
  or whole-page latency. Browser acceptance separately verified that ordinary
  customer-list use and opening the import dialog do not request the workbook.

## Follow-up: deep customer identity chains

Offline synthetic growth testing after phase 1 found a pre-existing recursive
union-find stack overflow for a single customer with 10,000 order records.
It reproduces in both the original baseline and phase 1. This is not evidence
that production currently has such a customer or has lost data.

The follow-up scope is confined to iterative two-pass root lookup/path
compression in `merchantCustomers.ts`, its existing test file and these notes.
Union direction, identity tokens, profile precedence, stable ordering, totals
and input immutability must remain unchanged. No API, write path, customer
record, permission, database object or configuration is changed. The existing
exact performance no-database release lane covers these same files.

Publication of this follow-up is separate from the already deployed phase 1;
tests and new release evidence are required before claiming the overflow fixed
in production. This correction still does not provide server-side pagination
or remove full-history reads.

The 20,000-activity single-token regression failed with `RangeError` before the
correction and passed after it. It checks all result fields against the original
37-activity fingerprint (adjusting only counts/totals) and verifies unchanged
input bytes. Transitive multi-token grouping, foreign-merchant bridge exclusion,
stable ties and existing full-output fingerprints also pass. The root reran the
complete candidate-focused suite: 119/119 passed, zero skips/failures. Full-project
TypeScript, focused ESLint, strict encoding and `git diff --check` passed.
