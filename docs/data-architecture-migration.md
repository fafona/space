# Data architecture migration

## Objective

Move transactional merchant data out of `pages.blocks` without interrupting
existing merchants or risking data loss. Page layout and editor configuration
remain JSON documents; orders, customers, balances, points, bookings, coupons,
and messages become first-class records.

## Safety principles

- No big-bang rewrite.
- No destructive database migration.
- Every mutation is idempotent.
- Money and points use append-only ledger entries.
- Existing storage remains the rollback source until parity is proven.
- A read-path switch requires metrics, reconciliation, and a tested rollback.

## Rollout sequence

### Stage 0: foundation

- Add versioned migrations and migration validation.
- Create customer, order, order item, order event, ledger, idempotency, and
  outbox tables.
- Do not change current application behavior.

### Stage 1: order dual-write

- Add a repository interface around the current order store.
- Write each successful order mutation to both the legacy snapshot and the new
  tables under one application operation ID.
- Keep legacy storage as the source of truth.
- Record and alert on mismatches without blocking the merchant.

Runtime controls:

- `MERCHANT_ORDER_V1_DUAL_WRITE_MODE=off` keeps the bridge completely inactive.
- `MERCHANT_ORDER_V1_DUAL_WRITE_MODE=shadow` writes only after the legacy
  mutation succeeds. A new-store failure is logged but never changes the
  already successful merchant operation.
- `MERCHANT_ORDER_V1_DUAL_WRITE_TIMEOUT_MS` bounds the extra shadow-write wait.
  Keep the default until staging latency has been measured.
- Do not enable `shadow` until migrations `202607250001` and `202607250002`
  have both been applied and the RPC has passed a staging smoke test.

Operational checks:

- Run `npm run check:order-v1-ready` before changing the runtime mode. It checks
  the migration registry, relational tables, and an empty atomic RPC call.
- Run `npm run audit:order-v1 -- --site=10000000` for one merchant at a time.
  The command is read-only and compares order counts, statuses, totals,
  timestamps, print counts, and line items without printing customer details.
- An exit code of `0` means parity, `2` means a data mismatch, and `1` means
  the database or schema was unavailable.

Historical backfill:

- `npm run backfill:order-v1 -- --site=10000000` is a dry run. It reads and
  validates one merchant, plans bounded batches, and performs no V1 write.
- A write requires all three safeguards: the environment variable
  `ORDER_V1_BACKFILL_WRITE_ENABLED=true`, the `--write` flag, and an exact
  `--confirm=10000000` merchant confirmation. Batch size is limited to 1-50
  and defaults to 10.
- The command checks migrations and the empty RPC immediately before writing,
  processes batches sequentially, then reloads both stores and reconciles them.
  It never deletes legacy rows and never prints customer details.
- Each order and event is idempotent. If a later batch fails, correct the
  external cause and rerun the same command; already completed batches are
  updated in place and do not duplicate events.
- Keep the write guard disabled outside the single operator shell. A successful
  backfill does not enable the V1 read path or change the source of truth.

Acceptance criteria:

- At least seven days with no unexplained order mismatch.
- Duplicate retries produce one logical mutation.
- New writes can be reconstructed from order events.
- Legacy-only rollback remains available.

### Stage 2: order read switch

- Backfill historical orders in bounded batches.
- Compare counts, totals, quantities, statuses, and timestamps per merchant.
- Read from the new tables behind a merchant-scoped feature flag.
- Fall back to legacy reads when the new store is unavailable.

Runtime controls:

- `MERCHANT_ORDER_V1_READ_MODE=off` is the default and does not query the V1
  tables.
- `MERCHANT_ORDER_V1_READ_MODE=verify` loads both stores, compares the complete
  normalized order payload, records a PII-free parity event, and always returns
  the legacy result.
- `MERCHANT_ORDER_V1_READ_MODE=primary` still loads both stores and returns V1
  order objects only after exact parity. A timeout, missing table, malformed
  row, missing order, content mismatch, or pagination mismatch automatically
  returns the legacy result.
- `MERCHANT_ORDER_V1_READ_SITE_IDS` is a comma-separated allowlist of exact
  eight-digit merchant IDs. There is deliberately no wildcard.
