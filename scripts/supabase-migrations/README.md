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

Migration `202608190040_merchant_acl_contract_hardening.sql` removes only the
unneeded hosted broad grants from `public.merchants` and freezes the
ordinary-account object contract at 21 raw ACL entries: the seven owner
privileges, the hosted `postgres` role's seven direct management privileges,
authenticated `SELECT`/`INSERT`/`UPDATE`, and service-role
`SELECT`/`INSERT`/`UPDATE`/`DELETE`, all issued by the owner without grant
options. `anon` retains no direct tuple, and browser/service roles receive no
relation-maintenance privileges. Preserving the direct `postgres` tuple is
required because the hosted role is deliberately `NOSUPERUSER`; `BYPASSRLS`
and `pg_read_all_data` do not replace its write and relation-maintenance ACLs.
The migration accepts only the observed 35-entry hosted production prestate or
that exact target and requires the hosted seven-bit `postgres` role contract
before and after catalog locking. Before mutation it
also requires the exact owner, persistent RLS relation shape, five policy
definitions and hashes, absence of column ACLs, rules, and inheritance, and
the exact 035-039 registry prerequisites. Unknown or delegated grants and any
partial repair fail closed. A registered replay is accepted only at the target
and performs no ACL mutation. Migration 040 changes no merchant row, policy,
function, ownership, or application behavior; the retained service-role DML
set preserves privileged operational access.

Migration `202608280041_merchant_staff_business_permissions.sql` additively
extends the enterprise-role permission catalog with the 46 staff business
permissions used by redemptions, bookings, orders, conversations, and members.
It replaces the role permission validator and staged `CHECK` with the exact
combined catalog and dependency graph, then adds service-role-only v3 role
mutation wrappers. They strictly validate `owner|employee` before setting a
transaction-local actor marker and delegating to the compatible v2 RPCs. An
atomic row trigger permits a row containing a business permission only when
that marker is exactly `owner`; direct DML, v2 business writes, and missing,
unknown, or employee v3 actors all fail closed. Collaboration-only v2 and v3
role behavior remains compatible. The migration does not update or backfill
any role row, change a default system role, or grant a business permission.
Rollout therefore stays
default-off: apply and verify the additive database contract first, deploy and
drain the compatible application fleet, and only then enable the feature and
make explicit owner-authorized role grants. Application rollback disables that
rollout while leaving the additive catalog and v2-compatible database surface
in place.

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
5. With the production merchant object diagnostic frozen, apply merchant ACL
   hardening 040 as the verified `supabase_admin`; require the exact 21-entry
   target and a no-op replay before rerunning cutover readiness.
6. Back up and apply additive staff business permission migration 041. Verify
   that no existing/default role changed and both v3 role RPCs are service-only;
   deploy and drain the compatible application fleet before enabling the
   feature or making any explicit owner-authorized business permission grant.

Migration `202608300042_merchant_enterprise_pgcrypto_schema_repair.sql`
repairs the production pgcrypto schema mismatch in eleven existing invitation
and outbox functions. It validates the exact pre-repair source, owner, ACL,
arguments, defaults, volatility, fixed `search_path`, and staff-identity trigger
shape before replacing each function in place. The only body change is
`digest(` to `extensions.digest(`. Apart from its own migration-registry row,
the migration changes no business-table row, trigger, role grant, function
signature, or rollout mode, and a registered replay is a catalog-validation
no-op.
7. Back up and apply pgcrypto schema repair 042. Confirm the eleven source
   fingerprints, staff-identity trigger, and RPC ACLs are unchanged apart from
   the schema-qualified digest calls before retrying any failed invitation.
8. Perform the separately supervised legacy personal recovery through the
   observer/create-only path without any direct protected-table read grant.
9. Perform the remaining controlled canonical backfill, then deploy the
   application positive-resolver cutover. Require authoritative readiness to
   be true.
