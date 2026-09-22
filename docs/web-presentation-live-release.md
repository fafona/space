# Reviewed presentation-only live deployment

User approved adding this lane after being told the old full release required a
write pause. It is not a bypass for migrations, authentication, dependencies or
background job changes: an exact file allowlist rejects those changes.

`node scripts/web-presentation-release.mjs stage TARGET BASELINE` builds one
independent loopback3102 web process from exact `origin/main`. The primary3000,
enterprise worker and previous card3101 processes remain alive and unchanged.
The candidate disables background schedulers; the original web/worker continue
the unchanged jobs. No database backup transfer, schema migration, maintenance
mode, data rewrite or baseline-process restart is performed.

Stage shares deployment/maintenance locks, verifies the active old card overlay,
same dependency lockfile, process identities, ended maintenance and disk reserve.
It retains exact nginx originals privately, runs focused Linux tests, builds,
starts the candidate and validates version, auth enforcement and real card URL.

`activate` adds immutable static assets without overwriting existing bytes (any
collision stops the release), then updates only the three observed application
proxy files. Supabase/OAuth/static aliases remain unchanged. nginx validates and
gracefully reloads. All web pages and save APIs now use the same new build, while
old tabs can still download the prior hashed assets. Public verification failure
restores original proxy contents and reloads. POST requests are not automatically
replayed to another backend.

The root state is `/var/lib/faolla-web-presentation-release/state.json`; active
marker `faolla_web_release.conf` blocks the old deployment and maintenance tools.
The old card state remains retained but is superseded while this web lane is
active; its controller also refuses changes. `rollback` first restores all three
exact proxy originals and removes only the owned marker, restoring the previous
primary/card topology. Processes and static files remain available for recovery.

The `.current` symlink continues to identify the old scheduler/base process; the
public `/api/app-web-version` identifies the live web release. Future releases
must review this explicit topology rather than treating `.current` as public web.
This first implementation refuses an existing state rather than blindly replacing
another release. Subsequent reuse/cleanup requires an ownership-checked handoff.
