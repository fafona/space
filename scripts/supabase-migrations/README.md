# Supabase migrations

This directory contains forward-only database migrations for Faolla.

## Rules

1. Apply `scripts/supabase-init.sql` before these migrations on a new project.
2. Apply migration files in filename order.
3. Back up the database before applying a migration.
4. Never edit a migration after it has been applied. Add a new migration instead.
5. Do not add destructive operations such as `drop table`, `truncate`, or `drop column`.
6. Run `npm run check:db-migrations` before committing.

The application does not apply these files automatically. Production migrations
must be executed deliberately through the Supabase SQL editor or a controlled
database deployment job.

## Current rollout

The migrations only create additive tables, indexes, policies, and helper
functions. Existing order, membership, booking, coupon, conversation, and page
reads and writes continue to use their current storage paths until each
domain's explicitly allowlisted dual-write mode is enabled. Conversation V1
tables have no authenticated direct-read policy; only the service-role bridge
and controlled operator tools can access them during shadow verification.

Migration `202607250007` prepares the reliable outbox runtime but does not
route any current side effect through it. Enqueue, claim, lease renewal,
completion, retry, dead-letter replay, and aggregate health functions are
`service_role` only. Event attempts and replay history are retained; operators
must disable enqueue rather than deleting task history during rollback.

Migration `202607250008` adds a merchant-and-event scoped claim RPC for
controlled worker pilots. The application worker does not use the broad claim
RPC: every claim and expired-lease recovery must match explicit exact merchant
IDs and registered event types. Applying the migration does not start a worker,
enable enqueue, or change the current Google review response path.

Migration `202608190035` adds the shadow-only positive authorization
foundation for ordinary Faolla accounts. It reuses consistent merchant UUID
aliases, creates an empty versioned canonical personal binding table with
active/disabled lifecycle state, and exposes only service-role
resolver/readiness RPCs. Readiness compares legacy metadata/email merchant
access with positive UUID ownership and gates personal metadata, global account
identifier, staff-registry, and cross-type conflicts without returning identity
values. It does not backfill production rows, change login or RLS behavior, or
make any route consume the new projection.

Migration `202608190036` is the preparation stage for the ordinary account
cutover. It adds `service_role`-only operations:
`faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)` allocates a
new merchant or personal ID for signup, and
`faolla_create_ordinary_account_authorization_v1(uuid,text,text)` creates an
explicit controlled ID only when the target does not exist. An existing target
is replay-safe only when it is already the exact active personal binding or all
seven merchant UUID aliases are present and equal to the same Auth UUID; it is
never repaired or rebound. Disabled personal rows are not reactivated by either
operation. The migration also adds
`faolla_get_ordinary_account_authoritative_cutover_readiness_v1()`, whose hard
gate uses only canonical rows, Auth UUIDs, schema/ACL state, identifier
collisions, staff/cross-type overlap, and aggregate system-site principal
overlap. Mutable metadata and email remain in the migration-035 observation
report but are not authoritative cutover inputs.
The create/bootstrap functions lock the target Auth row before entering one
shared advisory lock domain. An `ENABLE ALWAYS` staff-registry INSERT guard uses
that same domain in the reverse direction, so an Auth UUID cannot race into both
an ordinary canonical binding and a staff identity. A second `ENABLE ALWAYS`
guard rejects deletion of an Auth row while any ordinary merchant alias or its
canonical personal row still exists; unbound, staff-only, and exact
`site-main` system-site Auth rows are outside this ordinary lifecycle guard.
Retirement therefore remains fail-closed until a future atomic
ordinary-account retirement operation removes the canonical binding first.
All ordinary-account `SECURITY DEFINER` functions are normalized to the
migration owner with a fixed `pg_catalog, public` search path and exact direct
EXECUTE ACLs (service-role only for resolver/readiness/create/bootstrap; owner
only for trigger guards), including removal of grants to arbitrary custom
roles. Authoritative readiness verifies the actual unique-index columns,
operator classes, collation/options, predicates, constraint definitions, and
exact trigger function/event/`ENABLE ALWAYS` structure rather than object names
alone. It also removes every non-owner table- and column-level grant (including
delegated custom-role chains) from the canonical personal table and verifies
the exact owner ACL. Migration 036 does not change `faolla_is_merchant_owner`,
merchant/page/transaction table grants, or RLS policies.

