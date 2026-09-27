# Booking merge date parsing: isolated CPU change

This candidate applies only the three date-cache hunks from `9f122b71` to the
deployed `0004c202` booking persistence module. No capacity, route, authentication,
write protocol, migration, authority, notification or worker code is changed.
It is not a deployment or database acceptance report.

Each `mergeMerchantBookingPersistenceRecords` invocation now memoizes parsed
normalized date strings. The cache retains at most 16,384 keys, each at most 128
UTF-16 code units. Overflow and longer strings still use the previous parse path;
the cache is not a record limit or a total-process-memory bound. Field reads and
parsing remain lazy, and the cache is discarded between merges.

Global-ID winners, remote-on-equal replacement, invalid-date `-Infinity`, stable
tie ordering, no-ID deep deduplication, object references and source arrays stay
unchanged. The later booking-list `new Date(...)` sort is deliberately untouched.

## Evidence

- Thirteen merge parity tests retain the frozen old function hashes, independently
  matched to `0004c202`. They cover generated inputs, changing getters, invalid
  dates, cross-merchant duplicate IDs, cache overflow and long date strings.
- Four new customer GET tests execute actual route, customer aggregation, order
  and membership read entrypoints, booking automation/list/projection, settings
  stores and persistence loader code. They do not stub `listMerchantBookings`.
  Old/new HTTP bodies and all synthetic IO calls, including repair payloads, are
  compared. A precise inverse restores the entire old persistence module SHA-256
  `b53f78db3dcdd9dfa3491bb25f6e0065e7eebde350dcd519cfaf395f8722a3e4`, protecting
  unchanged read/write/fallback code rather than just the optimized helper.
- Synthetic 10,000 local plus 10,000 matching remote records, using 250 recurring
  timestamps: merge `Date.parse` calls **246,078 → 250**, with the same 10,000
  output records. This is not 20,000 distinct customers.
- Synthetic actual GET with 500 local plus 500 matching remote bookings using
  25 timestamps: persistence-module `Date.parse` calls **8,186 → 25**, with the
  same 500-customer response and IO sequence. This counts that module only,
  not total GET CPU time, latency or database work.

The GET fixtures use cancelled bookings, empty order/member/customer-store
inputs, fixed time, synthetic verified-session/snapshot inputs and in-memory
file/Supabase IO. Unused delivery/mutation dependencies fail if called. Real
authentication, HTTP transport, providers, PostgreSQL, browser behavior and live
data were not exercised. The repair case verifies existing side effects; this
change does not make customer GET read-only or solve global-store scaling.

Focused verification: seven related suites, **78/78 passed**; the three changed
TypeScript files passed ESLint; full `tsc --noEmit --incremental false` and
`git diff --check` passed. Root separately reran all 17 new parity tests and the
strict encoding check. Independent final review found no blocker and confirmed
both new files are automatically included in CI's mandatory remaining partition.
No dependencies were installed or modified; no live DB, provider or server
action was performed. This candidate is not deployed.

Reproducible focused command:

```sh
node --import tsx --test src/lib/merchantBookingPersistenceStore.test.ts src/lib/merchantBookingMergeParity.test.ts src/app/api/merchant-customers/route.booking-merge.test.ts src/app/api/merchant-customers/route.test.ts src/lib/merchantCustomers.test.ts src/lib/merchantCustomerDirectoryStore.test.ts src/lib/merchantBookings.test.ts
```

## Local timing sanity check, not an acceptance threshold

Root also executed the uninstrumented old/new module functions in isolated VM
contexts on Windows Node 24.13.1: four warmups, eleven alternating measurement
rounds, median per invocation, and reference parity checked before timing.
These are synthetic function timings, not production Node 20, total-request
latency, database measurements, or a repeatable speed guarantee.

| Input per merge | Before (ms) | After (ms) |
| --- | ---: | ---: |
| 20 local + matching remote records, 20 dates | 0.0867 | 0.0363 |
| 10,000 local + matching remote records, 250 dates | 184.9081 | 61.4613 |
| 10,000 local records, 10,000 dates | 85.7434 | 34.2488 |
| 18,000 local + matching remote records, 18,000 dates (overflow) | 234.8518 | 114.9146 |

Empty/singleton calls increased by approximately 0.0001 ms in this local sample;
no early-return behavior was changed to optimize that measurement noise. The
cache adds bounded allocation and still retains the old uncached overflow path.
