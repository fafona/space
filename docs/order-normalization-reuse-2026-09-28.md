# Reuse stable normalized orders at the legacy merge boundary

## Scope

Local candidate based on `f547d48cd44ae30515026cc24df750f368b9e2b5`.
This is not a deployment or a production-health assertion. No database/schema,
permissions, financial algorithm, dependency, release flag or worker is changed.
Publication must use the established no-maintenance separate-candidate path.

`mergeStoredMerchantOrdersRows` previously normalized every order in each
preferred page, selected the first winner of each order ID, then normalized every
winning order and its items again. The second pass repeats string processing,
object construction, quantity normalization and monetary summarization.

The final pass now reuses the first pass's fresh local objects **only when all
trim-then-slice fields are stable**. Records with newly exposed trailing
whitespace still use the original complete second normalization. Final sorting
uses the identical `createdAt` comparator on a newly built array.

This change applies to callers of this common merger, including full and chunk
window readers; it is not a customer-specific order projection. All full order
fields remain available for order handling, coupons, notifications and V1 parity.

## Why the guard is necessary

The normalizer is not unconditionally idempotent. For example, a 500-character
item name ending in a space after truncation loses that space on the second pass.
The same issue affects four customer fields, `clientRequestId`, and seven item
fields. Generated price text can also hit this boundary with a long price prefix.
All twelve categories are checked with native `trim`, including Unicode spaces.

Numeric quantities, prices and timestamps already reached stable values on the
first pass. Totals still come from the original item calculation, **never** the
untrusted stored `totalAmount`. Per-item and cumulative rounding and overflow
handling remain unchanged. The complete normalizer source is pinned in tests so
future changes require revisiting this assumption explicitly.

Only the first pass's internally created order/customer/item objects are reused.
There is no raw-input shortcut, cross-request cache or shared reference to stored
JSON. A later caller mutation cannot affect raw CAS data, another order or a
subsequent read.

Preserved behavior includes:

- First-pass normalization of every preferred row, including ultimately discarded
  duplicates or foreign-site records that may still raise a malformed-data error.
- Chunk-over-base precedence, numeric chunk sorting, per-row date sorting,
  first-ID winner selection and invalid/equal timestamp behavior.
- Original queries, pagination limits/probes, schema retries and source errors.
- Original raw `storageRows` references and the existing atomic write adapter.
- Complete V1 comparison, primary/verify decisions and error fallback. No V1 mode
  or circuit-breaker setting is changed.

The earlier idea of removing CAS snapshot capture was not implemented: it only
creates shallow page wrappers and is not a deep copy of the expensive order
items. This candidate instead addresses the demonstrated duplicate item work.

## Verification method

The reference fixture removes only the new private helper and reverses the one
changed call, then checks the **whole** recovered store against the pre-change
SHA. Tests execute that actual legacy source rather than a rewritten merge oracle.
Normalizers, query implementations and writer code are also protected by these
pins. Production has no reference toggle.

Dedicated regression coverage includes twelve Unicode truncation matrices,
generated price text, seeded JSON and double-bit inputs, extreme monetary values,
malformed coercions, frozen raw data, reference isolation, complete query traces,
the real transaction adapter with synthetic RPC, and V1 comparison/fallback.

Actual normalizer-body counters for 80 stable orders with three items each:
record/item/summary passes fall from 160 to 80; deep item visits fall from 480 to
240. With three orders and one non-stable order, passes fall from six to four:
the guard preserves the required second pass for that order. The guard itself
still scans the winning item strings; this is not constant-time processing.

Final local checks:

- **679/679** related order, membership, booking, customer, route, UI-contract and
  benchmark-guard tests passed, with no failures or skips. This includes the 26
  dedicated old/new store cases and actual GET response/effect differential tests.
- Full nonincremental TypeScript check passed. All eight changed/new code/test
  files passed ESLint; strict encoding and `git diff --check` passed.
- Read-only CI inventory inspection confirms the new tests belong exactly once
  to the mandatory `remaining` partition; no workflow or guard was weakened.
- Independent review found no blocking discrepancy in the production change,
  guard assumptions or measurement method. These are local checks, not remote
  CI or authenticated browser/production acceptance.

## Offline interface measurement

```powershell
node --import tsx scripts/benchmark-merchant-customer-order-normalization.mjs
```

The paired benchmark executes the actual customer GET, source loaders and reducer
with synthetic authentication and IO. Only the order store's executed source
differs. Compilation caches use the executed source hash; the report separately
identifies on-disk candidate sources and the restored legacy store. Default
fixtures and earlier report shapes remain unchanged.

The fixed scenarios use 100 orders with one item, 1,000 orders with 20 items, and
10,000 orders with one item, alongside matching counts in other customer sources.
Each runs both construction/request orders, with one first request and three
repeats: 48 GETs total. Every pair must retain exactly the same complete response,
input/read bytes, warnings, IO, effects, phase order and source identity.

These are in-process offline wall times, not cold-process, production p95,
throughput or CPU-exclusive measurements. Synthetic IO copying/accounting is
included. Async source phases overlap and cannot be summed. No real users or
configured credentials are involved.

Full raw first/repeated samples and source fingerprints are retained in
[the report](benchmarks/customer-order-normalization-reuse-20260928.json).
Observed repeat medians in milliseconds (three repeats per construction/request
order, Node v24.13.1 / Windows), legacy to candidate:

| Fixture | Execution order | Full GET | Orders source phase |
| --- | --- | ---: | ---: |
| 100 customers, one item/order | candidate first | 14.585 → 16.987 | 6.762 → 7.210 |
| Same | legacy first | 15.417 → 16.461 | 6.996 → 7.799 |
| 1,000 customers, 20 items/order | candidate first | 296.981 → 217.822 | 177.969 → 127.692 |
| Same | legacy first | 421.676 → 347.670 | 277.063 → 207.601 |
| 10,000 customers, one item/order | candidate first | 2499.520 → 2482.267 | 1205.471 → 1176.253 |
| Same | legacy first | 2564.213 → 2472.801 | 1254.273 → 1172.573 |

The item-rich fixture shows the clearest benefit: approximately 25–28% less
orders-phase wall time and 18–27% less full GET wall time in these samples. This
does **not** justify a universal speed claim: the small fixture's medians were
slower by about 1.0–2.4 ms for GET and 0.45–0.80 ms for its orders phase; its first
candidate requests were also slower. The 10,000-order one-item fixture improved
only modestly. All samples, including regressions, are retained without reruns
or selection. The guard has real work, and three repeated samples per order do
not establish a statistical significance or a production guarantee.

All 48 paired GETs passed the complete response/IO/effects invariants. Simulated
read bytes stayed at 219,048 / 3,820,484 / 22,286,015 for the three scenarios. Root
readback matched all 39 source hashes, three measurement-file hashes and both
executed store identities. Independent review also verified these identities
against the original git source and recomputed all 84 reported GET/phase medians
from the raw repeated samples. The report contains no actual customer records.

## Remaining limits

Database reads still transfer the full legacy documents and all item fields.
This does not implement database-side pagination/projection, reduce HTTP payload
size, prove a server memory limit or complete the overall scalability work.
Database projection needs separate validation of ordering, monetary derivation,
duplicate winners, schema failures and V1 compatibility. It is not bundled into
this local change, and no historical data is rewritten to simplify it.