10. A later PR adds the renumbered behavior-cutover migration and its
   acceptance/contract. Deploy, back up, and apply it manually. Never publish
   the behavior cutover before the
   intervening isolation, backfill, and application gates pass.

## Initial-password completed-request recovery candidate

Migration `202610030114_merchant_employee_initial_password_replay.sql` requires
the registered `202608310043` initial-password migration and its existing
tables/function. It preserves the claim function owner and service-role-only
execution, adding only exact completed-receipt recovery before the original
required-policy guard. The current invitation, active role, operation and
password fingerprint must match; expiry is rechecked after acquiring locks.
The handler still verifies Auth initialization. Replaying a completed receipt
does not write a password or business record. The required-policy write path
and waived-policy rejection remain unchanged.

This candidate is locally verified, not deployed. Use the authorized migration
identity that can replace the original function. The transaction has a 3-second
lock timeout; a timeout must abort rather than trigger forced lock removal.
Do not rerun historical 043 or infer that every attendance migration 061–113
is a dependency of this narrow repair. Verify the target catalog and registry
before any separately authorized release.

Migration `202610030115_merchant_attendance_location_notice_coverage.sql` adds
only an owner-authorized, service-only read RPC for the current default-location
roster and exact notice acknowledgements. It requires the original 076 registry,
tables and existing permission validator. It neither calls a writer RPC nor
changes table privileges, rows, publication rules or attendance behavior.
All totals and the 50-row keyset page share one statement snapshot; notice,
settings and location versions fence subsequent pages, but do not freeze the
roster. Acknowledgement is not delivery, reading, consent or clock eligibility.

115 is locally verified and not deployed. Its client/server coverage switches
default off; server access also requires existing NOTICE/ADMIN switches, current
enterprise entitlement and a current owner. Pausing new attendance does not
prohibit this read. Use the normal separately authorized no-maintenance release;
the 3-second migration lock timeout must fail safely, not force lock removal.

Migration `202610030116_merchant_attendance_self_revision_history.sql` adds a
separate service-only read RPC for the current employee's revision submissions
across approved roots. It requires original 095/097 dependencies and validates
both submission and original-root tenant/worker/employee/Auth ownership on every
page. The 50-candidate scan uses a dedicated identity/keyset partial index;
status filtering can produce empty nonfinal pages. This is not all attendance
requests, a payroll report or recovery of uncertain operations. Existing writers,
097 history and table privileges are unchanged.

116 remains an unpublished candidate. Its dedicated client/server switches are
default off; existing SELF/CORRECTIONS/REVISION_REQUESTS/REVISION_CYCLES server
switches, enterprise entitlement and password-authenticated self-view identity
still apply. Initial UI identity resolution uses the existing 079 context RPC
through corrections/context, not the clock-status endpoint. Before a separately
authorized no-maintenance rollout, assess the additional index size and build
duration on the actual ledger: a 3-second lock timeout does not bound index-build
time. A large ledger needs a reviewed concurrent-index release sequence, not an
unreviewed blocking index build or forced lock removal.

Migration `202610030117_merchant_attendance_owner_backlog.sql` adds one
service-only owner read RPC across all submission dates for correction,
revision and missing requests. It requires the original 086/097/103 registry
and related tables, reuses the 083/097/100 owner submission indexes and does
not create tables/indexes, backfill data or alter old writers/table grants.
Each page rechecks the current merchant owner, probes at most51 submissions
per source, merges at most51 and validates/filters50. The cursor includes
submission microseconds, source rank and request UUID; an empty nonfinal page
is valid. Pending is discovery, not authority to approve. Historical inactive
or unbound staff are not silently removed from the owner's backlog.

117 remains locally verified and unpublished. The dedicated OWNER_BACKLOG
client/server switches default off; the server also requires ADMIN, enterprise
entitlement and a normal authenticated current owner. New attendance may be
paused without denying this read. Fixed asOf is a time cutoff, not a cross-page
MVCC snapshot: concurrently committed corrections can require a fresh first
page. Existing writer lock semantics are unchanged. Use the separately
authorized no-maintenance release process; the 3-second migration lock timeout
must abort safely, never force lock removal.

