# Customer manager response payload — 2026-09-28

## Scope and root cause

The customer manager loaded the full directory wire shape, but consumed only
`orderCount`, `bookingCount`, `orderTotals` and `lastActivityAt` from each activity.
The three other activity timestamps and two activity notes were never displayed,
searched or edited. The notes can each contain up to 1,000 characters. The actual
searchable/editable `profile.notes` is separate and must remain intact.

This main-based checkpoint follows `b081896726c6a11186eaeff6868291440a963939`.
It does not activate the separate persisted-directory/booking-authority work.

## Runtime change

- The manager explicitly requests `GET /api/merchant-customers?siteId=…&view=manager-v1`.
- Only that exact view selects `toMerchantCustomerListItem`. It shallow-copies
  each row and projects activity to the four fields consumed by the manager.
  All profile fields and `incomplete` survive unchanged, including hidden fields
  used by full-profile PATCH, identity aliases, tax, addresses, notes and custom
  fields. No stored data is deleted or updated by the projection.
- Default, empty and unknown view parameters retain the original full response.
  Old clients therefore remain compatible with the new server. The new client
  also accepts the full response from an old server that ignores its query
  parameter; no fallback request or separate detail endpoint is necessary.
- The search helper accepts a generic profile subtype and preserves that subtype
  in its return value. Only its TypeScript types changed, not search semantics,
  cache budget, row order or occurrence handling.
- Authentication, source selection and parallel loading, source warnings,
  total, original stored edit version, POST/PATCH, request ownership/abort rules,
  local pagination, and booking read-time automation/repair are unchanged.

The projection deliberately creates a new top-level and activity object per row.
It does not clone nested profiles or totals, mutate the reducer output, add a
global cache, or claim a server-memory improvement. Its allocation/CPU cost is
part of the real GET; no latency improvement is inferred from byte savings.

## Actual GET payload evidence

See [the measured report](benchmarks/customer-manager-payload-20260928.json).
Each pair executes the actual route, all four real source entrypoints and the
reducer against identical synthetic in-memory IO. Measurement does not contact
production or configured providers. It uses Node v24.13.1 on Windows; timing is
disabled, so these are payload comparisons, not production capacity estimates.

| Synthetic fixture | Full JSON bytes | Manager JSON bytes | JSON reduction | Full gzip bytes | Manager gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 shared customer identities | 1,329,989 | 1,128,989 | 15.113% | 46,425 | 41,972 |
| 10,000 shared customer identities | 13,398,990 | 11,388,990 | 15.001% | 364,357 | 346,055 |
| 1,000 identities, long activity notes | 4,282,789 | 2,113,889 | 50.642% | 81,251 | 55,541 |

Each fixture has one stored profile, order, booking and membership per identity.
The long-note case requests 1,000-character synthetic order/booking notes; real
normalizers run before response generation. Notes use recognizable repetitive
synthetic prose, not a representative production distribution. A separate unit
test covers deterministic high-entropy activity notes and retained profile notes.

The gzip numbers are offline `gzipSync` defaults, **not observed HTTP transfer**.
The reductions are respectively 9.592%, 5.023% and 31.643%; compression/configuration,
customer content and connection speed can change actual network savings. Fewer
JSON bytes means less data to parse/retain at the client, but no parse-time or
heap measurement is claimed here.

All pairs retain the same status/counts/source outcomes/warnings/input bytes,
complete source IO/effects/final-state hashes and source-code hashes. The ordinary
fixtures make one session resolution, two snapshots, three local reads and seven
page selects, with no writes or forbidden calls. The full response is independently
cloned and only five activity fields are deleted to create the comparison oracle;
canonical JSON hashing ignores object-key order, but preserves every value,
array order, profile field and envelope/version. The production projection helper
is not used to construct this expected value.

## Regression coverage

- Default full-response fingerprints and default benchmark report shape remain
  unchanged. The complete prior route is pinned by a two-hunk inverse plus its
  existing SHA; neither reducer nor frozen reducer oracle was modified.
- Invalid/missing/wrong merchant sessions, store failure, each optional-source
  failure, ordered warnings, null/missing stored versions, empty results and
  unknown views retain their original behavior.
- Actual-source tests compare first and repeated booking read repairs, foreign
  bookings, independent source contributions and partial-source failures, not
  merely the injected route-call boundary.
- The real component handler harness now feeds manager-view responses by
  default. Both compact and old-server full responses exercise desktop/mobile
  lists, full-directory search, pagination, totals and profile editing/PATCH.
  Search, paging and editing do not fetch another detail endpoint. Mutation
  refresh and A→B→A/unmount ownership tests continue to pass.

Final local validation: **237/237** related customer/UI/search/source/benchmark
tests passed together, with no failures or skips; full nonincremental TypeScript,
strict encoding and `git diff --check` passed. ESLint has zero errors in the ten
changed/new code and test files; the manager retains its pre-existing warning
about the intentionally site-scoped request owner's `useMemo` dependency. The
site dependency must not be removed to silence that warning. The new test file
is automatically included in the mandatory CI `remaining` partition; workflow
and test discovery rules were not changed. A root readback independently verified
all 39 measured source hashes and recomputed all byte-reduction percentages.

To reproduce payload pairs in PowerShell from this worktree using the existing
locked dependencies (no application secrets or production connection required):

```powershell
@'
import h from './scripts/fixtures/merchantCustomerGetBaselineHarness.ts';
for (const [n, noteLength] of [[1000, undefined], [10000, undefined], [1000, 1000]]) {
  const fixture = { storedCustomers: n, orders: n, bookings: n, memberships: n,
    distinctCustomers: n, ...(noteLength === undefined ? {} : { noteLength }) };
  const full = await h.createMerchantCustomerGetBaselineHarness(fixture)
    .get({ measure: false, payloadAudit: true });
  const manager = await h.createMerchantCustomerGetBaselineHarness(fixture)
    .get({ measure: false, view: 'manager-v1', payloadAudit: true });
  console.log(JSON.stringify({ fixture, full, manager }));
}
'@ | node --import tsx --input-type=module
```

The reproduction prints aggregate reports, not customer records. Its independent
projection check is `full.payloadAudit.projectedResponseCanonicalSha256 ===
manager.payloadAudit.responseCanonicalSha256`; the harness tests also enforce
complete IO/effects equality and all failure/repair cases. No inference should
be drawn from zero timing fields when `measure: false` is selected.

## Remaining boundary and publication

This is **response payload reduction, not backend pagination or source IO
reduction**. The 10,000-customer response still contains 11.39 MB of uncompressed
JSON, and all historical source documents are still read and aggregated. Growing
membership transaction history and order item payloads need separate read-side
projection work; any database-side projection must retain legacy schema fallback,
selection/tie precedence and financial total calculation. Booking readers still
have automation and repair effects, so replacing them with a simplistic cache or
limited history query is not safe.

No production request, user-data mutation, migration, external push or deployment
was performed. Local verification is not remote CI or a production health check.
Publication must use the established separate-candidate, no-maintenance process
and an ownership-checked rollback; do not deploy inactive authority branches with
this change. The prior CPU checkpoint's transient-heap tradeoff remains separate
and is not solved by this response projection.
