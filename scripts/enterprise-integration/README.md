# Enterprise PostgreSQL integration acceptance

This suite applies the real Faolla SQL to a disposable PostgreSQL 15 database
and calls the final `service_role` RPCs with synthetic merchants. It does not
load `.env` files, Supabase credentials, backups, or production data.

Coverage includes:

- `supabase-init.sql`, the shared order/booking/coupon and reliable-outbox
  prerequisites, and enterprise migrations 001-026 plus audit-security and
  staged ordinary-account/runtime-hardening migrations 032-039 in filename
  order; the runner
  completes all Stage-2A acceptance fixtures before applying and testing the
  independently deployable 037 system-site isolation migration;
- owner bootstrap, roles, employee invitation acceptance, task assignment,
  task update, checklist, comments, notifications, and audit listing;
- forged-owner, cross-merchant, low-privilege ACL, and role-escalation denial;
- notification and audit failure injection to prove transaction rollback;
- workflow author/publisher/viewer permission separation, ordered client step
  UUIDs, immutable publication revisions, draft-versus-published projection,
  publish notifications, archive/restore, idempotent replay, and tenant denial;
- complete archive traversal with strict `(updated_at, id)` keyset cursors,
  server-side query/scenario/tag filters, private archive ACLs, and revision
  `TRUNCATE` rejection;
- employee workflow acknowledgement, revision-pinned execution, step notes and
  evidence metadata, completion feedback, manager resolution, and aggregate
  coverage statistics;
- published revision history, draft-only restoration, explicit legacy-role
  workflow permission grants, and single-event audit behavior;
- immutable task-to-workflow bindings, published-only choices, atomic checklist
  generation, provenance, idempotency, capacity rollback, and tenant denial;
- unified employee and manager todo projection, deterministic keyset pagination,
  permission-aware counts, and cross-merchant denial;
- order and booking workflow automation rules, immutable published-revision
  pinning, event idempotency, per-rule failure isolation, safe task templates,
  assignee notifications, and inactive-source protection;
- notification reads filtered by each employee's current task/workflow
  permissions, including historical rows after a role change;
- exact audit actor filters, strict UTC half-open time ranges, stable keyset
  pagination, and database-level task-event update/delete/truncate rejection;
- bounded current-state enterprise and employee operations summaries, unique
  multi-assignee task cardinality, exact due windows, restricted-board scope,
  cross-tenant and employee-enumeration denial, and service-only RPC grants;
- positive ordinary-account UUID ownership across multiple merchant IDs,
  versioned active/disabled safe-text personal bindings, aggregate-only
  identity readiness, exact legacy metadata/email gap detection, metadata
  duplicate/divergence and global account-identifier gates, disabled cross-type
  and staff-registry overlap denial, and service-only shadow RPC grants without
  changing current login or RLS paths;
- service-only, replay-safe merchant/personal bootstrap and create-only explicit
  IDs, the frozen personal range `50010105`-`59999999`, blocked/reserved/cross-
  table allocation, disabled-personal immutability, exact `site-main` system-
  sentinel exclusion without hiding other invalid merchant IDs,
  strict existing-target conflict denial, complete merchant UUID alias writes,
  staff/cross-type rejection in both write directions, bound-Auth DELETE
  rejection, staff-only Auth DELETE allowance, exact SECURITY DEFINER owner /
  canonical search-path / custom-role function ACL normalization, exact
  owner-only canonical-table and column ACLs, and catalog-structural readiness
  checks for unique indexes, constraints, and `ENABLE ALWAYS` triggers;
- relationally derived, selective removal of only those `site-main` UUID
  aliases shared with a non-system merchant, canonical personal account, or
  staff identity; preservation of an independent system principal and all
  contact/content fields; exact readiness-delta checks; unregistered no-op
  retry; and exact restrictive authenticated INSERT/UPDATE policies that
  prevent legacy email/UUID RLS from recreating or reattaching the sentinel
  while leaving ordinary merchants writable and `service_role` BYPASSRLS
  operations available;
- a `service_role`-only, PII-free recovery observer for one fixed Auth UUID and
  eight-digit personal ID, including exact unbound/bound envelopes, other-Auth
  personal-ID claims, merchant/staff/employee/system-site conflicts, source-
  table 42501 preservation, malformed input denial, custom-role ACL cleanup,
  and unregistered retry under quoted identifiers without any identity write;
