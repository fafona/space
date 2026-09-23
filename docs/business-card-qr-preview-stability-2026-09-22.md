# QR live-preview flicker fix

Status: locally implemented and verified; not deployed.

## Cause

The editor used a single exact-key URL for both display and save/export. Each
appearance change invalidated that key immediately, unmounting the QR image while
the 180 ms debounce, SVG rendering and font loading completed. Image swaps were
also committed before the browser had decoded the new SVG.

## Change

- Retain the last decoded image while a new appearance is generated, only within
  the same merchant/card and scan destination. Invalid input or closed editor
  must not show the retained image.
- Decode each new image before swapping. Cancel superseded requests, including
  those awaiting font/image decoding, so older results cannot replace newer ones.
- Keep the retained image's frame geometry/background until the swap, avoiding a
  temporary stretch into the new appearance's aspect ratio. QR X/Y/size and other
  card fields still respond immediately.
- Save and hidden export continue to require the exact current key. The retained
  display URL never authorizes saving a stale QR. Standalone QR export is unchanged.
- No stored records, destination rules, QR encoding, or background recovery changed.

## Verification

- 51 tests passed: preview policy/predecode, editor export wiring, background
  recovery, scan destinations, all 16 QR styles, fonts and text positions.
- TypeScript no-emit, changed-file ESLint, encoding and diff checks passed.
- Browser skill used the actual production preview hook and text controls in a
  local harness, with delayed font responses. Two 16-adjustment runs changed
  offsets, colors, fonts and frames: rapid changes sampled 19 frames; individual
  updates sampled 60. Both had zero blank frames, undecoded displayed images,
  image remounts or stale-save mismatches; final result ready and QR decoded.
- This was local real-component testing, not an authenticated production edit.

## Deployment boundary

Production is still c8e56782cac3b51118a63557f07057e61b0964d1 on the active 3102
live-web lane. Do not run the historical full/route deployment scripts or delete
the retained base/static release. The live-lane controller intentionally refuses
replacement of existing state; a subsequent deploy needs an ownership-checked
successor handoff. See D:/faolla-web-presentation-live-release-20260922.md.
