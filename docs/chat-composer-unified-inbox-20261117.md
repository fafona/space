# Chat composer and unified merchant inbox

## Scope

- The visitor and personal service-center composer now keeps attachment, input
  and send controls in one row. Multiline input grows within a bounded height.
- On mobile the conversation sheet tracks the visual viewport, including
  keyboard-only shrinking and browser panning. The isolated account document
  also caps textarea height to its own, smaller viewport.
- Account and visitor conversations share the existing merchant/employee list;
  visitor rows use a `guest:<thread UUID>` key, never the displayed eight-digit
  visitor number. Official support stays pinned and unread counts are retained.
- Selecting a visitor opens its existing authenticated thread API. Account and
  each visitor retain separate drafts. Authorization, message persistence and
  idempotency are unchanged; no messages are migrated or merged.
- Attachment cancellation retains the open sheet and its draft.

## Root causes and evidence

The old service composer placed send below the textarea. The sheet used layout
viewport units only, which do not necessarily shrink when a mobile keyboard
opens. Browsers that resize the layout viewport also use the compact chat
layout whenever the remaining viewport is short. In the account iframe, a 112 px multiline input plus fixed header and
message padding could overflow a 225 px document even after the host sheet was
correctly sized. The input now has an additional document-viewport height cap.

The previous unified-inbox work was uncommitted and absent from the deployed
version. Its UI changes were ported onto the current main tree without replacing
the later backend-startup optimizations or modifying its original worktree.

## Verification

`scripts/merchant-service-center-browser-acceptance.mjs` includes the owner and
employee mixed-inbox journeys as well as visitor/personal service-center tests.
All network IO in these browser fixtures is synthetic. They cover 320/390 px
phone widths, keyboard-only visual viewport changes and panning, send/input
alignment, attachment cancellation, independent drafts, stale responses,
pagination, partial failures, view-only permissions, and equal displayed visitor
and account numbers. Desktop owner layout is covered at 1440 px. Existing
service-center account, orders, language and QR journeys are retained.

These are real-browser automated viewport simulations, not a claim of testing
every physical phone keyboard. Production acceptance remains read-only; it must
not create messages or alter user data. Publication is not complete until the
ordinary release completion receipt and independent audit both pass.

No dependency, database, migration, business configuration, mail or booking
worker changes are included.