- `MERCHANT_ORDER_V1_READ_TIMEOUT_MS` bounds only the V1 observation. Keep the
  default until production verification establishes normal query latency.

Scope and rollback:

- The switch applies only to merchant order list reads. Personal order reads
  and every order mutation remain on the legacy store during this stage.
- V1 order and item rows are converted back into the existing application
  contract before comparison, so the API and UI do not receive a new schema.
- Full and windowed reads preserve legacy ordering and pagination metadata.
- Rollback is an environment-only change: set
  `MERCHANT_ORDER_V1_READ_MODE=off`. No data deletion or reverse migration is
  required.

Activation sequence for each merchant:

1. Apply and validate migrations `202607250001` and `202607250002`.
2. Backfill the merchant and run `npm run audit:order-v1 -- --site=10000000`
   until it reports parity.
3. Add only that merchant ID to `MERCHANT_ORDER_V1_READ_SITE_IDS` and use
   `verify` mode.
4. Review parity, fallback, timeout, and latency events for at least seven days.
5. Change to `primary` for the same allowlist. Keep the legacy snapshots and
   dual-write active throughout the retention window.

### Stage 3: membership ledger

- Backfill member identities and opening balances.
- Convert recharge, redeem, reversal, and manual adjustment operations to
  immutable ledger entries.
- Derive balances from ledger checkpoints and verify them against legacy
  snapshots before switching reads.

Prepared implementation:

- Migration `202607250003_membership_ledger_shadow_write_rpc.sql` adds the
  legacy membership identity key and the atomic customer/ledger bridge RPC.
- The bridge splits each legacy transaction into independent points,
  stored-value, and growth entries. Stored value uses currency minor units and
  growth uses a scale of 100.
- Recharge cancellation never mutates or removes an existing ledger credit.
  Its negative adjustment is appended and linked to the original entry.
- Legacy balances that cannot be reconstructed from retained transactions use
  explicit `opening_balance` or `legacy_reconciliation` entries. These entries
  are immutable and auditable.
- Live shadow writes are default-off and require both
  `MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_MODE=shadow` and an exact merchant ID in
  `MERCHANT_MEMBERSHIP_V1_DUAL_WRITE_SITE_IDS`.
- Shadow failures and timeouts do not roll back a successful legacy save.

Safe operator sequence for one merchant:

1. Confirm the merchant's ISO 4217 stored-value currency.
2. Run a read-only plan:
   `npm run backfill:membership-ledger-v1 -- --site=10000000 --currency=EUR`
3. Apply and verify migrations `202607250001` through `202607250003`.
4. Set `MEMBERSHIP_V1_BACKFILL_WRITE_ENABLED=true` only in the operator shell,
   then run:
   `npm run backfill:membership-ledger-v1 -- --site=10000000 --currency=EUR --write --confirm=10000000`
5. Require a clean independent audit:
   `npm run audit:membership-ledger-v1 -- --site=10000000 --currency=EUR`
6. Add only that merchant to the shadow-write allowlist. Keep all membership
   reads on the legacy snapshot until a separate read adapter has completed its
   verification period.

Backfill is idempotent. Never delete ledger rows to retry it; rerun the same
confirmed command and then audit again.

### Stage 4: bookings, coupons, and conversations

- Migrate each domain independently using the same dual-write, reconcile, and
  feature-flag process.
- Link every domain to the canonical merchant customer record.

Booking preparation:

- Migration `202607250004_booking_shadow_write_rpc.sql` adds first-class
  booking and booking-event tables plus a service-role-only atomic bridge RPC.
- Appointment time remains the exact merchant-local value used by the current
  booking rules. It is deliberately not assigned a timezone during shadow
  migration.
- Identifiable booking customers are linked to `merchant_customers` by account,
  authenticated user, guest hash, email, then phone. Existing membership
  profile data is retained when booking contact details are merged.
- Edit tokens are never copied into V1. The current booking snapshot, automation
  state, email-delivery state, and timeline are retained without that secret.
- Timeline entries and snapshot revisions use deterministic idempotency keys.
  Repeating a shadow write or backfill does not duplicate logical events.