Positive personal authorization is narrower than the migration-035 shadow
table constraint: canonical personal IDs must be eight decimal digits in the
product-owned inclusive range `50010105`-`59999999`. Bootstrap allocates only
inside that range, explicit create rejects either boundary overflow, the
resolver refuses an out-of-range canonical row, and authoritative readiness
reports it as `invalidCanonicalCount`. The exact merchant ID `site-main` is the
platform-wide system-site sentinel, not an ordinary merchant. Resolver,
bootstrap, and explicit create never grant it; authoritative readiness excludes
only that exact sentinel while continuing to hard-block every other invalid
merchant ID. A `site-main` Auth principal may not also become staff, personal,
or own any non-system merchant: the known writers reject it and readiness
reports the aggregate hard blocker as
`security.systemSitePrincipalOverlapCount` without returning a UUID. An
unoverlapped system-site principal remains outside the ordinary Auth lifecycle.

Migration `202608190037` is the independently deployable system-site principal
isolation stage. It derives the set of UUIDs that occur both in `site-main`
aliases and in a non-system merchant, canonical personal account, or staff
identity, then clears only matching `site-main` aliases. It does not contain or
depend on a production UUID, does not alter contact/content fields, and
preserves an independent system principal. Under the shared ordinary-account
advisory lock and identity-table lock order, it verifies that only
`security.systemSitePrincipalOverlapCount` changes and that the result is zero.
It also installs exact restrictive authenticated INSERT and UPDATE policies
for `site-main`. They close both the missing-sentinel recreation window and the
legacy-RLS reattachment window while retaining ordinary merchant writes and
privileged `service_role` BYPASSRLS operations. Email fallback reads remain
until the later behavior cutover. The later renumbered behavior-cutover
migration must include both isolation policies in its exact preflight allowlist
and explicitly remove or preserve them in its post-cutover policy catalog.

Migration `202608190038` adds one read-only recovery observer,
`faolla_observe_ordinary_account_recovery_v1(uuid,text)`. It is a
`service_role`-only `SECURITY DEFINER` bridge for the supervised legacy
personal-account recovery case. For one fixed Auth UUID and one exact eight-
digit personal ID, it returns only a versioned envelope of aggregate counts for
non-system merchant aliases, `site-main`, staff/employee bindings, merchant-ID
collision, target personal binding, another Auth UUID claiming the same
personal ID, and the exact active canonical row. It returns no UUID, email,
account ID, or metadata, performs no identity write, and leaves all source-
table ACLs unchanged. Runtime schema/ACL readiness and exact 035/036/037
prerequisites fail closed. This observer exists only to pre-prove the fixed
recovery target before the existing 036 create-only RPC performs its atomic
collision checks; it is not a generic bind or repair operation.

