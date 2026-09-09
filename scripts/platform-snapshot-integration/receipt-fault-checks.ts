import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
  PlatformSnapshotAtomicWrite,
  PlatformSnapshotRestoreAtomicView,
} from "../../src/lib/platformSnapshotAtomic.server";

// Only the already identity-checked, synthetic runner supplies these bridges.
// No process, environment, filesystem, connection or instance lifecycle access.
type Input = {
  query: (sql: string) => Promise<string>;
  execute: (sql: string) => Promise<{ code: number | null; out: string; err: string }>;
  candidate: string;
};
type Operation = {
  operationId: string; actorKey: string; scope: "user_manage";
  backupId: string; confirmationToken: string;
};
const table = "public.faolla_platform_snapshot_restore_receipts";
const readName = "public.faolla_read_platform_snapshot_restore_receipt_v1";
const commitName = "public.faolla_commit_platform_snapshot_restore_receipt_v1";
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const args = (operation: Operation) => [operation.operationId, operation.actorKey, operation.scope,
  operation.backupId, operation.confirmationToken].map(literal).join(",");
const operation = (): Operation => ({ operationId: randomUUID(), actorKey: "c".repeat(64), scope: "user_manage",
  backupId: "synthetic-receipt-fault-check", confirmationToken: `v1.${"d".repeat(64)}` });

export async function runReceiptFaultChecks({ query, execute, candidate }: Input): Promise<number> {
  let groups = 0;
  const pass = (label: string) => { groups++; console.log(`[platform-snapshot-receipts-faults] passed ${label}`); };
  // One SELECT includes data, physical column definitions, constraints and ACLs.
  // Transaction-local fault injection must leave every captured value unchanged.
  const snapshot = async (): Promise<unknown> => JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]') from ${table} r),
    'columns',(select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where attrelid='${table}'::regclass and attnum>0),
    'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname)
      from pg_constraint where conrelid='${table}'::regclass),
    'table',(select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'forceRls',relforcerowsecurity)
      from pg_class where oid='${table}'::regclass),
    'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,
      'config',proconfig,'source',prosrc) order by proname) from pg_proc where oid in
      ('${readName}(text,text,text,text,text)'::regprocedure,'${commitName}(text,text,text,text,text,jsonb,jsonb,jsonb)'::regprocedure)));`));
  const readView = async () => JSON.parse(await query(
    "set role service_role; select public.faolla_read_platform_snapshot_restore_v1('user_manage');")) as PlatformSnapshotRestoreAtomicView;
  const writesFor = (view: PlatformSnapshotRestoreAtomicView): PlatformSnapshotAtomicWrite[] =>
    view.target.rows.map(({ slug, row }) => ({ slug, blocks: row?.blocks ?? [] }));
  const commitExpression = (binding: Operation, view: PlatformSnapshotRestoreAtomicView, writes: PlatformSnapshotAtomicWrite[]) =>
    `${commitName}(${args(binding)},${json(view.catalog.rows)},${json(view.target.rows)},${json(writes)})`;
  const lookupExpression = (binding: Operation) => `${readName}(${args(binding)})`;

  // Replacing ONLY the candidate's outer final COMMIT with ROLLBACK makes even
  // an unexpected acceptance safe: the assertion fails but no weak schema stays.
  assert.match(candidate, /\bcommit;\s*$/i);
  const rollbackCandidate = candidate.replace(/\bcommit;\s*$/i, "rollback;");
  for (const fault of [
    `alter table ${table} add column synthetic_unexpected_column text;`,
    `alter table ${table} drop constraint faolla_platform_snapshot_restore_receipts_metadata_check;
     alter table ${table} add constraint faolla_platform_snapshot_restore_receipts_metadata_check check (true);`,
  ]) {
    const before = await snapshot();
    const failed = await execute(`begin; ${fault}\n${rollbackCandidate}`);
    assert.notEqual(failed.code, 0, "Candidate accepted a weakened or extended receipt schema");
    assert.match(failed.err, /^ERROR:\s+platform_snapshot_atomic_install_conflict\s*$/m);
    assert.deepEqual(await snapshot(), before, "Rejected installation changed schema, ACLs or physical data");
  }
  pass("unexpected column and weakened CHECK reject installation with complete transaction rollback");

  const binding = operation();
  const view = await readView();
  const writes = writesFor(view);
  const committed = JSON.parse(await query(`set role service_role; select ${commitExpression(binding, view, writes)};`)) as {
    receipt: unknown; replayed: boolean; result: unknown;
  };
  assert.equal(committed.replayed, false); assert.ok(committed.result);
  const beforeCorruption = await snapshot();
  const corruptSource = view.catalog.rows.find((entry) => entry.row !== null);
  const corruptTarget = view.target.rows.find((entry) => entry.row !== null);
  assert.ok(corruptSource?.row); assert.ok(corruptTarget?.row);
  const corruptBlocks = { syntheticOuterShapeCorruption: true };
  const corrupted = await execute(`begin;
    update public.pages set blocks=${json(corruptBlocks)} where merchant_id is null
      and slug in (${literal(corruptSource.slug)},${literal(corruptTarget.slug)});
    do $fault$ declare v_lookup jsonb; v_replay jsonb; v_count integer;
    begin
      begin
        perform public.faolla_read_platform_snapshot_restore_v1('user_manage');
        raise exception 'synthetic_expected_corrupt_reader_rejection';
      exception when others then
        if sqlerrm <> 'platform_snapshot_atomic_store_corrupt' then raise; end if;
      end;
      v_lookup := ${lookupExpression(binding)};
      if v_lookup->'receipt' is distinct from ${json(committed.receipt)} then
        raise exception 'synthetic_lookup_lost_committed_receipt'; end if;
      v_replay := ${commitExpression(binding, view, writes)};
      if v_replay->'receipt' is distinct from ${json(committed.receipt)}
        or v_replay->'result' is distinct from 'null'::jsonb
        or v_replay->'replayed' is distinct from 'true'::jsonb then
        raise exception 'synthetic_replay_read_or_repaired_current_state'; end if;
      select count(*) into v_count from public.pages where merchant_id is null
        and slug in (${literal(corruptSource.slug)},${literal(corruptTarget.slug)}) and blocks=${json(corruptBlocks)};
      if v_count <> 2 then raise exception 'synthetic_corruption_was_repaired'; end if;
    end $fault$;
    rollback;`);
  assert.equal(corrupted.code, 0, corrupted.err);
  assert.deepEqual(await snapshot(), beforeCorruption, "Temporary corrupt source/target must be fully restored by rollback");
  pass("metadata lookup and matching replay survive unreadable current source/target without repairing them");

  return groups;
}
