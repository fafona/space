# Customer membership profile: database-to-application projection

## The bottleneck addressed

The customer list needs membership identity/profile and saved balance fields, not
the complete transaction history. The previous profile reader avoided expanding
safe history on the application server, but still fetched it from `pages.blocks`.
This change can omit safe histories **inside a read-only database function before
returning JSON**. It does not migrate, repair, truncate or rewrite stored records.

The candidate is based on `7eaeceebd5ced0ba6fa50b036458b32e1b2bfe8a` and does not
include inactive customer-generation or booking-authority branches. Production
has not been modified by this implementation or its local acceptance tests.

## Deliberately narrow success contract

Migration `202609280060_customer_membership_profile_projection.sql` adds only
`faolla_customer_membership_profiles_v1(text)`, its exact execution ACL and its
migration registry entry. It changes no business relation, index, trigger, RLS
policy, writer or existing function. The function is stable, security-invoker,
uses a fixed search path and can be executed only by the owner and service role.
It is not an authentication/authorization replacement: customer GET retains its
existing merchant session check and configured server client.

Within one SQL statement snapshot, the function checks the global exact slug,
bounded to two rows for the uniqueness decision. It returns a projected row only
when there is exactly one matching row, its merchant ID is exact, its blocks are
an array, and no transaction object has object/array `balanceDelta` or
`growthDelta`. It preserves every membership array element, original ordinal and
all fields other than the unused history. Object memberships get `transactions:
[]`. It does not parse dates or numbers, compute balances, deduplicate members or
filter foreign/invalid records before the original JavaScript normalizer.

Zero rows, global duplicate slugs, wrong ownership, unsupported shapes and unsafe
money return an explicit data-free `fallback` envelope. They never claim an empty
membership list. This matters because the old reader retries by slug when its
initial merchant-filtered query is empty, and multiple unordered rows can affect
duplicate-ID winners. The SQL does not attempt to redefine those rules.

## Application integration and failure boundaries

Only `loadStoredMerchantMembershipProfiles` opts into the new read. Full history
readers and all save/CAS/ledger paths are unchanged. The original profile stripping,
both normalization passes and merge logic still execute after successful projection.
The existing full-store source pin remains unchanged after removing the precisely
identified projection import and profile-only additions.

The decoder accepts only the known version, requested scope, one exact-slug row,
required metadata, an array of blocks and empty histories on object members. A
missing RPC, explicit fallback, malformed response, permission/transport error or
deadline leads to **one invocation of the original reader**, using the same
authorized client. Its own existing schema retries and errors remain authoritative.
A failed RPC is never converted into an empty successful result. A later error in
the original normalizer is not caught or disguised by the projection adapter.

The optional attempt is limited to 1,500 ms. The SDK request receives an abort
signal where supported; the client then falls back if the deadline is reached.
This is not proof that every database/server cancels work immediately on client
disconnect. Late promise completion/rejection cannot replace the fallback result.
There are no business-data caches, background workers, read repairs or repeated
projection retry loops.

## Safe rollout and rollback

The feature is **off by default**, so an old deployment does not probe an absent
RPC on every customer request. Both of these public operational settings are
required:

```dotenv
MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED=1
MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS=99990001
```

The number above is a synthetic example, not a production merchant selection.
The allowlist must contain exact eight-digit merchant IDs, comma separated; an
empty or malformed list disables the optimization. Wildcards are not accepted.
These switches affect performance routing only, never authorization.

Release sequence, without maintenance:

1. Validate the candidate, current production baseline, backups and the existing
   release/rollback guards. Do not mix in inactive authority branches.
2. Apply the additive 060 migration through the controlled database workflow,
   after its required backup/preflight. Keep the old application serving traffic.
   No 053–059 feature schema is required by this function.
3. Verify service-role execution, browser-role denial and result equivalence for
   an explicitly selected merchant using the configured authorized workflow.
4. Validate the separate application candidate, then switch using the established
   ownership-checked no-maintenance release path. Enable only the verified IDs.
5. Observe end-to-end latency, DB CPU, errors and fallback rate before expanding.
   Do not infer these from the local synthetic measurements alone.

Rollback is disabling the feature/allowlist and returning to the old reader;
an application rollback also remains backward-compatible. No business-data or
schema rollback/removal is needed. Existing immutable assets and workers remain.
Actual rollout must not silently enable maintenance or bypass any release guard.

## Local acceptance and measured results

Validation completed on 2026-09-28:

- 717 related application, compatibility, migration-contract and native-runner
  unit tests passed; a separate 34 CI inventory/workflow tests passed.
