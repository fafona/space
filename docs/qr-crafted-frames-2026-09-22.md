# QR outer-frame redraw — local implementation, not deployed

Baseline: deployed HEAD `204fa6f9023f964e0cd6ced02ede23ff2a31ff97`.

## Changes

- 36 new `crafted-*` IDs: six approved original silhouette assets with their complete authored palette, plus 30 independent silhouettes covering nine categories.
- New palette transformation preserves relative accent hues and lightness; selecting an authored preset initializes frame-only recommended color, background, stroke and padding. QR and icon colors are untouched.
- Picker defaults to the new catalog. All 274 existing frame IDs remain under History. Opening the picker never changes the saved frame. Selecting an already active frame never resets a custom palette.
- Picker thumbnails, card preview and export share the production SVG renderer. No mockup-only art.
- Existing IDs, stored settings, QR module geometry, authorization and production data are unchanged.

## Verification

- TypeScript no-emit, targeted ESLint and git diff whitespace checks: passed.
- Decoration/color regression suite: 319 tests passed (all 310 frames × 16 QR styles decoded, plus icon/color/safety tests).
- After visual geometry refinements: all 36 crafted-frame tests rerun, 576 style/frame decode combinations passed.
- Crafted-specific tests: 3 passed, including exact original palette/shape equality for all six approved frames, geometry bounds and frame-only preset settings.
- Strict backup validation: 120 tests passed, including round-trip validation of every new frame.
- 26,400 old/new renderer comparisons for all existing frame/style combinations: byte-identical.
- Actual browser component fixture: old medal opens New tab without changing current card, new medal selection shows authored gold/coral palette, frame-only green recolor leaves QR/icon black, PNG export passes in-browser decode verification and reports generated file, History switch and search work.

## Review images / tooling

Outside-repository review artifacts: `D:/merchant-space/outputs/qr-redesign/`.

- `crafted-sheet-1.png`, `crafted-sheet-2.png`, `crafted-sheet-3.png`: all 36 frames generated with the actual QR renderer.
- `render-crafted.mjs`: regenerates the SVGs and contact sheets with sharp.
- `qa-editor.tsx` and `qa-server.mjs`: isolated actual editor component fixture; not shipped.
- `check-legacy-render.mjs`: compares current working renderer to HEAD.

No production deployment, maintenance transition or database migration was performed for this redraw. The 36 new designs do not mean the 274 historical designs have been redrawn. Printed QR codes still require a real-phone scan at final physical size.

## Second visual refinement (user: 这图还是差点意思，继续优化)

- Kept the six approved source silhouettes exact. Refined the 30 still-unreleased additional designs.
- Individually placed QR and caption for 13 shapes instead of relying on one low-positioned square; refined tea, bread, chef, storefront, house, flower, lotion, perfume, book, graduation, gamepad and leaf geometry.
- Packaging/screen designs use an integrated label with caption; natural silhouettes use their own continuous white interior (no overhanging generic label).
- Added restrained three-stop edge gradients, reflections and a low-opacity vector drop shadow for depth.
- Second-round artifacts: `crafted-v2-focus.png` and `crafted-v2-sheet-1.png` through `crafted-v2-sheet-3.png`. First-round sheets retained as `crafted-v1-sheet-*.png`.
- Repeated all 36 frame × 16 style decode combinations after revision; all passed. Final leaf/flower adjustments each passed another 16 combinations. Three crafted invariants and three color-selection tests passed. Existing 26,400 render comparisons remain byte-identical.
- No deployment or saved-card migration. Artifact generator accepts `--v2`.
- Final TypeScript, targeted ESLint and whitespace checks passed. Actual browser editor selected the refined lotion preset and generated a 2048px PNG after browser decode verification. VS Code open commands were sent for the four v2 review images.

## Third visual refinement (user: 继续优化)

- Refined ten unreleased frames: plate, cake, phone, medical kit, mirror, briefcase, suitcase, truck, rocket and palette. Added shape-specific structural details, restrained accent materials and integrated QR surfaces instead of generic overlaid labels.
- Larger screen QR, separately positioned cargo QR/caption, luggage tag and telescoping handle, medical clasps/cross, leather straps and brass buckles, mirror support, ceramic rim/cutlery, icing/candles, rocket porthole and paint/brush details.
- Added optional per-frame caption X coordinate for asymmetric designs. Truck QR and caption are both centered in its cargo box; caption remains outside the QR quiet zone at all supported padding settings.
- Corrected brush rotation after visual review found export-edge clipping. Added raster edge tests for all 36 silhouettes at maximum stroke width.
- Eight crafted/color invariant tests passed; 36 × 16 style/icon raster decode combinations passed; 26,400 historical renderer comparisons remained byte-identical. TypeScript, targeted ESLint and whitespace checks passed.
- Review images: `crafted-v3-focus.png` and `crafted-v3-sheet-1.png` through `crafted-v3-sheet-3.png`, generated from actual production SVG renderer with `render-crafted.mjs --v3`. v1/v2 sheets retained. Images inspected locally; no new browser-session export test in this round (renderer changes only).
- No production deployment or saved-card modification. Approved six source designs remain exact.

## Fourth visual refinement (user: 好很多了，再优化)

- Refined eight additional unreleased designs: takeaway coffee, chef, icecream, polaroid, camera, paw, tooth and record. Retained the approved first six and the third-round designs.
- Improved cup lid/sleeve/rolled base, light chef caption band, inset pink scoop/waffle lattice, layered photo paper/torn tape, camera controls/lens/bezel, rounded paw pads, enamel-colored tooth rim and vinyl grooves/reflections. Shield interior now uses a continuous background instead of a gradient interrupted by the QR square.
- Repositioned captions to avoid colored rims. Added raster tests of the light caption surface for chef, icecream and paw, plus geometric containment of the whole QR quiet-zone square inside camera/record circular insets.
- Initial 36-frame scan pass found one record/long-link/classic failure at 768px with padding 32. Removing the artwork reproduced it, isolating resampling rather than decoration occlusion. Adjusted record QR square from 210 to 212 local units, centered in the inset; all 16 record style/icon combinations then passed. The other 35 frame tests passed unchanged (576 final passing combinations in total across these runs).
- Added a dedicated record long-link regression covering 640/768/1024/2048px and padding 8/16/32 (12 combinations); all passed. Total crafted/color invariant tests: 11 passed, including maximum-stroke raster boundary checks and exact source-art preservation.
- Final TypeScript, targeted ESLint and historical renderer comparison passed (26,400 byte-identical cases). Review PNGs regenerated from the production renderer as `crafted-v4-focus.png` and `crafted-v4-sheet-1.png` through `crafted-v4-sheet-3.png`; previous review versions retained.
- No deployment, saved-card changes or browser export re-test in this renderer-only round. Printed results still need a real-device scan at final physical size.
