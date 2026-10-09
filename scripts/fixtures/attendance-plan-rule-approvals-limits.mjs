// Caller-owned166 acceptance only. Importing this module starts nothing.
// Capacity rows are explicitly synthetic new-ledger snapshots, NOT additional
// real rule publications, observations or owner approvals. Old tables are never
// altered. All ordinary constraints and append guards remain enabled.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {planRuleApprovalsExpression as expression} from './attendance-plan-rule-approvals-native.mjs';

const require=createRequire(import.meta.url);
const tables=Object.freeze(['merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_streams']);
const labels=Object.freeze([
  '140 actual50-artifact worker cap rejects a new source while current and original receipts remain readable',
  '140 actual1000-operation merchant cap rejects a new approval while original recovery remains readable',
  '140 both immutable tables reject update delete and bounded FK-closed truncate; stream is a mutable head',
  '140 actual SQL collector allows reminder A-B-A but rejects identical-rule provenance replacement',
]);
function fingerprintSql(names){
  assert(Array.isArray(names)&&names.length>0&&new Set(names).size===names.length);
  for(const name of names)assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return "(select md5(jsonb_object_agg(name,rows order by name)::text) from ("+names.map(name=>
    "select "+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+" r) rows").join(' union all ')+") all_tables)";
}
const lines=output=>output.trim()?output.trim().split(/\r?\n/):[];
const denied=expr=>"do $quota$ begin begin perform "+expr+";raise assert_failure using message='plan_rule_capacity_unexpected_success';"+
  "exception when raise_exception then if sqlerrm<>'attendance_plan_rule_limit' then raise;end if;end;end;$quota$;";

