# Merchant Admin Data Splitting Plan

Current merchant memberships, coupons, and membership settings are stored as JSON payloads in `pages.blocks`. The cache and aggregate APIs reduce repeated reads, but true multi-device concurrency and large-data pagination require row-based storage.

## Target Tables

- `merchant_memberships`
  - One row per membership.
  - Key columns: `site_id`, `membership_id`, `member_no`, `status`, `updated_at`.
  - Search columns: nickname, name, phone, email, member number, region fields.
- `merchant_member_transactions`
  - One row per point/balance operation.
  - Key columns: `site_id`, `membership_id`, `transaction_id`, `operation_id`, `type`, `created_at`.
  - Unique index: `(site_id, operation_id)` where `operation_id` is not null.
- `merchant_coupons`
  - One row per coupon definition.
  - Key columns: `site_id`, `coupon_id`, `code`, `status`, `updated_at`.
- `merchant_coupon_claims`
  - One row per claimed coupon.
  - Key columns: `site_id`, `coupon_id`, `claim_id`, `settlement_code`, identity fields, `valid_until`.
- `merchant_coupon_redeems`
  - One row per coupon redemption.
  - Key columns: `site_id`, `coupon_id`, `claim_id`, `settlement_code`, `operation_id`, `redeemed_at`.
  - Unique indexes: `(site_id, settlement_code)` and `(site_id, operation_id)` where `operation_id` is not null.
- `merchant_membership_settings`
  - One row per merchant settings snapshot.
  - Redemption categories/items can stay JSON initially, then split when item volume requires it.

## Migration Order

1. Keep existing JSON store as source of truth and add dual-read helpers that can read row tables first, then fall back to JSON.
2. Backfill row tables from existing JSON payloads with an idempotent script.
3. Switch new writes to dual-write: row tables plus existing JSON.
4. Add verification jobs comparing row snapshots against JSON snapshots per merchant.
5. Switch reads to row tables after verification is stable.
6. Stop writing JSON snapshots after a rollback window.

## Runtime Rules

- Every money/points/coupon mutation must carry an `operationId`.
- Server writes must enforce unique operation IDs for idempotency.
- Checkout should write membership transaction, stock movement, and coupon redemption in one database transaction.
- List pages should use server-side pagination/search and detail-on-demand for transactions and coupon history.