- Full non-incremental TypeScript checking and changed-code lint passed.
- Migration inventory validated 61 migrations; encoding and diff checks passed.
- A fresh, isolated local PostgreSQL 15 cluster ran the actual migration and
  replay, real role/ACL denials, conservative fallback cases, actual TypeScript
  profile loaders and the complete customer reducer. Original rows and registry
  were hash-compared around reads; old/new output and expected exceptions matched.
  This is native SQL acceptance, not a production or PostgREST/HTTP acceptance.

The full, unfiltered successful run is stored in
[`benchmarks/membership-profile-db-projection-20260928.json`](benchmarks/membership-profile-db-projection-20260928.json),
including source/runner SHA-256 hashes, all three repetitions per case, raw/native
and compact JSON byte counts, query samples, output hashes and stopped-cluster
identity. All fixtures are synthetic.

| Members × transactions each | Old compact JSON bytes | Projected compact JSON bytes | Change |
| --- | ---: | ---: | ---: |
| 100 × 0 | 33,384 | 33,446 | +62 bytes (+0.19%) |
| 1,000 × 20 | 4,695,285 | 338,547 | −92.79% |
| 10 × 5,000 | 11,031,203 | 3,475 | −99.97% |

These are database-returned JSON sizes, **not compressed network bytes or a
whole-page speed-up**. They include the small versioned RPC envelope. No-history
merchants have no payload benefit from this implementation.

Native SQL timing deliberately records two different measurement boundaries:

| Fixture | Old/new synthetic JSON-wrapper median (ms) | Old bare SELECT / new RPC EXPLAIN execution median (ms) |
| --- | ---: | ---: |
| 100 × 0 | 2.473 / 4.051 | 0.048 / 4.604 |
| 1,000 × 20 | 107.159 / 44.889 | 0.050 / 47.897 |
| 10 × 5,000 | 223.450 / 106.443 | 0.043 / 106.211 |

The first pair includes constructing a synthetic JSON result in SQL. The second
uses separate `EXPLAIN ANALYZE` runs of the actual SELECT/RPC. A bare legacy
SELECT does not pay the same JSON-construction/serialization cost during EXPLAIN;
these numbers must not be treated as end-to-end latency ratios. They make the
additional database work visible and do not prove reduced physical reads or DB
CPU under production traffic. Each median has only three descriptive local
samples, not a production performance SLO or capacity claim.

### Acceptance-run failures retained

Three fresh task-owned directories were used; no failed directory or old fixture
was reused, deleted, restarted or had permissions changed:

1. `D:/codex-membership-profile-projection-native-20260928-ZtCJct`: PostgreSQL
   became ready, but Node's synchronous `pg_ctl start` capture waited on inherited
   background pipes and timed out. No acceptance database/SQL results were
   produced. The independent cleanup stopped it at 09:33:01 CEST. The runner now
   uses ignored stdio only for the fixed `pg_ctl start` call, with its dedicated
   logfile and all startup/identity/cleanup checks retained.
2. `D:/codex-membership-profile-projection-native-20260928-u94G47`: an invalid
   joined-date fixture incorrectly expected two valid profiles. The unchanged
   original normalizer correctly rejects that member, so the expected count was
   corrected to one. SQL's complete raw-element/order assertion and old/new full
   result/error comparisons were not relaxed. Cleanup stopped it at 09:36:51 CEST.
3. `D:/codex-membership-profile-projection-native-20260928-8OebvE`: all acceptance
   checks and measurements passed, exit 0. Cleanup stopped it at 09:38:50 CEST;
   the runner confirmed `pg_ctl status` 3 after stopping. Read-only follow-up
   confirmed no retained postmaster PID and no listener on the fixed port 56642.

The first two failures are test-runner/fixture issues, not passing benchmark
samples. The successful raw report contains every measurement from the third
run without selecting only favorable samples. The default-off operational
switches remain unchanged and no production database or application was touched.

## Limits and costs

This removes history from the returned JSON, not PostgreSQL's internal storage
read. PostgreSQL still fetches/detoasts and inspects history and constructs the
projected JSON, potentially increasing DB CPU. A malformed or ambiguous row
causes an extra optional RPC before the full legacy read. Small/no-history cases
can have slightly larger JSON because of the versioned envelope. Native SQL text
bytes and compact JSON bytes are not gzip/HTTP transfer measurements.

This is not server-side pagination of the whole customer list. Orders, bookings
and manual customer records still use their established readers. The full
directory still performs identity merging across those sources. No production
capacity, latency or complete-project optimization claim follows from this change.
