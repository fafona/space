# Redemption atomic PostgreSQL acceptance

This suite applies the real 045 order/member and 046 redemption migrations to
an empty disposable PostgreSQL database. It verifies the shared transaction
boundary for member points, inventory settings, coupon documents, their
histories/backups, and durable operation receipts.

## Isolated execution

Use a **new disposable PostgreSQL instance** and an empty database named
`faolla_redemption_test`. The runner fixes its host to `127.0.0.1`, checks the
database name, refuses existing user relations, and requires explicit opt-in.
It never loads application env files, database URLs, password files, Supabase
credentials, existing backups or production data. Other integration databases
are not used or cleaned. Synthetic rows remain for inspection after a run.

```powershell
$env:REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:REDEMPTION_TEST_PORT = '56450'
$env:REDEMPTION_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
node scripts/redemption-integration/run.mjs
```

The standalone `redemption-database` CI job provisions PostgreSQL 15 and runs
this script explicitly. A local PostgreSQL 13 result is identified as such and
is not evidence that PostgreSQL 15 CI ran. The script is intentionally not a
`*.test.mjs` file: ordinary local unit testing must not start SQL integration.

## Coverage

- Service-only RPCs, no direct API-role access to the receipt table, fixed
  search paths, populated migration replay and unrelated page preservation.
- Successful checkout and actual persisted versions across every document;
  unchanged documents do not alter versions, histories or receipts.
- Response-loss retry and concurrent identical operation IDs: one commit,
  then read-only replay even when stock is zero and the coupon is already used.
- Same operation ID with another fingerprint/member fails without mutation.
- Last-item contention by the same or different members; same-claim coupon
  contention; a coupon consumed after preparation rejects the whole mixed cart.
- Both orderings of checkout versus ordinary settings/coupon writes, and
  checkout versus 045 recharge; re-reading and rebasing retains both changes.
- Failures and suppressed DML at every domain, primary/backup history and
  receipt insertion; BEFORE/AFTER receipt tampering and an AFTER receipt trigger
  changing earlier data also roll the whole checkout back.
- Maximum safe integer stock/points cost, invalid stock, malformed payloads, corrupt/ambiguous documents, tenant
  isolation and minimal receipt content.

Concurrency uses independent real `psql` connections. The first transaction
remains open until the coordinator observes the second in `pg_locks`; a fixed
sleep is not counted as proof of concurrency. Failure assertions compare all
page documents and durable receipts, not only one balance field.

The test provides synthetic prepared plans and fingerprints to the service
RPCs. It proves database CAS, all-or-nothing persistence and operation binding;
it does **not** substitute for application tests of price calculations,
canonical request fingerprints, initially invalid/used coupons, business
permissions, HTTP/PostgREST, Auth or browser retry behavior. For example, a
coupon used after preparation is a database conflict; detecting a coupon that
was already used before preparation belongs to the application validator.
