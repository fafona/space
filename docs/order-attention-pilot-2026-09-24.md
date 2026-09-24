# Owner order-attention summary pilot

## Authorization and scope

On 2026-09-24 the user approved the explicitly proposed **fafona-only** order
summary pilot: one private derived table, compatible capture, bounded backfill,
reconciliation, no-maintenance publication and a retained legacy fallback.
Read-only production identity inspection confirmed `10000000 = fafona` before
implementation. This is not authorization to migrate V1 business stores or to
rewrite orders, memberships, points, customer identities or history.

Baseline: `0106e4650601cf60a150d0acd3cf90ba26805f6e`. The original dirty workspace
is not a release source. Work is isolated on `perf/order-attention-pilot-20260924`.

## Root cause and design

The owner sidebar polls the full order collection to display an attention count
and just one newest notification. Repeated transfer, JSON parsing and reduction
grow with all historical orders even when nothing changed.

The new opt-in `GET /api/orders?siteId=10000000&attention=1` returns only the
existing `{count, latest}` notification representation. Existing site resolution,
`orders.view`, owner identity and feature checks precede the summary branch.
Personal, employee, detail and paginated reads retain their original paths.
Employees retain their existing customer-data redaction; owner payloads are never
shared with them. All existing private/no-store response headers remain.

No order-writing RPC is replaced. Migration 052 installs a **deferred, ALWAYS,
AFTER ROW constraint trigger** over source pages, plus an ALWAYS statement guard
for clearing the source relation. Changes to either OLD or NEW relevant slug
invalidate the fixed merchant summary and increment its generation in the same
source transaction. Enrollment happens under the source relation lock in the
same migration transaction, with the pilot disabled by default.

Source changes cannot commit while retaining an older valid summary: a capture
failure aborts that transaction. Projection computation failures happen outside
the business transaction and simply retain the original full-read fallback.
The unchanged v1 transaction still owns orders, points and both history stores.

The read RPC's STABLE snapshot pairs generation with source. Its ready path reads
one primary-key summary row, the merchant existence check and capture metadata;
it does not fetch `pages.blocks`, invoke booking automation, or read V1/parity.
Dirty summaries are rebuilt in JavaScript using the original store merge and
normalization. Publishing checks exact **epoch + decimal-string bigint generation**.
A late result cannot replace a newer generation or a reset epoch. Read/publish
RPCs run as separate transactions, never from inside a source-writing transaction.

This is a read-through summary, **not** an incremental order-write migration.
The first read after a change does O(N) validation/reduction; normal unchanged
polls read the tiny summary. Existing source writes and full workbench reads are
not made constant cost by this pilot.

## Semantic and resource bounds

- Pending and never touched only; restored/touched orders are not new.
- Original chunk-over-root precedence, numeric chunk order and first-ID-wins.
- Existing item normalization recalculates all-item totals; raw totals are not trusted.
- Existing customer fallback, first-two-item text, UTF-16 72-character truncation,
  updated/created timestamp order and UTF-16 notification key tie comparison.
- Ambiguous dates, browser-origin-dependent attachment previews, invalid scope,
  malformed/noncanonical source or unsupported payloads fall back, never return
  a fabricated zero count and never repair original records.
- Maximum 512 source rows and 8 MiB uncompressed source JSON per rebuild; no
  partial/truncated projection. Transport budget is 6 seconds. Reconciliation
  attempts are bounded to three and the production operation to one minute.
- No raw SQL errors, source rows, customer details or notification content in
  operational reports. Reports contain revision, counts, byte counts and hashes.
- Successful summaries are **not written into the full-order browser cache**.
  Existing visibility pause, abort, timeout, backoff and late-response guards stay.

The table has RLS and no client or service direct-table grants/policies. Only the
two read/publish RPCs are executable by `service_role`; helper/trigger functions
are private. Unexpected inherited table, column and function grants are removed
for these new objects. No additional indexes besides the singleton PK are added.

## Publication and rollback

Only the exact `order-attention` release lane may apply 052. Existing performance
and QR lanes remain database-forbidden; analytics permissions are not broadened.

1. Build the exact-main independent candidate, with
   `FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=0`, background jobs paused, all original
   processes and traffic unchanged.
2. Verify an encrypted backup before the narrowly allowlisted additive migration.
   This is an on-host encrypted backup, not an off-host disaster-recovery claim.
3. `scripts/order-attention-pilot.ts enable` verifies the approved merchant,
   projects and compares two independent snapshots, enables under revision CAS
   with a fresh epoch, rebuilds, then compares again. It never updates pages.
4. Enable only the private candidate's environment and recheck its routes.
   Immediately before traffic activation, reconcile again and validate the
   machine-readable proof; preserve original workers and immutable assets.
5. Owned nginx switching and public smoke checks use the existing online flow.
   No maintenance window, business-data repair, process cleanup or original
   worker restart is part of this release.

Rollback restores the owned prior traffic configuration first. The baseline has
no enabled summary consumer; preserve compatible schema/source/derived data.
Disable the candidate's pilot flag without restarting any original worker.
The scoped `disable` operation may explicitly retire the derived epoch; no
business records or schema are deleted.

Privileged DROP/restore or trigger disabling is outside normal write capture.
Before such an operation disable the pilot; afterward replace epoch, clear the
projection, restore capture and reconcile before re-enabling. A currently enabled
trigger does not prove it was continuously enabled in the past. This limitation
must not be hidden by periodic repair or an automatic zero badge.

## Verification evidence before release

- Local focused tests cover old order/transaction behavior, exact notification
  semantics, projection, route authorization, UI cache isolation/abort, operation
  guards and migration contracts. Typecheck passes on the isolated worktree.
- The mandatory existing Transaction PostgreSQL Acceptance CI job additionally
  creates a fixed fresh disposable PG15 database for the actual 045+052 SQL.
  It tests deferred capture, ACLs, old writers, races, rollback, replica mode,
  source limits and epoch resets. Static tests alone are not its acceptance.
  This self-contained job now runs alongside Quality for early SQL feedback;
  all ten jobs must still succeed before publication. No test is removed.
- The standalone production CLI loads the exact candidate's checked, private
  configuration after verifying its identity, using Next production precedence
  without logging credentials. Service configuration is checked before SQL
  changes. Synthetic subprocess tests cover file-only configuration and process
  environment precedence; Linux CI also checks file permissions and links.
- `scripts/order-attention-benchmark.ts` is network-free and compares full JSON
  output with the actual old AdminClient reducer plus store merge. Synthetic
  100/1k/10k/20k cases use 12 timed samples after warmup. It reports p50/p95/p99,
  bytes and heap deltas; these are **not production response times or capacity**.
- Development-machine sample: dirty projection p50 ~1.52/12.09/141.53/289.94 ms,
  versus old merge/reduce ~0.87/8.13/89.53/206.77 ms. Validation costs more on a
  cold rebuild. The repeated ready-payload parse/guard is ~0.003–0.004 ms per
  operation (batched averages, excludes database/HTTP). At 20k synthetic records,
  old normalized JSON response ~13.89 MB vs ~268 bytes for the summary.

Production migration, reconciliation and HTTP evidence must be recorded from the
actual completed run, not inferred from the offline benchmark or unit tests.

## Still outside this pilot

Customer/product/order server pagination and bounded rendering, personal-order
indexes, truly incremental source writes, booking scheduler observability, catalog
storage limits and analytics retention remain separate stages. This pilot does
not establish an unlimited-user SLA or finish all project-wide optimization.
