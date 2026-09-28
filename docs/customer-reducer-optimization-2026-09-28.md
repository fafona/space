# Customer directory: remove discarded alias work

## Scope and root cause

This is a small runtime optimization on top of the main-based, offline baseline
`b4a7b77a9f93d08cb9640da3d0b33ae2abe092d1`. It does not include the unmerged
booking-authority/customer-projection candidate branch or its migrations.

The measured customer directory reducer merges every profile in an identity
group. Each intermediate `mergeProfiles` used to normalize both profiles'
identity tokens, allocate a Set, and truncate its aliases. However, directory
construction computes the final aliases independently from the **original**
candidates and unconditionally replaces those intermediate aliases. No other
merged field, identity graph edge, derived ID or activity calculation reads
the intermediate aliases. This was repeated work with no effect on the result.

The private merge helper now accepts `mergeIdentityAliases: false` for the
directory call only. It carries the preferred aliases as a temporary reference;
the final directory item still gets its own `allTokens.slice(...)` array.
Both shared upsert paths retain the default original alias merge. Customer
save/import/update behavior is not changed. No persistent or cross-request cache
is added, and no source reads, writes, authorization or delivery behavior changes.

The following subtle behaviors are deliberately preserved:

- Candidate identity tokens are individually capped at 24 before identity joins.
- Priority and stable timestamp ordering determine preferred profile fields.
- Stored IDs short-circuit the derived-ID branch, so their aliases retain
  insertion order. Derived IDs sort `allTokens` in place, so their final aliases
  are sorted before the final 24-item slice. These cases must not be unified.
- Bridge joins/splits, foreign-merchant exclusion, rounding after each activity
  addition, raw activity date fallbacks and note selection are unchanged.

## Independent reference and regression evidence

`scripts/fixtures/merchantCustomersReference.ts` freezes the complete previous
module at the reference commit, not a rewritten algorithm or today's helpers.
After its header, its SHA-256 is
`1a44b96f9f901b2e7edab8f7faae24ea0745fa8312ef5815418e54a35fa420e4`.
It has only erased type imports and is imported by tests, never runtime code.
The tests validate the pinned digest without requiring Git at test execution.

The new differential tests compare full objects **and serialized field/array
order**, and deep-freeze both implementations' inputs. They cover four-source
bridges and removal, stored/derived IDs, aliases and caps, normalized contacts,
equal/invalid dates, activity totals and notes, repeated calls and merchant
changes, 256 deterministic mixed-source cases, and 192 seeded upsert variants
across default/false/true replacement modes. Existing large-chain, read-repair,
authorization and source-failure regression tests are retained.

Final local checks:

- Combined customer, benchmark, booking, order and membership regressions:
  **138/138 passed**, zero failures/skips, including 12 new differential tests.
- Full `tsc --noEmit --incremental false`: passed after final test edits.
- All three changed/added TypeScript files: ESLint passed.
- Strict encoding and diff-whitespace checks: passed.
- The new test is automatically included in the required CI `remaining`
  partition. No CI workflow or gate was changed. No remote CI run is claimed.

To run the new differential suite and the existing actual-GET benchmark:

```sh
node --import tsx --test src/lib/merchantCustomers.optimization.test.ts
node --import tsx scripts/benchmark-merchant-customer-get.mjs
```

For the before measurement, run the same benchmark in a worktree at the pinned
reference commit with the same locked dependencies. The benchmark's historical
`comparisonReference` label is not an automatic Git-equivalence check; use the
retained source hashes to identify the actual code under measurement.

## Actual GET benchmark comparison

Raw paired reports and the compared fields are retained in
[customer-reducer-optimization-20260928.json](benchmarks/customer-reducer-optimization-20260928.json).
The original benchmark CLI and synthetic-IO harness are byte-identical in both
worktrees. They execute the actual GET, source loaders and reducer, with no real
database, network, credentials, customer records or production requests.

Fresh reference and optimized full runs were executed sequentially on Windows,
Node 24.13.1, with the same locked dependencies. Each report separates the first
request from five repeated samples and verifies its own instrumentation parity.
Across implementations, **all 36 sample pairs** match status, customer count,
warnings, activity/source counts, response bytes and complete response hash,
effects hash, input bytes and every IO counter. Of the 38 loaded application
source hashes, only `src/lib/merchantCustomers.ts` changes.

Repeated-sample medians in milliseconds:

| Synthetic case | Reducer before | Reducer after | GET before | GET after |
| --- | ---: | ---: | ---: | ---: |
| Empty | 0.004 | 0.005 | 0.312 | 0.393 |
| 100 identities, four sources | 10.238 | 9.323 | 16.876 | 17.664 |
| 1,000 identities, four sources | 103.495 | 90.198 | 189.464 | 171.972 |
| 10,000 identities, four sources | 1,522.221 | 1,329.803 | 2,845.995 | 2,729.430 |
| One customer, 20,000 activities | 781.924 | 665.334 | 1,293.353 | 1,209.998 |
| 100 identities plus 10,000 foreign bookings | 16.133 | 13.921 | 229.878 | 228.766 |

In this run, reducer time falls 12.6% at 10,000 identities and 14.9% for one
customer with 20,000 activities; whole instrumented GET time falls only 4.1%
and 6.4% respectively. The 100-customer GET is slightly slower despite a faster
reducer. These are small-sample, local wall-clock observations, not a dedicated
performance lab, statistical confidence interval or a universal speedup claim.
Do not compare the percentages to the earlier retained baseline run: local load,
JIT and GC vary. No production p95, capacity or browser latency was measured.

The fixture's JSON cloning, IO byte accounting and trace hashing remain in the
GET timer. Source phases overlap and must not be added together. All aligned
cases retain zero writes; foreign bookings retain the same target response.
The 10,000-customer response still contains 13,398,990 bytes. All four sources
are still fully read. This change does **not** solve data-volume growth or enable
server pagination, and does not justify declaring the entire optimization plan
complete.

## Publication boundary

This checkpoint is local implementation and offline validation, not a deployment
receipt. Production traffic, data, schema, source-selection flags and maintenance
state are untouched. A future release can carry this main-based runtime change
without any of the inactive authority candidates or database migrations, using
the established no-maintenance candidate/switch/rollback process.

Next structural work remains correctly invalidated source aggregation and bounded
customer summaries with separate complete edit details. A further token-cache or
timestamp optimization should independently measure CPU and allocation tradeoffs;
neither is silently included in this small change.