Migration `202610030118_merchant_attendance_self_requests.sql` adds a separate
service-only read RPC combining the current employee's correction, revision and
missing requests across submission dates and four historical decision states.
Both employee and worker pins are revalidated on every page. Each source filters
tenant/worker/employee/Auth before its 51-row probe; the combined scan interprets 50.
The DESC cursor is submission microseconds, kind rank and UUID. Empty filtered
pages can still have a next page. Inconsistent original ownership or terminal
lineage rejects the whole page rather than exposing or skipping a broken row.

118 adds two identity/keyset indexes for correction and missing and reuses 116's
revision index. No old writer, table grant, business data or existing endpoint
changes. In particular 061's service-role event SELECT remains unchanged while
the private request ledgers remain inaccessible directly. SELF_REQUESTS client
and server switches default off; the server also requires SELF/CORRECTIONS for
the existing 079 identity context, enterprise entitlement and password self-view
authentication. It does not require write/approval switches, worker.active or
module-on to read existing history. Approved means a past decision, not the
current effective timesheet. Fixed asOf is a cutoff, not an MVCC snapshot.

118 is an unpublished candidate. Before an explicitly authorized no-maintenance
release, assess both index sizes and build durations against the actual ledger.
The 3-second lock timeout does not limit a build after lock acquisition; large
tables require a reviewed concurrent-index rollout, never forced lock removal.

Migration `202610030119_merchant_attendance_shift_templates.sql` is an unpublished,
default-off daily shift-template candidate. It adds only two private tables
(current templates and immutable operation receipts), their own indexes and a
service-only RPC. Every request checks current merchant ownership and settings;
writes serialize on the existing merchant/settings lock order and use revision
CAS. Exact same-actor replay and receipt reads remain available when attendance
admission is paused; disabling the feature flag or losing enterprise access is
still a hard denial. API roles have neither direct table access nor ownership.
No previous table, fact, grant or scheduled slot is rewritten. Applying a template
only fills an unpublished UI draft; actual publication remains the 099 path.
There is no automatic recurrence, employee binding, timezone or payroll rule in a
template. The 100-active cap has serial native coverage and lock-structure review,
not a two-connection race test. No production migration or flags were applied.

Migration `202610030120_merchant_attendance_schedule_overview.sql` adds only a
service-only owner read RPC over the immutable 099 schedule ledger. It does not
create tables/indexes, rewrite facts or change any existing writer/table grants.
The selected 1–20 worker IDs and at most 31 local start dates use the existing
worker/date index. Each worker yields at most 51 raw candidates before revision
filtering, the merged first 50 are checked, and the cursor follows the last
scanned row. Empty intermediate pages remain pageable; no unbounded search for
matching older rows is performed before the per-worker limit. This candidate
bound is not a measured production I/O or latency guarantee. Current owner
authority is checked on every page. A captured enterprise schedule revision
preserves publication/cancellation state; current employee labels are not used
to rewrite historical labels. Both new gates remain off, and the server also
requires the original schedule gate. No production migration has been applied.

Migration `202610030121_merchant_attendance_leave_permission.sql` retains the090
permission validator and adds only independent `attendance.self.leave`, depending
on enterprise/self viewing. It does not backfill or grant any existing role.
Migration `202610030122_merchant_attendance_leave_requests.sql` adds private
append-only requests/entries and a service-only leave RPC. Submit, withdraw,
approve, reject and cancel preserve immutable command/summary receipts; owner
self-review is forbidden, and approval revalidates binding/employment/overlap.
All fresh actions obey the platform write gate; currently authorized exact old
receipts remain recoverable while paused. Existing punches, schedules, balances
and payroll are unchanged. Only pure list GETs scan25+1; detail/receipt/POST
responses omit list pagination. Local acceptance includes two witnessed lock
races and actual new UI flows with synthetic authentication; not real Auth,
PostgREST/Next, phone or production capacity. Both new gates remain default-off.
Neither migration has been applied to production.

