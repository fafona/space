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

After applying a migration, verify it with:

```sql
select version, name, applied_at
from public.faolla_schema_migrations
order by version;
```
