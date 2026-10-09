//182 diagnostic ONLY on153. Caller owns runtime and namespace. Actual103
//commands create A/approved, B/withdrawn and C/rejected templates; dense B
//copies retain storage guards but are NOT claimed as actual employee actions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const fid=n=>id(182000000+n);
const offset=(value,minutes)=>new Date(Date.parse(value)+minutes*60000).toISOString().replace(/Z$/,'000Z');
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const perform=sql=>`do $root_capacity_rpc$ begin perform ${sql};end;$root_capacity_rpc$;`;
const withoutObservation=raw=>{const out=structuredClone(raw);delete out.base.asOf;return out;};
function fingerprint(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') missing_root_rows)';
}

export async function verifyPeriodMissingRootCapacityNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d?.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const {parseUnifiedSource}=require('../../src/lib/merchantAttendanceUnifiedTimesheet.ts');
  const q={siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const uq=access=>access==='owner'?{...q}:{siteId:d.site,access:'self',expectedWorkerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate};
  const rq=access=>access==='owner'?{access,workerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate}:
    {access,workerId:null,locationId:null,expectedWorkerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate};
  const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId),employee=quote(h.employeeId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),allHash=fingerprint(names);
  const writable=['merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries'];
  const protectedHash=fingerprint(names.filter(name=>!writable.includes(name)));
  const source=access=>`public.faolla_attendance_period_source_v1(${json({...q,access})},${access==='owner'?owner:auth})`;
  const report=access=>`public.faolla_attendance_unified_report_v1(${site},${access==='owner'?owner:auth},${json(rq(access))})`;
  const policy=fid(1),a=fid(2),aa=fid(3),b=fid(4),bt=fid(5),c=fid(6),ct=fid(7);
  // Prepare primitive RPC arguments in the caller-owned setup context. The
  // service_role RPC calls below must never evaluate private-table subqueries.
  const versions=JSON.parse(d.exec(`select jsonb_build_object('settingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),
    'policyRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}));`));
  assert(Number.isSafeInteger(versions.settingsVersion)&&versions.settingsVersion>=1,'root_capacity_safe_settings_version');
  assert(Number.isSafeInteger(versions.policyRevision)&&versions.policyRevision>=0&&versions.policyRevision<Number.MAX_SAFE_INTEGER,'root_capacity_safe_policy_revision');
  const settingsVersion=versions.settingsVersion,previousPolicyRevision=versions.policyRevision,policyRevision=previousPolicyRevision+1;
  const initial=`do $root_capacity_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050153),'root_capacity_requires153';
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'root_capacity_before_period_creation';
    assert not exists(select 1 from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker}),'root_capacity_empty_missing_history';
    assert (select time_zone from public.merchant_attendance_settings where merchant_id=${site})='UTC','root_capacity_utc_required';
    assert (select version from public.merchant_attendance_settings where merchant_id=${site})=${settingsVersion}
      and (select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site})=${previousPolicyRevision},'root_capacity_prepared_versions_stable';
    assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
      where e.merchant_id=${site} and e.id=${employee} and e.auth_user_id=${auth} and e.status='active' and r.status='active'
      and 'attendance.self.request'=any(r.permissions)),'root_capacity_existing_request_permission';
    assert not exists(select 1 from pg_trigger t join pg_class x on x.oid=t.tgrelid where x.relnamespace=${owned.oid} and t.tgenabled<>'O'),'root_capacity_enabled_triggers';
  end;$root_capacity_initial$;`;
  const setPolicy=perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},${json({action:'set_policy',operationId:policy,
    expectedRevision:previousPolicyRevision,expectedSettingsVersion:settingsVersion,submissionWindowDays:365,reason:'Synthetic182 root capacity policy'})},null,null,true)`);
  const policyChecked=`do $root_capacity_policy$ begin
    assert (select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})=${policyRevision},'root_capacity_actual_policy_revision';
    assert (select version from public.merchant_attendance_settings where merchant_id=${site})=${settingsVersion},'root_capacity_settings_unchanged';
  end;$root_capacity_policy$;`;
  const mq=(access,requestId=null)=>({siteId:d.site,access,fromDate:q.fromDate,throughDate:new Date(Date.parse(q.fromDate)+86400000).toISOString().slice(0,10),
    requestId,operationId:null,beforeAt:null,beforeId:null});
  const rpc=(access,requestId,command)=>`public.faolla_attendance_missing_v1(${json(mq(access,requestId))},${access==='owner'?owner:auth},${command},true)`;
  const inside={startAt:offset(h.slot.startAt,-120),endAt:offset(h.slot.startAt,-60),breaks:[]};
  const outside={startAt:offset(h.slot.startAt,1320),endAt:offset(h.slot.startAt,1380),breaks:[]};
  assert.equal(inside.startAt.slice(0,10),q.fromDate);assert.notEqual(outside.startAt.slice(0,10),q.fromDate);
  const submit=(operationId,revise=false)=>perform(rpc('self',null,json({action:revise?'revise':'submit',operationId,
    reason:'Synthetic182 missing declaration',expectedWorkerId:h.workerId,expectedSettingsVersion:settingsVersion,expectedPolicyRevision:policyRevision,
    locationId:h.slot.locationId,timeZone:'UTC',proposal:revise?outside:inside,...(revise?{supersedesRequestId:a,expectedApprovalOperationId:aa}:{})})));
  const decide=(requestId,op,action)=>`do $root_capacity_decide$ declare review jsonb;command jsonb;begin
    review:=${rpc('owner',requestId,'null')};assert review->'detail'->>${quote(action==='approve'?'canApprove':'canReject')}='true','root_capacity_real_decision_eligible';
    command:=jsonb_build_object('action',${quote(action)},'operationId',${quote(op)},'requestId',${quote(requestId)},'expectedRevision',1,
      'evidenceToken',review->'detail'->>'evidenceToken','reason','Synthetic182 real missing decision');
    perform ${rpc('owner',requestId,'command')};end;$root_capacity_decide$;`;
  const withdraw=perform(rpc('self',b,json({action:'withdraw',operationId:bt,requestId:b,expectedRevision:1,reason:'Synthetic182 real withdrawal'})));
  const copy=(first,last)=>`set constraints all deferred;do $root_capacity_copy$ declare i integer;r public.merchant_attendance_missing_requests%rowtype;
    first_entry public.merchant_attendance_missing_entries%rowtype;terminal public.merchant_attendance_missing_entries%rowtype;new_id uuid;new_op uuid;begin
    for i in ${first}..${last} loop
      select * into strict r from public.merchant_attendance_missing_requests where merchant_id=${site} and request_id=${quote(b)};
      select * into strict first_entry from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=${quote(b)} and revision=1;
      select * into strict terminal from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=${quote(b)} and revision=2;
      assert terminal.action='withdraw','root_capacity_withdrawn_template';
      new_id:=('00000000-0000-4000-8000-'||lpad((182010000+i)::text,12,'0'))::uuid;new_op:=('00000000-0000-4000-8000-'||lpad((182020000+i)::text,12,'0'))::uuid;
      r.request_id:=new_id;first_entry.operation_id:=new_id;first_entry.request_id:=new_id;first_entry.command:=first_entry.command||jsonb_build_object('operationId',new_id);
      terminal.operation_id:=new_op;terminal.request_id:=new_id;terminal.command:=terminal.command||jsonb_build_object('operationId',new_op,'requestId',new_id);
      insert into public.merchant_attendance_missing_requests select (r).*;
      insert into public.merchant_attendance_missing_entries select (first_entry).*;insert into public.merchant_attendance_missing_entries select (terminal).*;
    end loop;end;$root_capacity_copy$;set constraints all immediate;`;
  const marker=(kind,value=allHash)=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${value});`;
  const read=(label,access,kind)=>marker('before_read')+`set local role service_role;
    select jsonb_build_object('kind','read','label',${quote(label)},'access',${quote(access)},'reader',${quote(kind)},'raw',${kind==='source'?source(access):report(access)});`+marker('after_read');
  const reads=label=>['owner','self'].flatMap(access=>['report','source'].map(kind=>read(label,access,kind))).join('\n');
  const failedSource=access=>marker('before_failure')+`set local role service_role;do $root_capacity_reject$ begin
    begin perform ${source(access)};raise exception 'root_capacity_expected_failure_missing';
    exception when raise_exception then if sqlerrm<>'attendance_period_source_too_large' then raise;end if;end;
    end;$root_capacity_reject$;${prefix}select jsonb_build_object('kind','rejection','access',${quote(access)},'error','attendance_period_source_too_large');`+marker('after_failure');
  const oracle=total=>`do $root_capacity_oracle$ declare roots integer;related integer;pending integer;withdrawn integer;rejected integer;begin
    select count(*) into roots from public.merchant_attendance_missing_requests where merchant_id=${site} and coalesce(root_request_id,request_id)=${quote(a)};
    select count(*) into related from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker}
      and start_at<${quote(q.throughDate+'T00:00:00.000000Z')}::timestamptz+interval '24 hours' and end_at>${quote(q.fromDate+'T00:00:00.000000Z')}::timestamptz;
    select count(*) into pending from public.merchant_attendance_missing_requests r where r.merchant_id=${site} and r.supersedes_request_id=${quote(a)}
      and not exists(select 1 from public.merchant_attendance_missing_entries terminal where terminal.merchant_id=r.merchant_id and terminal.request_id=r.request_id and terminal.revision=2);
    select count(*) filter(where e.action='withdraw'),count(*) filter(where e.action='reject') into withdrawn,rejected
      from public.merchant_attendance_missing_requests r join public.merchant_attendance_missing_entries e on e.merchant_id=r.merchant_id and e.request_id=r.request_id and e.revision=2
      where r.merchant_id=${site} and r.supersedes_request_id=${quote(a)};
    assert roots=${total} and related=1 and pending=0 and withdrawn=${total===1?0:total-2} and rejected=${total===1?0:1},'root_capacity_precise_counts';
    assert exists(select 1 from public.merchant_attendance_missing_current_v1 where merchant_id=${site} and request_id=${quote(a)}),'root_capacity_parent_still_current';
  end;$root_capacity_oracle$;select jsonb_build_object('kind','counts','rootRows',${total},'historicalChildren',${total-1},'related',1,'pending',0);`;
  const batches=[];for(let first=1;first<=97;first+=10)batches.push(copy(first,Math.min(first+9,97)));
  const steps=['begin;'+prefix+initial+marker('protected_before',protectedHash),
    prefix+'set local role service_role;'+setPolicy+prefix+policyChecked,prefix+'set local role service_role;'+submit(a),prefix+'set local role service_role;'+decide(a,aa,'approve'),
    prefix+oracle(1)+reads('root1'),prefix+'set local role service_role;'+submit(b,true),prefix+'set local role service_role;'+withdraw,
    prefix+'set local role service_role;'+submit(c,true),prefix+'set local role service_role;'+decide(c,ct,'reject'),
    ...batches.map(sql=>prefix+sql),prefix+oracle(100)+reads('root100'),prefix+copy(98,98),
    prefix+oracle(101)+read('root101','owner','report')+read('root101','self','report')+failedSource('owner')+failedSource('self'),
    marker('protected_after',protectedHash)+'set constraints all immediate;rollback;'];
  assert(steps.length<=26,'root_capacity_bounded_steps');let output;
  try{output=lines(await native.querySteps(steps.map(sql=>scope.sql(sql))));}
  catch(error){throw new Error('period_missing_root_capacity_diagnostic_failed:'+String(error?.message??error),{cause:error});}
  finally{assert.equal(d.fingerprint(),baseline,'root_capacity_rollback');assert.equal(d.definitions(),definitions,'root_capacity_definitions');assert.equal(d.tableCatalog(),catalog,'root_capacity_catalog');}
  assert.equal(output[0].kind,'protected_before');assert.equal(output.at(-1).kind,'protected_after');assert.equal(output[0].hash,output.at(-1).hash,'root_capacity_protected_facts');
  assert.deepEqual(output.filter(row=>row.kind==='counts').map(row=>[row.rootRows,row.historicalChildren,row.related,row.pending]),[[1,0,1,0],[100,99,1,0],[101,100,1,0]]);
  const groups=new Map();let successfulReads=0;const sizes=[];
  for(let i=0;i<output.length;i++)if(output[i].kind==='read'){
    const row=output[i];assert.equal(output[i-1].kind,'before_read');assert.equal(output[i+1].kind,'after_read');assert.equal(output[i-1].hash,output[i+1].hash,'root_capacity_read_wrote_rows');
    if(!groups.has(row.label))groups.set(row.label,{});const group=groups.get(row.label),key=row.access+row.reader;
    assert.equal(group[key],undefined);group[key]=row.raw;successfulReads++;
  }
  let firstTotals;const fingerprints={};
  for(const [label,group] of groups){
    for(const access of ['owner','self']){
      const rawReport=group[access+'report'];assert.equal(rawReport.complete,true);assert.deepEqual(rawReport.missing.map(item=>item.requestId),[a]);
      assert.deepEqual(rawReport.missing[0].proposal,inside);assert.equal(rawReport.base.items.length,1);assert.equal(rawReport.base.items[0].startEventId,h.startEventId);
      const parsed=parseUnifiedSource(rawReport,uq(access));assert.equal(parsed.totals.missingSelected.workedUs,3600000000);
      if(firstTotals===undefined)firstTotals=parsed.totals;else assert.deepEqual(parsed.totals,firstTotals);
      assert.deepEqual(withoutObservation(rawReport),withoutObservation(groups.get('root1')[access+'report']));
      if(label==='root101')continue;
      const raw=group[access+'source'];assert.equal(raw.complete,true);assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
      assert.equal(digest(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
      assert(Buffer.byteLength(raw.sourceText,'utf8')<=1048576);assert(Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304);
      sizes.push({label,access,canonicalBytes:Buffer.byteLength(raw.sourceText,'utf8')});
      assert.deepEqual(raw.context.missing.map(item=>item.requestId),[a]);assert.equal(raw.context.missing[0].isCurrentApproved,true);assert.equal(raw.blockers.includes('pending_missing'),false);
      assert.deepEqual(withoutObservation(raw.report),withoutObservation(rawReport));
      const projected=projectPeriodClosureSource(raw,{...q,access,mode:'preview',periodId:null,operationId:null,version:null});
      assert.deepEqual(projected.artifact.report.totals,firstTotals);
    }
    if(label!=='root101'){
      assert.equal(group.ownersource.sourceFingerprint,group.selfsource.sourceFingerprint);assert.deepEqual(group.ownersource.sourceCanonical,group.selfsource.sourceCanonical);
      fingerprints[label]=group.ownersource.sourceFingerprint;
    }
  }
  assert.equal(fingerprints.root1,fingerprints.root100,'root_history_changed_semantic_source');assert.equal(successfulReads,10);
  const rejected=output.filter(row=>row.kind==='rejection');assert.deepEqual(rejected.map(row=>[row.access,row.error]),[['owner','attendance_period_source_too_large'],['self','attendance_period_source_too_large']]);
  for(let i=0;i<output.length;i++)if(output[i].kind==='rejection'){
    assert.equal(output[i-1].kind,'before_failure');assert.equal(output[i+1].kind,'after_failure');assert.equal(output[i-1].hash,output[i+1].hash,'root_capacity_failed_read_wrote_rows');
  }
  return {diagnosticOnly:true,readerVersion:'153',rootRows:[1,100,101],historicalChildren:[0,99,100],relatedCurrentParents:1,pendingChildren:0,
    successfulReads,expectedSourceRejections:2,canonicalFingerprints:fingerprints,sourceSizes:sizes,legacyReportsUnchanged:true,
    actual103Templates:{approvedParents:1,withdrawnChildren:1,rejectedChildren:1},actualMissingWriteCalls:6,actualMissingReviewReads:2,actualPolicyWriteCalls:1,syntheticWithdrawnChildCopies:98,
    allReadsAndFailuresZeroWrites:true,allFactsDefinitionsCatalogRestored:true,outerRollbackTransactions:1,readerFixed:false,
    syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'One owned rollback transaction. Actual103 A/B/C commands on synthetic past scope; 98 constrained copies of the withdrawn B request and both receipts create density. Root100 means parent1+historicalchildren99. No business reader modification, 100 actual employee submissions, real data, production capacity or deployment claim.'};
}
