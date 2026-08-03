# Enterprise PostgreSQL integration acceptance

This suite applies the real Faolla SQL to a disposable PostgreSQL 15 database
and calls the final `service_role` RPCs with synthetic merchants. It does not
load `.env` files, Supabase credentials, backups, or production data.

Coverage includes:

- `supabase-init.sql`, the shared transaction prerequisite, and all enterprise
  migrations 001-021 in filename order;
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
- notification reads filtered by each employee's current task/workflow
  permissions, including historical rows after a role change;
- two independent `psql` sessions racing the same task, invitation, and
  workflow versions, with exactly one commit and one
  `enterprise_version_conflict` for each race;
- two concurrent restores competing for the 200th active workflow slot, with
  one commit, one `workflow_limit_reached`, replay-safe success, and no losing
  idempotency or audit residue.

Run it only against an empty disposable database:

```bash
createdb faolla_enterprise_test
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/faolla_enterprise_test?sslmode=disable' \
ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 \
  bash scripts/enterprise-integration/run.sh
```

The runner refuses to start unless the explicit disposable-database flag is
`1` and the target contains no user relations.

The GitHub Actions workflow provisions its own PostgreSQL 15 service. Plain
PostgreSQL cannot reproduce PostgREST HTTP routing or the Supabase Auth service;
the fixture supplies only the database roles and `auth.uid()` / `auth.jwt()`
stubs needed to compile and execute the repository SQL. API/browser behavior
remains covered by the existing application tests.
