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

## CI fixture integration

The first PR run (`43940603985`, browser job `133556792386`) rejected the new
same-origin `/flags/cn.svg` requests in the existing redemption harness, which
only intercepted the former external flag CDN. Its nine original scenarios reached
their unchanged unexpected-request assertions. The utility-control harness had
the same old image fixture and was synchronized as well. Both now serve actual
local assets only for their synthetic origin and exact known paths; all unknown
requests and all original business/layout assertions remain rejected/retained.
The combined locale, utility and redemption browser rerun passed all 19 groups.
The original failed CI run remains retained; no production changes were made.

## Follow-up: actual AdminClient startup CPU — 2026-11-16

The earlier language batch was subsequently published as
`dadbced2d579b991a62f83edde6cc87bc964a280`. This follow-up starts from that
deployed commit, in `D:/merchant-space-backend-startup-20261116` on
`perf/backend-startup-20261116`. **The follow-up changes below are local only.**
No production process, setting, permission or business record was changed.

### Evidence and limits

A bounded read-only existing draft-shape query returned one approximately 298 KB
response in 56 ms, with three PC plans and three mobile plans, each containing
three pages. No raw content or credentials were printed. This is one database
read, not the authenticated API/login round trip or a latency percentile.

Native computer-use remained unavailable after its documented recovery procedure;
the browser inventory also reported its access host unavailable. No browser
authentication, saved credentials or cookies were accessed. Actual-user login
profiling remains unavailable, so total login/interactive time is not claimed.

An isolated in-memory bundle of the actual AdminClient, I18n provider and stores
uses synthetic identity, a similarly shaped 335 KB draft and intercepted HTTP.
Both merchant business landing and explicit editor entry were exercised. The
diagnostic uses a development React build, four-times CPU throttling and identical
clone/JSON instrumentation; it is not a production-build benchmark.

| Synthetic entry | Deep-copy calls before / after | Copy time before / after | Longest task before / after |
| --- | --- | --- | --- |
| Merchant business landing | 4352 / 361 | 815 / 179 ms | 863 / 244 ms |
| Explicit website editor | 3531 / 361 | 674 / 178 ms | 866 / 245 ms |

These are individual comparison runs, not user-visible end-to-end speedups or
SLOs. Raw local diagnostic outputs remain under `catalog/backend-startup/` and
are not application assets. The final durable acceptance uses production React
and checks deterministic copy counts and behavior rather than a timing threshold.

### Narrow changes

- Do not summarize or prepare previews for the closed platform-only legacy
  template dialog during merchant startup. Opening that dialog still computes
  and displays/filter its original templates.
- Build static built-in template definitions once per module, then return an
  independent deep copy. Never share editable snapshots. Existing normalization
  already discards stored built-in content and restores the definitions; skip
  deriving and cloning those discarded fields while retaining its editable
  label/category/timestamps. Custom template normalization is unchanged.
- Memoize repeated system-default reverse translation results inside one
  synchronous draft traversal only. Later traversals still see newly loaded
  translation caches; authored content and unchanged object identity are kept.
- Lazily compute only the editor's mount-state seeds, not current/user drafts.
  Existing remote hydration, early business-workspace release and all identity,
  permission, save and manual recovery barriers remain unchanged.

### Regression coverage

`platformControlStore.test.ts` checks the exact pre-change built-in content hash,
one-copy warm normalization, independent mutable snapshots, JSON fallback,
built-in metadata policy and custom content preservation. Existing permission,
history and sorting tests remain intact. `editorSystemDefaults.test.ts` checks
repeated-value scalar equivalence, authored object identity and late cache loading.

`scripts/admin-startup-browser-acceptance.mjs` exercises actual AdminClient:
interactive business landing without mounting its editor; held session and held
cloud-draft gates; distinct PC/mobile page restoration and switching; and opening,
filtering and closing the platform template dialog. All HTTP is synthetic and
unknown requests/writes are rejected. The new acceptance runs in the existing
mandatory Playwright CI job, not the dependency-free unit partition. No existing
test or assertion was removed, and publication checks were not changed.

## Follow-up: defer editor-only resources

Further source/import-graph inspection confirmed that ordinary saved business-card
normalization imported QR rendering modules, including the full industry artwork,
crafted/expanded frames and studio SVG assets. These resources are not needed to
read or normalize saved card settings. A lightweight settings module now owns
the same normalizers and original style/color constants; legacy rendering exports
re-export the same functions. Saved IDs are checked against a small ID-only index.
The renderer catalog/order parity test requires synchronizing this index whenever
artwork presets change; it never accepts arbitrary unknown IDs or drops an old ID.

Before the split, synthetic coverage of all 262 icon and 310 frame presets plus
invalid/default inputs recorded these fingerprints. The unchanged results after
the split are mandatory regressions, alongside existing actual QR decoding tests:

- Decoration settings: `41b6be803e207a26c449e514716a782d034c69284e28b964e0a559e2b5e98a79`.
- Normalized draft QR: `f5f42717cb303cd801e36981c72fc458f88ec92c859af4a9bb4343b8873b7550`.

An identical minified esbuild import-graph comparison reduced initial static
JavaScript from 1,293,647 to 1,117,713 bytes (175,934 bytes, about 172 KiB).
This is **not** Next's guarded production build, network compression or elapsed
login time. No production bundle reduction is claimed until the actual build is
measured. The browser acceptance now verifies that all six QR artwork/rendering
modules still exist for deferred editors, but are absent from AdminClient's
initial static import graph; only lightweight settings remain on that path.
The business-card manager itself can still load its own artwork when opened.

A second actual-browser reproduction confirmed that opening the website editor
in a new window imported editor asset processing, theme processing and block editor
modules in the **old** workspace as well. The added regression failed on those
three old-window script requests before the change. Removing that source-window
preload leaves the destination's normal deferred imports and identity/draft gates
unchanged. The same test now verifies no old-window editor-engine requests and
successful PC/mobile draft restoration in the new editor window. This is not a
complete extraction of the monolithic AdminClient or a change to any save path.

These additional changes remain local and unpublished. They do not change login
queries, session rules, polling, publication tools, database records or workers.

Final local checks for the combined worktree passed: 55 focused TypeScript
tests, 38 original draft/CI contracts, five actual AdminClient browser groups,
and all 409 original business-card/QR/share checks (including decoding all frame
presets across the original style coverage). Full project TypeScript checking,
focused ESLint, strict encoding and `git diff --check` also passed. These are
local checks, not complete PR/main CI or a guarded production publication.