Migration `202610030123_merchant_attendance_calendar.sql` adds an independent
owner-only manual holiday/closure calendar, with private append-only entries and
operations. It requires the061 foundation; no existing business data, permissions,
punches, schedules, leave, booking rules, membership points or payroll are changed.
Enterprise and single-location scopes retain their creation-time IANA zone and
location label/version. Dates are inclusive civil labels (1–366 dates), not paid
duration or a legal-holiday feed. A cancellation appends revision2; original
receipts retain revision1. Current ownership is rechecked for every request.
Fresh create/cancel actions obey the platform write gate; exact authorized old
receipts remain recoverable while paused. Two new indexes belong only to the
new entries table. Neither table nor the projection helper is exposed to API
roles; only the main RPC has service_role EXECUTE. The independent CALENDAR
frontend/server flags remain default-off. No production migration was applied.

Migration `202610030124_merchant_attendance_groups.sql` adds independent owner-only
attendance group definitions and worker assignment intervals. Four new private
tables separate current projections from immutable operation history. It requires
the061 foundation and changes no existing worker/settings values, permissions,
clock rules, schedules, approvals or payroll. Inclusive civil-date intervals
cannot overlap for the same worker across groups. Ending an open-ended assignment
preserves its earlier dates; cancellation voids the entire interval but retains
history. Paused modules reject fresh writes while authorized exact receipts remain
recoverable. Commands across both new ledgers share the same operation-ID namespace
and merchant/settings lock order. Only the main RPC is service-executable; helpers
and raw tables are private. Independent GROUPS frontend/server flags remain default-off.
No production migration was applied.

Migration `202610040125_merchant_attendance_leave_notifications.sql` adds private
leave-result recipient projections and first-read markers, plus an opt-in wrapper
around122. It does not replace122, alter old tables/indexes, install source-table
triggers, or backfill history. The default-off server flag selects the wrapper
only for owner approve/reject/cancel POSTs. After acquiring the existing merchant
and settings locks, the wrapper distinguishes a fresh decision from an old receipt;
only a fresh decision appends a notification in the same transaction. Capture
failure rolls back that new decision as well. Disabling the flag preserves the
original executor path; GET/self actions always use the original RPC.
Recipient-keyed pagination orders by actual decision time, not request submission.
Reads recheck current membership, self.view and the original recipient identities;
historical approvers need not remain owners. Explicit mark-read is idempotent and
retains its first timestamp; GET never marks read. A paused module permits reads
and already-read recovery but rejects a fresh mark. Only new RPCs are executable
by service_role; new raw tables and helpers remain private. No emails, push,
polling, all-read operation or unread count is introduced. No production changes
were applied; this approved scope is still a local candidate.

Migration `202610040126_merchant_attendance_leave_review.sql` adds a service-only,
owner-only read RPC for pending leave discovery. It does not alter122/125, source
tables, indexes, triggers, grants, or saved facts. Existing owner submission-time
index ordering is read oldest first, with at most51 candidates and full validation
of the first50 before selecting currently submitted requests. An empty match page
may still have a cursor, which belongs to the last scanned candidate rather than
the last match. This is not a total count or a frozen snapshot. Current owner and
settings are checked under the original lock order on every page; later detail
and decisions continue through the original leave API. Both the new review flag
and existing leave flag must be enabled for its GET endpoint; POST is refused.
The approved change remains local-only with all real feature flags unchanged.

Migration `202610040127_merchant_attendance_rule_versions.sql` adds an independent
owner-only candidate policy ledger for the enterprise and explicitly selected
attendance groups. It requires064/124 and does not alter any existing clock,
assignment, schedule, approval, report or settings writer. Two private tables
hold a current stream projection and immutable operation receipts. Saving,
future-dated publication and future-only withdrawal are separate, version-checked
operations; publication consumes a previously saved draft, and withdrawal never
deletes the original publication. Exact original-actor recovery remains possible
while paused. Dates use a pinned enterprise zone and the earliest actual UTC
instant of that local day, checked against the post-lock server clock. Only the
new service-role RPC is callable; raw tables/helpers remain private. This ledger
does not yet apply inheritance or classify attendance. Personal exceptions and
historical calculation snapshots are not included. Both new feature flags remain
default-off; no production migration or opening is implied.

