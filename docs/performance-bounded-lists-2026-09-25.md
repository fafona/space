# Bounded list performance phase — 2026-09-25

Baseline: `dd4ea2f939a804673d5e2edbf13992fcca4e8b79` (live fafona attention pilot).
Worktree: `D:/merchant-space-bounded-lists-20260925`.

## Root causes and changes

- Customers mounted every filtered record in the active responsive view.
  Render at most 50 records, retain the complete collection for search/stats,
  editing and import. Query/source/status/site transitions reset the page;
  viewport changes retain it; shrink clamps it without resurrecting old pages.
  Paging does not issue another API request or rewrite records.
- Catalog management, read-only catalog, category selection and collection
  selection mounted every product. Each now renders at most 50 products.
  Search still covers the full collection; selection IDs/drafts/revisions stay
  in their original parent state. Search Enter must not submit a containing
  edit form. Published website layouts, prices and writes are unchanged.
- Order metadata used one PostgREST query; server row caps could hide later
  chunks and incorrectly end a window. Read stable `slug,id` batches, advance
  by actual returned count, require an empty terminal probe, and restart on
  supported schema fallbacks. Repeated pages, invalid responses and overflow
  fail explicitly. The existing 10,000-row full-read safety limit also bounds
  metadata. This is not a multi-request database snapshot; concurrent deletion
  can still cause offset drift. Metadata traffic/memory scales with chunk count;
  cumulative database OFFSET work is not claimed to be linear.
  Selected chunk-body reads had the same cap issue: with cap=1, a 20-order
  window spanning two 100-order chunks returned only 10 and a false end flag.
  They now use the same bounded complete reader; metadata-listed missing chunks
  fail rather than expose a partial window. On an ordinary single-batch read,
  metadata and body each add one empty terminal probe (usually 4 queries total
  instead of 2). This is a correctness tradeoff, not a request-count reduction.

## CI delay investigation

The previous PR's exact tree passed all checks (CI `36051205521`), but the
post-merge duplicate run `36055700670` was cancelled by the 45-minute job limit.
Its first serial maintenance group passed in 14m16s. The second copy, inside
the concurrent general suite, stopped reporting in batch 7. Logs do not prove
which underlying process stalled. The original 52 runtime tests passed in
isolated local native Node and tsx runs; that alone is not Linux acceptance.

The new CI-only runner partitions the entire discovered unit/contract inventory
between existing mandatory steps with exact union/disjointness contracts.
Maintenance native proofs run once, serially, not a second time in concurrent
tsx batches. The local `npm test` remains full. All 10 CI jobs, the 45-minute
limit, schema checks, real database/startup/ingress/browser acceptance, encoding,
lint and guarded production build remain required. No skip switch or timeout
increase was introduced. New exact-head CI evidence is required before release.

First phase CI (`36068237488`, head `35bfe0a3`) stopped on one stale assertion
in `production-maintenance-topology-workflow.test.mjs`: it still required the
topology workflow test in the earlier diagnostic command, although it already
belonged to the mandatory serial maintenance group. That group completed in
10m36s (1389 passed, one failed, one platform skip), not a timeout. Update this
test-only contract to verify both exact mandatory commands and unique partition
membership; do not remove coverage or retry the unchanged failing head. The
remaining 511-file local suite completed in 13 batches with zero failed batches.

## Scope and limits

No migration, saved configuration/data changes, source writes, permission/auth,
worker, dependency or booking-automation changes. This phase reduces DOM work
and corrects bounded reads; customer/catalog API payloads and full server-side
aggregation are unchanged. It is not evidence of unlimited account capacity or
completion of incremental customer/product/order storage work.

## Acceptance and release

Local focused behavioral tests cover full search, selection retention, empty and
last pages, 10,000-customer render bounds, draft identity, schema fallback and
capped order reads. The synthetic-only loopback browser harness uses the real
components and installed Tailwind; all non-GET requests are denied and no
production session or data is used. It is not full authenticated E2E coverage.

Observed local acceptance before submission: 178/178 focused tests, strict
encoding and schema-file validation passed. Chrome exercised 1,000-product
pagination (50 mounted), search for product 1,000, a page-two selection retained
after search, the preselected product 999, and search Enter leaving both category
and collection forms open. The 390px layout initially exposed a grid intrinsic
width overflow; explicit single-column tracks corrected it without changing
desktop columns. Customer UI exercised 123 total records, 50 first-page / 23
last-page rows, full search for customer 123, and an unsaved edit across the
390px/1440px breakpoint. Synthetic fixtures only; no real save was attempted.

Release is a separate exact `bounded-lists` lane: candidate tests + unchanged
guarded build + smoke, then `ready-no-database` and owned traffic activation.
Every database action is forbidden. Existing analytics secret and enabled
fafona pilot are preserved; all old workers/assets remain available. No
maintenance, cleanup or destructive rollback is performed. Publication evidence
must identify the tested/merged tree and actual live target; this document is
not by itself a claim that the candidate is already online.
