# Booking merge CPU release preparation — 2026-09-27

This note records a release-policy change, not a production deployment or a
server acceptance result. No database, provider, data, running process or live
proxy was touched during local implementation/testing.

## Local release-policy evidence

Before the later pre-build recovery addition, the five release/retention suites
passed **293/293** tests:

```powershell
node --test scripts/online-traffic-release.test.mjs scripts/online-release-retirement-policy.test.mjs scripts/online-release-retirement.test.mjs scripts/online-release-rolling-policy.test.mjs scripts/online-release-rolling.test.mjs
```

This comprises 64 release-adapter tests, 155 unchanged single-retirement tests
and 74 new rolling tests. The adapter tests execute the actual retained-process,
candidate-source/environment and proxy activation/rollback function bodies.
Two successive synthetic release histories use the real rolling validators and
process normalizer, including original thin historical snapshots, new complete
snapshots, all three adjacent rollback edges, ancestry/target mismatch rejection,
and third-anchor identity protection after cutover. Injected process, filesystem,
HTTP and command boundaries do not establish production PM2/nginx acceptance.

The 23 focused suites selected by the actual `booking-merge-cpu` stage branch,
plus its unchanged QR-preview and canonical-auth suites, separately completed
323 tests: **322 passed, one skipped**. The skip is the existing Linux real
descriptor/chmod proof on this Windows machine. The release suite above supplies
the third common stage suite. The original four retirement files have no byte
changes. Syntax, strict encoding and scoped ESLint checks passed with no errors;
ESLint retains the pre-existing unused `candidateEnvironment(s)` parameter
warning. Required CI and the actual production build/candidate/public checks
remain outstanding release gates, not results inferred from local tests.

The already-reviewed CPU implementation at `82a9c13e` changes only three hunks
in `merchantBookingPersistenceStore.ts`: one per-call date-parse memo and its
two uses. The four original function hashes and full old-file inverse remain
pinned by the parity suites. No booking writer, capacity calculation, authority,
identity, notification, ordering or read-repair behavior is changed by this lane.

From deployed `0004c202`, the reviewed closure is exactly ten existing files
(four CPU and six CI), plus four release-policy files, four new bounded rolling
files and this note: 19 paths. Adjacent runtime/auth/SQL/migration/dependency
paths and all four original single-retirement files remain excluded.

Reproduce the CPU checkpoint locally with:

```powershell
node --import tsx --test src/lib/merchantBookingPersistenceStore.test.ts src/lib/merchantBookingMergeParity.test.ts src/app/api/merchant-customers/route.booking-merge.test.ts src/app/api/merchant-customers/route.test.ts src/lib/merchantCustomers.test.ts src/lib/merchantCustomerDirectoryStore.test.ts src/lib/merchantBookings.test.ts
```

Those seven suites passed 78 tests at the CPU checkpoint. The GET fixture runs
the real route, customer aggregation and booking-store entrypoints against
synthetic identity/data/clock and external I/O. Its cancelled-booking and empty
other-source fixtures do not constitute real authentication, database, provider,
automation-time-boundary or production-latency acceptance. Parse-count savings
are limited to the persistence merge, not all date parsing in a complete GET.

The new lane additionally runs public/customer compatibility, CI contracts,
QR/auth/static release safety and the original plus new rolling-policy suites.
The real production build, strict environment/bundle checks, required CI,
candidate smoke and public post-switch verification remain mandatory on the
exact reviewed source. Local VM/fake-filesystem tests verify controller ordering,
failure isolation and owned rollback; they do not emulate an actual PM2/nginx
release or certify a free production port.

Rolling retirement is a separate explicit command, never a stage side effect.
Complete immutable history binds one stopped registration and all retained
identities. New stage snapshots pin the history head; only completed active
historical rollback may use a verified ancestral birth pin and exact allowed
rollback edge. Current plus two rollback builds, older immutable assets, data
and background jobs remain protected. No maintenance, automatic cleanup or
port-range expansion is authorized.

## Failed pre-build stage and exact recovery

The first production stage of application
`57dbac3ab07899fcca03a17d149c3c717b805d63` failed during focused tests: 377 passed
and 10 failed when concurrent CI discovery encountered the Linux PM2 test
fixture's temporary symlink. No build or candidate process was created; live
`0004c202f1c75bce4241c4185aeb16eb1724b177` and public traffic stayed unchanged.
The separately completed historical-process retirement receipt remains intact.

A subsequent diagnostic on the original clean candidate, with its original
runtime environment and only `--test-concurrency=1` added, passed all 387 tests
in 20.1239 seconds with no skips. This was a test-only diagnosis: it did not alter
stage state, create `.next`, start a candidate or authorize activation. The
recovery entrypoint still reruns every gate and test before building.

