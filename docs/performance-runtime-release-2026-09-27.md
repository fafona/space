# Curated runtime performance release — 2026-09-27

## Source and scope

Candidate branch: `release/performance-runtime-20260927`, based on reviewed
`origin/main@975935b4417404a4ebd7784ef6e846e1e2ef5556`.
Independent runtime changes are cherry-picked from `2af3d92a`, `49984304`,
and `fac720a2` as `eef32ec1`, `85742ed4`, and `2daa5165`.

The four application files implement merchant-scoped customer request ownership,
a lazy size-bounded search corpus, public page plan reuse, and product filter /
group / page reuse. No API, saved business data, dependency, database migration,
booking authority, authentication or background worker is changed. Web Push and
the unfinished database-authority candidates are deliberately excluded.

The independent `runtime-performance` release lane admits exactly 18 paths:
the eleven curated application/test/original-note paths, this note, and the six
already-reviewed operational files between the actual live build and main.
Old lanes retain their scopes. This is not permission to publish the full
customer-read-shadow branch or replay historical static recovery.

## Local acceptance

- The initial exact 26-suite stage selection passed: 371 tests passed, one
  Linux-only real-descriptor test skipped on Windows, zero failures. The later
  new-lane-only saved-proxy guard passed all 52 release tests; the combined
  release/static/baseline suite passed 104 with one Linux-only skip.
- Whole-project TypeScript, focused application ESLint, strict encoding, and
  all 60 automatic migration-file checks passed. No migration was executed.
- Existing loopback-only harnesses used real customer/ProductBlock components,
  synthetic records and installed React/Tailwind. Customer search found QA-036
  from the full list and kept full-directory totals; switching A to B replaced
  the visible customer identity. Product search QA-1, quantity increment and
  unrelated redraw retained the cart/query without another catalog request.
- The standalone product harness has known styled-jsx `jsx`/`global` attribute
  warnings. It is not a full Next production-shell or capacity test. No new
  runtime exception was observed in these interactions.
- The isolated dummy-environment Next production build passed, including its
  TypeScript/static generation and admin bundle budget: async entry 1080.7 KB
  against 1250 KB, largest chunk 454.7 KB against 760 KB. Production stage,
  exact-head CI and public cutover acceptance have not been performed.

## Read-only production observation and release stop

The public version API and a strictly host-pinned connection using the existing
deployment identity agree that the active web build is
`1740b254851c11302b6c7fef536cf9ef92d75637`, on loopback port 3110.
The maintenance phase is `ended`, no operation lock was present, and free disk
was approximately 47 GiB. The repository main SHA is not the live app SHA;
the old `.current` scheduler/base symlink is not the live app either.

Every approved candidate port 3103–3110 is actually listening, occupied by
retained online releases. All twelve PM2 processes were online, including the
original 3000 application, card3101, web3102 and independent automation worker.
The release controller would reject staging with `no_candidate_port`.

No deployment controller was run, no remote file/configuration was changed,
no process was stopped/restarted, and no data or release files were deleted.
The existing policy explicitly forbids automatic retained-process cleanup or
port-range expansion. Publication therefore requires approval of a safe slot
reuse/retirement policy, followed by ownership/traffic/rollback checks, not a
fallback to maintenance or the historical full-deploy workflow.

Independent review also reproduced a pre-existing ordinary-activation gap:
saved nginx after-config drift could be applied before a failed public probe,
then violate rollback ownership. The new runtime lane now validates every saved
before/after hash before any activation side effect and uses the checked bytes;
rollback validates every saved before-config before writing any. Existing
current-proxy ownership checks and all old lanes remain unchanged. Actual
function VM tests include last-file drift, missing files, post-check archive
drift and public-failure rollback, without real network or production writes.

## Remaining overall work

This independently shippable client/runtime slice is not overall optimization
completion. Real server-side customer/product pagination, indexed personal
orders, incremental customer aggregation, bounded order transactions, independent
booking scheduling and end-to-end scale acceptance remain governed by the main
performance and booking-authority plans. Offline protocol tests are not proof of
live integration or production capacity.