- exact 16-function runtime RPC catalog and raw EXECUTE ACL normalization,
  hosted current/legacy role-topology gates, removal of the legacy
  authenticator-to-superuser edge, owner/custom/delegated grant cleanup,
  owner-only all-schema future function defaults and canaries, exact registry
  owner-plus-service-read table ACLs with no column grants, registry and
  postcondition rollback, quoted-identifier retry, and multi-session probes for
  the fixed twenty-catalog `SHARE ROW EXCLUSIVE` order, cluster-wide active and
  prepared-XID quiescence, controlled deployment-lock re-entry, safe retry,
  ordinary catalog-read availability, and post-gate owner-only DDL defaults.
  The catalog-writer timeout probe runs with `lc_messages=C` so its standard
  PostgreSQL `lock_timeout` text is deterministic; released-lock active or
  prepared XIDs are checked separately by the stable migration error;
- the production ordinary-account cutover readiness query itself, including
  its fixed migration mutex, ordered five-relation `SHARE` lock followed by the
  twenty-catalog gate, cluster-wide active/prepared-XID rejection, then the
  consistently ordered registry gate, frozen runtime-RPC postconditions,
  exact database-name and
  cluster system-identifier pinning, merchant/personal row-count baselines,
  exact nine-function metadata/ACL modes, exact 037 merchant policy and ACL
  inventory, exact 038 five-relation/fourteen-column surface, exact personal and
  migration-registry structures, forbidden-binder absence, all-schema creator
  function-default ACL closure, aggregate-only output parsing, fail-on-blocked
  package execution, fixture-only merchant `service_role` ACL cleanup before
  the probe, and a read-only rollback boundary;
- a production-normalized ready fixture followed by fail-closed drift and exact
  restoration probes for bridge/guard bodies and ACLs, merchant policy/table
  ACLs, the 038 relation-column surface, personal constraints/rules/inheritance,
  registry persistence/rules/primary key, forbidden binders, non-public schema
  function defaults, and the pinned merchant baseline; positive hostile
  `quote_all_identifiers` and public-first shadow-search-path probes; and two-
  connection evidence that readiness-held relation locks make both merchant
  DML and `ALTER POLICY` wait before either can mutate production state;
- authoritative-readiness-gated removal of email-based owner authorization,
  mutable metadata/email DoS resistance, conflicting-registry and extra-policy
  rollback, exact pre/post protected-table ACLs (including custom delegated and
  known-role extra privileges), exact anonymous home policies, authenticated
  merchant INSERT/UPDATE denial, true-owner merchant/page/transaction reads,
  email-forgery and employee-only denial, and preservation of anonymous public
  merchant-home reads across the RLS cutover, including authenticated ordinary
  owner denial for the `site-main` system sentinel and for a system-site
  principal malformed onto any ordinary merchant;
- two independent `psql` sessions racing the same task, invitation, and
  workflow versions, with exactly one commit and one
  `enterprise_version_conflict` for each race;
- two concurrent restores competing for the 200th active workflow slot, with
  one commit, one `workflow_limit_reached`, replay-safe success, and no losing
  idempotency or audit residue;
- paired PostgreSQL sessions racing ordinary creation against staff insertion,
  new ordinary creation against Auth deletion, and idempotent bootstrap against
  bound-Auth deletion, plus simultaneous ordinary/staff attempts for the
  system-site principal, with statement/lock timeouts proving no deadlock and
  postconditions proving no cross-type, system overlap, or orphaned canonical
  identity.

Run it only against an empty disposable database:

```bash
createdb faolla_enterprise_test
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/faolla_enterprise_test?sslmode=disable' \
ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 \
  bash scripts/enterprise-integration/run.sh
```

The runner refuses to start unless the explicit disposable-database flag is
`1` and the target contains no user relations.

Immediately before the final readiness probe, the runner derives the expected
database name, PostgreSQL system identifier, ordinary-merchant count, and
canonical-personal count from the disposable fixture. The PostgreSQL wrapper
passes those four canonical values as fixed `psql` variables so the same SQL
identity and baseline gates exercised in production are covered here.

The GitHub Actions workflow provisions its own PostgreSQL 15 service. Plain
PostgreSQL cannot reproduce PostgREST HTTP routing or the Supabase Auth service;
the fixture supplies only the database roles and `auth.uid()` / `auth.jwt()`
stubs needed to compile and execute the repository SQL. API/browser behavior
remains covered by the existing application tests.
