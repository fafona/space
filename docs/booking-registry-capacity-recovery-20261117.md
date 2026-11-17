# Bounded booking worker registry recovery

The failed web candidate `4963116f54bcab64ae397e06ecf323838fe2e3be`
remains rolled back to `dadbced2d579b991a62f83edde6cc87bc964a280`.
Neither existing application is rebuilt, re-labelled or republished here.

The 45-row PM2 registry exceeded the original transport's 1 MiB AMP-frame
bound. A separately read snapshot was 1,080,610 bytes; omitting only the new
candidate was 1,046,314 bytes. Original gate and source-revision structural
checks passed. The original worker consequently failed before history
validation, and finalization could not obtain natural completed cycles.

The user explicitly approved a new bounded 4 MiB registry read adapter and
one audited source-only worker transition. The old shared transport remains
byte-for-byte unchanged. The new read session preserves its request, peer,
socket, framing, UTF-8/unique-JSON, correlation and total-deadline checks.
Original 128-row and 512 KiB filtered output checks remain. There is no
fallback CLI, reconnection, mutation in the reader, or automatic retry.

The recovery profile is fixed to history head 65, the real post-reboot worker
PID 685108 / PMID 24 / restart 1, its source, boot and original gate digest.
Version-1 worker contracts still require historical PMID 27. Version 2 only
admits this incident, the same website anchors and a single source change.
Every other process, raw/configured environment, route, saved gate and failed
candidate state remains unchanged. Complete PR/main CI, installed-source
verification and the existing real worker application acceptance are required.
Two naturally scheduled completed cycles and both public old-version routes
must be verified before a completed receipt can be written.

No SQL, manual automation tick, business-data repair or mail activation is
authorized. A sealed unknown mutation must not be resent. All failed attempts,
original manager dumps, builds, history and recovery evidence are retained.
This document is a design/evidence record, not a successful recovery receipt.
