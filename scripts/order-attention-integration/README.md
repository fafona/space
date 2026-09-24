# Order attention projection PostgreSQL acceptance

`run.mjs` is a mandatory additional step in the existing transaction-database CI job. It uses PostgreSQL 15, the actual baseline `merchants`/`pages`/timestamp/index DDL, the unchanged `045` order-membership RPC and migration `052`.

Safety: hosted GitHub Actions only, explicit `ORDER_ATTENTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1`, exact service-container identity binding, fixed `127.0.0.1:5432` and fixed newly created `faolla_order_attention_test`. The runner refuses an existing target and never drops/resets databases, reads application env files, accepts a database URL, or connects to production. The preceding transaction suite's database remains untouched. Only owned psql children are stopped on exit; disposal belongs to the CI service container.

Coverage:

- Source pages and the existing commit RPC remain unchanged by migration/replay; singleton pilot defaults disabled.
- RPC execution is service-only; direct table and column grants are absent even after replay repairs injected fixture grants.
- Disabled prewarming, enable/reset epochs, exact bigint generation strings, payload validation, stale publication rejection.
- Legacy RPC writes, direct insert/update/delete, rename/owner changes, legacy whitespace and replica-mode DML invalidate after commit. Unrelated merchants do not invalidate.
- Joint order/member/history failures, suppressed DML, a derived-summary trigger failure at deferred commit and explicit rollback also roll back all source and derived state.
- Genuine concurrent psql sessions exercise summary-first/source-first races, competing unchanged v1 CAS writers, and a direct future-chunk insert/existing-chunk upsert against a v1 writer. Lock waits are observed through `pg_locks`; no mocked database or timing-only race assertion is used.
- More than 512 source rows, over 8MiB, non-array blocks and a missing merchant refuse projection; they do not return a truncated successful result.
- Disabled capture refuses reads; explicit reset accompanies fixture trigger repair. Replica-mode TRUNCATE invalidates and supports an empty projection.

The constraint trigger is deferred until transaction commit. Read/publish use separate transactions, never an order writer's uncommitted transaction. This acceptance checks storage/CAS/transaction behavior, not TypeScript notification semantics or production timings.

Local non-database safety tests: `node --test scripts/order-attention-integration/run.test.mjs scripts/ci-workflow-contract.test.mjs`. Passing these tests is not a substitute for the mandatory genuine PostgreSQL CI step.
