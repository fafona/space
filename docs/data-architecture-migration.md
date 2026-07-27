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

### Stage 12: order primary rollout gate

- Convert the remaining operator prerequisites into one deterministic,
  read-only decision record before the first order `primary` canary.
- Keep the gate separate from activation. It does not query Supabase, apply a
  migration, edit environment variables, widen an allowlist, or switch traffic.

Prepared implementation:

- `npm run check:v1-rollout-gate -- --file=<manifest.json>` validates one
  eight-digit merchant and only the `orders` transition from `verify` to
  `primary`. Bookings, coupons, conversations, memberships, `off -> primary`,
  and multi-merchant canaries are blocked.
- The reviewed read allowlist must contain exactly the manifest merchant. Both
  change and rollback owners must be present as stable operator handles.
- Migrations `202607250001`, `202607250002`, `202607250007`, and
  `202607250008` must be recorded as applied. Recording a migration in the
  manifest does not apply it; the operator must obtain the applied versions
  from the production migration registry.
- Order dual-write must still be in `shadow` for the merchant, report zero
  errors, have a current observation, and have been continuously healthy before
  the first read-evidence observation for at least 168 hours.
- Backfill evidence must be complete with zero failures and equal source and
  written counts. A current reconciliation must report equal legacy, V1, and
  matched counts with no missing, unexpected, or mismatched orders.
- The embedded Stage 11 report must be scoped only to `orders`, use policy
  values at least as strict as the defaults, contain no rejected evidence
  lines or fallbacks, and remain current when the gate runs. A previously ready
  but now stale report is blocked.
- The Outbox snapshot must be scoped to the same merchant, no older than 15
  minutes, and pass the existing health evaluator. Retry and attempt-limit
  observations remain visible as warnings; dead letters, expired leases,
  unknown event types, or excessive due age block rollout.
- Timestamps more than five minutes in the future are blocked. The command
  prints only scope, transition, required migration versions, stable blocker
  codes, and health warnings. It does not print source evidence or business
  identifiers.
- Exit code `0` means the manifest satisfies the prepared canary gate. Exit
  code `2` means valid input was evaluated but rollout is blocked. Exit code
  `1` means the file, JSON, or command input failed.

Run a prepared single-merchant decision:

```powershell
npm run check:v1-rollout-gate -- --file=.\private\order-v1-canary-10000000.json
```

The manifest is an operator evidence bundle, not a source of truth. Populate it
from the production migration registry, a completed backfill summary, a fresh
domain reconciliation, the Stage 11 order-only report, and a fresh
merchant-scoped Outbox health snapshot. Store it outside the repository because
operational owner handles and rollout timing are environment-specific.

A `ready` result still requires an approved change window and a human-reviewed
rollback command. The first activation must change only
`MERCHANT_ORDER_V1_READ_MODE=primary` and the exact single-site
`MERCHANT_ORDER_V1_READ_SITE_IDS` allowlist, together with the Stage 13 order
primary circuit-breaker settings. Roll back by setting the mode to `off`; never
delete V1 rows or reverse a migration during incident response.

### Stage 13: order primary automatic circuit breaker

- Protect the approved single-merchant order `primary` canary after activation.
  This protection is process-local, read-path-only, and default-off. It does not
  write business data, alter feature flags, or affect `verify` observations.
- Enable it only for a Stage 12-ready order canary:
  `MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED=true`.
- A timeout, V1 query failure, missing V1 envelope, or exact-parity mismatch is
  a circuit failure. The default threshold is three failures in 60 seconds.
  Legacy-source failures are not counted as V1 failures.
- When the threshold is reached, that process stops querying V1 for the merchant
  and returns the legacy result. Each suppressed request emits the existing
  `merchant_order_v1_read` event with `outcome=fallback` and
  `reason=circuit_open`.
- The default cooldown is five minutes. Once it expires, exactly one request per
  process becomes a half-open parity probe. Concurrent requests keep using the
  legacy source. Exact parity closes the circuit; a failed or inconclusive probe
  restarts the cooldown.
- Circuit state is isolated by exact eight-digit merchant ID. A failure for one
  merchant cannot open another merchant's circuit. Process restart clears the
  in-memory state; this is intentional because legacy fallback remains the
  authoritative safety mechanism.
- The values are bounded even when environment input is malformed:
  failure threshold `2..20`, window `10000..3600000` ms, and cooldown
  `30000..3600000` ms.