- Live booking shadow writes require both
  `MERCHANT_BOOKING_V1_DUAL_WRITE_MODE=shadow` and an exact merchant ID in
  `MERCHANT_BOOKING_V1_DUAL_WRITE_SITE_IDS`. Failures remain non-blocking.

Safe booking sequence for one merchant:

1. Run the read-only plan:
   `npm run backfill:booking-v1 -- --site=10000000`
2. Apply and verify migrations `202607250001` through `202607250004`.
3. Set `BOOKING_V1_BACKFILL_WRITE_ENABLED=true` only in the operator shell,
   then run:
   `npm run backfill:booking-v1 -- --site=10000000 --write --confirm=10000000`
4. Require a clean independent audit:
   `npm run audit:booking-v1 -- --site=10000000`
5. Add only that merchant to the booking shadow-write allowlist. Keep all
   booking reads on the legacy snapshot until a separate verified read adapter
   has completed its observation period.

The booking backfill is bounded, rerunnable, and never deletes legacy records.

Coupon preparation:

- Migration `202607250005_coupon_shadow_write_rpc.sql` adds first-class coupon,
  claim, redemption, and immutable event tables.
- Claim access codes and settlement credentials are SHA-256 digests in V1.
  Plaintext credentials are excluded from both the normalized rows and the
  retained source snapshots.
- Claims link to canonical merchant customers by account, authenticated user,
  then email. Existing membership and booking profile data is retained.
- A redemption release changes the V1 redemption state to `released`; it does
  not delete the redemption or its audit events.
- Live coupon shadow writes require both
  `MERCHANT_COUPON_V1_DUAL_WRITE_MODE=shadow` and an exact merchant ID in
  `MERCHANT_COUPON_V1_DUAL_WRITE_SITE_IDS`. Failures remain non-blocking.

Safe coupon sequence for one merchant:

1. Run the read-only plan:
   `npm run backfill:coupon-v1 -- --site=10000000`
2. Apply and verify migrations `202607250001` through `202607250005`.
3. Set `COUPON_V1_BACKFILL_WRITE_ENABLED=true` only in the operator shell,
   then run:
   `npm run backfill:coupon-v1 -- --site=10000000 --write --confirm=10000000`
4. Require a clean independent audit:
   `npm run audit:coupon-v1 -- --site=10000000`
5. Add only that merchant to the coupon shadow-write allowlist. Keep all coupon
   reads and business decisions on the legacy snapshot until a separate
   verified read adapter has completed its observation period.

Coupon backfill is bounded, rerunnable, and never deletes legacy records.

Conversation preparation:

- Migration `202607250006_conversation_shadow_write_rpc.sql` adds first-class
  threads, participants, immutable messages, saved contacts, and monotonic
  read cursors.
- Merchant peer threads and platform-support threads use separate stable IDs.
  The platform participant is represented by `faolla-support`; message bodies
  and attachment text remain byte-for-byte compatible with the legacy chat.
- A repeated message ID with different sender, body, or timestamp is rejected
  as a conflict. Existing messages are never updated or deleted.
- A platform-support backup restore archives a removed thread but retains its
  participants and messages. Independent reconciliation treats that retained
  support history as expected, not as corruption.
- Saved peer contacts link to canonical `merchant_customers`. The helper
  resolves by the contact account before email, preserving existing customer
  profile data.
- Read cursors can only advance. The dry-run also verifies that each legacy
  cursor points to a real incoming message in its thread.
- Conversation tables expose no authenticated direct-read policy during this
  stage. Current JSON snapshots remain the sole read and business source.
- Live conversation shadow writes require both
  `MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE=shadow` and an exact account ID in
  `MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS`. Wildcards are rejected and
  failures remain non-blocking.

Safe conversation sequence for one merchant:

1. Run the read-only plan:
   `npm run backfill:conversation-v1 -- --site=10000000`
2. Resolve every reported identity, timestamp, duplicate, or cursor blocker.
3. Apply and verify migrations `202607250001` through `202607250006`.
4. Set `CONVERSATION_V1_BACKFILL_WRITE_ENABLED=true` only in the operator
   shell, then run:
   `npm run backfill:conversation-v1 -- --site=10000000 --write --confirm=10000000`
