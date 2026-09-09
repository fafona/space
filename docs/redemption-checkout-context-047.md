# Redemption confirmation context (047)

Scope: additive migration `202609080047_redemption_checkout_context.sql` only. It depends on 045 and 046 and leaves their files unchanged. This document does not authorize deployment or a production migration.

## State and recovery contract

- Each `(merchant_id, operation_id)` permanently binds one operator, member, intent fingerprint and normalized request. A request contains only whitelisted cart fields, note, settings/coupon version pins and the prepared quote; its serialized JSON is limited to 256 KiB.
- `pending -> committed` saves the authoritative result in the same transaction as points, inventory, coupons, business histories/backups and the 046 operation ledger. `pending -> cancelled` saves a tombstone and cannot be undone by retrying checkout.
- Only one **unacknowledged** context exists for an operator in a merchant. This includes committed/cancelled contexts: a lost response must remain recoverable after a refresh.
- Get without an operation ID returns that unacknowledged context. Get with an ID also retrieves old acknowledged results, scoped to the same operator and merchant.
- Acknowledge is explicit and only legal for committed/cancelled states. It releases the operator's slot but does not remove the context or alter its result. Repeated acknowledgement is idempotent.
- There is no TTL, background deletion, automatic cancellation or automatic acknowledgement.
- A committed retry returns the **original** result, even if the supplied replacement result or current balance differs. Cancel of a committed context also returns the original committed context.
- A 046 operation ledger without a matching complete checkout result requires explicit legacy review. Neither staging nor committing may fabricate a historical receipt.

## Price and balance consistency

The stored request pins `settingsVersion`, `couponVersion` and the complete ordered quote. A different quote for the same operation fails with `redemption_checkout_quote_changed`; the operator must cancel, acknowledge and explicitly begin another operation. Membership balance is deliberately not pinned in the context: a recharge can occur while prices remain unchanged. Membership CAS still applies to each prepared mutation.

The committed result must match the pinned quote and the real old/new member balances. Its transaction ID identifies the new redemption transaction with the expected debit, operator, timestamp and operation marker. All old transactions remain intact; the net delta of the new transactions explains the final balance, including nonnegative level-up gifts. Unrelated members cannot change through checkout. Coupon count matches normalized coupon rows and actual newly added redeem events, including operator and operation binding.

Coupon event validation preserves the exact old-event subsequence within the existing 5000-event limit, including the precise allowed tail truncation. New events may interleave with future-dated old events after the application's timestamp sort (for example because of clock skew). Duplicate new event IDs/claims/settlement codes are rejected. If 5000 future-dated old events evict a new event entirely, checkout fails closed rather than claiming an unrecorded coupon redemption; that anomalous history needs explicit review.

The result contains product line names, not member names, email addresses or member numbers. Stored coupon settlement data is server-only recovery material, not an exposed browser-authentication token.

## Compatibility and access boundary

047 renames the actual 046 implementation to `faolla_commit_redemption_internal_v1(text,jsonb)`. That internal function and all internal checkout helpers are owner-only: every non-owner EXECUTE grant is removed, including the inherited service-role grant.

The existing public `faolla_commit_redemption_v1(text,jsonb)` name becomes a compatibility wrapper for **settings/coupons-only ordinary writes**. It rejects both operation and membership keys. Checkout must use `faolla_commit_redemption_v2(text,text,jsonb,jsonb)` after staging. This prevents old checkout callers from bypassing a cancelled tombstone.

New public stage/get/cancel/ack/v2 functions are service-role-only, have fixed search paths, and share the exact 045/046 merchant advisory-lock namespace. The checkout table has RLS and no direct API-role or service-role relation/column privileges. Existing authorization checks remain the server's responsibility; an operator ID must come from the authenticated business actor, never an arbitrary client field.

## Rollout gates

Do not run an old and new checkout writer concurrently during cutover. Stop/drain old checkout workers and requests, verify the actual database schema/trigger inventory, apply 047, then enable code that stages and uses v2. Ordinary settings/coupon writers keep their public RPC name. The old API is intentionally fail-closed after migration; there is no fallback or compensating write.

The migration is transaction-wrapped and registry-checked. Replay of 047 preserves existing data and internal function identity. Do not replay 046 independently after 047: that would recreate the old public implementation until 047 restores its wrapper. Normal migration tooling must honor the migration registry and ordering.

Before production use, run isolated real-PostgreSQL concurrency/ACL/fault-injection tests and PostgreSQL 15 CI, then authorized end-to-end cashier recovery tests. Local PostgreSQL 13 evidence alone is not a claim that production or PostgreSQL 15 has been tested.

## Local verification recorded on 2026-09-08

The isolated `faolla_checkout_test` database on loopback port 56451 compiled the actual 045/046/047 migrations and passed 19 PostgreSQL 13.15 test groups. Coverage includes independent-session lock waits, commit/cancel ordering, replay and unacknowledged recovery, ordinary writer compatibility, scoped ACL repair, all nine business/history write-failure paths, checkout stage/commit/cancel/ack failures and suppressed writes, and final checkout triggers altering earlier business/history/ledger/context writes. Additional compatibility cases verify a full 5000-event coupon history within the unchanged 15-second statement timeout, a new event interleaved with future-dated old events, exact preservation of retained old events, duplicate-claim rejection, a level-up gift making the final point balance exceed the initial balance, and rejection of empty/non-string/duplicate event IDs without writes. These are synthetic local database tests, not production or PostgreSQL 15 execution.

The verified 047 SHA-256 is `683AD34E3DF55CCB088D5F8B78ECEEA1C7E905DB341F3E5D6FF16BC978E9485E`. The previously verified 046 file remains unchanged at `7192CF31A96817E005D17D982EBC1BE3CCD9C8C769F1BD543BDC4B1C8D1E7143`.
