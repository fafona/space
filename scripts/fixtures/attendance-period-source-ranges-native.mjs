//178 inert, caller-owned synthetic rollback probes. Dense rows are constrained
//copies of real-RPC templates, NOT evidence of 101 actual user submissions.
//No process, database, timeout, trigger, old function or permanent data changes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
const stamp=value=>new Date(value).toISOString().replace(/Z$/,'000Z');
const shift=(value,ms)=>stamp(Date.parse(value)+ms);
const perform=expression=>`do $range_rpc$ begin perform ${expression};end;$range_rpc$;`;
const fid=n=>id(178000000+n);
const sqlId=expression=>`('00000000-0000-4000-8000-'||lpad((178000000+${expression})::text,12,'0'))::uuid`;
function fingerprint(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') source_range_rows)';
}
const parseLines=output=>output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
function planSummary(raw){
  const nodes=[];const visit=n=>{if(!n||typeof n!=='object')return;nodes.push({type:n['Node Type'],index:n['Index Name']??null});for(const p of n.Plans??[])visit(p);};
  for(const entry of raw)visit(entry.Plan);return nodes;
}

export async function verifyPeriodSourceRangesNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.timeZone,'UTC');
  const q={siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId),employee=quote(h.employeeId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const source=access=>`public.faolla_attendance_period_source_v1(${json({...q,access})},${access==='owner'?owner:auth})`;
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),allHash=fingerprint(names);
  const checks=[],plans=[];let reads=0;
  const correctionTables=['merchant_enterprise_roles','merchant_attendance_events','merchant_attendance_correction_controls',
    'merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings','merchant_attendance_correction_decisions',
    'merchant_attendance_correction_effects','merchant_attendance_revision_requests','merchant_attendance_revision_decisions','merchant_attendance_effect_versions'];
  const leaveTables=['merchant_enterprise_roles','merchant_attendance_leave_requests','merchant_attendance_leave_entries'];
  const calendarTables=['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations'];
  const entryGuard=`do $range_initial$ begin
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'range_probe_before_period_creation';
    assert not exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=${site} and worker_id=${worker}),'range_probe_empty_correction_history';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'range_probe_triggers_enabled';
    assert exists(select 1 from pg_index where indexrelid='public.attendance_correction_proposal_period_idx'::regclass and indisvalid and indisready),'range_correction_index_ready';
    assert exists(select 1 from pg_index where indexrelid='public.attendance_revision_proposal_period_idx'::regclass and indisvalid and indisready),'range_revision_index_ready';
  end;$range_initial$;`;
  const read=label=>`${prefix}select jsonb_build_object('kind','before_read','label',${quote(label)},'hash',${allHash});
    set local role service_role;select jsonb_build_object('kind','source','label',${quote(label)},'owner',${source('owner')},'self',${source('self')});
    ${prefix}select jsonb_build_object('kind','after_read','label',${quote(label)},'hash',${allHash});`;
  const reject=(label,code)=>`${prefix}do $range_reject$ declare before_hash text;begin
    before_hash:=${allHash};begin perform ${source('owner')};raise exception 'range_expected_rejection_missing';
    exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    assert ${allHash}=before_hash,'range_failed_read_wrote_rows';end;$range_reject$;
    select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`;
  const run=async(label,steps,writes,verify)=>{
    for(const t of writes)assert(names.includes(t));const protectedHash=fingerprint(names.filter(t=>!writes.includes(t)));
    const mark=kind=>`${prefix}select jsonb_build_object('kind',${quote(kind)},'hash',${protectedHash});`;
    const statements=['begin;'+prefix+entryGuard+mark('protected_before'),...steps.map(step=>prefix+step),mark('protected_after')+'rollback;'];
    assert(statements.length<=80,'range_bounded_statement_count');let rows;
    try{rows=parseLines(await native.querySteps(statements.map(step=>scope.sql(step))));}
    catch(error){throw new Error('period_source_ranges_failed:'+label+':'+String(error?.message??error),{cause:error});}
    finally{assert.equal(d.fingerprint(),baseline,label+':rollback');assert.equal(d.definitions(),definitions,label+':definitions');assert.equal(d.tableCatalog(),catalog,label+':catalog');}
    assert.equal(rows[0].hash,rows.at(-1).hash,label+':protected_rows_changed');
    const sources=[];
    for(let i=1;i<rows.length-1;i++)if(rows[i].kind==='source'){
      const {owner:a,self:b}=rows[i];assert.equal(rows[i-1].kind,'before_read');assert.equal(rows[i+1].kind,'after_read');
      assert.equal(rows[i-1].hash,rows[i+1].hash,label+':read_mutation');
      for(const raw of [a,b]){assert.equal(raw.sourceVersion,'attendance-period-source-v1');assert.equal(raw.complete,true);
        assert.equal(raw.workerId,h.workerId);assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
        assert.equal(digest(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
        assert(Buffer.byteLength(raw.sourceText,'utf8')<=1048576);assert(Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304);}
      assert.equal(a.sourceFingerprint,b.sourceFingerprint,label+':owner_self_hash');assert.deepEqual(a.sourceCanonical,b.sourceCanonical);
      reads+=2;sources.push({label:rows[i].label,raw:a});
    }
    for(const row of rows.filter(row=>row.kind==='plans')){
      const forced=planSummary(row.forced);
      plans.push({index:row.index,dataset:'dense_unrelated_withdrawn_history',query:'actual_151_moved_arm',
        natural:planSummary(row.natural),forced,forcedSelectedNewIndex:forced.some(node=>node.index===row.index),
        fixtureStatisticsNotRefreshed:true,productionPerformanceProven:false});
    }
    verify(sources,rows);checks.push(label);
  };
  const batches=(count,build)=>{const out=[];for(let first=1;first<=count;first+=10)out.push(build(first,Math.min(count,first+9)));return out;};
  const permission=`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.leave']) p order by p)
    where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
  const settings=`(select version from public.merchant_attendance_settings where merchant_id=${site})`;
  const policy=fid(1),aRequest=fid(2),aWithdraw=fid(3),bRequest=fid(4),bApprove=fid(5),revisionRequest=fid(6),revisionWithdraw=fid(7);
  const policyRevision=`(select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})`;
  const policyStep=perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},jsonb_build_object('action','set_policy',
    'operationId',${quote(policy)},'expectedRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}),
    'expectedSettingsVersion',${settings},'reason','Synthetic178 range probe policy','submissionWindowDays',365),null,null,true)`);
  // New pairs lie the day AFTER q, but before real now. They have no historical
  //auth sidecar, and must not be pulled into this earlier period by noisy requests.
  const outsideStart=shift(h.slot.startAt,86400000),outsideEnd=shift(h.slot.startAt,86400000+60000);
  const proposal=(start,end)=>({startAt:start,endAt:end,breaks:[]});
  const inside=proposal(stamp(h.slot.startAt),shift(h.slot.startAt,60000)),outside=proposal(outsideStart,outsideEnd);
  const eventPairs=(first,last)=>`do $range_events$ declare i integer;seq bigint;a timestamptz;begin
    select coalesce(max(sequence),0) into seq from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker};
    for i in ${first}..${last} loop a:=${quote(outsideStart)}::timestamptz+(i-1)*interval '2 minutes';
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
      values(${sqlId('10000+i*2')},${site},${worker},${quote(h.slot.locationId)},${sqlId('20000+i*2')},seq+1,'clock_in','web',null,a,a,'UTC',${employee}),
      (${sqlId('10001+i*2')},${site},${worker},${quote(h.slot.locationId)},${sqlId('20001+i*2')},seq+2,'clock_out','web',null,a+interval '1 minute',a+interval '1 minute','UTC',${employee});seq:=seq+2;
    end loop;end;$range_events$;`;
  const cQuery=requestId=>json({mode:'detail',expectedWorkerId:h.workerId,requestId,operationId:null});
  const submit=(requestId,startId,endId,p,revision=0)=>perform(`public.faolla_attendance_correction_self_v3(${site},${auth},${cQuery(requestId)},
    ${json({action:'submit',operationId:requestId,expectedRevision:revision,reason:'Synthetic178 correction range',startEventId:startId,expectedLastEventId:endId,proposal:p})}
    ||jsonb_build_object('expectedPolicyRevision',${policyRevision}),true)`);
  const withdraw=(requestId,operationId,revision)=>perform(`public.faolla_attendance_correction_self_v3(${site},${auth},${cQuery(requestId)},
    ${json({action:'withdraw',operationId,requestId,expectedRevision:revision,reason:'Synthetic178 withdrawal'})},true)`);
  const decide=(requestId,operationId,action='approve')=>`do $range_decide$ declare r jsonb;begin
    r:=public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},null,null,true);
    assert (r->>${quote(action==='approve'?'canApprove':'canReject')})::boolean,'range_template_decision_eligible';
    perform public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},jsonb_build_object('action',${quote(action)},
      'operationId',${quote(operationId)},'requestId',${quote(requestId)},'expectedRevision',(r->'review'->'item'->>'revision')::bigint,
      'expectedEvidence',r->>'evidenceToken','reason','Synthetic178 decision'),null,true);end;$range_decide$;`;
  const aStart=fid(10002),aEnd=fid(10003),bStart=fid(10004),bEnd=fid(10005);
  const outside2=proposal(shift(outsideStart,120000),shift(outsideEnd,120000));
  const revisionOutside=proposal(outside2.startAt,shift(outside2.endAt,-1000));
  const cTemplate=[permission,policyStep,eventPairs(1,2),submit(aRequest,aStart,aEnd,outside),withdraw(aRequest,aWithdraw,1),submit(bRequest,bStart,bEnd,outside2),decide(bRequest,bApprove)];
  const revQuery=(mode,requestId=null)=>json({mode,expectedWorkerId:h.workerId,baseRequestId:bRequest,requestId,operationId:null});
  const rTemplate=`do $range_revision$ declare r jsonb;c jsonb;begin
    r:=public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('prepare')},null,true);
    c:=jsonb_build_object('action','submit','operationId',${quote(revisionRequest)},'expectedRevision',(r->>'revision')::bigint,
      'expectedBaseOperationId',${quote(bApprove)},'expectedEffectiveOperationId',r->'current'->>'operationId','expectedPolicyRevision',${policyRevision},
      'reason','Synthetic178 revision range','proposal',${json(revisionOutside)});
    r:=public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',revisionRequest)},c,true);
    perform public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',revisionRequest)},jsonb_build_object('action','withdraw',
      'operationId',${quote(revisionWithdraw)},'requestId',${quote(revisionRequest)},'expectedRevision',(r->>'revision')::bigint,'reason','Synthetic178 revision withdrawal'),true);
  end;$range_revision$;`;
  const copyHistory=(kind,first,last)=>{
    const revision=kind==='revision',table=revision?'merchant_attendance_revision_requests':'merchant_attendance_correction_entries';
    const submitId=revision?revisionRequest:aRequest,withdrawId=revision?revisionWithdraw:aWithdraw,base=revision?3000:1000;
    return `do $range_history$ declare i integer;s public.${table}%rowtype;w public.${table}%rowtype;begin
      for i in ${first}..${last} loop
        select * into s from public.${table} where merchant_id=${site} and operation_id=${quote(submitId)};
        select * into w from public.${table} where merchant_id=${site} and operation_id=${quote(withdrawId)};
        s.request_id:=${sqlId(base+'+i*2')};s.operation_id:=s.request_id;s.revision:=i*2+1;
        s.command:=s.command||jsonb_build_object('operationId',s.operation_id,'expectedRevision',s.revision-1);
        s.recorded_at:=clock_timestamp();insert into public.${table} select (s).*;
        w.request_id:=s.request_id;w.operation_id:=${sqlId(base+'+i*2+1')};w.revision:=s.revision+1;
        w.command:=w.command||jsonb_build_object('operationId',w.operation_id,'requestId',w.request_id,'expectedRevision',w.revision-1);
        w.recorded_at:=clock_timestamp();insert into public.${table} select (w).*;
      end loop;end;$range_history$;`;
  };
  const leaveQuery={siteId:d.site,access:'self',requestId:null,operationId:null,beforeAt:null,beforeId:null};
  const calendarQuery={siteId:d.site,locationId:null,fromDate:null,throughDate:null,entryId:null,operationId:null,beforeAt:null,beforeId:null};
  const leaveTemplate=(start,end)=>perform(`public.faolla_attendance_leave_v1(${json(leaveQuery)},${auth},${json({operationId:fid(20),action:'submit',reason:'Synthetic178 range leave',expectedWorkerId:h.workerId,expectedSettingsVersion:1,timeZone:'UTC',startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString()})}||jsonb_build_object('expectedSettingsVersion',${settings}),true)`);
  const calendarTemplate=(from,through)=>perform(`public.faolla_attendance_calendar_v1(${json(calendarQuery)},${owner},${json({operationId:fid(21),action:'create',reason:'Synthetic178 range calendar',kind:'closure',title:'Synthetic range closure',fromDate:from,throughDate:through,expectedSettingsVersion:1,locationId:null,expectedLocationVersion:null,timeZone:'UTC'})}||jsonb_build_object('expectedSettingsVersion',${settings}),true)`);
  const copyContext=(kind,first,last)=>{
    const leave=kind==='leave',table=leave?'merchant_attendance_leave_requests':'merchant_attendance_calendar_entries',ops=leave?'merchant_attendance_leave_entries':'merchant_attendance_calendar_operations';
    const pk=leave?'request_id':'entry_id',key=leave?'requestId':'entryId',template=fid(leave?20:21),base=leave?5000:6000;
    return `do $range_context_copy$ declare i integer;r public.${table}%rowtype;e public.${ops}%rowtype;begin
      for i in ${first}..${last} loop
        select * into r from public.${table} where merchant_id=${site} and ${pk}=${quote(template)};
        select * into e from public.${ops} where merchant_id=${site} and operation_id=${quote(template)};
        r.${pk}:=${sqlId(base+'+i')};e.${pk}:=r.${pk};e.operation_id:=r.${pk};
        e.command:=e.command||jsonb_build_object('operationId',e.operation_id);e.snapshot:=e.snapshot||jsonb_build_object(${quote(key)},r.${pk});
        insert into public.${table} select (r).*;insert into public.${ops} select (e).*;
        perform public.faolla_attendance_${leave?'leave':'calendar'}_summary_v1(r);
      end loop;end;$range_context_copy$;`;
  };
  const dayBefore=shift(h.slot.startAt,-86400000).slice(0,10);
  // Real151 moved-arm predicates, including latest-head/decision elimination
  //and ORDER BY request_id. Capture while dense synthetic rows still exist.
  //No artificial expression ORDER BY and no claim that force-selected==natural.
  const from=h.slot.workDate+'T00:00:00.000000Z',to=shift(from,86400000);
  const explainSteps=[
    ['merchant_attendance_correction_entries',"x.proposal->>'startAt'",'attendance_correction_proposal_period_idx',
      'newer.worker_id=x.worker_id and newer.start_event_id=x.start_event_id','merchant_attendance_correction_decisions'],
    ['merchant_attendance_revision_requests',"x.command->'proposal'->>'startAt'",'attendance_revision_proposal_period_idx',
      'newer.base_request_id=x.base_request_id','merchant_attendance_revision_decisions'],
  ].map(([table,expression,index,stream,decisions])=>{
    const query=`select x.request_id from public.${table} x where x.merchant_id=${site} and x.worker_id=${worker} and x.action='submit'
      and public.faolla_attendance_instant_v1(${expression})>=${quote(shift(from,-31*86400000))}::timestamptz
      and public.faolla_attendance_instant_v1(${expression})<${quote(to)}::timestamptz
      and public.faolla_attendance_instant_v1(${expression.replace('startAt','endAt')})>${quote(from)}::timestamptz
      and not exists(select 1 from public.${table} newer where newer.merchant_id=x.merchant_id and ${stream} and newer.revision>x.revision)
      and not exists(select 1 from public.${decisions} decided where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
      order by x.request_id limit 101`;
    return `do $range_explain$ declare natural_plan jsonb;forced_plan jsonb;prior_setting text:=current_setting('enable_seqscan');begin
      execute ${quote('explain(format json) '+query)} into natural_plan;
      perform set_config('enable_seqscan','off',true);
      execute ${quote('explain(format json) '+query)} into forced_plan;
      perform set_config('enable_seqscan',prior_setting,true);
      perform set_config('faolla.range_plan',jsonb_build_object('kind','plans','index',${quote(index)},'natural',natural_plan,'forced',forced_plan)::text,true);
    end;$range_explain$;select current_setting('faolla.range_plan')::jsonb;`;
  });
  await run('unrelated_coarse_window_history',[
    read('baseline'),...cTemplate,rTemplate,
    ...batches(100,(a,b)=>copyHistory('correction',a,b)),...batches(100,(a,b)=>copyHistory('revision',a,b)),
    leaveTemplate(shift(h.slot.startAt,-86400000),shift(h.slot.endAt,-86400000)),calendarTemplate(dayBefore,dayBefore),
    ...batches(100,(a,b)=>copyContext('leave',a,b)),...batches(100,(a,b)=>copyContext('calendar',a,b)),
    `do $range_dense_counts$ begin
      assert (select count(*) from public.merchant_attendance_correction_entries where merchant_id=${site} and worker_id=${worker} and action='submit')=102;
      assert (select count(*) from public.merchant_attendance_revision_requests where merchant_id=${site} and worker_id=${worker} and action='submit')=101;
      assert (select count(*) from public.merchant_attendance_leave_requests where merchant_id=${site} and worker_id=${worker} and (request_id=${quote(fid(20))} or request_id between ${quote(fid(5001))} and ${quote(fid(5100))}))=101;
      assert (select count(*) from public.merchant_attendance_calendar_entries where merchant_id=${site} and (entry_id=${quote(fid(21))} or entry_id between ${quote(fid(6001))} and ${quote(fid(6100))}))=101;
    end;$range_dense_counts$;`,read('dense_excluded'),...explainSteps,
  ],[...new Set([...correctionTables,...leaveTables,...calendarTables])],rows=>{
    assert.equal(rows.length,2);assert.equal(rows[0].raw.sourceFingerprint,rows[1].raw.sourceFingerprint);
    assert.equal(rows[1].raw.context.pendingCorrections.length,0);assert.equal(rows[1].raw.context.leave.length,0);assert.equal(rows[1].raw.context.calendar.length,0);
  });

  // Same in-period original, >100 superseded declarations. Latest withdrawal
  //and latest decision remove pending; an old submit is never independently live.
  await run('latest_head_and_moved_proposal',[
    permission,policyStep,eventPairs(1,2),submit(aRequest,h.startEventId,h.lastEventId,inside),withdraw(aRequest,aWithdraw,1),
    ...batches(100,(a,b)=>copyHistory('correction',a,b)),read('all_withdrawn'),
    submit(fid(30),h.startEventId,h.lastEventId,outside,202),read('original_inside_proposal_outside'),withdraw(fid(30),fid(31),203),
    submit(fid(32),aStart,aEnd,inside),read('original_outside_proposal_inside'),withdraw(fid(32),fid(33),1),read('withdrawn_moved_in'),
    submit(fid(34),h.startEventId,h.lastEventId,inside,204),decide(fid(34),fid(35),'reject'),read('latest_decision'),
  ],correctionTables,rows=>{
    const count=rows.map(x=>x.raw.context.pendingCorrections.length);assert.deepEqual(count,[0,1,1,0,0]);
    assert.equal(rows[1].raw.context.pendingCorrections[0].requestId,fid(30));assert.equal(rows[2].raw.context.pendingCorrections[0].requestId,fid(32));
    assert(rows[1].raw.blockers.includes('pending_correction'));assert(rows[2].raw.blockers.includes('pending_correction'));
    assert.equal(rows[0].raw.sourceFingerprint,rows[3].raw.sourceFingerprint);assert.equal(rows[0].raw.sourceFingerprint,rows[4].raw.sourceFingerprint);
  });

  const revisionSubmit=(op,p)=>`do $range_latest_revision$ declare r jsonb;c jsonb;begin
    r:=public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('prepare')},null,true);
    c:=jsonb_build_object('action','submit','operationId',${quote(op)},'expectedRevision',(r->>'revision')::bigint,
      'expectedBaseOperationId',${quote(bApprove)},'expectedEffectiveOperationId',r->'current'->>'operationId','expectedPolicyRevision',${policyRevision},
      'reason','Synthetic178 latest revision','proposal',${json(p)});
    perform public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',op)},c,true);
  end;$range_latest_revision$;`;
  const revisionWithdrawStep=(requestId,op)=>`do $range_latest_withdraw$ declare r jsonb;begin
    r:=public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',requestId)},null,true);
    perform public.faolla_attendance_revision_self_v2(${site},${auth},${revQuery('detail',requestId)},jsonb_build_object('action','withdraw',
      'operationId',${quote(op)},'requestId',${quote(requestId)},'expectedRevision',(r->>'revision')::bigint,'reason','Synthetic178 latest withdrawal'),true);
  end;$range_latest_withdraw$;`;
  const revisionReject=(requestId,op)=>`do $range_revision_reject$ declare r jsonb;begin
    r:=public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(requestId)},null,null,true);
    assert r->'canReject'='true'::jsonb,'range_revision_otherwise_rejectable';
    perform public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(requestId)},jsonb_build_object('action','reject',
      'operationId',${quote(op)},'requestId',${quote(requestId)},'expectedRevision',(r->'review'->>'submittedRevision')::bigint,
      'expectedEvidence',r->>'evidenceToken','expectedBaseOperationId',r->'current'->>'operationId','reason','Synthetic178 latest decision'),null,true);
  end;$range_revision_reject$;`;
  await run('in_period_revision_latest_head',[
    permission,policyStep,submit(bRequest,h.startEventId,h.lastEventId,inside),decide(bRequest,bApprove),rTemplate,
    ...batches(100,(a,b)=>copyHistory('revision',a,b)),read('revisions_all_withdrawn'),
    revisionSubmit(fid(40),outside),read('revision_original_inside_proposal_outside'),revisionWithdrawStep(fid(40),fid(41)),read('revision_latest_withdrawal'),
    revisionSubmit(fid(42),proposal(inside.startAt,shift(inside.endAt,-1000))),revisionReject(fid(42),fid(43)),read('revision_latest_decision'),
  ],correctionTables,rows=>{
    assert.deepEqual(rows.map(x=>x.raw.context.pendingCorrections.length),[0,1,0,0]);
    assert.equal(rows[1].raw.context.pendingCorrections[0].kind,'revision');assert.equal(rows[1].raw.context.pendingCorrections[0].requestId,fid(40));
    assert.equal(rows[0].raw.sourceFingerprint,rows[2].raw.sourceFingerprint);assert.equal(rows[0].raw.sourceFingerprint,rows[3].raw.sourceFingerprint);
  });

  // One template per independent synthetic stream; unique raw pairs and the
  //actual basis helper keep source identities/endpoints valid. Proposals move in.
  const denseCorrections=(first,last,wrongAuth=false)=>`do $range_pending_copy$ declare i integer;r public.merchant_attendance_correction_entries%rowtype;begin
    for i in ${first}..${last} loop
      select * into r from public.merchant_attendance_correction_entries where merchant_id=${site} and operation_id=${quote(aRequest)};
      r.start_event_id:=${sqlId('10000+i*2')};r.operation_id:=${sqlId('7000+i')};r.request_id:=r.operation_id;r.revision:=1;
      r.basis:=public.faolla_attendance_correction_basis_v1(${site},${auth},r.start_event_id,${worker},${employee});
      r.proposal:=${json(inside)};r.recorded_at:=clock_timestamp();${wrongAuth?'r.actor_auth_user_id:='+quote(fid(99999))+';':''}
      r.command:=r.command||jsonb_build_object('operationId',r.operation_id,'expectedRevision',0,'startEventId',r.start_event_id,
        'expectedLastEventId',${sqlId('10001+i*2')},'proposal',r.proposal);
      insert into public.merchant_attendance_correction_entries select (r).*;
    end loop;end;$range_pending_copy$;`;
  // Template pair1 is withdrawn; 100 independent pending streams use pair2..101.
  await run('pending_exact_100_101',[
    permission,policyStep,...batches(102,eventPairs),submit(aRequest,aStart,aEnd,outside),withdraw(aRequest,aWithdraw,1),
    ...batches(100,(a,b)=>denseCorrections(a+1,b+1)),read('pending_100'),denseCorrections(102,102),
    reject('pending_101','attendance_period_source_too_large'),
  ],correctionTables,rows=>{assert.equal(rows.length,1);assert.equal(rows[0].raw.context.pendingCorrections.length,100);assert(rows[0].raw.blockers.includes('pending_correction'));});
  await run('pending_historical_identity',[
    permission,policyStep,eventPairs(1,2),submit(aRequest,aStart,aEnd,outside),withdraw(aRequest,aWithdraw,1),denseCorrections(2,2,true),
    reject('old_actor','attendance_period_source_identity_changed'),
  ],correctionTables,rows=>assert.equal(rows.length,0));
  for(const kind of ['leave','calendar'])await run(kind+'_exact_100_101',[
    ...(kind==='leave'?[permission,leaveTemplate(h.slot.startAt,h.slot.endAt)]:[calendarTemplate(h.slot.workDate,h.slot.workDate)]),
    ...batches(99,(a,b)=>copyContext(kind,a,b)),read(kind+'_100'),copyContext(kind,100,100),reject(kind+'_101','attendance_period_source_too_large'),
  ],kind==='leave'?leaveTables:calendarTables,rows=>{assert.equal(rows.length,1);assert.equal(rows[0].raw.context[kind].length,100);});

  assert.equal(plans.length,2,'range_both_actual_moved_arm_plans_required');
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  return {checks,scenarios:checks.length,sourceReads:reads,plans,denseUnrelated:{corrections:102,revisions:101,leave:101,calendar:101},
    exact100And101:['pending_corrections','leave','calendar'],allRollbackFingerprintsUnchanged:true,readFingerprintsUnchanged:true,
    definitionsAndCatalogUnchanged:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Real SQL reads and small actual-RPC templates; dense history and candidate counts are synthetic append-only copies with live constraints/triggers. No claim of 101 actual user operations or production EXPLAIN performance. Every seed is rolled back; original raw clock/publication history remains synthetic.'};
}
