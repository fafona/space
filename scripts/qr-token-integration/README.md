# QR token atomic mutation acceptance

The route keeps the existing `pages` system document and all previously issued
tokens. Migration `202609080044` adds a partial unique index and a service-only
RPC; database row locks serialize `ensure` and `reset`. Missing RPC support
returns HTTP 503 for writes, never a legacy read/modify/write fallback.

## Isolated PostgreSQL test

Create a new empty database named `faolla_qr_test` in a disposable local
PostgreSQL instance. The runner refuses non-empty targets, uses only
`127.0.0.1`, requires an explicit opt-in, and never loads application env files.
It creates synthetic records and test roles. Do not use an existing instance
that contains production data or run it against production.

```powershell
$env:QR_TOKEN_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:QR_TOKEN_TEST_PORT = '56448'
$env:QR_TOKEN_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
node scripts/qr-token-integration/run.mjs
```

On CI, provision PostgreSQL 15 with user `postgres`, database `faolla_qr_test`
and host trust authentication on a loopback port, then set the same opt-in and
port variables. `QR_TOKEN_TEST_PSQL` can be omitted when `psql` is on PATH.

Coverage: ambiguous legacy rows block migration without token loss; migration
replay and old links; exact service-role ACL and fixed search path; malformed
inputs; concurrent different-account resets, same-account ensures and resets;
both ensure/reset orderings; concurrent first creation; failed/suppressed
updates; corrupt NULL payloads; and unrelated page isolation. Each race uses
two real PostgreSQL sessions, starting the second only after the first holds
the row lock. Mock application tests exercise the API/storage contract but do
not substitute for these database tests.

## Release ordering

Apply the additive migration before the new application. If duplicate legacy
rows or an unexpected unique-index definition are found, stop and investigate;
never merge/delete rows automatically or copy tokens from backup/history.
Before enabling the new QR writer, drain/stop every old application instance
that could still write the shared document directly. A mixed old/new writer
deployment is not protected by the new RPC. Existing link validation can
continue throughout. A rollback to the old application also restores the old
writer's concurrency risk, so coordinate QR mutation availability explicitly.

The migration changes no existing ordinary-account RPC, ACL allowlist, RLS
policy, function default privilege, public homepage or merchant-owned page.
