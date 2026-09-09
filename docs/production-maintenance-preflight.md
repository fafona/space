# Read-only maintenance preflight

`Production Maintenance Topology` is a manually dispatched diagnostic, not a
maintenance switch. It does not stop processes, change routing, read application
environment files, run migrations, or authorize a release. Do not use a successful run as
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

## Capability inventory

The workflow now streams `check-production-maintenance-capabilities.mjs`. The
earlier topology collector and validator remain available for historical reports.
The capability inventory checks the expected live build before and after a
bounded inventory. It inspects all container identities within a fixed limit,
emitting only recognized component classes, counts, exposure classifications and
digests. Names, addresses and arbitrary labels are not published. A shared
Compose project or network is an association, not permission to stop a service.

Only an unambiguous, recognized Kong or database container may receive an exec
probe. Selected Kong configuration metadata is classified immediately; the
collector does not read or publish its entire environment or declarative body.
Control-plane requests are fixed read-only GETs at an already identified local
listener, never a port scan or a configuration change. Unavailable tools, disabled
listeners or ambiguous configurations remain unknown.

Plugin availability is not evidence that a plugin is active on any route. Kong
distinguishes loading plugin code from enabling a configured instance; see its
[configuration reference](https://developer.konghq.com/gateway/configuration/#plugins).
The collector does not load, enable or reconfigure plugins.

Database probes reuse the deployment's configured container-local credential
mechanism, with fixed client options and a bounded read-only transaction. They
inspect scheduler and transaction metadata, not business records, SQL query
text, job commands or prepared transaction identifiers. Insufficient effective
statistics privileges must not appear as a verified zero. A snapshot of zero
active transactions is not proof that future writes are fenced.

This probe is not a complete host scheduler inventory, firewall reachability
test, in-flight operation drain or maintenance certificate. It cannot stop or
restart any service, enable a plugin, alter database privileges or invoke the
release pipeline. A successful run still reports maintenance as not verified.

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
