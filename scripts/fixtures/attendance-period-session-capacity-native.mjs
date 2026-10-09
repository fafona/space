//180 diagnostic /181 accepted-capacity verification. No reader/writer
//replacement here; root installs between independent calls. Caller owns existing
//synthetic PG/schema. The added past events and unverified133 identity bindings
//are constrained append-only synthetic fixtures, NOT actual historical clocks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
function fingerprint(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') session_capacity_rows)';
}
const withoutObservation=raw=>{const result=structuredClone(raw);delete result.base.asOf;return result;};

export async function verifyPeriodSessionCapacityNative({d,native,scope,h,expected='152'}){
  assert(['152','153'].includes(expected),'session_capacity_expected_version');
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d?.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.timeZone,'UTC');
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
  const allHash=fingerprint(names),protectedHash=fingerprint(names.filter(name=>!['merchant_attendance_events','merchant_attendance_shift_rule_bindings'].includes(name)));
  const site=quote(d.site),worker=quote(h.workerId),employee=quote(h.employeeId),owner=quote(d.owner),auth=quote(h.employeeAuthUserId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const day=new Date(Date.parse(h.slot.workDate+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
  const narrow={fromDate:day,throughDate:day},wide={fromDate:h.slot.workDate,throughDate:day};
  const sourceQuery=(range,access)=>({siteId:d.site,access,workerId:h.workerId,...range});
  const reportQuery=(range,access)=>access==='owner'?{access,workerId:h.workerId,...range}:
    {access,workerId:null,locationId:null,expectedWorkerId:h.workerId,...range};
  const report=(range,access)=>`public.faolla_attendance_unified_report_v1(${site},${access==='owner'?owner:auth},${json(reportQuery(range,access))})`;
  const source=(range,access)=>`public.faolla_attendance_period_source_v1(${json(sourceQuery(range,access))},${access==='owner'?owner:auth})`;
  const initial=`do $session_capacity_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050152),'session_capacity_requires152';
    assert ${expected==='153'?'':'not '}exists(select 1 from public.faolla_schema_migrations where version=202610050153),'session_capacity_exact_reader_version';
    assert (select time_zone from public.merchant_attendance_settings where merchant_id=${site})='UTC','session_capacity_saved_utc_required';
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'session_capacity_before_period_creation';
    assert (select count(*) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker})=2,'session_capacity_exact_original_pair';
    assert exists(select 1 from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker} and id=${quote(h.startEventId)} and sequence=1 and action='clock_in')
      and exists(select 1 from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker} and id=${quote(h.lastEventId)} and sequence=2 and action='clock_out'
        and occurred_at<${quote(day+'T00:00:00.000000Z')}::timestamptz),'session_capacity_preceding_closed_before_period';
    assert not exists(select 1 from public.merchant_attendance_correction_effects where merchant_id=${site} and worker_id=${worker})
      and not exists(select 1 from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker}),'session_capacity_no_correction_or_missing';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'session_capacity_guards_enabled';
    assert ${quote(day+'T10:00:00.000000Z')}::timestamptz<clock_timestamp(),'session_capacity_ended_historical_day';
  end;$session_capacity_initial$;`;
  // Preserve all per-row checks/FKs/append-only guards. Sequence3 follows the
  //existing h clock-out; one-minute shifts are separated by one-minute gaps.
  const seed=(first,last)=>`do $session_capacity_seed$ declare i integer;a timestamptz;start_id uuid;op_id uuid;begin
    for i in ${first}..${last} loop
      a:=${quote(day+'T06:00:00.000000Z')}::timestamptz+(i-1)*interval '2 minutes';
      start_id:=('00000000-0000-4000-8000-'||lpad((180010000+i*2)::text,12,'0'))::uuid;
      op_id:=('00000000-0000-4000-8000-'||lpad((180020000+i*2)::text,12,'0'))::uuid;
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
      values(start_id,${site},${worker},${quote(h.slot.locationId)},op_id,i*2+1,'clock_in','web',null,a,a,'UTC',${employee}),
        (('00000000-0000-4000-8000-'||lpad((180010001+i*2)::text,12,'0'))::uuid,${site},${worker},${quote(h.slot.locationId)},
          ('00000000-0000-4000-8000-'||lpad((180020001+i*2)::text,12,'0'))::uuid,i*2+2,'clock_out','web',null,a+interval '1 minute',a+interval '1 minute','UTC',${employee});
      insert into public.merchant_attendance_shift_rule_bindings(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
        channel,request_auth_user_id,employee_id,employee_auth_user_id,worker_version,settings_version,status,reason,source_id,algorithm_version,binding_policy,recorded_at)
      values(${site},start_id,${worker},op_id,i*2+1,${quote(h.slot.locationId)},a,'UTC','self',${auth},${employee},${auth},
        (select version from public.merchant_attendance_workers where merchant_id=${site} and id=${worker}),
        (select version from public.merchant_attendance_settings where merchant_id=${site}),'unverified','source_unavailable',null,
        'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',a);
    end loop;end;$session_capacity_seed$;set constraints all immediate;`;
  const marker=kind=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${protectedHash});`;
  const bounds=range=>[quote(range.fromDate+'T00:00:00.000000Z')+'::timestamptz',quote(new Date(Date.parse(range.throughDate+'T00:00:00.000Z')+86400000).toISOString())+'::timestamptz'];
  // Independent simple closed-pair oracle, not a copied candidate CTE. No
  //corrections/missing/open records exist in this deliberately minimal dataset.
  const oracle=(label,range,count,preceding)=>{
    const [from,to]=bounds(range);
    return `do $session_capacity_oracle$ declare n integer;p integer;begin
      select count(*) into n from public.merchant_attendance_events start_event
        cross join lateral(select finish.occurred_at from public.merchant_attendance_events finish
          where finish.merchant_id=start_event.merchant_id and finish.worker_id=start_event.worker_id and finish.sequence>=start_event.sequence and finish.action='clock_out'
          order by finish.sequence limit 1) endpoint
        where start_event.merchant_id=${site} and start_event.worker_id=${worker} and start_event.action='clock_in'
          and start_event.occurred_at<${to} and endpoint.occurred_at>${from};
      select count(*) into p from public.merchant_attendance_events start_event
        where start_event.merchant_id=${site} and start_event.worker_id=${worker} and start_event.action='clock_in' and start_event.occurred_at<${from};
      assert n=${count} and p=${preceding},'session_capacity_exact_relevance_oracle';
    end;$session_capacity_oracle$;
    select jsonb_build_object('kind','oracle','label',${quote(label)},'relevant',${count},'preceding',${preceding});`;
  };
  const success=(label,range,count,preceding)=>oracle(label,range,count,preceding)+
    ['owner','self'].flatMap(access=>['report','source'].map(kind=>`${prefix}
      select jsonb_build_object('kind','before_read','hash',${allHash});set local role service_role;
      select jsonb_build_object('kind','read','label',${quote(label)},'range',${json(range)},'count',${count},
        'access',${quote(access)},'reader',${quote(kind)},'raw',${kind==='report'?report(range,access):source(range,access)});
      ${prefix}select jsonb_build_object('kind','after_read','hash',${allHash});`)).join('\n');
  const failure=(label,range,count,preceding)=>oracle(label,range,count,preceding)+
    ['owner','self'].flatMap(access=>['report','source'].map(kind=>{
      const expression=kind==='report'?report(range,access):source(range,access);
      return `${prefix}select jsonb_build_object('kind','before_failure','hash',${allHash});
      set local role service_role;do $session_capacity_reject$ begin
        begin perform ${expression};raise exception 'session_capacity_expected_failure_missing';
        exception when raise_exception then if sqlerrm<>'attendance_report_too_large' then raise;end if;end;
      end;$session_capacity_reject$;
      ${prefix}select jsonb_build_object('kind','rejection','label',${quote(label)},'access',${quote(access)},'reader',${quote(kind)},'error','attendance_report_too_large');
      select jsonb_build_object('kind','after_failure','hash',${allHash});`;
    })).join('\n');
  const batches=[];for(let first=1;first<=99;first+=10)batches.push(seed(first,Math.min(first+9,99)));
  const stages=['99_relevant_plus_closed_preceding','100_relevant_no_preceding','100_relevant_plus_closed_preceding','101_truly_relevant'];
  if(expected==='153')stages.push('101_relevant_plus_closed_preceding');
  const steps=['begin;'+prefix+initial+marker('protected_before'),...batches.map(sql=>prefix+sql),
    prefix+success(stages[0],narrow,99,1),prefix+success(stages[1],wide,100,0),prefix+seed(100,100),
    prefix+(expected==='153'?success(stages[2],narrow,100,1):failure(stages[2],narrow,100,1)),prefix+failure(stages[3],wide,101,0),
    ...(expected==='153'?[prefix+seed(101,101),prefix+failure(stages[4],narrow,101,1)]:[]),
    marker('protected_after')+'set constraints all immediate;rollback;'];
  assert(steps.length<=24,'session_capacity_bounded_steps');let output;
  try{output=lines(await native.querySteps(steps.map(sql=>scope.sql(sql))));}
  catch(error){throw new Error('period_session_capacity_failed:'+expected+':'+String(error?.message??error),{cause:error});}
  finally{
    assert.equal(d.fingerprint(),baseline,'session_capacity_rollback');assert.equal(d.definitions(),definitions,'session_capacity_definitions');
    assert.equal(d.tableCatalog(),catalog,'session_capacity_catalog');
  }
  assert.equal(output[0].kind,'protected_before');assert.equal(output.at(-1).kind,'protected_after');
  assert.equal(output[0].hash,output.at(-1).hash,'session_capacity_protected_old_facts');
  const expectedOracles=[[stages[0],99,1],[stages[1],100,0],[stages[2],100,1],[stages[3],101,0]];
  if(expected==='153')expectedOracles.push([stages[4],101,1]);
  assert.deepEqual(output.filter(row=>row.kind==='oracle').map(row=>[row.label,row.relevant,row.preceding]),expectedOracles);
  let positiveReads=0;const sizes=[],groups=new Map(),canonicalFingerprints={};
  for(let i=0;i<output.length;i++)if(output[i].kind==='read'){
    const row=output[i];
    assert.equal(output[i-1].kind,'before_read');assert.equal(output[i+1].kind,'after_read');assert.equal(output[i-1].hash,output[i+1].hash,'session_capacity_successful_read_wrote_rows');
    if(!groups.has(row.label))groups.set(row.label,{label:row.label,range:row.range,count:row.count});
    const group=groups.get(row.label),key=row.access+(row.reader==='report'?'Report':'Source');
    assert.equal(group[key],undefined,'session_capacity_duplicate_read');group[key]=row.raw;positiveReads++;
  }
  assert.equal(groups.size,expected==='153'?3:2);
  for(const row of groups.values()){
    const {count,range}=row;
    const projections=[];
    for(const access of ['owner','self']){
      const direct=row[access+'Report'],raw=row[access+'Source'];
      assert.equal(direct.complete,true);assert.equal(direct.base.items.length,count);assert.deepEqual(direct.missing,[]);
      assert.deepEqual(withoutObservation(raw.report),withoutObservation(direct));assert.equal(raw.complete,true);
      assert.equal(raw.context.plans.sessions.length,count);assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
      assert.equal(hash(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
      const bytes=Buffer.byteLength(raw.sourceText,'utf8'),rawBytes=Buffer.byteLength(JSON.stringify(raw),'utf8');
      assert(bytes<=1048576);assert(rawBytes<=4194304);sizes.push({stage:row.label,access,canonicalBytes:bytes,rawBytes});
      const projected=projectPeriodClosureSource(raw,{...sourceQuery(range,access),mode:'preview',periodId:null,operationId:null,version:null});
      projections.push(projected);assert.equal(projected.artifact.report.base.rows.length,count);
      // All newly seeded rows have no claimed rule verification or adoption.
      for(const session of raw.context.plans.sessions.filter(s=>s.item.startEventId!==h.startEventId)){
        assert.equal(session.ruleBinding.status,'unverified');assert.equal(session.ruleBinding.reason,'source_unavailable');
        assert.equal(session.relation,null);assert.equal(session.adoption,null);assert.equal(session.planRuleApproval,null);
      }
    }
    assert.equal(row.ownerSource.sourceFingerprint,row.selfSource.sourceFingerprint);assert.deepEqual(row.ownerSource.sourceCanonical,row.selfSource.sourceCanonical);
    assert.deepEqual(projections[0].artifact.report.totals,projections[1].artifact.report.totals);
    const includesPrior=range.fromDate===h.slot.workDate,seededCount=count-(includesPrior?1:0);
    const expectedIds=Array.from({length:seededCount},(_,j)=>id(180010000+(j+1)*2));
    if(includesPrior)expectedIds.push(h.startEventId);
    assert.deepEqual(row.ownerReport.base.items.map(item=>item.startEventId).sort(),expectedIds.sort());
    const prior=row.ownerReport.base.items.find(item=>item.startEventId===h.startEventId);
    assert.equal(prior!==undefined,includesPrior);
    if(prior)assert.equal(prior.events.length,2);
    const expectedUs=seededCount*60000000+(prior?(Date.parse(prior.events[1].occurredAt)-Date.parse(prior.events[0].occurredAt))*1000:0);
    for(const projected of projections){
      assert.equal(projected.artifact.report.totals.original.workedUs,expectedUs);
      assert.equal(projected.artifact.report.totals.selected.workedUs,expectedUs);
      assert.equal(projected.artifact.report.totals.selected.breakUs,0);
    }
    canonicalFingerprints[row.label]=row.ownerSource.sourceFingerprint;
  }
  const rejected=output.filter(row=>row.kind==='rejection');assert.equal(rejected.length,8);
  for(let i=0;i<output.length;i++)if(output[i].kind==='rejection'){
    assert.equal(output[i-1].kind,'before_failure');assert.equal(output[i+1].kind,'after_failure');
    assert.equal(output[i-1].hash,output[i+1].hash,'session_capacity_failed_read_wrote_rows');
  }
  const failedStages=expected==='153'?[stages[3],stages[4]]:[stages[2],stages[3]];
  for(const label of failedStages)assert.deepEqual(rejected.filter(row=>row.label===label).map(row=>[row.access,row.reader,row.error]),
    [['owner','report','attendance_report_too_large'],['owner','source','attendance_report_too_large'],['self','report','attendance_report_too_large'],['self','source','attendance_report_too_large']]);
  assert.equal(positiveReads,expected==='153'?12:8);
  return {version:expected,diagnosticOnly:expected==='152',stages,outerRollbackTransactions:1,positiveReads,expectedRejectedReads:rejected.length,
    sourceSizes:sizes,canonicalFingerprints,old093OmissionReproduced:expected==='152',readFailureCode:'attendance_report_too_large',readerFixed:expected==='153',
    syntheticAdditionalEvents:expected==='153'?202:200,syntheticUnverifiedBindings:expected==='153'?101:100,actualClockRpcs:0,
    ownerSelfCanonicalEqual:true,allReadsAndFailuresZeroWrites:true,allFactsDefinitionsCatalogRestored:true,
    protectedOldTablesUnchanged:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Four152 or five153 stages in ONE guarded outer rollback transaction per invocation. Root alone installs the reader migration between calls. Constrained synthetic past event pairs and unverified133 identity metadata, not actual clock commands. No rule verification, new authorization, real account, performance or deployment claim.'};
}
