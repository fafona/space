# Pages client-write ACL acceptance (048)

Migration: `scripts/supabase-migrations/202609090048_pages_client_write_acl.sql`.

048 deliberately blocks old browser `pages` INSERT/UPDATE/DELETE, including
independent column INSERT/UPDATE grants. Deploy the server-only publishing
candidate while normal entry points and old writers remain stopped. An old
cached browser must not regain the removed fallback. Do not rerun
`supabase-init.sql`, which contains the historical authenticated write grant.

The migration does not change rows, SELECT privileges, RLS policies, service-role
permissions, other tables, default privileges, role membership or RPC ACLs.
Unexpected inheritance/ownership that retains client writes causes rollback;
so does loss of a preserved read or service-role privilege. Do not use CASCADE
or silently change another role to make it pass. It is not a general write
fence or evidence that every application/background/RPC writer has stopped.

## CI wiring

Use a **separate, initially empty** GitHub Actions `postgres:15` service:

- `POSTGRES_DB=faolla_pages_acl_test`, `POSTGRES_USER=postgres`,
  `POSTGRES_HOST_AUTH_METHOD=trust`, mapping `5432:5432`.
- Wait for `pg_isready -U postgres -d faolla_pages_acl_test`; install the normal
  PostgreSQL client so `psql` is available on PATH.
- Set `CI=true`, `GITHUB_ACTIONS=true`, and
  `PAGES_ACL_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1`.
- Before the runner, execute `node scripts/ci-postgres-service-identity.mjs`
  with `FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID` taken directly from
  `${{ job.services.postgres.id }}`. This binds the container's actual server
  address through `GITHUB_ENV`; pass that same trusted service ID to the runner.
- Execute `node scripts/pages-acl-integration/run.mjs` with no arguments.

The runner connects only to `127.0.0.1:5432/faolla_pages_acl_test` as `postgres`.
It verifies PostgreSQL major 15, the bound service address, default service data
directory and no user relations/functions/test roles before its first write.
It never reads project environment files, accepts no connection overrides and
does not create/reset/drop a database or start/stop a service. It preserves the
synthetic fixture on failure. Each psql invocation is bounded by 25 seconds and
the overall runner by a checked 120-second deadline.

## Acceptance coverage

The runner extracts real baseline pages/timestamp/index DDL and applies the
unchanged 044, 045, 046 and 047 SQL files, then the actual 048 migration. Its
synthetic policy intentionally permits both client roles, proving write denial
is due to the new ACL rather than an unrelated RLS rejection.

It checks predecessor/registry failures; inherited writer and client-owner
failures; service permission loss through PUBLIC; complete ACL/registry/data
rollback; previously working anon/authenticated writes becoming SQLSTATE 42501;
SELECT and service INSERT/UPDATE/DELETE remaining usable; no change to business
rows, RLS policies, unrelated tables or role memberships; idempotent reapply;
and closure of reintroduced PUBLIC, table and column grants.

This is database-boundary acceptance, not browser/account-flow E2E or production
evidence. Existing publishing, public-page and account tests remain necessary.
No actual PostgreSQL run is implied by passing the pure/static tests below.

```text
node --test scripts/pages-client-write-acl-migration-contract.test.mjs scripts/pages-acl-integration/run.test.mjs
node scripts/check-supabase-migrations.mjs
```
