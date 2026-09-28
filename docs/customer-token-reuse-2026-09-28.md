# Customer directory: reuse identity tokens within one build

## Scope and proven repeated work

Based on main-derived `4e159588bb28fcb9c734c538c13c6dda4426305e`, which already
skips intermediate alias merges. This change does not include the inactive
booking-authority/projection branch or any migrations.

The same normalized candidate used to have its identity tokens computed twice:
once for identity joins and once for final aliases. These are identical pure
computations on the same profile. The selected implementation computes them once,
using the directory-owned profile's alias slot as temporary storage. After a
group's tokens have been added, in original priority/timestamp order, to a Set,
the candidate's temporary token array is cleared. This also replaces the large
`flatMap` intermediate array with ordered Set insertion.

Ownership is essential: all candidate profiles have been freshly normalized in
this call. The input profiles and their arrays are never repurposed. All identity
joins finish before any token array is cleared. Directory field merges keep
`mergeIdentityAliases: false`; final aliases still come from an independent
`allTokens.slice(...)` array. Per-candidate 24-token caps, stable ordering,
stored-ID short circuit and derived-ID in-place sort remain unchanged.
Shared upsert and the public token helper are unchanged. No cross-request cache,
persistent state, source-read change, authorization change or production GC is
introduced.

A test-only counter injected into the pure module's unique token function body
observes 400 calls for 100 candidates in each of four sources, then 800 after a
second independent invocation, and no extra calls for foreign rows. This is
one call per normalized candidate, not a count inferred from the old b4a fixture
(which also performed intermediate alias merging).

## Experiments retained, not conflated

The first local variant reused tokens but held each candidate's token array
until the end of the build. Its CPU result improved, but several after-call heap
endpoints increased. It is retained as **intermediate**, not the final result.

The selected version additionally clears consumed token arrays and streams tokens
into the group Set. It does not eliminate the need to hold candidate tokens during
union; early clearing removes candidate references, not necessarily all copies of
strings (the join map and group Set can still hold them). There is no claim that
clearing an array forces immediate collection or guarantees a lower heap peak.

Raw evidence:

- [Pure reducer CPU and memory](benchmarks/customer-token-reuse-pure-20260928.json):
  three reference runs, two intermediate runs and two selected runs, in recorded
  execution order. Each run uses five separate fresh child processes; each case
  records its first call and five repeated calls. All **210 samples** have equal
  complete input/output fingerprints and source/activity totals for their case.
- [Actual synthetic GET](benchmarks/customer-token-reuse-get-20260928.json):
  reference, intermediate and selected reports. All **36 reference/selected
  sample pairs** match complete response/IO-effect hashes, counts, warnings,
  input/response bytes and every IO counter. Of 38 application source hashes,
  only `src/lib/merchantCustomers.ts` changes.

The pure tool is byte-identical in the reference and candidate worktrees:
`e562c30cdc8b2572c1a4ad4c05015adaeab2d55e81e2bb7a7f44135520ae306a`.
Node, V8, TypeScript compiler, platform and architecture match across all runs.
The selected source hash is
`57ef68d0ca4e7d0a6ffa666064aff260c84979eb6de80a3d496f376450df2b1c`.
Both benchmark paths executed that same final source.

## CPU observations

Ranges below are the smallest/largest **per-run medians**, not percentiles or
confidence intervals. Each median has five repeated samples. All reference and
selected runs are shown; intermediate variants are excluded from these ranges.
Times are milliseconds.

| Fixed synthetic case | Reference: three run medians | Selected: two run medians |
| --- | ---: | ---: |
| 100 customers | 10.047–13.353 | 8.871–8.945 |
| 1,000 customers | 101.349–103.683 | 90.221–91.182 |
| 10,000 customers | 1653.761–1692.448 | 1496.425–1503.904 |
| One customer / 20,000 activities | 841.266–989.815 | 711.405–727.765 |
| 1,000 customers / 24 stored aliases | 117.064–125.060 | 102.455–103.299 |

In the final reverse-order pair (selected, then reference), the 10,000-customer
pure reducer is 9.5% faster and the 20,000-activity case 15.4% faster. Reference
times also vary considerably, especially the small and deep-history cases; these
are descriptive local observations, not promised percentages for production.

Actual GET repeated medians (reference / selected), milliseconds:

| Case | Reducer phase | Whole instrumented GET |
| --- | ---: | ---: |
| empty | 0.004 / 0.004 | 0.318 / 0.301 |
| 100-shared-identities | 8.39 / 7.262 | 17.585 / 15.76 |
| 1000-shared-identities | 99.98 / 67.384 | 187.933 / 142.844 |
| 10000-shared-identities | 1293.711 / 1169.107 | 2619.664 / 2493.11 |
| one-customer-20000-activities | 655.846 / 617.227 | 1170.905 / 1153.862 |
| 100-identities-plus-10000-foreign-bookings | 13.179 / 11.695 | 220.077 / 225.204 |

The GET has a different fixture and includes source loading and synthetic IO
cloning/accounting. Its timings must not be combined with the pure reducer
timings. Foreign-booking GET time slightly increases despite a faster reducer.
The 10,000-customer response is still 13,398,990 bytes and all sources are still
fully read. This is not server pagination or a solution to unbounded data growth.

## Memory tradeoff — not a memory optimization claim

The following final reverse-order pair reports MiB (reference / selected).
After-call and retained values are repeated-sample **heap deltas**; RSS is the
process-lifetime high-water reading before report serialization.

| Case | After-call heap delta | Post-GC retained heap delta | Process high-water RSS |
| --- | ---: | ---: | ---: |
| 100 customers | 4.332 / 3.930 | 0.128 / 0.128 | 95.016 / 95.363 |
| 1,000 customers | 14.487 / 11.155 | 1.244 / 1.204 | 160.438 / 160.594 |
| 10,000 customers | 67.182 / 85.502 | 11.983 / 11.974 | 350.836 / 347.637 |
| One customer / 20,000 activities | 23.102 / 66.346 | 0.019 / 0.019 | 259.145 / 255.980 |
| 1,000 customers / 24 stored aliases | 26.143 / 19.877 | 1.357 / 1.292 | 162.180 / 161.668 |

At 10,000 customers, the after-call heap delta increases from about 67.2 to
85.5 MiB. With 20,000 activities for one customer, it increases from about 23.1 to
66.3 MiB. These increases also appeared in earlier runs and must not be hidden
by the similar post-GC retained values and nearby RSS readings.

After-call sampling includes garbage not yet collected and may already reflect
automatic GC. Different collection timing is a possible explanation, **not
established by this measurement**. The test does not observe precise peak JS heap,
allocation totals, GC pause counts, production concurrency or a server memory
ceiling. Post-GC deltas include VM/JIT changes as well as the retained result.
RSS includes compiler, fixture creation, hashing and previous samples.

The selected change is therefore a **CPU optimization with an explicit temporary
heap tradeoff**, not memory-neutral, memory-saving or production-capacity proof.
It removes an avoidable intermediate array and shortens temporary reference
lifetime without adding a global cache or forcing production GC. If deployment
validation finds unacceptable GC/memory pressure, `4e159588` remains the separate
more conservative runtime checkpoint; this change can be omitted independently.

## Validation and publication boundary

- Existing frozen full-module differential tests retain 256 mixed-source cases,
  192 shared-upsert variations, bridge joins/splits, caps, stable ordering,
  mutation/re-entry and input immutability checks.
- Two new mechanism tests verify one token computation per local candidate.
- Eleven new tool tests check sampling order, missing GC refusal, signed memory
  deltas, input mutation rejection, source/fixture binding and a real small child.
- Combined customer/benchmark/booking/order/membership suite: **151/151 passed**,
  zero failures/skips.
- Full nonincremental TypeScript check passed after the final runtime edits.
- ESLint passed for the runtime module, counter tests and both benchmark files;
  strict encoding and diff checks passed.
- Both new test files are included automatically in the required CI
  `remaining` partition. No workflow/gate/dependency changed; remote CI is not
  claimed. The temporary same-tool copy in the reference worktree was removed
  after measurement; its tracked code remains unchanged and the tree is clean.

Reproduce in each worktree with the same locked dependencies and same tool:

```sh
node scripts/benchmark-merchant-customer-reducer.mjs
node --import tsx scripts/benchmark-merchant-customer-get.mjs
node --import tsx --test src/lib/merchantCustomers.token-reuse.test.ts
```

There is no production request, user-data write, schema change, source-selection
activation or deployment in this checkpoint. Continue to use no-maintenance
candidate validation and rollback for publication. Do not deploy the unrelated
inactive authority branch to release this small main-based optimization.