5. Require a clean independent audit:
   `npm run audit:conversation-v1 -- --site=10000000`
6. Add only that merchant to the conversation shadow-write allowlist. Keep all
   chat reads on the legacy snapshots until a separate privacy-reviewed read
   adapter completes its verification period.

Conversation backfill is bounded and rerunnable. Contacts are written before
their use, thread batches are written before read cursors, and no operator
command deletes legacy or V1 history.

### Stage 5: asynchronous operations

- Process notifications, Google synchronization, asset conversion, publishing,
  backups, and external webhooks from the outbox.
- Add retries, dead-letter handling, operation status, and latency metrics.

Prepared foundation:

- Migration `202607250007_reliable_outbox_runtime.sql` extends the existing
  outbox with bounded attempts, priority, correlation IDs, leases, cumulative
  attempt counts, dead-letter timestamps, results, and replay metadata.
- Each claim is atomic and uses `FOR UPDATE SKIP LOCKED`. A worker can only
  complete or fail the attempt while it owns an unexpired lease. Expired leases
  are recovered on the next claim; events at their attempt limit become dead
  letters instead of looping forever.
- Every processing attempt is retained in `merchant_outbox_attempts`. Manual
  replay resets only the current retry cycle; cumulative attempts and an
  append-only replay record remain available for audit.
- Enqueue is idempotent per merchant and opaque event key. Reusing the same
  operation returns the existing event, while changing the event identity or
  payload under that key is rejected as a conflict.
- Task payloads are limited to 128 KiB and task results to 64 KiB. The
  application contract rejects token, password, secret, authorization, cookie,
  credential, API-key, and private-key fields at any nesting depth.
- The RPC surface is restricted to `service_role`. The health RPC returns only
  aggregate counters and durations; it never exposes payloads, event keys,
  aggregate IDs, customer details, or error text.
- The worker coordinator claims only event types with registered handlers,
  renews leases while work is active, applies bounded task timeouts, and sends
  stable error codes rather than exception messages to storage.
- Handlers must be idempotent and must pass the supplied `AbortSignal` to every
  cancellable external request. A JavaScript promise cannot forcibly stop an
  external side effect after timeout, so handler review must verify this before
  enabling an event type.

Runtime controls:

- `MERCHANT_OUTBOX_V1_ENQUEUE_MODE=off` is the default and performs no RPC.
- `shadow` still requires an exact merchant ID in
  `MERCHANT_OUTBOX_V1_ENQUEUE_SITE_IDS` and an exact supported type in
  `MERCHANT_OUTBOX_V1_ENQUEUE_EVENT_TYPES`. Empty allowlists enqueue nothing,
  and wildcards are rejected.
- This stage does not start a worker and does not replace any current
  notification, Google sync, conversion, publishing, backup, or webhook path.
  Each handler must complete its own staging verification before one existing
  side effect is moved behind the outbox.

Safe outbox sequence:

1. Apply and verify migrations `202607250001` through `202607250007`.
2. Run the read-only aggregate audit:
   `npm run audit:outbox-v1`
3. Optionally scope the audit without exposing task data:
   `npm run audit:outbox-v1 -- --site=10000000`
4. Start a staging worker with one registered event type and no production
   enqueue allowlist. Verify lease expiry, retry, dead-letter, replay, duplicate
   enqueue, and handler timeout behavior.
5. Enable one low-risk event type for one merchant. Keep its original
   synchronous path available until outbox completion, latency, and duplicate
   delivery metrics are stable.
6. Move domains independently. Never enable all event types or all merchants
   through a wildcard.

Rollback is an environment-only enqueue shutdown. Set
`MERCHANT_OUTBOX_V1_ENQUEUE_MODE=off`, stop the worker, and use the existing
business path. Do not delete queued events, attempts, or replay history.

### Stage 6: scoped Google review sync pilot

- Keep the current synchronous Google review refresh as the response source.
- Mirror stale refresh requests into the outbox only when the generic Stage 5
  enqueue mode and both exact allowlists are enabled.
- Process the mirrored work with a one-shot, merchant-scoped operator command
  before considering any continuously running worker.

