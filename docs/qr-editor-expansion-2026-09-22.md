# QR editor expansion — local implementation

No deployment, database migration, or saved merchant-card mutation performed.

## Changes

- 16 QR styles: the original 10 plus 6 rounded-finder variants.
- 262 center icons: 36 legacy, 6 approved custom filled designs, and 220 filled industry symbols across 16 sectors.
- 274 frames: 40 legacy, 6 approved custom silhouettes, 8 rounded geometric frames, and 220 industry-theme combinations using 8 layout families. These are not 274 unique silhouettes, and coverage is broad rather than literally exhaustive.
- One style/icon/frame picker pattern with category, search and 12-item pagination; previews generated only for the visible page.
- One shared foreground palette with independently selectable QR/icon/frame targets. Selecting targets does not change saved colors. Applying a color changes only selected effective colors, including legacy follow-color cards. Low contrast involving QR rejects the whole update atomically.
- Separate background controls, optional caption, 2048/4096 PNG and SVG exports. Browser decoding is checked before downloading.
- Old IDs and renderer paths retained. No automatic restyling of existing cards.
- Static allowlisted SVG data only; no remote runtime asset loading or new package dependency. Third-party attribution is in `licenses/tabler-icons.txt`.

## Verification

- 337 QR/decoration/color/draft tests passed, including 274 frames × 16 styles = 4,384 decoding combinations, 262 icon decoding checks, and all 7 color-target combinations with both legacy follow settings.
- 51 image routing/storage/share tests passed.
- 2,460 baseline SVG comparisons against deployed HEAD were byte-for-byte identical for original styles/frames and representative old icons.
- Browser checked the actual React editor in an isolated local fixture: target selection without mutation, QR-only preservation, icon+frame color, all-target color, atomic contrast rejection, common picker category/search/pagination, narrow container layout, successful SVG and 4096 PNG generation.
- Local fixture uses no authenticated application session or production data. Full production build/release checks and physical-phone/print-size scan checks remain deployment/acceptance tasks.

## Deployment note

This is a source change, not a production release. Keep normal release gates; verify the real merchant editor after deployment. Small framed QRs still require adequate on-card size; high export resolution alone does not guarantee scanning at a small printed size.