Migration `202610040128_merchant_attendance_sources.sql` adds an owner-only,
service-only read RPC for one worker and at most seven inclusive enterprise-local
dates. It delegates to 103 first, retaining current merchant/settings/worker locks
while collecting original/approved attendance, assignment history, candidate
rule publications, interval-overlapping schedules/leave and relevant calendar
hints. Source zones and historical identities stay separate from current labels.
The latest relevant publication before the range survives any newer drafts.
Additional sections use a 100+1 candidate bound and return no partial list
when limited. Assignment/schedule/leave/calendar overflow is detected before
per-row validation; complete sections still validate every retained source and
reuse date/zone UTC boundaries only within this invocation. Rule heads and all
publications separately cap at 100. Incomplete
assignment coverage limits rules, and incomplete schedule/location coverage
limits calendar. The raw response is capped at 1 MiB; these limits are not measured
production capacity guarantees. It requires 093/099/103/122/123/124/127 and adds
no tables, indexes, source writes, old writer changes or existing table grants.
Only the new RPC is service-executable; the schedule validation helper is private.
Current evidence is not a frozen historical snapshot, applied inheritance,
absence classification or payroll. The independent SOURCES frontend/server flags
remain default-off. Eight isolated SQL and six browser checks passed, including
exactly100 complete and101 limited-empty calendar candidates under the unchanged
timeout; scope/limitations are recorded in `docs/employee-attendance-sources-20261004.md`.
No production application or feature opening is implied.

`202610040131_merchant_attendance_rule_captures.sql` adds an independent,
default-closed archive of currently observed candidate rule sources. It requires
064/124/127/129/130 and their prerequisites, adds two private append-only tables,
two private validators and one service-only RPC. New captures read130 inside the
transaction; the browser cannot upload source evidence. Exact-operation recovery
rechecks the current owner, worker and both employee identities before returning
the original receipt, even when new capture is paused. Original UTF-8 text and
SHA-256 are retained without re-deriving old timezone boundaries. Equal semantic
sources share one body; byte/count guards and a1000-operation cap prevent unbounded
new storage, with no automatic historical deletion. No existing writer or table
grant changes. This is not proof of historical application, frozen calculation,
period sealing or payroll. Nine isolated SQL groups and106 focused tests passed;
only the operation-cap rejection/recovery was exercised dynamically, not every
artifact byte/count threshold. Details and limitations are recorded in
`docs/employee-attendance-rule-captures-20261004.md`.
`FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED` remains off; no UI or production migration
is implied.

`202610040132_merchant_attendance_rule_capture_history.sql` adds one independent
service-only metadata reader, requiring064/131 and their prerequisites. It adds
no table/index or old writer/grant changes. Current owner, worker and both employee
identities are checked on every page; a continuation anchor must belong to that
same scope. Fixed25-item pages use26 metadata candidates, the existing merchant
primary key and131's1000-operation cap. The64KiB result never reads source bodies
or recomputes their hashes. Explicit detail reads still use the original131 GET.
The timestamp cutoff is not a transaction snapshot or proof of historical rule
application. Seven isolated SQL and six actual browser/handler/service/SQL groups
passed with one actual source capture plus26 clearly synthetic metadata rows;
all reads preserved facts/definitions. Independent frontend/server
RULE_CAPTURE_HISTORY flags remain default-off. See
`docs/employee-attendance-rule-capture-history-20261004.md` for exact boundaries.
No production application or feature opening is implied.

