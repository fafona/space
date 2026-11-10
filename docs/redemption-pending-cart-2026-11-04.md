# Restore pending redemption goods to the cashier cart

Implemented locally on `fix/redemption-pending-cart-20261104`, based on
`fe11d715e62fe3d014492b995e94fb929b07a20d`. Not merged or deployed. No production
requests, business-data mutations, schema changes, migrations or dependency changes.
The other pending feature branches and dirty primary workspace were not modified.

## Root cause

The server already persists the original checkout request and immutable quoted
lines. Recovery GET previously stripped everything except lifecycle metadata and
the terminal receipt. Re-entering the cashier also resets local draft state, so a
pending checkout blocked a new sale while the visible cart was empty. Each recovery
read additionally cleared the last known checkout while waiting for the response.

## Changes

- After the existing actor-scoped lookup and reauthorization, GET adds a strictly
  validated `pendingCart` for pending checkouts only. It contains site/operation
  binding and the quoted product lines/totals. It never exposes raw requests,
  member IDs, notes, claim/settlement tokens, fingerprints or document versions.
- The cashier displays these server lines directly, rather than trying to resolve
  them through today's catalog, balance or stock. Original quantities, prices,
  voucher labels/discounts and totals remain visible even after reload or item
  removal. Narrow screens get readable original line quantities and points.
- Pending goods remain visible during a status recheck or failed read, within the
  same identity/scope only. A failed/unknown state still disables submission; cached
  display is never treated as proof of an authorized/current financial state.
- The footer's "continue original checkout" uses the existing retry endpoint with
  only site, original operation ID and action. It does not create a new operation
  or send editable browser cart data. Existing service balance/stock/permission,
  quote/version and atomic deduplication checks are unchanged.
- Pending goods are read-only. Mixing another member, new items or held carts is
  blocked until explicit original cancellation/confirmation. The header identifies
  an original-member checkout instead of misleadingly displaying a walk-in customer.
- Existing terminal receipt, cancellation/commit race, explicit acknowledgement
  and no-automatic-replay-print behavior remains unchanged. Missing/malformed old
  previews show an explicit reread state and never enable an unseen checkout.
- No pending request/quote is saved to browser storage. Nothing auto-resumes on
  mount/focus/refresh; resuming requires an explicit operator action.

## Verification

- 124 focused model, service, privacy/authorization route, cashier/member recovery,
  receipt/transaction and new pending-preview tests passed.
- 14 existing member/redemption recovery and employee frontend contract tests passed.
- 5 isolated Chromium acceptance cases passed with the actual cashier component
  and opt-in synthetic harness. All network IO is intercepted. Cases include wide
  and narrow display, reload without local storage, sold-out/current-low-balance
  data, in-progress/failed GET retaining goods, price-change rejection, explicit
  cancel/ack, repeated clicks, lost retry response, cancel/commit races, missing
  old preview, and delayed prior-employee results. Test promises use explicit
  release/completion signals, not elapsed time as evidence of completion.
- TypeScript no-emit and focused ESLint checks passed. Wide/narrow screenshots
  were visually inspected and retained outside the repository at
  `D:/faolla-redemption-pending-cart-20261104/`.

Browser command: `node --test scripts/redemption-pending-cart-browser-acceptance.mjs`.
The normal merge/build/release checks are still required before deployment.