Prepared implementation:

- Migration `202607250008_scoped_outbox_claim.sql` adds a separate claim RPC
  that requires non-empty exact merchant and event-type scopes. Both lease
  recovery and new claims are restricted by those scopes and continue to use
  `FOR UPDATE SKIP LOCKED`.
- The application worker uses only the scoped claim RPC. It rejects empty,
  wildcard, duplicate, malformed, or oversized merchant scopes before calling
  the database.
- `google.reviews.sync` carries only the merchant ID, reason, bucketed request
  time, and aggregate identity. OAuth tokens and integration secrets remain in
  the encrypted integration store and never enter the outbox payload or task
  result.
- Google API requests receive the worker `AbortSignal`, so a task timeout or
  lost lease cancels the in-flight request. Authorization and configuration
  errors are terminal; rate limits, timeouts, aborts, and server failures use
  bounded retries.
- The stale public-review route starts shadow enqueue beside the existing sync
  rather than in front of it. With the default settings it performs no enqueue
  RPC, and enqueue failure cannot change the legacy response.
- `npm run worker:outbox-v1:once` has no loop or scheduler. It requires the
  operator-only environment guard, one exact eight-digit merchant ID, and an
  identical confirmation value. Its only registered handler is
  `google.reviews.sync`.

Safe pilot sequence for one merchant:

1. Apply and verify migrations `202607250001` through `202607250008` in
   staging, then run `npm run audit:outbox-v1 -- --site=10000000`.
2. Set the enqueue mode to `shadow`, allowlist only merchant `10000000`, and
   allowlist only event type `google.reviews.sync`.
3. Trigger one stale review read and verify that the legacy refresh still
   returns the displayed snapshot while exactly one bucketed outbox event is
   present.
4. In a dedicated operator shell only, set
   `MERCHANT_OUTBOX_V1_WORKER_EXECUTION_ENABLED=true` and run:
   `npm run worker:outbox-v1:once -- --site=10000000 --confirm=10000000`
5. Verify the saved review snapshot, aggregate health, attempt outcome, retry
   behavior, and duplicate suppression. Repeat the one-shot command only after
   reviewing the previous result.
6. Keep continuous worker execution and removal of the legacy sync path out of
   this pilot. Those require separate latency, duplicate-delivery, and
   operational-alert acceptance criteria.

Rollback is immediate and non-destructive: set
`MERCHANT_OUTBOX_V1_ENQUEUE_MODE=off`, leave
`MERCHANT_OUTBOX_V1_WORKER_EXECUTION_ENABLED=false`, and continue using the
existing synchronous review refresh. Retain all queued events and attempt
history for audit.

### Stage 7: booking read verification

- Observe booking V1 parity on explicitly allowlisted merchant list reads.
- Keep the legacy booking snapshot as the only returned business result.
- Do not expose a primary V1 booking read mode until a separate observation
  period, customer self-service review, and rollback acceptance are complete.

Prepared implementation:

- `MERCHANT_BOOKING_V1_READ_MODE=off` is the default and performs no V1 query.
  The only accepted active value is `verify`; `primary`, wildcard values, and
  unknown modes are rejected by falling back to `off`.
- `MERCHANT_BOOKING_V1_READ_SITE_IDS` accepts exact eight-digit merchant IDs
  only. Verification never runs for merchants outside that allowlist.
- After the existing legacy load and booking automation complete, full and
  paginated merchant reads observe V1 under a bounded timeout. Timeout, query
  failure, missing rows, invalid rows, count drift, ordering drift, content
  drift, or pagination drift all return the original legacy result.
- V1 rows are reconstructed only from the sanitized `source_snapshot`.
  Cross-merchant identities, duplicate booking IDs, malformed timestamps,
  invalid statuses, and any snapshot containing `editToken` are rejected.
- Verification compares the complete public management record, including
  automation state, customer email logs, timeline, and window metadata when
  requested. Logs contain only aggregate counts, stable reason codes, and a
  bounded list of booking IDs; logging failure cannot affect the read.
- Personal booking reads and every booking mutation remain entirely on the
  legacy path in this stage.

Safe verification sequence for one merchant:

1. Apply migrations `202607250001` through `202607250004`, run the booking
   backfill, and require a clean
   `npm run audit:booking-v1 -- --site=10000000`.
2. Keep booking dual-write active for that merchant so later automation and
   status changes continue to reach V1.
3. Set `MERCHANT_BOOKING_V1_READ_MODE=verify`, add only `10000000` to
   `MERCHANT_BOOKING_V1_READ_SITE_IDS`, and keep the default timeout initially.
4. Observe parity, timeout, fallback, and latency events for at least seven
   days across full list, paginated workbench, calendar, and notification
   reads.
5. Resolve every mismatch at the writer or mapper. Do not suppress comparison
   fields and do not enable a primary booking read during this stage.

Rollback is an environment-only change:
`MERCHANT_BOOKING_V1_READ_MODE=off`. No database mutation, reverse migration,
or data deletion is required.

### Stage 8: coupon read verification

- Observe the complete coupon V1 projection on explicitly allowlisted merchant
  snapshot reads while keeping the legacy coupon document as the only returned
  business result.
- Do not reconstruct claim or settlement secrets from V1. V1 intentionally
  stores those values as hashes, so this stage is verification-only and has no
  `primary` mode.

Prepared implementation:

- `MERCHANT_COUPON_V1_READ_MODE=off` is the default and performs no V1 query.
  The only accepted active value is `verify`; `primary`, wildcard values, and
  unknown modes resolve to `off`.
- `MERCHANT_COUPON_V1_READ_SITE_IDS` accepts exact eight-digit merchant IDs
  only. A bounded timeout applies to the complete observation.
- Allowlisted coupon snapshot reads load `merchant_coupons`,
  `merchant_coupon_claims`, `merchant_coupon_redemptions`, and
  `merchant_coupon_events` in parallel, using deterministic bounded
  pagination. Every row must retain the requested merchant identity and a
  complete entity identity.
- The existing reconciliation projection compares coupon configuration and
  sanitized source snapshots, hashed claim and settlement codes, customer
  linkage, claim state, active and released redemption history, and
  idempotent event coverage. Timeout, query failure, invalid identity, missing
  data, or any mismatch returns the original legacy snapshot unchanged.
- Logs contain only stable reason codes, aggregate counts, and a bounded list
  of coupon IDs. Claim codes, settlement codes, customer data, and source
  snapshots are never logged. Logging failure cannot affect the read.
- Public and merchant coupon snapshot reads can be observed. Personal claimed
  coupon metadata and every create, update, claim, redeem, release, and archive
  mutation remain on their existing paths.

Safe verification sequence for one merchant:

1. Apply migrations `202607250001` through `202607250005`, run
   `npm run backfill:coupon-v1 -- --site=10000000`, then require a clean
   `npm run audit:coupon-v1 -- --site=10000000`.
2. Keep coupon dual-write enabled only for that merchant so later claims,
   redemptions, releases, and configuration changes continue to reach V1.
3. Set `MERCHANT_COUPON_V1_READ_MODE=verify` and add only `10000000` to
   `MERCHANT_COUPON_V1_READ_SITE_IDS`.
4. Observe parity, fallback, timeout, and latency for at least seven days,
   including public coupon display, management lists, claims, redemptions, and
   released-redemption compensation.
5. Resolve mismatches in the writer, sanitizer, or reconciliation mapping.
   Never weaken secret hashing and do not enable a primary coupon read during
   this stage.

Rollback is an environment-only change:
`MERCHANT_COUPON_V1_READ_MODE=off`. No database mutation, reverse migration,
or data deletion is required.

### Stage 9: conversation read verification

- Observe the complete merchant conversation projection only after the legacy
  peer inbox, platform support inbox, and read-state document have been loaded
  together for the same authenticated merchant.
- Keep those legacy documents as the only response source. This stage does not
  reconstruct a conversation response from V1 and has no `primary` mode.

Prepared implementation:

- `MERCHANT_CONVERSATION_V1_READ_MODE=off` is the default and performs no V1
  query. Only `verify` is accepted; `primary`, wildcard values, and unknown
  modes resolve to `off`.
