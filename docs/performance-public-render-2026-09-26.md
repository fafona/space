# Public render derivation reuse — 2026-09-26

Baseline: `498acfbc3ff8c5662ba5ac056993836af761ee6b`.
Worktree: `D:/merchant-space-customer-read-shadow-20260925`.
Local implementation and acceptance only; no production publication or latency
claim is implied by this document.

## Confirmed repeated work

`SitePageClient` owns `usePullToRefresh` state. Each touch move updates the pull
distance and renders the component. Before this change, every render called the
desktop/mobile plan normalizers, deeply copying all plans/pages, followed by
another defensive clone of the active page. Fresh nested product arrays also
invalidated existing product normalization memos even when the source was unchanged.

The component now memoizes desktop/mobile plan derivation by the published source
array and the active-page defensive clone by its actual selected source. All new
hooks precede every early return, but active-page cloning waits until the existing
loading gates permit content rendering. Existing normalizers, defensive clone semantics,
page/viewport resolution and publication/revalidation paths are retained. Published
server loads, local parse/sanitize and remote sanitize replace arrays; source IDs
are not used as an invalidation token. There is no global or cross-visit cache.

`ProductBlock` already memoized normalization and category arrangement, but repeated
search, selected-category filtering, page slicing and category grouping on each
cart/customer input and animation render. Those four pure derivations now depend
only on their actual data/rule/selection inputs. Loading/error/empty/ungrouped
states still do not invoke grouping. Product normalization, search semantics,
category order, page clamps, layout, cart effects, persistence, transport, pricing
and authoritative order submission are unchanged.

## Acceptance

- Actual `SitePageClient` and actual touch hook, with deterministic browser/hook
  adapters: 20 touch frames, cancel and unrelated merchant-label updates reuse
  plans and active-page clones. Switching page/viewport, same-ID fresh server
  data and local publication invalidate correctly. Loading/maintenance/content
  transitions retain hook order. Tests freeze source inputs and assert isolation.
  A retained local source during hydration performs no active-page clone until
  content can render, then one clone reused by subsequent unrelated renders.
- Actual `ProductBlock` pure derivation and handler regressions are separate from
  transport acceptance. They test the four dependency boundaries, not wall-clock
  speed thresholds or a particular React scheduler implementation. Eleven tests
  reconstruct the actual baseline component from frozen original declarations
  and verify its complete SHA-256 before comparing full render output and handler
  sequences. Discarding all memo caches must also preserve frozen inputs and cart
  state: correctness does not depend on React retaining a memo.
- The existing loopback-only `public-catalog-batch-browser-harness.mjs` was reused
  with real `BlockRenderer`/`ProductBlock`, installed React/Tailwind, synthetic
  catalogs and memory-only storage. No production session or data was used.
  Search `QA-1` narrowed the first collection; increasing its quantity to one and
  an unrelated redraw preserved the query/cart and issued no new catalog request.
  The product overlay requested only its newly mounted collection. Closing it,
  switching to mobile and changing the synthetic merchant showed the correct new
  products. An intentional 503 rendered the existing sync error, not legacy data.
- The standalone esbuild harness retains its known styled-jsx DOM attribute
  warnings (`jsx`/`global`); it is not a Next production build. No new component
  runtime exception was observed before the deliberate 503 scenario.

Final root validation: **552 distinct TS tests** passed in the combined
booking/customer/adapter/public-catalog/render suite, along with 61 SQL/static
isolation contracts and 9 native PostgreSQL
compatibility groups. Full-project TypeScript, focused ESLint, strict encoding,
64 automatic migration-file checks and `git diff --check` passed. These are
targeted local regressions, not the complete CI inventory or production capacity
acceptance. The experimental CAS remains outside automatic migrations.

## Deliberate limits

This reduces repeated client CPU and temporary allocations. It does not reduce
the first plan payload, paginate the public product database, change SSR output,
or prove a production p95/maximum supported merchant size. The customer read-model
and booking-source experiments remain offline and are not activated by these UI
changes. Their persisted-source/worker cutover requires separate authority and
compatibility/reconciliation evidence; see the booking cutover contract.

Publication must remain a no-maintenance candidate release with exact-head checks,
existing worker/asset preservation, safe rollback and public verification. This
worktree includes offline migrations/experiments and must not be passed blindly to
the narrow no-database release lane or have its guards widened to force a release.
