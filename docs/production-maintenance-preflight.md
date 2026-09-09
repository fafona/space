# Read-only maintenance preflight

`Production Maintenance Topology` is a manually dispatched diagnostic, not a
maintenance switch. It does not stop processes, change routing, read environment
files, run migrations, or authorize a release. Do not use a successful run as
evidence that business writes have stopped.

The workflow requires the exact current `main` source, successful push CI for that
source, an explicit expected live build, and pinned SSH host trust. It shares the
production operation lock. The probe runs over standard input without a server
checkout or persistent installation. The Nginx `-T` configuration test does not
reload or restart Nginx, but can open configured log files; the version HTTP probe
can also produce ordinary access logs. This is not a zero-filesystem-write
guarantee. No application configuration or business data mutation is requested.
Only a strictly validated, bounded summary
is printed; raw SSH, process, container, and proxy output is not published.

Unavailable or unknown observations remain unresolved. In particular, process
status alone cannot prove that an in-flight write or external email has drained,
and proxy configuration cannot prove the absence of other database clients.
Docker role counts cover only the fixed `supabase-kong`, `supabase-rest`,
`supabase-db` and `supabase-auth` names. A zero count does not exclude a differently
named instance. Published port mappings are not a network reachability test,
especially for host or shared-container networking. Other containers and
separately managed scheduled jobs require a further bounded operator review.

## Before migration

1. Inspect the actual web runtime, independent workers, reverse proxy, Supabase
   gateways, published ports, and any separately managed scheduled jobs.
2. Establish a persistent maintenance boundary covering write-capable GET/SSR
   requests, background automation inside the web process, independent workers,
   and direct business database/API clients.
3. Verify existing operations have settled and that maintenance survives release
   switching, rollback, and worker restarts. Keep genuine health checks available.
4. Only then use the existing exact-source backup, migration, readiness and
   deployment chain. Failures must not silently reopen business writes.

The current application's embedded booking automation cannot be paused merely
by stopping the separate enterprise automation worker. Blocking Supabase
indiscriminately also blocks deployment health/persistence checks; do not fake
their responses or skip the checks. Resolve this handoff before applying schema
changes. A failed preflight does not enable maintenance or modify deployment
configuration.