The incident-only `resume-booking-stage` pins the original state, runtime, local
environment, retained-history head and candidate tree hashes in
`BOOKING_STAGE_RESUME`. Read-only dependency comparison also found identical
31,303-file inventories, digest
`f12f24a40f70ac0f5c55821268303873826ece213856cb0b8e84f871cd58428e`;
the already-present, pinned Next WASM fallback avoids a first-build dependency
installation. Recovery verifies this same dependency digest and legitimate
internal symlinks before and after build; it neither recopies nor repairs them.

The new current-main tool is allowed to differ from the original application
only in the three release scripts and these two release notes. It runs original
candidate tests/build in the original candidate directory and its own tests in
the tool directory. It adds private attempt/failure evidence but never resets
old state, rewrites candidate source/certificates, stops another process or
silently retries. A successful candidate becomes ready only after the actual
build, retained/source/config/environment checks and normal smoke; activation
remains a separate owned action. This note is not evidence that recovery or
activation has completed.

The recovery change added nine local controller/policy contracts. At that
checkpoint the five release/retention suites passed **302/302** tests; scoped lint reported no
errors (the original unused parameter warning remains), and strict encoding and
diff checks pass. Tests cover the exact incident/tool scope, unchanged complete
26-suite serial invocation, original private byte proofs, ordinary versus
escaping dependency links, missing/changed artifacts, occupied process/port,
test/build failure isolation and the real controller's ready-state ordering.
They use injected I/O and do not substitute for the actual recovery build or
public activation acceptance. The old `finish-stage` branch remains unchanged.

## Pre-build probe failure and separately authorized continuation

The first recovery, using tool
`3d73d081beacdd1856c9170a08294e5a1507be25`, passed the original candidate's 387
focused tests, 229 retirement tests and the newer tool's 73 tests. It then failed
with `fetch failed` at `2026-09-27T21:32:51.679Z` in the second baseline check,
before build. The original state, runtime/environment, tree, dependency and
history hashes remained unchanged; `.next` and the candidate PM2 registration
were absent. Read-only checks found the live baseline healthy, with unchanged
PIDs/restart counts and no OOM evidence. No traffic switch occurred.

Fresh-Node, read-only loopback diagnostics reproduced a stale pooled-socket
failure after consuming a response, yielding once to let the connection enter
the idle pool, then blocking the controller for nine seconds while the server
advertised a five-second keep-alive timeout. The next default fetch failed with
`UND_ERR_SOCKET`; a separate fresh process using `Connection: close` throughout
returned 200, as did a default process allowed to handle socket events after
the blocking interval. This reproduces the failure mechanism, but the original
receipt recorded only `fetch failed`: its precise historical cause cannot be
proved retrospectively. No diagnostic resumed stage, built or started a process.

The approved correction forces `Connection: close` on each controller request,
without an automatic network retry or changes to Host, redirect, status or
timeout checks. New fetch-failure messages retain only a pathname and bounded
safe error identifiers. Original exception text, URL queries, headers, bodies
and environment values are not logged.

The separately authorized `resume-booking-probe-stage` preserves the old
one-attempt guard and uses a new exclusive audit pair. Its additional incident
pins are:

- Prior before receipt SHA-256:
  `b3a6bc00f6a5d632a207953a13e326e29bf962c1210d75e7e1701cae9214586a`.
- Prior failure receipt SHA-256:
  `c27dc12d4fd8213a830389159732c95c6ff590428c5dd29d5782669a78810f65`.
- Prior tool: `3d73d081beacdd1856c9170a08294e5a1507be25`.

The new tool must be clean current main and descend from the prior tool with
only the same five operational paths changed. Both old receipts must retain
their exact raw bytes, private ownership/mode/link properties and incident
fields before the new audit, after tests, after build and before ready. The
original candidate and every original gate remain unchanged. This addition
does not delete evidence, reset state, stop another process, weaken
`finish-stage` or establish production recovery/activation success.

The probe correction and additional continuation passed **307/307** tests in
the same five local suites (zero failures or skips):

```powershell
node --test --test-concurrency=1 scripts/online-traffic-release.test.mjs scripts/online-release-retirement-policy.test.mjs scripts/online-release-retirement.test.mjs scripts/online-release-rolling-policy.test.mjs scripts/online-release-rolling.test.mjs
```

The request test uses the actual controller function and an owned loopback HTTP
child, with real fetch and synchronous child-process delays. It verifies fresh
connections, explicit closure, status rejection and manual redirects. Separate
injected-I/O contracts check timeout/Host/header preservation, safe single-fetch
failure diagnostics, exact prior receipts/tool ancestry and failure isolation
at each continuation gate. This is not production PM2/nginx/build acceptance.
Both scripts pass syntax checks; scoped lint has zero errors and only the
pre-existing unused-parameter warning. Strict encoding and diff checks pass.
