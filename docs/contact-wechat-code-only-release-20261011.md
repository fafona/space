# Contact-card WeChat guidance: code-only, no-maintenance publication

## User-facing scope

The existing public contact-card save button detects phone WeChat and explains:
open the `…` menu, choose **在浏览器中打开**, and then press the same save button.
The alternative **继续在微信下载** retains the original contact download URL.
Other browsers keep the original native link behavior. This does not promise
automatic system-browser navigation or a native Contacts screen inside WeChat.

No QR payload, merchant settings, VCF fields, public card layout, website link,
attendance role, permission, database object, or saved business record is changed.
Application changes are exactly `src/app/card/[card]/route.ts` and its existing
`src/lib/merchantBusinessCardWebsiteRoute.test.ts` regression tests.

## Why a separate release lane is needed

The older route-only tools assume legacy ports and refuse the currently active
whole-web release. Rolling attendance back or weakening those guards would be
unsafe. The explicitly approved `contact-wechat-code-only` lane instead starts
from live `a535a308e21f121e7cf410a6f7d84c974eb370a6` on port 3103, while retaining
the existing exact-main, CI, ancestry, source ownership, locking, proxy, immutable
asset, smoke, and rollback requirements.

The 17 previously reviewed live-to-main support files are pinned byte-for-byte
to `4e482a849bc9d8668d00b6da1895d09414fa5d34`; their inclusion grants no database
execution authority. New tools and tests have a separate explicit allowlist.
This is not a general shortcut or an expansion of traffic/attendance scopes.

## Candidate and compatibility guarantees

- The current PM2 and actual process environments must agree. All inherited
  uppercase environment keys are checked; only explicit candidate identity,
  port and paused-job overrides are allowed. Existing runtime heap, telemetry,
  and PM2 settings must already match their unchanged fixed values.
- Baseline `.env.local` is hashed and retained verbatim except the exact fixed
  candidate override lines. File-only administrator and web-push credentials
  are preserved without printing values. Unreviewed runtime business keys are
  refused before writes instead of being silently dropped during build.
- Dependency lock bytes and the copied owned dependency-tree digest must match.
  Candidate source, full reviewed closure, private environment and bounded-build
  evidence are rechecked before candidate startup and publication.
- The unchanged reviewed build sandbox runs the full `npm run build`: 4 GiB
  memory maximum, 3072 MiB Node heap, one CPU, 128 tasks, no swap, isolated
  network, 20-minute timeout, at least 6 GiB available RAM and 20 GiB free disk.
  No dependency installation, direct Next-only build or skipped guard is used.
- Readiness is `ready-no-database`. Every database entry point explicitly denies
  this lane. Existing attendance database-ready flags and merchant cohort are
  inherited unchanged; no attendance SQL or enablement transition runs.

## Acceptance, switching and rollback

Before candidate writes, baseline contact responses must agree on loopback,
`www.faolla.com` and `faolla.com`. Body, content type and disposition are sealed
as private hashes/metadata. Candidate and public responses must preserve them
and contain the actual emitted WeChat guide, not only a build/version marker.

Advanced attendance read-only routes must still reject unauthenticated access
with 401 and both production QA harness routes with 404. On loopback, a narrowly
bounded native HTTP transport preserves the required `launch.faolla.com` Host;
it only permits five known GET paths, no credentials, no redirect following,
a 20-second timeout and a 2 MiB response limit. Older lane transports are unchanged.

Switching is additive immutable-asset publication and an owned nginx graceful
reload. The current live application and existing workers are never stopped
or restarted. Every saved before/after proxy file is validated before switching
or rollback. Failed public acceptance restores the same owned live baseline.

After successful publication, bookkeeping only appends the existing guarded
`converge` ownership certificate with a literal null victim. No automatic
retirement, process stop or artifact deletion occurs in this lane. Bookkeeping
failure leaves the healthy application online and is reported as pending; it
does not fabricate a stable ownership chain or erase evidence.

This document describes the reviewed release procedure, not proof of deployment.
Production completion is reported only after candidate build and public checks.