`202610040133_merchant_attendance_shift_rule_bindings.sql` adds two private,
append-only tables and four private helpers for new clock-in point bindings.
Requires064/124/127/129/130 and their existing dependencies; only130's private
memoized personal-receipt validator is reused, never its owner-only reader.
Bounded point sources
retain UTC assignment endpoints, current employee/Auth identities, exact choices,
provenance and a separate algorithm/policy version; immutable source hashes are
deduplicated per worker. Explicit unconfigured fields are not normal attendance.
No historical event is backfilled, no old table/clock/report function is replaced.

`202610040134_merchant_attendance_bound_clocks.sql` requires133 and the existing
108/111/112/113 identity-aware clocks. Four new service-only wrappers return the
original response unchanged and bind only fresh successful clock_in inside that
same transaction. Queries, replays, breaks and closing events never replace a
binding. The private binder's source failures are separate from PIN lease/clock
business work; infrastructure failures can still abort the transaction. Neither
migration authorizes rollout. Server dispatch remains on old RPCs unless both
`FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED=1` and an explicit bounded
`FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS` allowlist opt the merchant in. No flags
were persisted. See `docs/employee-attendance-shift-rule-bindings-20261004.md` for
the isolated four-service/SQL evidence, storage limits and remaining pilot gates.

`202610040135_merchant_attendance_shift_rule_binding_reader.sql` adds three private
structural validators and one service-only single-start-event reader. Requires
064/133 and their prerequisites; no new table/index or old writer/grant changes.
Current owner and employee/Auth identity, exact clock-in event and saved binding
are checked before returning original bounded source text. Missing/unverified
evidence is not replaced with current rules. Saved UTC and versions are validated
without replaying current timezone conversions; source dedup IDs and historical
authors may differ from the requested start/current owner. The independent
`FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED` server gate remains off.
Seven isolated native groups passed, including actual handler/service/SQL reads,
three self-clock cycles and unchanged fingerprints. No UI, formal schedule
association, anomaly classification or production application is implied. See
`docs/employee-attendance-shift-rule-reader-20261004.md` for exact boundaries.

`202610050136_merchant_attendance_schedule_publication_evidence.sql` adds one
private append-only publication-context table, three new functions and one narrow
index on the existing schedule slots. Requires064/099 and their prerequisites.
The index is built CONCURRENTLY between prerequisite and final transactions;
do not wrap the whole file in one transaction. Both phases validate any existing
same-name index; invalid or conflicting objects are rejected, never auto-dropped.
A valid index left by an interrupted final phase may be reused.

Only a fresh opted-in publish captures at most32 immutable slot references with
publication-time employee/Auth, worker/location/settings versions and UTC/zone
context. JSON slot data is capped at16KiB; no rules or whole personnel files are
copied. Evidence failure aborts the original099 publication in the same
transaction. Existing operation IDs are detected under the original settings
lock and are never backfilled. Original reads, cancellation, clocks, corrections
and reports remain unchanged. This is not a clock-to-schedule association or a
freeze of future planned-start rules.

Server dispatch remains on099 unless both
`FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED=1` and an explicit bounded
`FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS` list opt the merchant in;
only publish selects the new wrapper. Existing active employee/Auth constraints
remain enforced. See
`docs/employee-attendance-schedule-publication-evidence-20261005.md` for local
acceptance and remaining boundaries. No production installation or activation is
implied.

## 202610050137 — ordinary self clock-in explicit schedule selection

Additive, default-off candidate depending on111,134,136 and their prerequisites.
Adds one private append-only initial-selection relation table and three functions;
does not replace old clock, schedule, cancellation, report or correction functions.
The new service-only RPC calls111 (or134 under the separate rule-binding gate)
and persists the employee's explicit selection in the SAME transaction. Required
association failure rolls back the new clock and optional rule binding. No old
operation is backfilled, and the same selected slot may have multiple sessions.

