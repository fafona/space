# Editable backgrounds and independent QR text positions

Status: implemented and locally verified; not deployed. No production data has
been changed by this work.

## Background root cause and recovery boundary

`compactSnapshotBusinessCard` used to erase `backgroundImageUrl` and set
`backgroundImageSnapshotOnly` to false whenever a public image existed. The admin
editor consumes those snapshots, so its editable draft lost the source while the
folder thumbnail still displayed the previously flattened front image.

- Preserve background sources (including bounded uploaded data URLs), transforms
  and snapshot-only status through snapshot construction and reload.
- Record `backgroundImageSourceKnown` so intentionally blank/cleared backgrounds
  do not accidentally recover an old image. Upload and clear both set this flag.
- When an old card has no source and no known-empty marker, show its existing
  front as a snapshot-only preview with the existing editable layers suppressed.
  This does not reconstruct a separate background from a flattened image.
- Keep that original front on settings save rather than rerendering it. Explain
  that full front redesign requires the original background or explicit clear.
- During card merges, a genuine source (or explicit clear) wins over a degraded
  snapshot-only fallback. Do not attach a snapshot-only flag to a recovered source.

No database migration, automatic record rewrite or replacement image was used.
For a specific legacy card whose independent source is absent, an original file
must be supplied to restore fully editable image/text/QR layers.

## QR text positions

Each optional `qr.topText` / `qr.bottomText` now supports `offsetX` (-120..120) and
`offsetY` (-300..300), integer units relative to a 300px-wide QR. Absent offsets
retain legacy zero-position rendering and are not added to existing settings just
by normalization.

The UI supplies separate sliders, number inputs and position reset buttons. Font,
color, content, enabled state and the other text's position remain unchanged on
reset. SVG and embedded font paths share the same positions. Vertical bounds
expand as needed; horizontal text fits the remaining width. Users can move text
into frame whitespace, but must avoid obscuring scannable modules. The existing
browser QR export verification remains in place.

Strict backup validation permits the two bounded optional fields. No dependency
or schema changes.

## Verification

- 213 focused tests passed: background editor recovery, intentional clear, source
  merge, snapshot round-trip, card normalization, strict backup validation, QR
  styles/fonts/position bounds, raster QR decode and website destination behavior.
- TypeScript no-emit, changed-file ESLint, encoding and diff checks passed.
- Browser local harness using the real text-controls component and renderer:
  top (-30,20), bottom (35,-20); top-only reset did not change bottom; JSON save
  and reload retained both; QR decoded and 2048px PNG generation succeeded.
- No claim of authenticated production editor testing or deployment.

## Release note

The current `/card/`-only release overlay does NOT deploy the admin editor or
snapshot validator. These changes require a consistent application release;
do not widen or bypass the existing route-only deployment allowlist. Maintain
the user's no-maintenance constraint when arranging that future release.
