# Checkout context PostgreSQL acceptance

This independent suite applies the real 045, 046 and 047 migrations to an empty
disposable PostgreSQL database. It verifies the server-side pending checkout,
immutable request and authoritative receipt, cancellation tombstone, explicit
acknowledgement, and their atomic boundary with points, stock and coupons.

## Isolated execution

Use a new disposable PostgreSQL instance and an empty `faolla_checkout_test`
database. Local execution accepts only `127.0.0.1:56451` and requires its actual
`data_directory` to equal this worktree's `.runtime/checkout-test-pg`. The runner
checks database name, server address, port and existing relations before writing.
CI alone may use port 5432 in the fresh PostgreSQL service below.

```powershell
$env:CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = '1'
$env:CHECKOUT_TEST_PORT = '56451'
$env:CHECKOUT_TEST_PSQL = 'C:\upos-runtime\pgsql\bin\psql.exe'
node scripts/checkout-integration/run.mjs
```

The runner never loads application env files, database URLs, password files,
Supabase credentials, existing backups or production data. It does not reset a
database or clean other test instances. Synthetic rows remain after the run for
inspection; repeating the suite requires a separately authorized reset of this
exact disposable database. An ordinary `npm test` does not start this runner.

The independent `checkout-database` CI job provisions PostgreSQL 15 and runs the
plain Node script explicitly, after the quality job. Local acceptance on
PostgreSQL 13.15 is reported as such, not as proof that PostgreSQL 15 CI ran.

## Coverage

- Actual migration application and populated reapplication; service-only RPCs,
  fixed search paths, inaccessible internal writer, and removal of drifted
  function/table/column grants. Neither durable table is directly readable by
  API roles; unrelated pages remain unchanged.
- A committed 046 legacy operation without a 047 context cannot be adopted.
  The old public v1 writer rejects financial operations after 047 is installed.
- Immutable, idempotent staging; one unacknowledged slot per site/operator;
  rejection of pending acknowledgement and competing new operation IDs.
- Lost commit-response recovery from GET without an operation ID: the immutable
  terminal receipt remains available until explicit acknowledgement. Old
  operation replay remains read-only even after acknowledgement and a new cart.
- Cancel-first prevents late commit; commit-first cannot be reversed by cancel.
  Cancellation changes no financial document, and its permanent tombstone
  continues blocking the cancelled operation after acknowledgement.
- Both commit/cancel orderings, duplicate commit, and competing stage IDs use
  independent real `psql` connections. The first transaction is released only
  after observing the second connection's actual wait in `pg_locks`; a fixed
  sleep is not treated as concurrency evidence.
- Other actors/sites get no context. Their mutations fail without writes;
  different authenticated operators have independent checkout slots.
- Substitution of intent, fingerprint, membership, note, quote, pinned document
  versions, receipt totals, debit operator or another member fails closed.
  An old pending checkout cannot silently reprice after settings changes.
- Raised failures and suppressed writes at all four context transitions, plus
  failures at all nine financial document/history/backup boundaries, leave
  every page and both durable tables unchanged.
- AFTER-context triggers modifying earlier member data, history, the 046
  operation receipt or the new authority result cause complete rollback.
- A valid level-up gift may exceed the checkout debit, provided the new
  transactions explain the exact final point balance. Coupon history at the
  5000-event limit permits only the existing writer's precise tail truncation;
  dropping an event from the middle is rejected. Future-dated old events may
  precede the new event without breaking the original order of old events.
  Reusing a consumed claim/settlement or normalizing away empty, non-string or
  duplicate event IDs is rejected. These tests retain the 15-second statement
  timeout, including the valid 5000-event checkout.

Fixtures are synthetic service-level prepared plans. This suite establishes
the PostgreSQL transaction, CAS, immutable context and ACL guarantees, not
application pricing or fingerprint canonicalization, employee permissions,
HTTP/PostgREST authorization and redaction, browser scope changes or printing.
Those boundaries require the separate TypeScript/API/browser suites. The suite
does not authorize or perform a production migration or deployment.