Fresh selection requires the new frontend flag and both server enabled/list
settings. A rollback of the selection flag forbids all new RPC POSTs, including
replay; current-authorized original-ID GET recovery remains, subject to the old
SELF total switch. No endpoint downgrade clears or resubmits pending intent.
Choices use the existing worker/date index with a101 sentinel,100-entry and48KiB
bound; entire RPC output is limited to64KiB. Private publication/cancellation
snapshots are not sent to clients. Explicit selection is not automatic matching,
attendance classification, physical presence or payroll.

See `docs/employee-attendance-self-schedule-selection-20261005.md` for the167-test,
9 native-group,4 browser-group local evidence and4 actual connection races.
Installation and activation on production remain unperformed.

## 202610050141 — opt-in location clock explicit selection and approved-plan reference

Additive local candidate after113/134/137/140; one compact private append-only
sidecar and four new functions. Existing clock, range, notice, schedule, report,
correction and historical migration definitions are not replaced. New clock-in
calls the original113 (or134) and saves the original location receipts,137
explicit relation and validated140 reference in the same transaction. No owner
impersonation, uploaded policy body, automatic matching or historical backfill.

Frontend enabled flag and server enabled flag plus exact merchant allowlist are
required. Feature rollback rejects all new POSTs; authorized original-number GET
can recover while the original SELF/LOCATION base gates remain enabled. Old
location actions and safe finish retain their original endpoint. Candidate reads
use101/100-entry,48KiB/64KiB limits; stored adoption is at most4KiB and references
existing policy artifacts instead of copying them.

See `docs/employee-attendance-location-schedule-20261005.md`:154 focused tests,
12 actual local SQL/handler groups,2 exact-PID races,4 actual-parent browser
groups. Auth and GPS are synthetic; no production installation, real-device
acceptance, capacity claim or all-channel completion is implied.

## 202610050151 — period source relevant-range reads (local candidate)

Depends on066,148,149,150 and their original prerequisites. Adds two
proposal-time partial indexes with separate `CREATE INDEX CONCURRENTLY`
statements, then replaces only148's source reader in a short final transaction.
Run the complete file through a statement-aware executor: do not wrap the whole
file in one transaction or strip its transaction boundaries. Valid matching
orphan indexes may be adopted; wrong/invalid indexes fail closed without any
automatic drop, reindex or timeout extension.

The reader selects latest pending corrections/revisions relevant to the period,
including proposals moving in or out, before applying the100-entry cap. Existing
plan/leave/missing overlap checks precede their sentinels; calendars keep the
saved-zone boundary calculation. No existing business rows, writer functions,
historical migration files or archived bodies are rewritten. This does not lift
the original report/session or missing-root limits, guarantee constant-time
scanning, or implement timezone-change continuation.

See `docs/employee-attendance-period-source-ranges-20261005.md` for actual local
acceptance status and limitations. No production installation is implied.

## 202610050152 — period missing-revision context (local candidate)

Depends on103,148–151 and their original prerequisites. Atomically replaces only
the period source reader and reuses103's validated parent index. No new tables,
indexes, writer changes or historical migration edits. Keep the3-second lock
deadline;151 must still be installed using its separate concurrent-index phases.

An approved declaration inside the period can have a pending direct revision
outside it. Include that revision as context and `pending_missing`, validating
the actual parent approval, root, original receipt and historical identity;
do not count its proposed hours. Send/self-confirm may retain this complete
pending context, while sealing remains blocked. No recursive whole-root
expansion, saved-body rewriting or change to total100/root100 limits is implied.

See `docs/employee-attendance-period-missing-context-20261005.md` for actual
old151 reproduction,152 acceptance, unchanged reports and remaining limitations.
Not installed in production by this work package.

## 202610050153 — period temporal session capacity (local candidate)

Depends on093,103,148–152 and their original prerequisites. In one transaction,
replaces only the existing owner/scoped v2 period readers and the current period
source reader. No tables, indexes, helpers, writers or historical migration
files change. Keep the3-second lock deadline and reject incompatible signatures,
security metadata or widened execution privileges rather than repairing them.