- `MERCHANT_CONVERSATION_V1_READ_SITE_IDS` accepts exact eight-digit merchant
  IDs only. The native-notification aggregation boundary reserves at most one
  verification window per merchant and web process every 60 seconds by
  default. Concurrent requests share the reservation.
- An allowlisted verification first discovers thread IDs from the requested
  account's participant rows. Threads, all participants, messages, owned
  contacts, and the account's read cursors are then loaded with deterministic,
  bounded pagination under one total timeout.
- Every V1 row must remain within the discovered thread scope. Contacts and
  read cursors must retain the requested merchant identity, and every loaded
  thread must include that merchant as a participant. Cross-account or
  incomplete identities invalidate the observation.
- Existing reconciliation compares peer and support thread metadata,
  participants, immutable message content, contacts and customer linkage, and
  official and peer read cursors. Archived support threads and retained support
  history remain explicitly allowed.
- Timeout, query failure, invalid rows, missing data, or any mismatch returns
  the exact original legacy objects. Logs contain stable reason codes and
  aggregate counts only. Message text, attachment data, names, emails, source
  snapshots, and thread or message identifiers are never logged.
- All conversation mutations, message delivery, contact writes, read-state
  writes, notification calculation, and API response shapes remain unchanged.

Safe verification sequence for one merchant:

1. Apply migrations `202607250001` through `202607250006`, run
   `npm run backfill:conversation-v1 -- --site=10000000`, then require a clean
   `npm run audit:conversation-v1 -- --site=10000000`.
2. Keep conversation dual-write enabled only for that merchant so subsequent
   peer messages, support messages, contact changes, and read cursors continue
   to reach V1.
3. Set `MERCHANT_CONVERSATION_V1_READ_MODE=verify` and add only `10000000` to
   `MERCHANT_CONVERSATION_V1_READ_SITE_IDS`. Keep the default timeout and
   interval for the initial observation.
4. Observe parity, fallback, timeout, and latency for at least seven days while
   exercising peer chat, platform support, unread counts, contacts, and both
   official and peer read states.
5. Resolve mismatches in the writer, identity resolver, mapper, or backfill.
   Never add message content or customer data to logs, and do not introduce a
   primary conversation read during this stage.

Rollback is an environment-only change:
`MERCHANT_CONVERSATION_V1_READ_MODE=off`. No database mutation, reverse
migration, or data deletion is required.

### Stage 10: membership ledger read verification

- Observe membership identity, transaction coverage, and derived account
  balances on explicitly allowlisted merchant membership snapshot reads.
- Keep the legacy membership document as the only returned business result.
  V1 does not yet contain the complete membership profile and this stage has no
  `primary` mode.

Prepared implementation:

- `MERCHANT_MEMBERSHIP_V1_READ_MODE=off` is the default and performs no V1
  query. Only `verify` is accepted; `primary`, wildcard values, and unknown
  modes resolve to `off`.
- `MERCHANT_MEMBERSHIP_V1_READ_SITE_IDS` accepts exact eight-digit merchant IDs
  only. The complete observation has a bounded timeout and uses the same
  normalized stored-value currency as the dual writer and backfill.
- After the legacy membership snapshot and scheduled point rules finish,
  allowlisted reads load only customers with a legacy membership identity and
  only legacy membership ledger references. Both tables are merchant-scoped
  and use deterministic bounded pagination.
- Every customer and ledger row must retain the requested merchant identity.
  Customer IDs, membership identities, ledger IDs, idempotency keys,
  timestamps, account types, currency, integer amounts, reversal links, and
  customer relationships are validated before reconciliation.
- Existing reconciliation compares member number and lifecycle state,
  immutable legacy transaction entries, transaction running balances, and
  final points, stored-value, and growth balances. Opening and reconciliation
  checkpoints remain included in balance totals without depending on one
  historical checkpoint-key format.
- Timeout, query failure, invalid rows, missing data, or any mismatch returns
  the exact original legacy snapshot. Logs contain stable reason codes and
  aggregate counts only. Names, email addresses, telephone numbers, member
  numbers, transaction IDs, idempotency keys, notes, and profile data are never
  logged.