export async function checkPlanRuleApprovalLimits({d,native,scope}){
  assert(d?.syntheticOnly===true&&typeof native?.querySteps==='function'&&typeof scope?.sql==='function');
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.match(d.site,/^\d{8}$/);
  const names=d.inventory();for(const name of tables)assert(names.includes(name));
  const fingerprint=fingerprintSql(names),oldFingerprint=fingerprintSql(d.protectedTables);
  const {parsePlanRuleApprovalsResult}=require('../../src/lib/merchantAttendancePlanRuleApprovals.ts');
  const parse=(raw,q)=>parsePlanRuleApprovalsResult(raw,q,d.owner);
  const readQuery=d.query(d.slots.main,'read'),original=parse(d.raw(readQuery),readQuery);
  assert(original.approval,'plan_rule_real_approval_template_required');
  assert.equal(original.approval.actorId,d.owner);
  const recoveryQuery=d.query(d.slots.main,'recover',original.approval.operationId);
  const templateId=original.approval.operationId,templateSourceId=original.approval.sourceId;
  const sourceSlot=d.slots.cancelBefore;
  assert.notEqual(sourceSlot.id,d.slots.main.id);
  const candidateQuery=d.query(sourceSlot),candidate=parse(d.raw(candidateQuery),candidateQuery);
  assert.equal(candidate.preview.eligible,true,'plan_rule_fresh_future_candidate_required');
  assert.equal(Number(d.exec("select count(*) from public.merchant_attendance_plan_rule_artifacts where merchant_id="+quote(d.site)+
    " and worker_id="+quote(d.worker)+" and source_sha256="+quote(candidate.preview.fingerprint)+";")),0,'plan_rule_quota_must_need_new_artifact');
  const counts=JSON.parse(d.exec("select jsonb_build_object('artifacts',(select count(*) from public.merchant_attendance_plan_rule_artifacts where merchant_id="+quote(d.site)+
    " and worker_id="+quote(d.worker)+"),'operations',(select count(*) from public.merchant_attendance_plan_rule_operations where merchant_id="+quote(d.site)+"));"));
  assert(Number.isSafeInteger(counts.artifacts)&&counts.artifacts>0&&counts.artifacts<50);
  assert(Number.isSafeInteger(counts.operations)&&counts.operations>0&&counts.operations<1000);
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const artifactRows=50-counts.artifacts,operationRows=1000-counts.operations;
  const newTableGuard="do $new_tables$ declare name text;begin foreach name in array array["+tables.map(quote).join(',')+"] loop "+
    "assert exists(select 1 from pg_class c where c.oid=('public.'||name)::regclass and c.relnamespace="+owned.oid+" and c.relowner::regrole::text='postgres' and c.relrowsecurity),"+
    "'plan_rule_owned_private_table_required';"+
    "assert not exists(select 1 from pg_constraint c where c.conrelid=('public.'||name)::regclass and not c.convalidated),'plan_rule_constraints_must_remain_valid';"+
    "assert not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||name)::regclass and t.tgenabled<>'O'),'plan_rule_triggers_must_remain_enabled';end loop;"+
    // Explicitly verify the whole FK closure before the destructive-command
    // rejection test. No CASCADE and no relation outside these three is named.
    "assert not exists(select 1 from pg_constraint c where c.contype='f' and c.confrelid in("+tables.map(t=>"'public."+t+"'::regclass").join(',')+
    ") and c.conrelid not in("+tables.map(t=>"'public."+t+"'::regclass").join(',')+")),'plan_rule_new_only_fk_closure_required';end;$new_tables$;";
  const prefix="reset role;"+d.guard+newTableGuard;
  const checked=async(steps,verify)=>{
    assert(steps.length<=100&&steps[0].startsWith('begin;')&&steps.at(-1).trim().endsWith('rollback;'));
    try{return verify(lines(await native.querySteps(steps.map(step=>scope.sql(step)))));}
    finally{
      // querySteps closes its one session on every exit, which rolls an open
      // transaction back even when a SQL/step deadline or assertion fires.
      assert.equal(d.fingerprint(),baseline,'plan_rule_limit_probe_not_rolled_back');
      assert.equal(d.definitions(),definitions,'plan_rule_limit_probe_changed_definitions');
      assert.equal(d.tableCatalog(),catalog,'plan_rule_limit_probe_changed_constraints_or_triggers');
    }
  };
  const cloned=(offset,count,artifacts)=>{
    assert(Number.isSafeInteger(offset)&&Number.isSafeInteger(count)&&count>0&&count<=100);
    const base=artifacts?166800:168000;
    const mutations=Array.from({length:count},(_,j)=>{
      const i=offset+j+1,newId=id(base+i),revision=original.revision+i;
      const artifact=artifacts?
        "a.source_id:="+quote(newId)+";a.source:=jsonb_set(a.source,'{enterprise,revision}',to_jsonb("+String(10000+i)+"::bigint));"+
        "a.source:=jsonb_set(a.source,'{fields}',public.faolla_attendance_plan_rule_fields_v1(a.source));"+
        "a.source_sha256:=encode(sha256(convert_to(a.source::text,'UTF8')),'hex');a.source_bytes:=octet_length(convert_to(a.source::text,'UTF8'));"+
        "insert into public.merchant_attendance_plan_rule_artifacts select a.*;":"";
      return artifact+"o.operation_id:="+quote(newId)+";o.revision:="+revision+";o.source_id:=a.source_id;"+
        "o.command:=o.command||jsonb_build_object('operationId',o.operation_id,'expectedRevision',o.revision-1,'expectedFingerprint',a.source_sha256,"+
        "'reason','Synthetic capacity-only private row; not an actual owner approval');"+
        "insert into public.merchant_attendance_plan_rule_operations select o.*;";
    }).join('\n');
    return prefix+"do $clone$ declare a public.merchant_attendance_plan_rule_artifacts%rowtype;o public.merchant_attendance_plan_rule_operations%rowtype;begin "+
      "select * into a from public.merchant_attendance_plan_rule_artifacts where merchant_id="+quote(d.site)+" and source_id="+quote(templateSourceId)+";"+
      "select * into o from public.merchant_attendance_plan_rule_operations where merchant_id="+quote(d.site)+" and operation_id="+quote(templateId)+";"+
      "assert a.worker_id="+quote(d.worker)+" and a.slot_id="+quote(d.slots.main.id)+" and o.source_id=a.source_id and o.actor_auth_user_id="+quote(d.owner)+
      " and o.revision="+original.revision+",'plan_rule_real_template_changed';"+
      "assert (select revision from public.merchant_attendance_plan_rule_streams where merchant_id="+quote(d.site)+" and slot_id="+quote(d.slots.main.id)+")="+
      String(original.revision+offset)+",'plan_rule_synthetic_head_changed';"+
      mutations+
      "update public.merchant_attendance_plan_rule_streams set revision="+String(original.revision+offset+count)+" where merchant_id="+quote(d.site)+
      " and slot_id="+quote(d.slots.main.id)+";end;$clone$;set constraints all immediate;set constraints all deferred;";
  };
  const quotaScenario=async(artifacts)=>{
    const syntheticRows=artifacts?artifactRows:operationRows,steps=[];
    // At most20 artifacts (40 inserts) or100 small operations per SQL step.
    const batch=artifacts?20:100;
    for(let n=0;n<syntheticRows;n+=batch)steps.push((n===0?'begin;':'')+cloned(n,Math.min(batch,syntheticRows-n),artifacts));
    const command=d.approvalCommand(candidate,artifacts?167900:169900,'Synthetic actual capacity rejection');
    const query=d.query(sourceSlot,'approve',command.operationId);
    const countSql=artifacts?
      "select count(*) from public.merchant_attendance_plan_rule_artifacts where merchant_id="+quote(d.site)+" and worker_id="+quote(d.worker):
      "select count(*) from public.merchant_attendance_plan_rule_operations where merchant_id="+quote(d.site);
    steps.push(prefix+"do $count$ begin assert ("+countSql+")="+(artifacts?50:1000)+",'plan_rule_exact_capacity_required';end;$count$;"+
      "select "+oldFingerprint+";select "+fingerprint+";set local role service_role;"+denied(expression(query,d.owner,command,true))+
      "select "+expression(recoveryQuery,d.owner,null,false)+";select "+expression(readQuery,d.owner,null,false)+";reset role;select "+fingerprint+";select "+oldFingerprint+";");
    steps.push('rollback;');
    await checked(steps,output=>{
      assert.equal(output.length,6,'plan_rule_capacity_output_shape');
      for(const i of [0,1,4,5])assert.match(output[i],/^[a-f0-9]{32}$/);
      assert.equal(output[0],output[5],'plan_rule_capacity_reads_changed_old_facts');
      assert.equal(output[1],output[4],'plan_rule_rejected_write_or_reads_changed_private_facts');
      const recovered=parse(JSON.parse(output[2]),recoveryQuery),current=parse(JSON.parse(output[3]),readQuery);
      assert.deepEqual(recovered.approval,original.approval,'plan_rule_original_receipt_recomputed');
      assert.equal(current.revision,original.revision+syntheticRows);assert.equal(current.approval.revision,current.revision);
      assert.equal(current.approval.sourceId,artifacts?id(166800+syntheticRows):templateSourceId);
      return true;
    });
    native.pass(labels[artifacts?0:1]);
  };
  await quotaScenario(true);
  await quotaScenario(false);

  const attempts=[];
  for(const table of tables.slice(0,2)){
    const predicate="merchant_id="+quote(d.site)+" and "+(table.endsWith('artifacts')?'source_id='+quote(templateSourceId):'operation_id='+quote(templateId));
    attempts.push("update public."+table+" set worker_id=worker_id where "+predicate);
    attempts.push("delete from public."+table+" where "+predicate);
    const ordered=[table,...tables.filter(t=>t!==table)];
    attempts.push("truncate "+ordered.map(t=>'public.'+t).join(','));
  }
  await checked(['begin;'+prefix+"do $immutable$ begin "+attempts.map(statement=>
    "begin "+statement+";raise assert_failure using message='plan_rule_append_only_allowed';exception when insufficient_privilege then "+
    "if sqlerrm<>'attendance_events_append_only' then raise;end if;end;").join('\n')+
    "end;$immutable$;select jsonb_build_object('rejected',6);rollback;"],output=>{
    assert.equal(output.length,1);assert.deepEqual(JSON.parse(output[0]),{rejected:6});
  });
  native.pass(labels[2]);

  // Counterfactual collector regression ONLY: real130 output is the template,
  // but the three within-plan effective instants below are synthetic. They are
  // not persisted and do not claim127 can publish intraday instants.
  const overnight=d.slots.overnight;
  await checked(['begin;'+prefix+
    "do $collector$ declare raw jsonb;enterprise jsonb;pub_a jsonb;pub_b jsonb;pub_c jsonb;slot_context jsonb;source_slot jsonb;preview jsonb;plan public.merchant_attendance_schedule_slots%rowtype;begin "+
    "select * into plan from public.merchant_attendance_schedule_slots where merchant_id="+quote(d.site)+" and worker_id="+quote(d.worker)+" and id="+quote(overnight.id)+";"+
    "assert plan.id is not null and plan.end_at-plan.start_at=interval '1 hour','plan_rule_collector_plan_required';"+
    "raw:=public.faolla_attendance_rule_sources_v1("+json(d.sourceQuery)+","+quote(d.owner)+");"+
    "select value into enterprise from jsonb_array_elements(raw->'rules'->'items') where value->'groupId'='null'::jsonb;"+
    "select value into pub_a from jsonb_array_elements(enterprise->'publications') where (value->>'effectiveAt')::timestamptz<=plan.start_at order by (value->>'effectiveAt')::timestamptz desc limit 1;"+
    "assert pub_a->>'action'='publish','plan_rule_real_publication_template_required';"+
    "pub_a:=jsonb_set(pub_a,'{rules,openSpanWarningMinutes}',jsonb_build_object('mode','value','minutes',60));"+
    "pub_b:=pub_a||jsonb_build_object('operationId',"+quote(id(170001))+",'revision',4,'effectiveAt',to_char((plan.start_at+interval '20 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'));"+
    "pub_b:=jsonb_set(pub_b,'{rules,openSpanWarningMinutes}',jsonb_build_object('mode','value','minutes',120));"+
    "pub_c:=pub_a||jsonb_build_object('operationId',"+quote(id(170002))+",'revision',6,'effectiveAt',to_char((plan.start_at+interval '40 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'));"+
    "raw:=jsonb_set(raw,'{assignments}',jsonb_build_object('limited',false,'items','[]'::jsonb));"+
    "raw:=jsonb_set(raw,'{personal}',jsonb_build_object('revision',0,'limited',false,'items','[]'::jsonb));"+
    "raw:=jsonb_set(raw,'{rules}',jsonb_build_object('limited',false,'items',jsonb_build_array(jsonb_build_object('groupId',null,'revision',6,'publications',jsonb_build_array(pub_a,pub_b,pub_c)))));"+
    "slot_context:=public.faolla_attendance_self_schedule_slot_v1(plan);"+
    "source_slot:=jsonb_build_object('id',plan.id,'revision',plan.revision,'locationId',plan.location_id,'locationVersion',slot_context->'publication'->'locationVersion',"+
    "'timeZone',plan.time_zone,'startAt',slot_context->'slot'->'startAt','endAt',slot_context->'slot'->'endAt');"+
    "preview:=public.faolla_attendance_plan_rule_preview_v1(raw,source_slot);"+
    "assert preview->'eligible'='true'::jsonb and preview->'blockers'='[]'::jsonb,'plan_rule_reminder_round_trip_rejected';"+
    "pub_b:=pub_b||jsonb_build_object('rules',pub_a->'rules');"+
    "raw:=jsonb_set(raw,'{rules,items,0,publications}',jsonb_build_array(pub_a,pub_b));"+
    "preview:=public.faolla_attendance_plan_rule_preview_v1(raw,source_slot);"+
    "assert preview->'eligible'='false'::jsonb and preview->'blockers'=jsonb_build_array('source_switch'),'plan_rule_identical_provenance_replacement_allowed';"+
    "end;$collector$;select jsonb_build_object('reminderRoundTrip',true,'identicalRepublishBlocked',true);rollback;"],output=>{
    assert.equal(output.length,1);assert.deepEqual(JSON.parse(output[0]),{reminderRoundTrip:true,identicalRepublishBlocked:true});
  });
  native.pass(labels[3]);
  return {checks:labels.length,workerArtifactCap:50,merchantOperationCap:1000,syntheticArtifacts:artifactRows,
    syntheticOperations:artifactRows+operationRows,immutableDenials:6,collectorCounterfactualChecks:2,
    actualCapacityRejectedApprovals:2,actualRecoveryReads:2,actualCurrentReads:2,allRollbackFingerprintsUnchanged:true,
    oldFactsAndDefinitionsUnchanged:true,streamIsMutableHead:true,syntheticOnly:true,
    fixtureDisclosure:'Capacity-only private clones and unpersisted collector counterfactuals; not additional actual owner approvals or intraday publications.',
    notRuntimeCovered:['merchant500artifactCap','artifactByteQuotas'],callerOwnsRuntimeAndCleanup:true};
}
