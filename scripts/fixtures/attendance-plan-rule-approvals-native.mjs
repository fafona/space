//166 minimal synthetic preparation. Root owns the stopped local PG lifecycle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {prepareSelfScheduleNativeFixture} from './attendance-self-schedule-native.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
import {sourcesNativeDependencies} from '../merchant-attendance-sources-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {rulesQueryInput,rulesNativeSave,rulesNativePublish} from '../merchant-attendance-rules-native.mjs';

export const planRuleApprovalsRpc='faolla_attendance_plan_rule_approvals_v1';
export const planRuleApprovalsMigration='202610050140_merchant_attendance_plan_rule_approvals.sql';
export function planRuleApprovalsExpression(query,actor,command=null,moduleEnabled=true){
  assert.equal(typeof moduleEnabled,'boolean');
  assert.match(actor,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return `public.${planRuleApprovalsRpc}(${json(query)},${quote(actor)},${json(command)},${moduleEnabled})`;
}
export async function preparePlanRuleApprovalsNative(native,scope){
  const d=await prepareSelfScheduleNativeFixture(native,scope),{exec}=d;
  for(const name of [...sourcesNativeDependencies,'202610040128_merchant_attendance_sources.sql',
    '202610040135_merchant_attendance_shift_rule_binding_reader.sql','202610050138_merchant_attendance_shift_check.sql']){
    if(exec(`select count(*) from public.faolla_schema_migrations where version=${Number(name.slice(0,12))};`)==='0')exec(boundClockMigrationBody(native.root,name));
  }
  //139 contains CREATE INDEX CONCURRENTLY; it must run outside BEGIN.
  exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050139_merchant_attendance_plan_coverage.sql'),'utf8')));
  const protectedTables=d.inventory().filter(t=>t!=='faolla_schema_migrations');
  const oldFacts=d.fingerprint(protectedTables),oldCatalog=JSON.parse(d.tableCatalog());
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const oldDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f';`);
  const oldDefs=oldDefinitions();exec(boundClockMigrationBody(native.root,planRuleApprovalsMigration));
  assert.equal(d.fingerprint(protectedTables),oldFacts);assert.equal(oldDefinitions(),oldDefs);
  assert.deepEqual(JSON.parse(d.tableCatalog()).filter(row=>oldCatalog.some(old=>old[0]===row[0])),oldCatalog);
  const installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog(),afterInstall=d.fingerprint();
  exec(boundClockMigrationBody(native.root,planRuleApprovalsMigration));
  assert.equal(d.fingerprint(),afterInstall);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const query=(slot=d.slots.main,mode='preview',operationId=null)=>({siteId:d.site,workerId:d.worker,slotId:slot.id,mode,operationId});
  const raw=(q=query(),c=null,actor=d.owner,enabled=true)=>JSON.parse(exec(`set local role service_role;select ${planRuleApprovalsExpression(q,actor,c,enabled)};`));
  const sourceQuery={siteId:d.site,workerId:d.worker,fromDate:d.day(1),throughDate:d.day(2)};
  const sourceRaw=(q=sourceQuery,actor=d.owner)=>JSON.parse(exec(`set local role service_role;select public.faolla_attendance_sources_v1(${json(q)},'${actor}');`));
  const ruleExpression=(command)=>`public.faolla_attendance_rules_v1(${json(rulesQueryInput())},'${d.owner}',${json(command)},true)`;
  const publishRules=(choices,revision=0,effectiveOn=d.day(1),seed=166000)=>{
    const save=rulesNativeSave(seed,revision,choices?{rules:choices}:{}),publish=rulesNativePublish(seed+1,revision+1,effectiveOn);
    exec(`set local role service_role;do $future$ begin perform ${ruleExpression(save)};perform ${ruleExpression(publish)};end;$future$;`);
    return {save,publish};
  };
  return {...d,query,raw,sourceQuery,sourceRaw,publishRules,ruleExpression,oldDefinitions,oldDefs,protectedTables,installedDefinitions,installedCatalog,
    approvalCommand:(preview,n,reason='Synthetic166 explicit rule approval')=>({operationId:id(n),expectedRevision:preview.revision,
      expectedFingerprint:preview.preview.fingerprint,employeeId:d.employee,employeeAuthUserId:d.auth,reason})};
}
