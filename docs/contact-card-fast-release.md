# Narrow, no-maintenance contact-card releases

This is a route-scoped rollout, not a replacement for database/authentication or
full application deployment. Only `/card/` traffic changes. The primary web,
worker, assigned merchant identity, database schema and all saved merchant data
remain unchanged. The global application-version endpoint continues to identify
the primary release; card responses expose `X-Faolla-Card-Release` separately.

## Procedure

1. Review the exact baseline-to-target diff with the script's strict allowlist.
   Run focused card tests, release-policy tests, TypeScript and lint.
2. Commit/push the reviewed source. On the server fetch that exact source, then
   `node scripts/contact-card-release.mjs stage TARGET_SHA BASELINE_SHA`.
   This takes the normal deployment lock and maintenance operation lock, verifies
   the old process/build, creates a separate release, copies identical dependencies
   (not hardlinks), builds once, and starts a loopback-only paused-background web.
3. Inspect the actual saved card URL using the candidate. Activation requires its
   public card key and expected website URL:
   `node scripts/contact-card-release.mjs activate CARD_KEY HTTPS_WEBSITE_URL`.
   It validates the HTML, tests nginx config, gracefully reloads nginx and verifies
   public card/home/login. Old web PID and runtime symlink must stay unchanged.
4. Failure during activation restores the original routing. Transport failures
   also fall back to the existing old web. Explicit rollback:
   `node scripts/contact-card-release.mjs rollback`.

No maintenance page, web shutdown, migration, backup export, credential export,
or historical-release deletion is performed. The existing tested full database
backup remains intact. A failed/stale staging state requires review, not automatic
deletion or overwriting. The primary runtime must not change underneath the route
release. Old candidate files/processes are intentionally retained for review.

## Full-release handoff

Full deployment and maintenance control now reject an active route config BEFORE
pausing services. Explicitly roll the route back first (old card behavior only;
site remains live), then use the normal release procedure with this fix included.
Do not run older maintenance/deployment scripts against an active route release.
Future expansion requires reviewed route/dependency compatibility; do not broaden
the allowlist just to make an unrelated change pass.

The initial rollout includes building and testing this new mechanism; subsequent
timing estimates must be based on actual measurements, not treated as a deadline.
