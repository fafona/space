# Google callback loading transition: narrow no-maintenance release

Approved 2026-10-25 against live `dd85d9fb1d5f571b6951fdc4891066f0ba88ceef`.
The login page rendered its form while completing the existing Google callback.
Use the existing branded loading screen from callback first paint through URL
cleanup and committed navigation. Terminal errors release the form; pending
retries and account-entry notices remain visible. Ordinary password login,
account selection, OAuth parameters, server validation and redirects stay intact.

Only the three reviewed login UI/test files may change. All three full files,
the exact live baseline and the complete tool closure are checked. The archived
old login page is a test-only text fixture, byte-pinned to the original Google
lane's unchanged hash. Old lane tests use that immutable fixture and separately
prove today's page remains forbidden to that lane. No old production restriction
is widened; no workflow, dependency, API, auth transport, database or feature
configuration change is admitted.

Require every CI check on both the PR and exact merged current-main SHA before
staging. Preserve clean owned source, dependency tree, baseline PID, inherited
settings and secrets, maintenance state, proxy snapshots, build proof and logs.
The fixed baseline process is `merchant-space-online-dd85d9fb1d5f`, port 3105.

Retain admission of 6 GiB available RAM and 20 GiB disk. Build in the unchanged
private-network sandbox: 4 GiB hard memory, 3072 MiB Node heap, one CPU, 128 tasks,
zero swap and a 20-minute timeout. Do not enlarge budgets, lower checks, stop
another process, retry a failed candidate automatically or enter maintenance.
Resource or protected-workflow failures require a new user decision.

Candidate/public smoke retains contact/vCard/WeChat, attendance and super-admin
denial, hidden harnesses, merchant-session host boundaries, login and assets.
The additional callback GET uses only an empty OAuth marker, no code/token or
account, and checks first-paint loading markup without executing browser effects.
Its fixed native HTTP loopback transport preserves the launch Host and HTTPS
forwarding metadata, rejects redirects, and bounds body size and elapsed time;
it does not widen the existing session-only probe or follow traffic into live.
No production account or business data is created. Gracefully switch only after
all gates pass, with owned rollback on failed public validation. Post-publication
retention is convergence-only: keep active and baseline rollback, never stop or
delete any other version or change background tasks.
