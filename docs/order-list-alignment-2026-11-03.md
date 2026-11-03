# Order list action alignment

Implemented locally on `fix/order-list-action-alignment-20261103`, based on
`fe11d715e62fe3d014492b995e94fb929b07a20d`. Not merged or deployed. Other pending
features and the user's dirty primary workspace were not modified.

## Cause and scope

The list's right column had intrinsic width and a wrapping flex action row.
Different status labels/button counts changed that column's width and pushed
the flexible customer/contact area into different positions.

Only list presentation changes:

- Reserve a 306 px right column, constrained to the available card width.
- Use fixed semantic slots: status, completion, cancellation, details. Missing
  actions leave empty grid cells rather than moving their neighbors. The narrow
  layout keeps the same slots in two rows; button heights remain 34 px.
- Fix the contact area width on wide rows while allowing it to shrink/wrap on
  narrow cards. Keep empty contact placeholders and align amounts to the right.
- Preserve all existing event handlers, status/permission conditions, disabled
  state, selection exclusions and API calls. No order data or server logic changes.

## Verification

- `node --test scripts/order-list-alignment-browser-acceptance.mjs`: 3 passed.
  Uses the actual list component and generated Tailwind CSS. Measures geometry
  at 1920/1440/1024/768/390 px, across four statuses, missing contacts/account
  IDs, long contact values/amounts, busy text, a synthetic status transition and
  restricted roles. Unexpected network requests fail the case. All requests are
  intercepted and use synthetic data; no real account/database is contacted.
- `npx tsx --test src/components/admin/MerchantOrderManagerDialog.layout.test.ts`:
  2 structural regression checks passed (included by normal test discovery).
- 25 existing order model, permissions, frontend-access and preference tests
  passed; 6 existing employee/frontend security contract tests passed.
- Full TypeScript no-emit check passed. Focused ESLint passed without warnings.
- Visually inspected wide and narrow browser screenshots; retained outside the
  repository at `D:/faolla-order-alignment-20261103/`.

Normal merge/build/release checks are still required before this reaches users.
