# Customer search corpus — local candidate

## Root cause and scope

Every nonempty deferred search rebuilt 17 normalized fields for each eligible
customer. That repeated trim, UTF-16 truncation, Unicode normalization, case
folding, tags/custom-field joining and whitespace replacement for each keystroke.
The page's loaded directory is already treated as immutable: GET replaces the
array and the editor clones profile drafts before changing them.

The manager now owns one lazy search corpus per loaded-array snapshot. Empty
queries do not build customer search strings; source/status-excluded rows are
not materialized until needed. Later queries reuse each eligible row's string.
New GET arrays, merchant switches and unmounts retire the old corpus. There is no
global/customer-ID cache, browser persistence or API change.

Retained derived text is capped at 4 Mi UTF-16 code units (not an exact JS heap
limit). Overflow rows still run the complete original computation. No data or
search results are truncated to satisfy the cache budget.

## Correctness and measured evidence

The original `filterMerchantCustomerDirectory` is unchanged and serves as an
independent parity oracle. Coverage includes all source/status combinations,
17-field inclusion/exclusion, substring and cross-field matching, field/query
truncation before NFKC, combining/expanded characters, split surrogate pairs,
joined tag/custom-field truncation, duplicates, sparse arrays, stable order and
original object references. New-response invalidation and cache overflow are
tested explicitly.

Actual component handler tests with three synthetic customers observe 52
normalization calls on the first nonempty query (17 × 3 fields + query), then one
on each later query. A replacement response rebuilds the corpus. This proves
less repeated computation; it is not a claim about measured online latency.

Focused verification: 79 search, legacy directory, actual component, contract
and telemetry test groups passed, along with whole-project TypeScript, targeted
ESLint and whitespace checks.

The backend still returns the full customer directory and runs the same four
source loaders/booking automation. Server-side paging and safe decoupling remain
separate work. This candidate changes neither saved data nor search semantics.
No deployment or maintenance was performed.
