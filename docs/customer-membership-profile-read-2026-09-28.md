# Customer-only membership profile read — 2026-09-28

## Root cause and bounded change

The customer GET uses membership identity/contact information, membership status
and the three stored balance fields. It never consumes transaction history.
Nevertheless, the membership store normalized and sorted transactions once for
each source row and again for the merged winners. Growing histories therefore
caused avoidable application work when opening the customer manager.

This checkpoint follows `1ede92a33fab68461bc6fac0f3e9ba54f3e93b51` and adds
`loadStoredMerchantMembershipProfiles` for **only** the customer GET. It retains
the existing query and complete merger, including both profile normalization
passes. A shallow copy of safe persisted membership JSON replaces transaction
history with an empty array before that merger. The returned view then omits the
`transactions` property entirely and has an explicit `Omit` type, rather than
pretending an empty history is a full financial record.

The original full loader, query, merger, membership normalizer, save, transaction
commit and ledger mirroring functions remain unchanged. No stored transaction is
cleared, truncated or rewritten. Customer reducer changes are TypeScript-only;
full membership records and the new read-only profile view are both accepted.

## Failure and compatibility boundaries

A blind removal of transaction history would change existing failure behavior.
For example, valid persisted JSON can contain a transaction with a valid date
and `balanceDelta: {"toString": null}`. The original money normalizer throws on
that value, causing `memberships_unavailable` in the customer GET. Skipping it
would silently change the warning and customers returned.

The new path therefore performs a lightweight scan of transaction `balanceDelta`
and `growthDelta`. Primitive/null/missing values use the fast path. A complex
value keeps that member's entire history and delegates to the original merger;
it neither swallows errors nor implements its own date/money normalization.
Invalid dates or invalid memberships consequently retain their original skip or
failure behavior. The full normalizer is source-pinned by tests so future changes
cannot silently invalidate the guard's assumptions.

Important legacy behavior preserved:

- Original merchant/slug queries, missing-column retries, empty-primary fallback,
  mandatory errors and optional-source warnings.
- Per-row ID deduplication **before** filtering membership site IDs, then cross-row
  deduplication, final normalization and stable sorting. Equal timestamps still
  select the later occurrence without changing Map insertion order.
- Bad history in a foreign or ultimately replaced membership still reaches the
  same original processing that could fail before filtering/deduplication.
- Entire customer response, ordering, totals, editable fields, warnings and
  manual-store version for both default and `manager-v1` responses.

This adapter is for persisted JSON returned by the existing store, not arbitrary
JavaScript getters, proxies or custom prototypes. It still scans safe histories
once, but avoids expanding, date-normalizing and sorting their transaction
objects twice. It is not a constant-time operation or a measured heap reduction.

## Evidence and reproduction

The dedicated synthetic actual-GET benchmark compares the new reader with the
unchanged full reader in the same module. The reference is selected only by an
explicit offline fixture option. Production has no such bypass or feature flag.
Both sides execute the real route, source loaders, normalizers and reducer;
authentication/DB/filesystem/provider IO are synthetic. Outputs and full IO/effect
hashes must match for every paired request, not just the number of customers.

```powershell
node --import tsx scripts/benchmark-merchant-customer-membership-profile.mjs
```

The fixed scenarios cover empty, medium and deep transaction histories. Each runs
in both request orders with a first request and three repeats. These are offline
wall-time samples, not a cold-process, production p95, throughput or CPU-exclusive
measurement. Timings include synthetic IO cloning/accounting; overlapping source
phase times cannot be added together. Full raw samples and source fingerprints
are in [the report](benchmarks/customer-membership-profile-read-20260928.json).

Observed repeated-request medians (milliseconds, three repeats per execution
order, Node v24.13.1 / Windows):

| Fixture | Execution order | Full GET → profile GET | Full membership phase → profile phase |
| --- | --- | ---: | ---: |
| 100 customers, no transactions | profile first | 24.595 → 20.084 | 7.982 → 5.466 |
| Same | legacy first | 23.725 → 19.601 | 8.220 → 7.353 |
| 1,000 customers × 20 transactions | profile first | 630.900 → 328.145 | 465.182 → 160.392 |
| Same | legacy first | 640.845 → 338.516 | 467.180 → 169.423 |
| 10 customers × 5,000 transactions | profile first | 1227.483 → 176.013 | 1224.036 → 172.932 |
| Same | legacy first | 1265.967 → 177.269 | 1261.806 → 173.153 |

There are 48 measured GETs: three scenarios × two execution orders × four requests
× two variants. Every pair has identical complete response bytes/hash, source
outcomes, warnings, input bytes, IO and final-state/effects hashes. All samples and
descriptive summaries are retained, not just the fastest values. The small empty
history fixture's **first** profile requests were slower (38.454/28.680 ms versus
25.211/24.212 ms); the new shallow copies and guard are not universally free.
No cold-process independence or production speed guarantee is implied.

The membership-store mechanism test separately counts the actual normalizer body:
two memberships × 620 transactions × two passes previously processed 2,480
transaction entries; the safe profile path processes zero entries in that deep
normalizer while still performing all four membership-profile normalizations.
Its lightweight guard still scans the raw history once. Complex histories retain
the original transaction processing and success/failure behavior.

## Verification

- Combined related customer UI/search, directory, membership financial/store,
  orders, bookings, actual GET and benchmark suites: **260/260 passed**, no skips.
- Full nonincremental TypeScript, all ten changed/new code/test files' ESLint,
  strict encoding and `git diff --check` passed. Both new test files are in the
  mandatory CI `remaining` partition; workflows/gates/dependencies are unchanged.
- Deeply frozen JSON input and exact schema-query traces are compared against the
  original full store, including unusual/noncallable money coercion and duplicate
  foreign/overwritten records. A subsequent full read/save retains all 620 history
  records in its regression fixture.
- The old store is recovered by removing only five additive declarations and
  checked against its existing complete source SHA. The original membership
  normalizer and frozen customer reducer oracle are not edited or re-pinned.
- A further 64 seeded mixed-source reducer cases compare transaction-free
  membership inputs against the complete frozen reference output and JSON order.
- The independent review and root readback match all 39 executed source hashes
  and both measurement-file hashes. Review also recomputed all 84 phase/GET
  medians from the recorded raw repeat samples.

These local checks do not constitute remote CI or authenticated browser/production
acceptance. The benchmark exposes no customer rows or configured credentials.

## What this does not solve

The database still returns the entire membership document and transaction arrays;
the read-byte accounting and number of queries are deliberately unchanged. This
removes unnecessary application normalization, not database/network transfer.
Do not call it completed server-side pagination or complete scalability work.

A later database-side projection needs its own proof. Replacing the unordered
legacy query with an RPC, adding ordering or pre-deduplicating rows can alter
equal-timestamp winners; historical data is not guaranteed unique. Schema/error
fallback semantics and deployment/rollback permissions also need to be retained.
That change is not included here, and no existing data was cleaned up to make it
easier.

No production data, schema, flags, workers or release state were changed. This is
a local candidate, not an online deployment or production-health assertion.
Publication must follow the established no-maintenance separate-candidate process
and keep an ownership-checked rollback. Do not mix in inactive authority branches.
