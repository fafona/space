# Customer GET scaling: current-runtime baseline

## Scope

This work starts from main `b8e3581037724d96a9a57cafd8e0ea787a87ea37` in an
isolated worktree. The application reference is the deployed booking CPU build
`57dbac3ab07899fcca03a17d149c3c717b805d63`. The source and dependency manifests
are unchanged from that application. Only offline measurement, its tests and
this report are added. No production request, database migration, source-data
write, application endpoint change or deployment belongs to this step.

The question is not whether 50 DOM rows render quickly. It is how much source
work, aggregation and response materialization the actual customer GET repeats
as identities, per-customer history and other merchants' bookings grow.

## Existing work to retain, not rebuild

The isolated, **unmerged** customer-shadow branch at `2f3eb06c` already contains:

- A generation-scoped query/detail store with 50-row summaries and separately
  retrieved full profiles, preserving the manual edit-conflict version.
- Commit-coupled database source observations, captured-source normalization,
  publication, invalidation checks and native synthetic PostgreSQL evidence.
- Inactive booking-authority, winning-preparation and semantic-recovery
  candidates. None of these constitutes live HTTP operation ownership.

Its documents `customer-query-persisted-shadow-2026-09-25.md`,
`customer-captured-shadow-session-2026-09-25.md` and the final checkpoint of
`booking-authority-plan-2026-09-26.md` remain the design/evidence inventory.
They are not publication receipts. Their `primaryEligible:false` restriction
must remain; do not merge the entire branch or install migrations 053–059 just
to make a customer list appear paginated. The earlier in-memory projection
prototype failed its performance gate and is not a proposed production cache.

## Current causal chain

1. The real route authorizes the requested merchant before loading sources.
   It reads saved profiles, orders, bookings and memberships concurrently with
   `Promise.allSettled`. Profiles are mandatory; other source failures remain
   explicit warnings. They are not successful empty source observations.
2. The booking list still invokes automation before filtering/projecting. Its
   three `include…: false` flags omit response fields, not automation. The
   persistence loader merges a shared local/remote multi-merchant document and
   can perform repair writes. Real GET is therefore not a safe read-only probe
   merely because its HTTP method is GET.
3. All four source arrays reach the complete identity-joining customer reducer.
   A new linking record may merge identities; removing one may split them.
   Paginating each source first is not equivalent. Slicing the final array
   after aggregation still performs all source work.
4. The route serializes the complete directory. The existing 50-row browser
   paging bounds rendered rows, not this response or the backend computation.

Do not suppress booking effects, reuse a cached directory by TTL, replace the
manual edit version with a projection generation, or submit lightweight rows
as full editable profiles. Those shortcuts can alter established behavior.

## Reproducible isolated measurement

```sh
node --import tsx scripts/benchmark-merchant-customer-get.mjs --quick
node --import tsx scripts/benchmark-merchant-customer-get.mjs
```

The CLI only accepts the optional `--quick` flag. It accepts no URL, credentials,
site ID, input data path, unbounded sample count or production configuration.
The fixture executes the actual route, reducers and source loaders using an
allowlisted VM module graph. Persistence, session and snapshot inputs are
synthetic; unused network, mutation and delivery dependencies fail closed.
The fixture never imports a default configured database client or reads `.env`.

Scenarios distinguish:

- Empty data and 100 / 1,000 / 10,000 identities shared across four sources.
- One customer with 10,000 orders and 10,000 bookings.
- 100 current-merchant identities alongside 10,000 foreign-merchant bookings.

Bookings are cancelled, time is fixed, and V1 modes are off. The benchmark is
**not** a test of live reminder delivery, every booking state, real authorization,
database wait, PostgREST caps, snapshot caches, browser rendering or concurrency.
No existing booking execution path is disabled in production.

Each case compares phase-wrapped/unwrapped fresh harnesses using complete response
and IO/end-state fingerprints, reports the first request separately, then makes
five repeated GETs in both harnesses and repeats that full parity check each
time. Source hashes identify the executed code; the historical comparison label
is not an automatic Git-object pin. The root separately verifies source equality
against that Git reference before recording results. Creation/compilation and
final response/end-state fingerprint computation are not GET timing. IO trace
hashing, byte accounting and cloning remain inside the timer. All timings are
instrumented local wall time, not pure CPU time.
Concurrent source and nested phase timings **must not be summed**. Synthetic
clone/adapter overhead remains in the measured path.

Input and IO bytes are compact UTF-8 JSON at memory boundaries. Duplicate local
and remote booking copies count separately, as do repeated reads. They are not
network transfer, SQL storage or process peak-memory measurements. A handful
of samples is descriptive; no production p95, speedup, capacity or SLO follows.

Two measurement errors were caught before retaining results:

- Host-created JSON arrays have different prototypes from VM-created arrays.
  Node deep equality can therefore report a difference for identical JSON and
  fabricate read repairs. IO now parses its returned JSON in the same VM as
  the application. Empty and mixed-source repeated GETs assert zero repairs;
  a separate deliberately divergent local/remote case still exercises the real
  repair path, including its subsequent settled state.
