# Booking merge CPU release preparation — 2026-09-27

This note records a release-policy change, not a production deployment or a
server acceptance result. No database, provider, data, running process or live
proxy was touched during local implementation/testing.

## Local release-policy evidence

The final five release/retention suites passed **293/293** tests:

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
