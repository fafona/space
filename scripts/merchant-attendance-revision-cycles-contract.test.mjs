import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const cycles=read('scripts/supabase-migrations/202610010095_merchant_attendance_revision_cycles.sql');
const core=read('scripts/supabase-migrations/202610010094_merchant_attendance_revision_decision_core.sql');
const requests=read('scripts/supabase-migrations/202610010091_merchant_attendance_revision_requests.sql');
function definition(s,name){const start=s.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));assert(start>=0,name);const end=s.indexOf('$$;',start);assert(end>start);return s.slice(start,end+3);}
const normalize=s=>s.replace(/--[^\n]*/g,'').replace(/\s/g,'').replace('createorreplacefunction','createfunction');
function section(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a);assert(a>=0&&b>a);return s.slice(a,b);}
test('continuous cycles reuse existing journal storage and remain inaccessible to every application role',()=>{
  assert(!/create table|create index|grant execute|grant .* to service_role|update public\.|delete from|\btruncate\b|alter table/i.test(cycles));
  for(const [name,args] of [['effect_at_v1','text,uuid,uuid,timestamptz'],['self_v2','text,uuid,jsonb,jsonb,boolean'],['owner_review_v3','text,uuid,uuid'],['decide_v2','text,uuid,uuid,jsonb,uuid,boolean']]){
    assert(cycles.includes(`revoke all on function public.faolla_attendance_revision_${name}(${args}) from public,anon,authenticated,service_role;`));
  }
  assert.match(definition(cycles,'faolla_attendance_revision_self_v2'),/p_platform_enabled boolean default false/);
  assert.match(definition(cycles,'faolla_attendance_revision_decide_v2'),/p_allow_write boolean default false/);
  const handler=read('src/app/api/merchant-enterprise/attendance/revision-decisions/route-handler.ts');
  assert(handler.includes('FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED==="1"'));assert(handler.includes('executeRevisionDecision'));
  assert(!handler.includes('faolla_attendance_revision_decide_v1'));
  assert(!read('src/lib/merchantAttendanceRevision.server.ts').includes('faolla_attendance_revision_self_v2'));
});
test('new self protocol preserves tenant, current identity, role and worker authorization and raw basis recheck',()=>{
  const old=definition(requests,'faolla_attendance_revision_self_v1'),now=definition(cycles,'faolla_attendance_revision_self_v2');
  for(const [start,end] of [['perform 1 from public.merchants','can_request:='],['basis:=public.faolla_attendance_correction_basis_v1','now_at:=clock_timestamp();proposal:=']]){
    const latest=section(now,start,end).replace(/  select \* into current_effect[^\n]*\n  if current_effect.request_id[^\n]*\n/,'');
    assert.equal(normalize(latest),normalize(section(old,start,end)));
  }
  assert(now.indexOf('if receipt.command<>p_command')<now.indexOf('attendance_platform_paused'));
  assert.match(now,/head\.action='submit' and head_decision\.operation_id is null/);
  assert.match(now,/item_decision\.operation_id is not null then raise exception 'attendance_correction_closed'/);
  assert.match(now,/base\.operation_id::text<>p_command->>'expectedBaseOperationId' or current_effect\.operation_id::text<>p_command->>'expectedEffectiveOperationId'/);
  assert.match(now,/original\.basis,current_effect\.proposal,null,now_at/);
  assert(!/revision\s*%|mod\(/i.test(now));
});
test('owner review preserves raw facts, employment, latest overlap checks and authorization while using captured source',()=>{
  const old=definition(core,'faolla_attendance_revision_owner_review_v2'),now=definition(cycles,'faolla_attendance_revision_owner_review_v3');
  for(const [start,end] of [['  if p_site_id is null','  proposed:='],['  begin\n    evidence:=','  base_json:=']]){
    let candidate=section(now,start,end);
    if(start.includes('p_site_id'))candidate=candidate.slice(0,candidate.indexOf('  captured:='));
    assert.equal(normalize(candidate),normalize(section(old,start,end)));
  }
  assert.match(now,/faolla_attendance_revision_bound_rules_v1\(p_site_id,first_row,original\.basis,captured->'proposal',now_at\)/);
  assert.match(now,/base_json:=captured/);assert.match(now,/'sourceVersion','revision-review-v2','requestState'/);
  assert.match(now,/'decisionOperation',item_decision\.operation_id/);
});
test('deciding core changes only source selection, review version and explicit response protocol',()=>{
  let expected=definition(core,'faolla_attendance_revision_decide_v1')
    .replaceAll('faolla_attendance_revision_decide_v1','faolla_attendance_revision_decide_v2')
    .replaceAll('faolla_attendance_revision_owner_review_v2','faolla_attendance_revision_owner_review_v3')
    .replace('  op uuid;','  submitted_base uuid;op uuid;')
    .replace("  select * into current_effect from public.merchant_attendance_effect_current_v2",()=>"  submitted_base:=coalesce((first_row.command->>'expectedEffectiveOperationId')::uuid,first_row.base_operation_id);\n  select * into current_effect from public.merchant_attendance_effect_current_v2")
    .replaceAll('current_effect.operation_id<>first_row.base_operation_id','current_effect.operation_id<>submitted_base')
    .replaceAll('current_effect.operation_id=first_row.base_operation_id','current_effect.operation_id=submitted_base')
    .replace("'protocol','revision-decision-v1'","'protocol','revision-decision-v2'");
  assert.equal(normalize(definition(cycles,'faolla_attendance_revision_decide_v2')),normalize(expected));
});
test('historical sources are resolved from immutable references without copying whole events or snapshots',()=>{
  const resolve=definition(cycles,'faolla_attendance_revision_effect_at_v1');
  assert.match(resolve,/merchant_attendance_effect_versions where merchant_id=p_site and root_request_id=p_root and operation_id=p_operation/);
  assert.match(resolve,/e\.proposal:=request\.command->'proposal'/);assert.match(resolve,/return public\.faolla_attendance_effect_evidence_v2\(e,p_now\)/);
  assert(!/insert into|security definer|order by revision desc/.test(resolve));
  const self=definition(cycles,'faolla_attendance_revision_self_v2');
  assert.match(self,/'basedOn',based_on/);assert.match(self,/'decisionEffect',case when item_decision\.action='approve'/);
  assert.match(self,/coalesce\(\(first_row\.command->>'expectedEffectiveOperationId'\)::uuid,first_row\.base_operation_id\)/);
  assert.match(self,/octet_length\(result::text\)>262144/);
});
test('legacy functions gain only authenticated new-protocol refusal without broad behavior rewrites',()=>{
  for(const name of ['faolla_attendance_revision_self_v1','faolla_attendance_revision_owner_review_v1','faolla_attendance_revision_decide_v1']){
    const actual=definition(cycles,name),before=definition(core,name);
    const clean=actual.replace(/^.*if .*expectedEffectiveOperationId.*attendance_report_version_required.*\n/m,'');
    assert.equal(normalize(clean),normalize(before));
    assert(actual.indexOf('attendance_access_denied')<actual.indexOf("? 'expectedEffectiveOperationId'"));
  }
});