- Assimilating a VM Promise with host `Promise.resolve` can attach a phase
  observer after the route has already resumed its synchronous reducer. Source
  completion is now observed directly on the original promise, without
  substituting its return value. Deterministic `phaseOrder` checks require all
  four source completion events before reducer start, and reducer completion
  before serialization. Earlier quick phase numbers are discarded.

Success requires more than retaining customer identities. The report separately
sums actual `activity.orderCount`/`bookingCount` and counts customers contributed
by each source. Every benchmark sample must match the declared source sizes;
foreign bookings must not increase target-merchant activity. The ordinary and
foreign-noise scenarios must return the exact same complete response hash.

## Retained results — 2026-09-28

Raw evidence: [customer-get-baseline-20260928.json](benchmarks/customer-get-baseline-20260928.json).
Windows, Node 24.13.1, current source graph (38 SHA-256 fingerprints), one
retained run, five sequential repeated samples per case. Source/manifest Git
comparison against deployed 57 was empty. All cases passed unwrapped/phase-wrapped
parity for the first and every repeated request. No production timings were read.

| Scenario | Customers returned | Actual order / booking activities | Response JSON bytes | Repeated synthetic IO read bytes | Median local instrumented GET ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty | 0 | 0 / 0 | 87 | 974 | 0.426 |
| 100 identities, four sources | 100 | 100 / 100 | 132,088 | 219,048 | 18.708 |
| 1,000 identities, four sources | 1,000 | 1,000 / 1,000 | 1,329,989 | 2,205,484 | 188.903 |
| 10,000 identities, four sources | 10,000 | 10,000 / 10,000 | 13,398,990 | 22,286,015 | 2,167.631 |
| One customer, deep history | 1 | 10,000 / 10,000 | 1,409 | 16,007,674 | 988.272 |
| 100 identities + 10,000 foreign bookings | 100 | 100 / 100 | 132,088 | 12,009,848 | 186.163 |

These are fixed synthetic records, **not production response-size predictions
or user-visible latency**. IO totals include repeated compact-JSON copies and
test-adapter work, not real database/wire traffic. Source wall phases overlap;
their sum is not GET CPU time. The raw evidence retains all five samples,
individual IO counters, source contributions and phase event ordering.

At 10,000 identities the synchronous reducer median was 1,125.682 ms; response
construction/serialization median was 62.338 ms. This supports eliminating
repeated full aggregation, not a promised percentage speedup from adding an
index. The one-customer case still processes 20,000 activities despite returning
only 1,409 bytes, proving that response length alone is not a sufficient budget.

The foreign-booking case has the **same exact complete response hash** as the
ordinary 100-customer case, but 12,009,848 versus 219,048 synthetic read bytes.
Both repeatedly perform 7 page SELECTs, 3 local reads and 2 snapshot-service
lookups. Request count alone hides this data-volume growth. Each ordinary
aligned case has zero local/remote writes on both its first and repeated GETs;
intentional recovery writes are covered separately by tests.

### Decision

1. Prioritize a reusable, correctly invalidated customer generation with bounded
   list summaries and separately loaded complete edit details. Reuse the existing
   shadow query protocol rather than rebuilding its SQL or adding a TTL cache.
2. Treat the shared booking document and read-triggered execution as prerequisites,
   not optional cleanup: database-only customer pagination cannot bypass them
   while retaining current behavior. Continue the existing operation-ownership
   work before selecting an authoritative tenant-scoped booking read path.
3. Validate both total activities and distinct identities, plus growth in other
   tenants. Do not claim capacity based only on DOM row counts, number of queries
   or response size. Real database/HTTP/concurrency and browser measurements
   remain a later isolated acceptance step.

This step provides an executable regression baseline and a measured ordering of
work. It does not activate customer pagination or complete the overall scaling
plan. Since no runtime changed, there is nothing to deploy for this step.

### Validation

- New benchmark/fixture tests: 20/20, independently rerun, zero failures/skips.
- Combined new and existing customer/booking regressions: 98/98, zero skips.
- Full six-case benchmark: all source-size/identity/activity, repeat, phase-order
  and instrumentation-parity assertions passed; raw output retained above.
- Final full nonincremental TypeScript, four-file lint, strict encoding and
  source/diff checks passed. A final PromiseLike type-cast correction has
  byte-identical emitted JavaScript; the 20 new tests passed again afterward.
- Both new test files are automatically included in the mandatory CI remaining
  partition. No workflow/check was removed or changed. This is local validation,
  not a claim that a remote CI run or deployment occurred.

## Next implementation gate

Reuse the existing persisted query protocol, but keep the authoritative route
until all four source changes and local/remote booking reconciliation can be
observed safely. The next structural gap is authenticated HTTP operation
ownership and exact request semantics **before** old read-repair/side effects,
followed by complete writer/worker participation. The inactive SQL recovery
candidate alone does not supply that ownership.

Activation acceptance must cover exact identity joins/splits, ordered results,
global statistics, full details and edit versions, source failures, concurrent
writes, restore/recreation, cross-tenant denial, and interruption/rollback.
Any installed source observer or change to successful booking writers requires
its own explained scope and permission before affecting existing business data.
