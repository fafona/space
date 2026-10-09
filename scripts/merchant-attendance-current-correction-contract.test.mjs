import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read('scripts/supabase-migrations/202610010096_merchant_attendance_current_correction_decisions.sql');
const prior=read('scripts/supabase-migrations/202609300086_merchant_attendance_correction_decisions.sql');
function definition(s,name){const start=s.indexOf('create function public.'+name+'('),end=s.indexOf('end; $$;',start);assert(start>=0&&end>start);return s.slice(start,end+8);}
const normalize=s=>s.replace(/--[^\n]*/g,'').replace(/\s/g,'');
test('latest-source first-decision checks preserve all original identity, raw evidence, employment, policy and period-lock checks',()=>{
  const expected=definition(prior,'faolla_attendance_decision_checks_v1').replaceAll('faolla_attendance_decision_checks_v1','faolla_attendance_decision_checks_v2')
    .replaceAll('merchant_attendance_correction_effects','merchant_attendance_effect_current_v2');
  assert.equal(normalize(definition(sql,'faolla_attendance_decision_checks_v2')),normalize(expected));
});
test('decision transaction changes only source checks, collision guard and explicit current/history/replay metadata',()=>{
  let expected=definition(prior,'faolla_attendance_correction_decide_v1').replaceAll('faolla_attendance_correction_decide_v1','faolla_attendance_correction_decide_v2')
    .replaceAll('faolla_attendance_decision_checks_v1','faolla_attendance_decision_checks_v2');
  expected=expected.replace('proposal jsonb;b jsonb;',"current_effect public.merchant_attendance_effect_current_v2%rowtype;current_json jsonb:='null';replayed boolean:=false;changed boolean:=false;\n  proposal jsonb;b jsonb;")
    .replace('if receipt.request_id is not null then\n      if receipt.command<>p_command','if receipt.request_id is not null then\n      replayed:=true;\n      if receipt.command<>p_command')
    .replace("if receipt.action='approve' then\n        proposal:=","if receipt.action='approve' then\n        changed:=true;\n        proposal:=")
    .replace('  select * into d from public.','  if p_command is null and receipt.request_id is not null then replayed:=true;end if;\n  select * into d from public.');
  const collision=sql.match(/      if exists\(select 1 from public\.merchant_attendance_correction_entries[\s\S]*?attendance_operation_conflict';end if;/)?.[0];assert(collision);
  for(const table of ['correction_entries','revision_requests','revision_decisions','effect_versions'])assert(collision.includes('merchant_attendance_'+table));
  expected=expected.replace("      if not coalesce(p_allow_write,false) then raise exception 'attendance_platform_paused';end if;", "      if not coalesce(p_allow_write,false) then raise exception 'attendance_platform_paused';end if;\n"+collision);
  expected=expected.replace("  return jsonb_build_object('siteId',p_site_id,'asOf',to_char(clock_timestamp()",`  now_at:=clock_timestamp();
  select * into current_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id
    and worker_id=(r->'item'->>'workerId')::uuid and start_event_id=(r->'item'->>'startEventId')::uuid;
  if current_effect.request_id is not null then current_json:=public.faolla_attendance_effect_evidence_v2(current_effect,now_at);end if;
  return jsonb_build_object('protocol','correction-decision-v2','siteId',p_site_id,'asOf',to_char(now_at`)
    .replace("'effective',effect_json,'timesheetIntegrated',false","'effective',effect_json,'current',current_json,'writeEnabled',coalesce(p_allow_write,false),'replayed',replayed,'effectiveChanged',changed");
  assert.equal(normalize(definition(sql,'faolla_attendance_correction_decide_v2')),normalize(expected));
});
test('candidate remains additive/private; new HTTP/page consumers require explicit default-off gates',()=>{
  assert(!/create\s+(?:or replace|table|view)|grant execute|\b(?:update|delete from)\s+public\./i.test(sql));
  for(const name of ['faolla_attendance_decision_checks_v2','faolla_attendance_correction_decide_v2'])assert(new RegExp('revoke all on function public\\.'+name+'[^;]+from public,anon,authenticated,service_role;').test(sql));
  const route=read('src/app/api/merchant-enterprise/attendance/correction-decisions/route-handler.ts');
  assert(route.includes('executeCurrentCorrectionDecision'));assert(route.includes('FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1"'));
  assert(!route.includes('executeCorrectionDecision'));assert(read('src/components/enterprise/MerchantAttendanceCorrectionReviewPanel.tsx').includes('NEXT_PUBLIC_FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1"'));
  for(const name of readdirSync(new URL('../src/app/api/merchant-enterprise/attendance/',import.meta.url),{recursive:true})){
    if(!/\.tsx?$/.test(name)||/\.test\./.test(name)||name.replaceAll('\\','/')==='correction-decisions/route-handler.ts')continue;
    assert(!read('src/app/api/merchant-enterprise/attendance/'+name.replaceAll('\\','/')).includes('merchantAttendanceCurrentCorrectionDecision'),name);
  }
  assert(read('src/lib/merchantAttendanceCorrectionDecision.server.ts').includes('faolla_attendance_correction_decide_v1'));
});
test('explicit current-source parser shares immutable first-decision facts but never casts current revisions into a legacy first approval',()=>{
  const parser=read('src/lib/merchantAttendanceCurrentCorrectionDecision.ts'),service=read('src/lib/merchantAttendanceCurrentCorrectionDecision.server.ts');
  assert(parser.includes('parseCorrectionDecisionSnapshot'));assert(!parser.includes('parseCorrectionDecisionResult'));
  for(const marker of ['decisionEffect','current','rootRequestId','rootOperationId','rootRecordedAt','effectiveChanged','writeEnabled','replayed'])assert(parser.includes(marker));
  assert(service.includes('faolla_attendance_correction_decide_v2'));assert(!/setTimeout|setInterval|while\s*\(|for\s*\(/.test(service));
  assert(service.includes('Object.hasOwn(input.command,"siteId")'));assert(service.includes('correctionDecisionReceiptMatches'));
});