The100-session cap now follows the unchanged temporal relevance check. An
outer102-candidate probe can discard at most one irrelevant preceding session
and still detect the101st relevant item; this is NOT a102-row return limit.
Scoped identity/location visibility checks retain their original ordering after
the relevant-candidate count. Existing event/body/root and unified raw+missing
limits, saved versions and31days/744hours semantics stay unchanged.

See `docs/employee-attendance-period-session-capacity-20261005.md` for acceptance
status. No production installation is implied;151 retains its own staged
concurrent-index installation requirements.

## 202610050154 — period missing-root capacity and approved edges (local candidate)

Depends on093,103,148–153 and their original prerequisites. Atomically replaces
only the period-source reader. It verifies the existing direct-parent index and
function security contract, but does not create or repair indexes, change old
writers/reports, rewrite saved artifacts, or alter application permissions.

Removes the unrelated lifetime-root100 refusal; the actual period-related100
limit and all other body/session/timeout protections stay in place. Bounded
direct approved-successor and incoming-approved-revision edges must have matching
historical identities, root, parent approval, submission/approval receipts and
saved proposal/time relationships. Duplicate approved successors and invalid
edges now fail closed, including edges outside the requested period. A former
approver need not be today's owner. This is not an unrestricted ancestry audit
or a constant-time scan guarantee.

Keep the3-second lock deadline;151 retains its staged concurrent-index
installation. See `docs/employee-attendance-missing-root-repair-20261005.md` for
actual local acceptance status. No production installation is implied.

## 202610060162 / 202610060163 — application delegation (local candidate)

162 adds private append-only authorization, revocation and decision-authority
tables plus ten functions; existing leave/work decision functions and history
stay unchanged. It requires122/125/150/156 and their original prerequisites.
It uses one transaction with a3-second lock deadline and only new-table indexes;
no concurrent-index phase.163 extends161's permission catalog with independent
leave/work review permissions, without granting stored roles. Apply162 after
its dependencies and163 after161/162; earlier151/160 retain their own staged
concurrent-index requirements and must not be wrapped in an outer transaction.

Both application-delegation feature flags default off. Only explicit personnel,
category/kind and time grants authorize decisions. Optional leave notification,
old terminal entry and new authority record are atomic. New delegated approvals
check sealed periods; original owner leave behavior is not changed. Recovery is
minimal, strongly authenticated and GET-only; it does not restore lost authority.
See `docs/employee-attendance-application-delegation-20261006.md` for actual local
SQL/browser evidence and limitations. Not installed in production.

## 202610060164 — membership-linked attendance suspension (local candidate)

164 adds five private tables for saved pauses, current generations, exact status
operation receipts, explicit restores and two-sided delegation generations.
It requires019/064/106/160/162 and their original dependencies. It is one
transaction with a3-second lock deadline; the explicit partial index is on
the newly created epoch table, not historical business rows. No concurrent-index
phase is added.

The old employee-update RPC and two delegation usability functions retain their
OIDs. Exact prior bodies are held in non-callable private aliases. The wrapper
takes merchant/settings locks before the original task/employee authorization
chain. A new opted-in disable pauses the bound worker and revokes its PIN
atomically with existing employee status, task handover and audit; saved
generations invalidate grants on either employee identity. It does not alter
raw clock events, employment dates or pending applications. Existing old calls
without opt-in or employee epoch keep their previous version-only behavior.

`FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED` and its `NEXT_PUBLIC_` counterpart
default off. Previously captured pauses remain protected with flags off; safe
same-identity owner restore and minimal original-actor GET recovery remain
available. Membership reactivation alone never restores attendance. Explicit
restore preserves the previous worker active value and never revives old PINs
or grants. Ordinary worker/PIN activation cannot bypass an outstanding pause.

See `docs/employee-attendance-account-suspension-20261006.md` for local evidence
and recovery UI limitations. This candidate is not installed in production.

After applying a migration, verify it with:

```sql
select version, name, applied_at
from public.faolla_schema_migrations
order by version;
```
