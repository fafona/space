import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=f=>read('./supabase-migrations/'+f);
const files=['202610060157_merchant_attendance_work_arrangement_permission.sql','202610060158_merchant_attendance_work_arrangement_periods.sql','202610060159_merchant_attendance_work_arrangement_exceptions.sql'];
const fn=(sql,name)=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('\n$$;',start)+4;assert(start>=0&&end>start);return sql.slice(start,end);};
test('157 adds exactly one independent permission without granting stored roles',()=>{
  const original=fn(migration('202610030121_merchant_attendance_leave_permission.sql'),'faolla_valid_merchant_enterprise_permissions_v1');
  const added=fn(migration(files[0]),'faolla_valid_merchant_enterprise_permissions_v1');
  assert.equal(added.replace("      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),\n",''),original);
  assert(!/\bupdate\s+public\./i.test(migration(files[0])));
});
test('158 legacy collector differs only by private name and first-artifact version compatibility',()=>{
  const original=fn(migration('202610050155_merchant_attendance_period_fixed_boundaries.sql'),'faolla_attendance_period_closure_source_v1');
  const base=fn(migration(files[1]),'faolla_attendance_period_closure_source_base_v1')
    .replace('public.faolla_attendance_period_closure_source_base_v1(','public.faolla_attendance_period_closure_source_v1(')
    .replace("coalesce(fixed_body->'source'->>'sourceVersion','') not in ('attendance-period-source-v1','attendance-period-source-v2')","fixed_body->'source'->>'sourceVersion' is distinct from 'attendance-period-source-v1'");
  assert.equal(base,original);
});
test('158 empty context preserves old canonical and nonempty context uses saved UTC identity',()=>{
  const body=fn(migration(files[1]),'faolla_attendance_period_closure_source_v1');
  assert(body.includes("if arrangements='[]'::jsonb then return result;end if;"));
  assert(body.includes("(result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz"));
  assert(body.includes("'sourceVersion','attendance-period-source-v2'"));
  assert(body.includes('pending_work_arrangement'));assert(body.includes('faolla_attendance_period_canonical_v1(result)'));
});
test('159 original exception source is preserved byte-for-byte under a private name',()=>{
  const original=fn(migration('202610050146_merchant_attendance_plan_exception_source.sql'),'faolla_attendance_plan_exception_source_v1');
  const base=fn(migration(files[2]),'faolla_attendance_plan_exception_source_legacy_v1').replace('public.faolla_attendance_plan_exception_source_legacy_v1(','public.faolla_attendance_plan_exception_source_v1(');
  assert.equal(base,original);
});
test('159 changes only explicit current evidence and stores latest operation references',()=>{
  const sql=migration(files[2]),wrapper=fn(sql,'faolla_attendance_plan_exception_source_v1'),writer=fn(sql,'faolla_attendance_plan_exception_review_v1');
  assert(wrapper.includes("if arrangements='[]'::jsonb then return result;end if;"));
  assert(wrapper.includes("'plan-exception-evidence-v2'"));assert(wrapper.includes('work_arrangement_pending'));
  assert(!/status'='approved'/.test(wrapper));assert(writer.includes("ref_item->'history'->-1->'operationId'"));
  assert(writer.includes("'policy',source_result->'source'->>'policy'"));
});
test('new integration migrations preserve private collectors, contain no business-row rewrites and pass catalog rules',()=>{
  for(const f of files){const sql=migration(f);assert.deepEqual(validateMigrationSource(f,sql),[]);}
  for(const f of files.slice(1)){
    const sql=migration(f);assert(!/\b(?:update|delete\s+from)\s+public\./i.test(sql));
    const name=f.includes('periods')?'faolla_attendance_period_closure_source_base_v1':'faolla_attendance_plan_exception_source_legacy_v1';
    assert(sql.includes(`revoke all on function public.${name}(jsonb,uuid) from public,anon,authenticated,service_role;`));
    assert(!sql.includes(`grant execute on function public.${name}`));
  }
});
