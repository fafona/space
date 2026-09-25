# Request-local catalog resource index — 2026-09-25

Baseline: `85f8e402677c1038d918bcc81c3f4373c79d53a5` (bounded lists live).
Worktree: `D:/merchant-space-read-index-20260925`.

## Root cause and bounded correction

`resolveTrafficResources` previously called `resolveMerchantCatalogCollection`
for every product block. Each call normalized the complete catalog again.
It then scanned the whole product array and used a linear `productIds.includes`
for each candidate product. For B blocks, P products and K collection members,
the membership work alone could approach B × P × K comparisons.

The new `createMerchantCatalogCollectionResolver` normalizes one isolated input
snapshot and indexes collections by block and desktop/mobile/shared scope.
The traffic reader constructs it lazily for the first real product resource
only, reuses it within that synchronous call, and uses Set membership. It still
filters the original product array, preserving catalog order, duplicate entries,
original labels and hidden-product rules. Each returned collection has separate
arrays/rules. A later invocation prepares fresh input; there is no global index,
new cross-request cache, persistence or revision-based stale-data assumption.

Exact/shared precedence and ambiguity rejection match the unchanged original
resolver. No old resolver, catalog normalizer, strict validator, catalog store,
order quotation, route, authentication, signing, cache policy, saved data or
worker behavior is modified. Missing/ambiguous bindings retain legacy fallback.
Active-plan, desktop/mobile, tenant and 240-character resource-ID semantics are
unchanged. No new database call, schema, trigger, backfill or cleanup is added.

## Where this helps and what remains

This reduces pure resource-resolution CPU on the existing traffic context path.
The current public-metadata cache still keeps ordinary results for 30 seconds
and does not retain results above 2,000 resources. Its behavior is unchanged.
Warm cache hits do not run this computation; measured improvements apply to the
computation on misses/uncached large results, not every request or page load.
Catalog loading/strict parsing and output allocation remain; this does not
provide database-level product pagination or reduce cold-read response bytes.

The customer read audit found no common revision covering saved profiles,
orders, bookings and memberships. Booking reads can run time-dependent automation
and persistence. Sharing a complete customer GET or paging its sources before
identity merging would change behavior; slicing its final output per page would
repeat full reads and aggregation. Those approaches are not introduced here.
True backend scaling still needs a separately reviewed, rebuildable derived
read model with complete invalidation and parity checks. No original customer
record, import, booking action or statistics semantics are changed in this phase.

## Reproducible offline measurement

Run `node --import tsx scripts/benchmark-catalog-read-index.mjs` from this worktree.
The benchmark loads the exact resource reader from the baseline Git object,
uses unchanged normalization/plan dependencies, and compares complete ordered
outputs against the new reader. It uses synthetic, strictly valid catalogs only;
no network, credentials or saved customer/product data. It refuses unexpected
imports and CLI arguments. Input bytes are checked for mutation.

One local Node 24.13.1 run (seven alternating timed samples per path):

| Products / blocks | Catalog bytes | Product normalization reads before → after | Median CPU ms before → after |
| --- | ---: | ---: | ---: |
| 100 / 1 | 16,039 | 100 → 100 | 0.122 → 0.123 |
| 1,000 / 5 | 189,480 | 5,000 → 1,000 | 6.835 → 1.149 |
| 1,000 / 20 | 294,065 | 20,000 → 1,000 | 47.293 → 3.747 |

All ordered results matched. These are isolated CPU measurements on synthetic
inputs, not production latency, network, database capacity or a guaranteed
speedup. Wall time is descriptive only; tests assert output parity and exact
operation counts instead of unstable timing thresholds.

## Validation and publication boundary

New tests cover the old repeated-work baseline, all 64 combinations of scope
multiplicities, invalid input, unknown references, prototype-like keys, output
and input isolation, full resource parity, fallback rules, product order and
duplicates, active/mobile plans, hidden products, empty paths and ID limits.
The 1,000-product/20-block regression asserts one normalization, zero linear
membership includes and identical full output.

The separate exact `read-index` release lane requires focused catalog/traffic
and safety regressions, the unchanged guarded build and candidate smoke, then
`ready-no-database` before activation. Every database action is refused. The
enabled analytics secret and merchant 10000000 attention pilot are inherited
unchanged; existing processes, immutable assets, maintenance state, proxy hashes
and owned rollback checks remain. No port-range or retention change is included.

Source validation alone is not publication. Exact-head CI, merged-tree equality,
candidate acceptance and independent public verification are required before
calling this phase deployed; record those outcomes separately after release.
