# Locale feedback and backend loading — 2026-11-16

Base: deployed `c8982294231187f732e9d3f902af84c4a9a5d20c`.
Worktree: `D:/merchant-space-locale-performance-20261116`.
This is local implementation and diagnosis, **not a production publication**.
The separate uncommitted unified-conversation worktree is not included.

## Authorized scope

The user requested correction of apparent language/flag mismatch and investigation
of slow login, the interval before controls respond, and slow editor opening.
After a browser reproduction, the user explicitly selected showing usable authored
or cached content while translations complete progressively. Authentication,
authorization, saved settings, merchant drafts, bookings, orders and workers are
unchanged. Server inspections and the bounded existing performance-event query
were read-only; no production code, process, configuration or data was changed.

## Confirmed language causes and fixes

- The flag already used the selected I18n locale. A failed translation left
  merchant-authored Spanish text visible while Chinese remained selected, without
  any failure feedback. Desktop/mobile isolated tests reproduced this exact state.
- The flag depended on an external CDN. Thirty-nine small 80px raster flags are
  now embedded in inert local SVG resources (about 21 KB for the complete set).
  Source URLs and original PNG hashes are retained in `public/flags/sources.json`.
  Public, merchant and console routing recognizes only the exact supported paths;
  unknown console paths remain 404. No dependency or broad asset exemption added.
- A per-page/per-locale translation reporter exposes only state/counters, not
  customer text. Concurrent batches remain pending until all active batches finish;
  old page/locale callbacks cannot overwrite a newer owner. Incomplete translation
  offers explicit, non-modal retry. Customer drafts and page state are preserved.
- Malformed HTTP-success translation payloads are no longer cached as successful
  identity translations. Valid same-language identity results remain cacheable.
- Language menus/status controls are excluded from translation observation so
  their own updates/portals cannot create a body-wide translation feedback loop.
  Faolla protection, cancellation, request sharing and warm cache behavior remain.

## Confirmed backend first-paint blocker

The original `html[data-i18n-pending="1"] body { visibility: hidden; }` rule made
an otherwise loaded non-Chinese backend wait for external translation requests.
Individual requests allow up to ten seconds and a page can contain multiple
batches. This is not an authentication requirement or evidence of high server load.

A regression using the actual I18n provider, translator and original CSS rule
failed before the fix with `body` computed visibility `hidden` while translation
was held. Following the user's UX choice, the legacy pending marker no longer
hides the body. The same desktop/mobile tests now edit a synthetic input while
translation is pending. Existing authentication/loading components are not removed,
and original auth/isolation regression tests still pass.

## Additional performance findings — not claimed fixed

- Read-only server snapshot at `2026-11-16T19:08:07Z`: load averages
  `0.43 / 0.76 / 0.92`, original nine service PIDs unchanged, about 35.5 GiB free.
  This single snapshot does not prove there was never earlier resource pressure.
- The deployed AdminClient async entry contains 18 files, **1171.54 KiB**
  uncompressed (about 1.14 MiB); largest file 473.96 KiB. This is build size, not
  measured transfer/parse time or a claim that all login bytes are represented.
- Source inspection shows editor draft/published recovery, plan normalization and
  synchronous local persistence continue after identity/menu loading. The existing
  early business-workspace release is already present; do not propose or claim it
  as a newly implemented optimization. Editor-ready/first-interactive timing and
  a representative authenticated browser trace remain needed before changing this
  successful data-restoration path or choosing exact code-splitting boundaries.
  The computer-use skill was initialized to inspect the existing logged-in UI,
  but its native connection was unavailable. The documented lightweight retry,
  kernel reset/reinitialization and final retry also failed. No window was read,
  no UI input or authentication action was performed, and no browser credentials
  were extracted. This prevents claiming actual-user login/interaction profiling.
- A bounded, read-only query of existing performance events over 72 hours returned
  18 API diagnostic observations (no SLO-cohort samples). They included a 14.46 s
  booking-workbench observation and roughly 24.25 s redemption observations, with
  failures in several groups. These sparse/mixed diagnostic samples are **not**
  current-build latency percentiles and do not identify this user's specific login
  request. Login/session/editor startup are not represented by this set. No raw
  customer records, IDs, credentials or messages were disclosed.
- Existing Nginx access logs do not include request/upstream latency, so they cannot
  provide the missing authenticated end-to-end timing. No logging policy changed.

## Local validation and boundary

- 53 focused TS tests passed, including reporter ownership/concurrency, local
  assets, malformed responses, existing locale preference and middleware isolation.
- Nine actual React/browser acceptance groups passed, covering desktop/mobile
  pending-first-paint interaction, explicit retry, cold/warm/poisoned caches,
  abandoned languages, shared requests, private drafts and Faolla preservation.
- Full project `tsc --noEmit --incremental false`, focused ESLint, strict encoding
  and `git diff --check` passed (final commands recorded in the thread).
- CI's normal discovered-test partition automatically includes the new test files;
  browser acceptance remains in its existing mandatory browser job.
- Local dependencies reuse the existing exact-lockfile-matched junction only for
  tests/typechecking. No guarded application build through that junction was run.
  Complete PR/main CI, a separate guarded build and public verification are still
  required before deployment. No online speedup or complete backend optimization
  is claimed from these local tests.