- Every membership mutation, recharge, redemption, reversal, scheduled rule,
  personal card projection, and API response shape remains on its existing
  path.

Safe verification sequence for one merchant:

1. Apply migrations `202607250001` through `202607250003`, run
   `npm run backfill:membership-ledger-v1 -- --site=10000000 --currency=EUR`,
   then require a clean
   `npm run audit:membership-ledger-v1 -- --site=10000000 --currency=EUR`.
2. Keep membership dual-write enabled only for that merchant so later
   recharges, redemptions, reversals, manual adjustments, and scheduled point
   changes continue to reach V1.
3. Confirm `MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY`, set
   `MERCHANT_MEMBERSHIP_V1_READ_MODE=verify`, and add only `10000000` to
   `MERCHANT_MEMBERSHIP_V1_READ_SITE_IDS`.
4. Observe parity, fallback, timeout, and latency for at least seven days while
   exercising member lists, cashier lookup, recharge, redemption, reversal,
   and scheduled point rules.
5. Resolve mismatches in the writer, backfill, currency configuration, or
   reconciliation mapping. Never expose personal or transaction identifiers
   in logs and do not enable a primary membership read during this stage.

Rollback is an environment-only change:
`MERCHANT_MEMBERSHIP_V1_READ_MODE=off`. No database mutation, reverse
migration, ledger rewrite, or data deletion is required.

### Stage 11: unified V1 read rollout evidence

- Turn the per-domain verification logs into a bounded, repeatable pre-switch
  decision record.
- Keep this stage read-only. It does not query the database, change feature
  flags, enable a `primary` read mode, or write production data.

Prepared implementation:

- All order, booking, coupon, conversation, and membership verification events
  now include an ISO `observedAt` value and integer `durationMs`. The duration
  covers the enabled verification call through the final parity or fallback
  decision.
- `npm run audit:v1-read-rollout` accepts raw JSON events or the existing
  prefixed console lines. It extracts only the merchant scope, domain, mode,
  outcome, reason, observation time, and duration. Extra fields from source
  logs are not retained or printed.
- Evidence must use `mode=verify`. Missing fields, malformed events, inconsistent
  outcome/reason pairs, invalid timestamps, unsafe modes, and invalid durations
  are rejected. A relevant rejected line for the selected merchant blocks the
  result instead of being silently discarded.
- The default policy evaluates all five domains independently and requires at
  least 100 samples per domain across at least 168 hours, zero fallback events,
  P95 verification latency no higher than 2500 ms, and a latest observation no
  older than 24 hours. Events more than five minutes in the future also block
  readiness.
- The output contains aggregate counts, rates, P50/P95/P99 latency, observation
  window, last-observation age, and stable blocker codes only. It never prints
  source log lines or business/customer identifiers.
- Exit code `0` means every requested domain passed. Exit code `2` means valid
  evidence was evaluated but at least one gate blocked readiness. Exit code `1`
  means the command or input failed.

Audit one merchant from a filtered JSONL export:

```powershell
npm run audit:v1-read-rollout -- --file=.\logs\v1-read.jsonl --site=10000000
```

Audit selected domains from standard input with explicit policy values:

```powershell
Get-Content .\logs\v1-read.jsonl | npm run audit:v1-read-rollout -- --file=- --site=10000000 --domains=orders,bookings --min-samples=250 --min-window-hours=336 --max-fallback-rate=0 --max-p95-ms=1500 --max-last-age-hours=12
```

The rollout audit is necessary evidence, not sufficient authorization to switch
a domain. A clean domain-specific reconciliation audit, current backfill,
healthy dual-write/outbox processing, rollback ownership, and a reviewed
merchant allowlist are still required. Run this audit before any order
`primary` switch; non-order domains in Stages 7 through 10 intentionally remain
verify-only.

## Required operational metrics

- Mutation success and latency by domain and merchant.
- Legacy/new-store mismatch count.
- Idempotency replay count.
- Outbox age, attempts, and failure count.
- Database query P50, P95, and P99 latency.
- Backfill progress and reconciliation totals.

## Rollback

Until a domain finishes its read switch and retention window, disable its
feature flag and return to the legacy read path. Never roll back by deleting the
new tables or ledger entries.