Migration `202608190039_runtime_rpc_execute_acl_hardening.sql` is the urgent
runtime RPC ACL hotfix. It freezes the full catalog contract of 16 existing
RPCs, then rebuilds their raw ACLs to one authenticated-only owner check, one
owner-only single-order writer, and fourteen service-only runtime functions.
It removes custom and delegated grants, reconstructs owner tuples without
grant options, and makes audited creators' global function defaults
owner-only. Global defaults apply to future functions in every schema; callers
must receive EXECUTE explicitly. The migration runs only as the exact
SUPERUSER `supabase_admin`. It takes the production deployment advisory lock,
then locks ten shared catalogs in a fixed order with reader-compatible
`SHARE ROW EXCLUSIVE` locks and requires cluster-wide active and prepared XID
quiescence before it locks the registry or reads the complete preflight. This
serializes cooperating DDL while leaving ordinary catalog reads available;
apply it only through the controlled migration job during a short maintenance
window. A catalog writer that still holds `RowExclusiveLock` makes the entry
lock hit its ordinary `lock_timeout`; a writer whose catalog statement released
that lock but still owns an XID, or any prepared transaction, produces the
stable `runtime_rpc_execute_acl_hardening_concurrent_transaction` error. Both
paths occur before mutation and are safe to retry after quiescence. The migration
rebuilds the migration registry to the exact raw ACL of owner privileges plus
non-grantable `service_role` `SELECT`, and removes every live-column ACL so
runtime readiness remains readable without exposing registry writes. It
accepts the safe hosted role snapshots (including optional CLI and storage
edges), removes the legacy authenticator-to-superuser edge, and repeats the
complete definition, ACL, default, role-graph, and registry invariants before
registration. `cli_login_postgres`, when present, must be directly
unprivileged and is treated as a trusted CLI login whose only membership is
`postgres`, granted by `supabase_admin`; production
must compare this fail-closed catalog preflight with its read-only role snapshot
before apply. It changes no function body or business result.

The separately staged irreversible behavior cutover formerly used version
`202608190039`. It must be renumbered after this hotfix before publication and
must never coexist with the hotfix at the same registry version. Apply that
later cutover only after exact migrations 035/036/037/038/039 and the PR12
positive-resolver application are deployed, production
canonical bindings are backfilled, the
application has stopped every metadata/email authorization and allocator path,
and `faolla_get_ordinary_account_authoritative_cutover_readiness_v1()` reports
`readyForCutover=true`. The broader migration-035 readiness response may remain
false because user-writable metadata or mutable email is observation-only. The
migration repeats the authoritative readiness check under identity-table write
locks before any behavior DDL. It also rejects a conflicting registry name,
disabled RLS, any policy catalog outside the exact pre/post allowlists, or any
anonymous page policy other than the two exact home-only reads before changing
behavior. Protected-table ACLs are likewise accepted only when they exactly
match the frozen pre-cutover or post-cutover catalog, including role, privilege,
grant-option, owner, and column-ACL state. It then makes merchant,
page, order, booking, and coupon owner reads depend only on a live Auth UUID
with all seven internally consistent merchant aliases; staff identities are
explicitly denied. It also removes authenticated direct merchant INSERT and
UPDATE so browser/employee REST tokens cannot create merchants or change
ownership. Public merchant-home reads remain unchanged.
The replacement owner helper is likewise owner-normalized and admits exactly
one non-owner EXECUTE grantee (`authenticated`, without grant option).
It explicitly returns false for `site-main` and globally denies any Auth UUID
present in a `site-main` alias even if a malformed ordinary row also contains
that UUID; privileged system/super-admin paths remain outside ordinary owner
RLS.

Production publication is deliberately split because the production migrator
applies through the newest migration in the deployed revision:

1. Deploy, back up, and apply migration 036 with its bootstrap acceptance.
2. Deploy, back up, and apply migration 037; require the system-site overlap
   count to be zero.
3. Deploy, back up, and apply the service-only recovery observer 038. Its
   presence does not imply that the supervised recovery has occurred.
4. Take a fresh backup, deploy urgent runtime ACL hotfix 039, apply it as the
   verified `supabase_admin`, and re-probe all 16 RPCs (including all 15
   historically over-granted functions and the already narrow health RPC).
5. Perform the separately supervised legacy personal recovery through the
   observer/create-only path without any direct protected-table read grant.
6. Perform the remaining controlled canonical backfill, then deploy the
   application positive-resolver cutover. Require authoritative readiness to
   be true.
7. A later PR adds the renumbered behavior-cutover migration and its
   acceptance/contract. Deploy, back up, and apply it manually. Never publish
   the behavior cutover before the
   intervening isolation, backfill, and application gates pass.

After applying a migration, verify it with:

```sql
select version, name, applied_at
from public.faolla_schema_migrations
order by version;
```
