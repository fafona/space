# Booking list action alignment

Implemented locally on `fix/booking-list-action-alignment-20261104`, based on
`fe11d715e62fe3d014492b995e94fb929b07a20d`. Not merged or deployed. Other pending
features and the user's dirty primary workspace were not modified.

## Cause and scope

The top row used an intrinsically sized wrapping flex action group. Different
booking statuses exposed different button counts/labels and changed how much
space remained for customer/contact details. The lower detail group also lacked
explicit shrinking rules for its variable booking ID and optional email badge.

Presentation-only fix:

- Reserve semantic slots for confirmation/restoration, no-show, completion and
  cancellation. Missing actions leave empty cells, not focusable fake buttons.
- Keep a fixed Chinese action column with 34 px buttons; use stable two-row slots
  on narrow screens. Localized labels get a wider column and multiline room,
  without allowing status changes to change the reserved grid dimensions.
- Fix the wide contact area width while allowing it to shrink/wrap on narrow
  cards. Preserve contact actions and missing-data placeholders.
- Keep the details button at the right edge; booking IDs shrink/truncate around
  it. The lower field grid no longer requires five oversized columns on smaller
  desktop windows. Optional notes and email badges do not move the detail button.
- No API, data, booking transition, permissions, email or action handler changes.

## Verification

- 58 focused model, permissions, frontend access, preferences, presentation and
  new layout contract tests passed; 6 existing employee UI security contract
  tests passed.
- 3 new isolated Chromium acceptance cases passed using the actual component
  and generated Tailwind CSS: five states, present/missing contacts and account
  IDs, long contact values, optional email badges/notes, busy text/status change,
  view-only role, and Chinese/Spanish/English at 1920/1440/1024/768/390 px.
- 2 existing booking browser regression cases passed, covering uncertain public
  submission recovery and desktop/mobile pagination with unsaved drafts.
- Browser requests are intercepted; unexpected requests fail the cases. Synthetic
  records only; no real accounts, bookings, emails or databases are contacted.
- Full TypeScript no-emit and focused ESLint checks passed. Wide/narrow screenshots
  were visually inspected and retained outside the repository at
  `D:/faolla-booking-alignment-20261104/`.

Browser command: `node --test scripts/booking-list-alignment-browser-acceptance.mjs`.
Normal merge/build/release checks remain required before deployment.
