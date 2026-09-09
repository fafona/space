# Order and membership atomic PostgreSQL acceptance

This suite applies the real order/membership commit migration to an empty,
disposable PostgreSQL database. It uses real independent `psql` sessions, not
mock database responses. It never loads application env files, Supabase
credentials, a database URL, backups, or production data.

## Run safely

Create a **new disposable PostgreSQL instance** and an empty database named
`faolla_transaction_test`. The runner fixes the host to `127.0.0.1`, verifies
the exact database name, refuses a database with existing user relations, and
requires an explicit disposable-database opt-in. It leaves its synthetic data
in that disposable database for inspection; a repeat run needs a fresh empty
database, not an automatic cleanup of existing data.

```powershell
$env:TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:TRANSACTION_TEST_PORT = '56449'
$env:TRANSACTION_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
node scripts/transaction-integration/run.mjs
```

CI provisions its own PostgreSQL 15 service with the same fixed database name
on loopback port 5432. A local PostgreSQL 13 result is reported as PostgreSQL 13
and does not by itself claim that the PostgreSQL 15 CI job has passed. No npm
dependencies or application server are required for this database suite.

The file is intentionally named `run.mjs`, not `*.test.mjs`: the default local
test discovery must not start a database integration suite implicitly. The
dedicated `transaction-database` CI job runs it explicitly and fails on any
SQL error or failed assertion.

## Coverage and boundaries

- Service-only RPC grants, custom-role grant cleanup and migration replay.
- 101 orders spanning two chunks, member documents, primary histories and
  history backups committed together.
- Same-snapshot concurrent order updates and member debits: exactly one wins;
  a fresh-snapshot retry preserves previously committed changes.
- The coordinator observes an actual PostgreSQL lock wait before releasing
  the first transaction; fixed sleeps are not used as evidence of concurrency.
- Repeated requests do not duplicate orders, point entries or history writes.
- No-op retries preserve document timestamps; changing one order chunk leaves
  the other chunk untouched. A previously prepared empty-member snapshot
  conflicts if another session creates the member before it can commit.
- Injected SQL failures and suppressed DML in a later chunk, member write,
  history or backup roll back all affected documents; an AFTER trigger that
  rewrites an earlier document is also detected and rolled back.
- Conversion of the existing unchunked order document, tenant isolation,
  independent concurrent tenants, ambiguously owned reserved documents,
  corrupt persisted data, negative/fractional/unsafe numeric payloads and
  unrelated page preservation.

The fixture extracts the real `pages` schema, timestamp trigger and tenant
unique index from `supabase-init.sql`. The real migration supplies the RPC;
the test does not reimplement its transaction algorithm. Records are synthetic.

This is acceptance of the **order/member/history commit boundary**. Inventory
and coupon documents are asserted unchanged, not made atomic with redemption.
It also does not prove application retry orchestration, point-calculation
rules, HTTP/PostgREST routing, Supabase Auth or employee permissions; those
need their corresponding application and security tests.