Recommended canary settings:

```dotenv
MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED=true
MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_WINDOW_MS=60000
MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_COOLDOWN_MS=300000
```

The circuit breaker reduces repeated V1 pressure and user-visible failures; it
does not replace operator rollback. Any `circuit_open` event or primary fallback
must trigger investigation and a prompt switch of
`MERCHANT_ORDER_V1_READ_MODE=off` for the canary.

### Stage 14: order primary canary watchdog

- Evaluate only post-activation `merchant_order_v1_read` events for one exact
  merchant. The activation timestamp is required so prior `verify` evidence
  cannot make a new `primary` canary look healthy.
- `npm run audit:v1-primary-canary` is read-only. It reads a JSONL file or
  standard input, ignores unrelated domains, other merchants, and observations
  before activation, and never changes environment variables or business data.
- The default healthy threshold is 100 clean samples over 1440 minutes, with a
  current observation no older than 15 minutes and P95 duration no greater than
  2500 ms.
- Any post-activation fallback immediately returns `rollback_required`, even
  while the canary is still accumulating samples. `circuit_open` receives an
  additional explicit rollback reason. A P95 regression also requires rollback.
- Missing, thin, stale, future, malformed, or non-primary evidence returns
  `observing`. This keeps low traffic and evidence-integrity problems distinct
  from an observed V1 failure.
- Exit code `0` means healthy, `2` means rollback required, `3` means keep
  observing or repair evidence, and `1` means command/input failure. Automation
  must treat every nonzero code as not healthy.
- A rollback result prints the required action but does not execute it. Set
  `MERCHANT_ORDER_V1_READ_MODE=off`, redeploy, and retain all V1 rows and
  evidence for diagnosis.

Audit one canary from a log file:

```powershell
npm run audit:v1-primary-canary -- --file=.\logs\order-primary.jsonl --site=10000000 --activated-at=2026-07-25T00:00:00.000Z
```

Audit streamed logs with stricter latency and freshness limits:

```powershell
Get-Content .\logs\order-primary.jsonl | npm run audit:v1-primary-canary -- --file=- --site=10000000 --activated-at=2026-07-25T00:00:00.000Z --min-samples=250 --min-window-minutes=2880 --max-p95-ms=1500 --max-last-age-minutes=10
```

Run the watchdog continuously through the deployment platform's scheduler or
log pipeline during the entire canary. The process-local circuit breaker is the
fast request-path guard; this watchdog is the deterministic operator and
automation decision record.

### Stage 15: scheduled canary watch and alert delivery

- `npm run watch:v1-primary-canary` wraps the Stage 14 audit for a one-shot
  scheduler invocation. It evaluates one exact merchant and activation
  timestamp, writes a bounded state record, and optionally sends an HTTPS
  webhook. It never edits rollout variables, redeploys, or mutates business
  data.
- Execution is opt-in with
  `MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED=true`. Keep the deployed web
  process default false and set true only in the scheduler command environment.
- Store `--state-file` on persistent storage. Production releases link
  `.runtime` to the shared runtime directory, so
  `.runtime/order-v1-canary-<site>.json` survives release switches. A state file
  inside an individual release directory will be removed by release cleanup and
  must not be used.
- The state record acts as a small delivery outbox. It is written before webhook
  delivery; a failed delivery remains pending and is retried with the same
  notification ID and `Idempotency-Key`. Corrupt, oversized, cross-merchant, or
  symlinked state files fail closed instead of being overwritten.
- Initial `observing` and `rollback_required` results send an alert. Evidence or
  status changes send a new alert, transition back to `healthy` sends a recovery
  event, and an unresolved rollback sends a reminder every 60 minutes by
  default. Unchanged healthy and observing states are quiet.
- Overlapping scheduler runs are rejected with an exclusive lock. A lock older
  than 15 minutes is considered stale by default and can be recovered by the
  next run.
- The optional webhook URL must use HTTPS. The bearer token is never accepted as
  a command-line argument or printed to logs:

```dotenv
MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED=false
MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_WEBHOOK_URL=https://alerts.example.com/hooks/faolla-canary
MERCHANT_ORDER_V1_PRIMARY_CANARY_ALERT_BEARER_TOKEN=replace-with-secret
```

Run one scheduled check:

```bash
cd /var/www/merchant-space.current
MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED=true npm run watch:v1-primary-canary -- --file=/var/log/faolla/order-primary.jsonl --state-file=.runtime/order-v1-canary-10000000.json --site=10000000 --activated-at=2026-07-25T00:00:00.000Z
```

The command supports the Stage 14 policy options plus
`--rollback-reminder-minutes`, `--webhook-timeout-ms`, and
`--stale-lock-minutes`. Exit code `0` is healthy, `2` is rollback required, `3`
is observing, `4` is alert delivery failure, and `1` is invalid input or
runtime failure. The scheduler must retain stdout/stderr and alert on every
nonzero exit. A webhook payload contains only canary scope, status, bounded
metrics, reasons, and the operator action; it never includes source log lines or
credentials.

### Stage 16: canary watch dead-man health check

- `npm run check:v1-primary-canary-watch-health` is a read-only check for the
  Stage 15 scheduler itself. It does not run the audit, deliver notifications,
  edit state, change rollout variables, or touch business data.
- Run it from a separate scheduler or uptime monitor. Using the same scheduler
  as Stage 15 cannot detect that scheduler being stopped.
- It fails closed when the state file is missing, unreadable, stale, scoped to a
  different merchant or activation, internally inconsistent, or contains
  future timestamps. A current `rollback_required` result and an overdue
  pending notification are also critical.
- A fresh `observing` result or a newly pending notification is degraded. A
  fresh healthy result with no pending delivery is healthy.
- State and evaluation freshness default to 15 minutes. Pending notification
  delivery defaults to 5 minutes. Set thresholds above the actual Stage 15
  schedule interval, including normal log and webhook latency.

Example external health check:

```bash
cd /var/www/merchant-space.current
npm run check:v1-primary-canary-watch-health -- --state-file=.runtime/order-v1-canary-10000000.json --site=10000000 --activated-at=2026-07-25T00:00:00.000Z --max-state-age-minutes=15 --max-pending-age-minutes=5 --format=json
```

Exit code `0` is healthy, `2` is critical, `3` is degraded, and `1` is invalid
command input or an unexpected command failure. JSON output is bounded metadata
only and contains no source observations or credentials. Alert immediately on
exit `2`, and investigate repeated exit `3`.

### Stage 17: deployment-time order V1 configuration contract

- `npm run check:v1-deploy-config` validates the effective order V1 environment
  before a production build. `npm run build` runs it automatically, so the
  atomic production deployment cannot switch to a release with an unsafe
  combination.
- The default `off` state remains deployable. An inactive, valid read allowlist
  is reported as a warning so an emergency rollback does not require unrelated
  cleanup before the release can be built.
- `verify` requires at least one exact eight-digit merchant ID and active
  `shadow` dual write. `primary` additionally requires exactly one merchant and
  an enabled, valid process-local circuit breaker.
- Read, dual-write, and circuit-breaker numeric values must be canonical
  integers inside the same ranges enforced by the request path. Misspelled
  modes, wildcard/duplicate merchant IDs, and values that would otherwise be
  silently clamped or defaulted block the build.
- Scheduler and one-shot operator flags are forbidden in the deployed web
  process. In particular,
  `MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED=true` and
  `ORDER_V1_BACKFILL_WRITE_ENABLED=true` block the build; set them only in the
  shell running the corresponding one-shot command.
- The check logs only mode, merchant IDs, blockers, and warnings. It never logs
  database, OAuth, webhook, or other credential values.

Manual preflight:

```bash
npm run check:v1-deploy-config -- --format=json
```

Exit code `0` means the runtime combination is safe to build, `2` means the
configuration is blocked, and `1` means invalid command input or an unexpected
failure. This configuration contract does not replace the Stage 12 rollout
authorization manifest; operators must still run the rollout gate before the
first `verify -> primary` activation.

### Stage 18: signed primary deployment approval

- A `primary` build requires a short-lived signed deployment receipt. The first
  `verify -> primary` activation receipt is issued only by the Stage 12 rollout
  gate. This closes the gap where the runtime configuration could be valid but
  an operator could accidentally skip the evidence gate.
- `off` and `verify` do not read an approval key or receipt. An emergency
  rollback to `off` therefore remains available even when the receipt is
  missing, expired, corrupt, or stored on an unavailable volume.
- The receipt is scoped to one exact eight-digit merchant, defaults to a
  60-minute lifetime, and is signed with HMAC-SHA256. A wrong merchant,
  signature mismatch, future issue time, expiry, lifetime over 24 hours, weak
  key, symlink, unreadable file, malformed JSON, or file over 16 KB blocks the
  build.
