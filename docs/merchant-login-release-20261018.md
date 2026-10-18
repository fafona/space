# Merchant browser login recovery: no-maintenance code-only release

The user approved the six exact application/test files and a separate narrow
release lane. It distinguishes temporary session-service failure from explicit
401/403 rejection; failed stale-token sync no longer deletes the current cookie
session. Backoff retries are bounded to 30 seconds, pause while hidden and clean
up on unmount. Existing normal logout, account selection, staff restrictions,
host-only HttpOnly cookies and disabled cross-frame bearer transport remain.

Start only from owned live `6d77f3dfb61d1b694cc807c17d14f334cfec62f0` on
port 3105. The complete base-to-target closure admits exactly the six application
files and listed release tools/tests/this note. No dependencies, migrations,
permission model, business settings or historical records change. Older lanes
retain their original scope. Database entrypoints explicitly reject this lane.

Use the normal PR and required CI for exact merged main, the verified sparse
controller, then `stage TARGET BASELINE` and `activate TARGET`. One independent
candidate copies only unchanged owned dependencies; the existing guarded full
build has a 4 GiB hard limit, 3072 MiB Node heap, one CPU, 128 tasks, no swap,
private network and 20-minute timeout. Admission still requires 6 GiB available
RAM and 20 GiB free disk. Never reset failed state or lower these thresholds.

Recheck source, full closure, dependency tree, private environment and actual
baseline/candidate process identities before startup and switching. Candidate
and public acceptance preserve the existing contact/vCard, WeChat guidance,
attendance 401s, harness 404s and super-admin backup denial. A separate bounded
unauthenticated loopback GET probe preserves the exact portal Host while testing
the session endpoint; no real login, cookie, password or business write is used.
Real handset login remains a user acceptance check, not a claim of this smoke.

The website stays online. nginx changes only after readiness, with unchanged
ownership-checked rollback, additive immutable assets and retained workers.
Successful publication appends retention convergence only; no process retirement
or artifact deletion runs automatically. Failure evidence remains intact.

Separately, the user allowed temporary suspension of Supabase Studio only if
required for build admission, with exact ownership/configuration verification
and automatic restoration after the build attempt. This does not authorize
stopping PostgreSQL, the formal application, workers or other containers.
