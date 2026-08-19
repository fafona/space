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

Migration `202608190037` is the irreversible behavior cutover stage. Apply it
only after 036 is deployed, production canonical bindings are backfilled, the
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

1. PR-A contains migration 036, its bootstrap acceptance/contract, and the
   runner with 037 absent. Deploy, back up, and apply 036.
2. Perform the controlled canonical backfill, then deploy the application
   positive-resolver cutover. Require authoritative readiness to be true.
3. PR-C adds migration 037 and its cutover acceptance/contract. Deploy, back
   up, and apply 037 manually. Never publish 036 and 037 together before 036
   has been applied and the intervening backfill/application gates pass.

After applying a migration, verify it with:

```sql
select version, name, applied_at
from public.faolla_schema_migrations
order by version;
```