- Generating a new receipt first invalidates the previous file. A failed gate
  cannot leave a previously issued approval available for an unintended
  deployment.
- The activation receipt contains only its authorization type, merchant scope,
  evaluation and expiry timestamps, random nonce, and SHA-256 digest of the
  reviewed manifest. It contains no database credentials, OAuth tokens, source
  rows, or customer data.
- Successful issuance also appends the complete signed receipt to
  `<receipt-file>.audit.jsonl`. Use `--audit-file=<path>` to place this
  append-only audit on a different durable volume. If appending the audit
  fails, the newly written receipt is deleted and the deployment remains
  blocked.

Configure the production server with at least 32 random bytes of secret key.
Keep the receipt path absolute because the isolated release build does not link
`.runtime` until after the build:

```dotenv
MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_KEY=replace-with-at-least-32-random-bytes
MERCHANT_ORDER_V1_ROLLOUT_APPROVAL_RECEIPT_FILE=/var/www/merchant-space.shared/.runtime/order-v1-primary-approval.json
```

Immediately before the approved `verify -> primary` deployment, run the gate
against current evidence and atomically issue a one-hour receipt:

```bash
cd /var/www/merchant-space
npm run check:v1-rollout-gate -- \
  --file=/secure/operator/order-v1-rollout-manifest.json \
  --receipt-file=/var/www/merchant-space.shared/.runtime/order-v1-primary-approval.json \
  --ttl-minutes=60
```

Then set the exact approved merchant in
`MERCHANT_ORDER_V1_READ_SITE_IDS`, set read mode to `primary`, keep shadow
writes and the circuit breaker enabled, and deploy before the receipt expires.
`npm run build` verifies both the Stage 17 configuration and the Stage 18
approval. Exit code `2` means the release is not authorized and must not be
activated. Do not extend or edit a receipt manually.

### Stage 19: healthy primary continuation approval

- Once a merchant is already on `primary`, later releases must not pretend to
  perform another `verify -> primary` transition. Instead, issue a
  `continuation` receipt from the current Stage 15 canary watch state.
- `npm run issue:v1-primary-continuation-approval` first invalidates the
  previous receipt, then verifies the exact merchant and original activation
  timestamp through the Stage 16 health policy. It issues only when the state
  and evaluation are fresh, the canary status is `healthy`, and there are no
  blockers, warnings, or pending alert deliveries.
- Missing, unreadable, mismatched, stale, future-dated, `observing`, or
  `rollback_required` state blocks issuance. A blocked or failed command leaves
  no usable receipt, so an expired approval cannot silently authorize a later
  build.
- Continuation receipts use the same HMAC key, one-merchant scope, five-minute
  to 24-hour lifetime, build-time validation, and fail-closed audit behavior as
  activation receipts. Their signed evidence digest covers the normalized
  canary state, while the receipt itself contains no observations, credentials,
  or business data.
- The receipt schema is version `2`. Receipts issued by the earlier activation-
  only schema are intentionally rejected; issue a current activation or
  continuation receipt before the first deployment containing Stage 19.
- The Stage 16 health command remains read-only. Receipt issuance is a separate
  operator action so monitoring cannot authorize deployments by itself.

Immediately before a later `primary` deployment, issue a continuation receipt
from the current durable watch state:

```bash
cd /var/www/merchant-space.current
npm run issue:v1-primary-continuation-approval -- \
  --state-file=/var/www/merchant-space.shared/.runtime/order-v1-canary-10000000.json \
  --site=10000000 \
  --activated-at=2026-07-25T00:00:00.000Z \
  --receipt-file=/var/www/merchant-space.shared/.runtime/order-v1-primary-approval.json \
  --ttl-minutes=60
```

The audit defaults to
`/var/www/merchant-space.shared/.runtime/order-v1-primary-approval.json.audit.jsonl`.
Pass `--audit-file=<path>` to override it. The audit file is capped at 10 MB;
archive it before the cap is reached without modifying retained records. Exit
code `0` means a signed continuation was issued, `2` means health evidence
blocked issuance, and `1` means invalid input, a weak or missing signing key, or
another runtime failure. `npm run check:v1-deploy-config` reports
`approval-type=activation` or `approval-type=continuation` so release logs show
which authorization was consumed.

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
