# Public catalog request batching

The user approved combining public product catalog reads while retaining the
single-block endpoint and all order authority checks. Source baseline is
`bee2a6858a8e4bfc725f33c593601a45f890666c`; the preceding live version is
`28c136d27d6f235683cb2eadbf2a5f1fceb34bac`. This note describes the change; separate
exact-head CI and release evidence are required before claiming it is live.

## Root cause and implementation boundary

Every mounted public ProductBlock previously fetched and serialized a separate
catalog projection. Overlapping collections repeated merchant configuration,
catalog and published-block loading and repeated product data in each response.

The additive POST on `/api/orders/catalog/public/batch` accepts 1-32 block IDs, with a
streamed 64 KiB request-body limit. It shares the three loaders once per request,
normalizes collection lookup once using the existing read index, and sends the
visible union of successful collections plus each collection's product order.
The original GET implementation and its route facade are unchanged for editors
and existing clients. The separate batch route preserves the frozen historical
GET facade used by maintenance recovery evidence; those guards are not relaxed.
This is request-local sharing, not a global or cross-request catalog cache.

Strict client reconstruction retains collection/category order, multiplicity,
empty categories, price/revision metadata and optional browsing rules. Explicit
legacy/null differs from a valid empty collection and from errors. Malformed
responses, missing items, wrong collection scope and HTTP failures do not fall
back to GET or manufactured legacy products. Invalid single page IDs are kept
out of otherwise valid sibling batches. Server input limits are not relaxed.

Only SitePageClient opts into batching. A page/plan/site/viewport visit owns its
requests; unrelated re-renders do not refetch. Button-open blocks are requested
only while mounted, and reopening fetches fresh data. Requests are bounded to
two concurrent chunks. Aborted/removed/refreshed entries and late JSON bodies
cannot overwrite a later visit or membership generation. Each response remains
a self-consistent price/revision snapshot; refreshing one block cannot mix new
metadata into a sibling's old products or clear its cart.

## Preserved authority and known boundaries

- Display still depends on product permission, independently from order
  management permission. Shared loader failures preserve existing semantics.
- The server continues to check site + block ID + viewport publication scope.
  This change does not invent page/plan ACLs or hide existing category names.
- Sold-out products remain visible; hidden/unpublished-only products are not
  included in successful union results.
- Existing order permissions, publication, availability, catalog revision and
  persistence paths remain unchanged. Regression tests cover invalidation
  between display and authoritative order validation, with zero failed writes.
- Persisted cart keys, customers, orders, prices and saved merchant data are not
  rewritten. The existing catalog loader's recovery semantics are unchanged.
- A previously started order submission is not newly cancelled after an
  authentication wait. That separate lifecycle behavior is outside this change.

## Acceptance and release

Tests cover GET/batch parity, bounds and loader counts; protocol fail-closed
decoding; queue/concurrency, cancellation, ABA and sibling isolation; actual
hook lifecycle; and unchanged order authority. The loopback-only synthetic
browser harness exercises actual BlockRenderer/ProductBlock and the transport,
without production credentials or writes. Fixture savings are not a universal
latency guarantee: one non-overlapping block may save little, while many
overlapping blocks avoid repeated payloads and store reads.

Release uses the new exact `public-catalog-batch` no-database lane. It preserves
the current analytics secret, pilot, original workers/processes, old immutable
assets and owned rollback. No maintenance, database action, port-range expansion
or destructive cleanup is included.

Local acceptance before publication: the focused release suite passed 250/250,
CI inventory contracts passed 30/30, all 60 unchanged migrations validated, and
full-project TypeScript, strict encoding and targeted lint passed (the release
controller retains its pre-existing unused-parameter warning). Independent
read-only review found no blocking catalog integration issue.

The fixed synthetic two-inline-block browser fixture transferred 1,218 bytes in
one completed POST versus 828 + 605 bytes in two completed GETs. StrictMode's
cancelled development-only attempts are recorded separately, not counted as
successful responses. Actual product rendering and saved in-memory cart quantity
matched. Opening the modal requested only its new collection (964 bytes), and
closing it retained the inline cart. Mobile and merchant switches selected the
new scope. The final harness adds visible snapshot numbers for late-body tests;
it is not a production benchmark and never reads real browser storage.
With visible numbered snapshots, A-B-A navigation first released snapshot 6 and
then all older bodies; both inline blocks retained snapshot 6. A deliberate 503
showed the error state with no legacy products or GET fallback. Browser-only
styled-jsx attribute warnings originate from the standalone esbuild adapter;
the actual Next production build remains a separate mandatory release gate.

The initial PR run `36106838460` failed six historical source-proof assertions
because that version added POST to the frozen GET facade. The correction moves
only the new POST to `/api/orders/catalog/public/batch` and restores the old
facade byte-for-byte. Both original historical evidence suites now pass 21/21
unchanged and are included in stage acceptance. No historical guard, fixture,
workflow, required test or permission was weakened. A fresh exact-head CI is
required; the failed run is not represented as a passing release.
