# Super-admin dedicated origin correction

Production configuration corrected 2026-09-23 13:10 UTC. No application rebuild.

Cause: canonical portal is `https://launch.faolla.com`, but the separate
`FAOLLA_SUPER_ADMIN_ORIGIN` setting was absent. Existing fallback derived
`console.launch.faolla.com`; the real console was rejected with 421 before
credential and device checks.

Added explicit `FAOLLA_SUPER_ADMIN_ORIGIN=https://console.faolla.com` to active web
environment and persisted source/baseline/active `.env.local`, preserving all
other values. A same-build temporary instance served during the active process
reload. Nginx originals restored byte-for-byte, temporary instance removed after
drain, PM2 saved. No maintenance or database/user-record changes. No whitelist or
authentication checks were disabled.

Public verification: console login HTML 200; empty auth body reaches expected
400 invalid_credentials (no credentials supplied); non-console hosts remain 421;
foreign Origin 403; unauthenticated protected snapshot 401. Real account login and
email verification remain for the user; no credentials were extracted or used.

Eight focused origin/request/device authorization tests pass. Environment example
now explicitly separates launch and console, with a regression test for that pair.

Live build remains c8e56782cac3b51118a63557f07057e61b0964d1, port 3102, PM2 name
merchant-space-web-live, new PID 4038242. Operation state and private backups:
`/var/lib/faolla-super-admin-origin-fix-20260923`. Deployment topology handoff:
`D:/faolla-web-presentation-live-release-20260922.md`.

The first unrouted candidate smoke probe encountered Node fetch's 421 POST replay
body error; plain non-retrying HTTP probes confirmed actual app behavior. The
unrouted candidate was removed and metadata retained under the `-probe-retry`
directory before completing the correction. No traffic or saved configuration
changed during that failed probe attempt.

The unrelated QR preview flicker fix remains local and has not been deployed.
