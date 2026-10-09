//179 inert, caller-owned rollback proof. The main A/B scenarios use actual103
//commands over the expressly synthetic174 history. Dense/identity probes copy
//constrained templates; they are NOT claims of 100 real employee submissions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const fid=n=>id(179000000+n);
const stamp=value=>new Date(value).toISOString().replace(/Z$/,'000Z');
const offset=(value,minutes)=>stamp(Date.parse(value)+minutes*60000);
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const perform=expression=>`do $missing_rpc$ begin perform ${expression};end;$missing_rpc$;`;
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
function hashSql(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') missing_probe_rows)';
}

// Call once with151, install152 in the ROOT driver, then call with152. Each call
// restores its own current facts/functions/catalog baseline. No migration runs
// inside this helper and no transaction spans the two versions.
export async function verifyPeriodMissingContextNative({d,native,scope,h,expected}){
  assert(['151','152'].includes(expected),'missing_probe_explicit_version_required');
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof native?.connect,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.timeZone,'UTC');
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const q={siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const pq=(access='owner',periodId=null)=>({...q,access,mode:periodId?'detail':'preview',periodId,operationId:null,version:null});
  const site=quote(d.site),worker=quote(h.workerId),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),employee=quote(h.employeeId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const names=d.inventory(),allHash=hashSql(names),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const writable=['merchant_enterprise_roles','merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries'];
  const periodTables=['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'];
  const source=access=>`public.faolla_attendance_period_source_v1(${json({...q,access})},${access==='owner'?owner:auth})`;
  const legacy=`public.faolla_attendance_unified_report_v1(${site},${owner},${json({access:'owner',workerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate})})`;
  const initial=`do $missing_initial$ begin
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'missing_probe_before_period_creation';
    assert not exists(select 1 from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker}),'missing_probe_empty_missing_history';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'missing_probe_enabled_guards';
    assert exists(select 1 from public.faolla_schema_migrations where version=202610050151),'missing_probe_151_installed';
    assert ${expected==='152'?'':'not '}exists(select 1 from public.faolla_schema_migrations where version=202610050152),'missing_probe_version_exact';
  end;$missing_initial$;`;
  const permission=`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
    where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
  const settings=`(select version from public.merchant_attendance_settings where merchant_id=${site})`;
  const policy=fid(1),a=fid(2),aa=fid(3),b=fid(4),bt=fid(5),c=fid(6),ct=fid(7),t=fid(8),tt=fid(9);
  const policyRevision=`(select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})`;
  const policyStep=perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},jsonb_build_object('action','set_policy',
    'operationId',${quote(policy)},'expectedRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}),
    'expectedSettingsVersion',${settings},'reason','Synthetic179 missing context policy','submissionWindowDays',365),null,null,true)`);
  const proposal=(startAt,endAt)=>({startAt,endAt,breaks:[]});
  const inside=proposal(offset(h.slot.startAt,-120),offset(h.slot.startAt,-60));
  const outside=proposal(offset(h.slot.startAt,1320),offset(h.slot.startAt,1380));
  const anotherOutside=proposal(offset(h.slot.startAt,1440),offset(h.slot.startAt,1500));
  const templateInside=proposal(offset(h.slot.startAt,-240),offset(h.slot.startAt,-180));
  assert.equal(inside.startAt.slice(0,10),q.fromDate);assert.notEqual(outside.startAt.slice(0,10),q.fromDate);
  const mq=(access,requestId=null)=>({siteId:d.site,access,fromDate:q.fromDate,
    throughDate:new Date(Date.parse(q.fromDate)+86400000).toISOString().slice(0,10),requestId,operationId:null,beforeAt:null,beforeId:null});
  const call=(access,requestId,command)=>`public.faolla_attendance_missing_v1(${json(mq(access,requestId))},${access==='owner'?owner:auth},${command},true)`;
  const submit=(op,p,parent=null,approval=null)=>perform(call('self',null,json({action:parent?'revise':'submit',operationId:op,
    reason:'Synthetic179 missing range declaration',expectedWorkerId:h.workerId,expectedSettingsVersion:1,expectedPolicyRevision:1,
    locationId:h.slot.locationId,timeZone:'UTC',proposal:p,...(parent?{supersedesRequestId:parent,expectedApprovalOperationId:approval}:{})})+
    `||jsonb_build_object('expectedSettingsVersion',${settings},'expectedPolicyRevision',${policyRevision})`));
  const terminal=(requestId,op,action)=>action==='withdraw'?perform(call('self',requestId,json({action,operationId:op,requestId,expectedRevision:1,reason:'Synthetic179 terminal withdrawal'}))):
    `do $missing_decide$ declare review jsonb;command jsonb;begin
      review:=${call('owner',requestId,'null')};
      assert review->'detail'->>${quote(action==='approve'?'canApprove':'canReject')}='true','missing_actual_decision_eligible';
      command:=jsonb_build_object('action',${quote(action)},'operationId',${quote(op)},'requestId',${quote(requestId)},'expectedRevision',1,
        'evidenceToken',review->'detail'->>'evidenceToken','reason','Synthetic179 actual missing decision');
      perform ${call('owner',requestId,'command')};end;$missing_decide$;`;
  const setup=(reverse=false)=>[permission,policyStep,submit(a,reverse?outside:inside),terminal(a,aa,'approve')];
  const read=label=>`${prefix}select jsonb_build_object('kind','before_read','hash',${allHash});
    set local role service_role;select jsonb_build_object('kind','source','label',${quote(label)},'owner',${source('owner')},'self',${source('self')},'legacy',${legacy});
    ${prefix}select jsonb_build_object('kind','after_read','hash',${allHash});`;
  const checks=[];let sourceReads=0,projections=0,rejectedReads=0,actualLifecycle=false;
  const restore=label=>{assert.equal(d.fingerprint(),baseline,label+':rollback');assert.equal(d.definitions(),definitions,label+':definitions');assert.equal(d.tableCatalog(),catalog,label+':catalog');};
  const validateRead=(row,before,after)=>{
    assert.equal(before.kind,'before_read');assert.equal(after.kind,'after_read');assert.equal(before.hash,after.hash,'missing_source_read_must_not_write');
    const {owner:x,self:y}=row;
    for(const raw of [x,y]){
      assert.equal(raw.sourceVersion,'attendance-period-source-v1');assert.equal(raw.complete,true);
      assert.equal(raw.workerId,h.workerId);assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
      assert.equal(digest(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
      assert(Buffer.byteLength(raw.sourceText,'utf8')<=1048576);assert(Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304);
    }
    assert.equal(x.sourceFingerprint,y.sourceFingerprint);assert.deepEqual(x.sourceCanonical,y.sourceCanonical);
    // The old report is independently invoked with its actual owner query.
    // Observation timestamps may advance; fact/effect rows and missing are exact.
    assert.deepEqual(x.report.missing,row.legacy.missing);assert.deepEqual(x.report.base.items,row.legacy.base.items);
    const ownerProjection=projectPeriodClosureSource(x,pq()),selfProjection=projectPeriodClosureSource(y,pq('self'));
    assert.deepEqual(ownerProjection.artifact.report.totals,selfProjection.artifact.report.totals);
    assert.deepEqual(ownerProjection.artifact.source,selfProjection.artifact.source);
    assert.equal(ownerProjection.artifact.sourceFingerprint,x.sourceFingerprint);
    sourceReads+=2;projections+=2;
    return {label:row.label,raw:x,artifact:ownerProjection.artifact,totals:ownerProjection.artifact.report.totals};
  };
  const run=async(label,steps,verify)=>{
    const protectedHash=hashSql(names.filter(name=>!writable.includes(name)));
    const mark=kind=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${protectedHash});`;
    const statements=['begin;'+prefix+initial+mark('protected_before'),...steps.map(step=>prefix+step),mark('protected_after')+'set constraints all immediate;rollback;'];
    assert(statements.length<=60,'missing_bounded_steps');let rows;
    try{rows=lines(await native.querySteps(statements.map(step=>scope.sql(step))));}
    catch(error){throw new Error('period_missing_context_failed:'+expected+':'+label+':'+String(error?.message??error),{cause:error});}
    finally{restore(label);}
    assert.equal(rows[0].kind,'protected_before');assert.equal(rows.at(-1).kind,'protected_after');assert.equal(rows[0].hash,rows.at(-1).hash,'missing_protected_facts_changed');
    const reads=[];for(let i=1;i<rows.length-1;i++)if(rows[i].kind==='source')reads.push(validateRead(rows[i],rows[i-1],rows[i+1]));
    verify(reads,rows);checks.push(label);
  };
  const ids=raw=>raw.context.missing.map(item=>item.requestId).sort();
  const current=raw=>raw.report.missing.map(item=>item.requestId).sort();
  const pending=raw=>raw.blockers.includes('pending_missing');
  const equalTotals=(x,y)=>{assert.deepEqual(x.totals,y.totals);assert.deepEqual(x.raw.report.missing,y.raw.report.missing);};
  const reject=(label,code)=>`${prefix}do $missing_reject$ declare before_hash text;begin
    before_hash:=${allHash};begin perform ${source('owner')};raise exception 'missing_expected_rejection_missing';
    exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    assert ${allHash}=before_hash,'missing_failed_read_partial_write';end;$missing_reject$;
    select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`;

  await run('actual_outward_pending_and_withdraw',[...setup(),read('approved_inside'),submit(b,outside,a,aa),read('pending_outside'),terminal(b,bt,'withdraw'),read('withdrawn_outside')],rows=>{
    const [approved,proposed,withdrawn]=rows;assert.deepEqual(rows.map(x=>current(x.raw)),[[a],[a],[a]]);
    assert.deepEqual(ids(approved.raw),[a]);assert.deepEqual(ids(proposed.raw),expected==='151'?[a]:[a,b]);
    assert.equal(pending(approved.raw),false);assert.equal(pending(proposed.raw),expected==='152');assert.equal(pending(withdrawn.raw),false);
    assert.deepEqual(ids(withdrawn.raw),[a]);equalTotals(approved,proposed);equalTotals(approved,withdrawn);
    assert.equal(approved.raw.sourceFingerprint,withdrawn.raw.sourceFingerprint);
    assert.equal(proposed.raw.sourceFingerprint===approved.raw.sourceFingerprint,expected==='151');
    if(expected==='152'){
      const child=proposed.raw.context.missing.find(item=>item.requestId===b);
      assert.equal(child.status,'submitted');assert.equal(child.supersedesRequestId,a);assert.equal(child.rootRequestId,a);
      assert.equal(child.isCurrentApproved,false);assert.equal(child.startAt,outside.startAt);
    }
  });

  if(expected==='152'){
    await run('actual_outward_reject',[...setup(),submit(b,outside,a,aa),read('pending'),terminal(b,bt,'reject'),read('rejected')],([before,after])=>{
      assert.equal(pending(before.raw),true);assert.equal(pending(after.raw),false);assert.deepEqual(ids(after.raw),[a]);equalTotals(before,after);
    });
    await run('actual_outward_approve_preserves_old_report_semantics',[permission,policyStep,read('empty'),submit(a,inside),terminal(a,aa,'approve'),submit(b,outside,a,aa),read('pending'),terminal(b,bt,'approve'),read('approved_outside')],([empty,before,after])=>{
      assert.deepEqual(current(before.raw),[a]);assert.deepEqual(current(after.raw),[]);assert.equal(pending(after.raw),false);
      assert.deepEqual(ids(after.raw),[a]);assert.equal(after.raw.context.missing[0].isCurrentApproved,false);equalTotals(empty,after);
    });
    await run('actual_reverse_moved_in',[...setup(true),read('outside_approved'),submit(b,inside,a,aa),read('inside_pending'),terminal(b,bt,'approve'),read('inside_approved')],([empty,proposed,approved])=>{
      assert.deepEqual(ids(empty.raw),[]);assert.deepEqual(ids(proposed.raw),[b]);assert.equal(pending(proposed.raw),true);equalTotals(empty,proposed);
      assert.deepEqual(current(approved.raw),[b]);assert.equal(pending(approved.raw),false);assert.equal(approved.raw.context.missing[0].isCurrentApproved,true);
    });
    // Explicit bounded scope: do NOT claim full-root recursive history. Once B
    // is approved outside, A is no longer current; an outside C cannot change
    // this period. C moving into the period is still included by its own span.
    await run('actual_chain_direct_boundary_only',[...setup(),submit(b,outside,a,aa),terminal(b,bt,'approve'),submit(c,anotherOutside,b,bt),read('outside_grandchild'),terminal(c,ct,'withdraw'),submit(t,inside,b,bt),read('inside_grandchild')],([outsideChild,insideChild])=>{
      assert.deepEqual(ids(outsideChild.raw),[a]);assert.equal(pending(outsideChild.raw),false);assert.deepEqual(current(outsideChild.raw),[]);
      assert.deepEqual(ids(insideChild.raw),[a,t]);assert.equal(pending(insideChild.raw),true);equalTotals(outsideChild,insideChild);
      const child=insideChild.raw.context.missing.find(item=>item.requestId===t);assert.equal(child.supersedesRequestId,b);assert.equal(child.rootRequestId,a);
    });

    // A current employee/Auth mismatch on an OUTSIDE pending child must not be
    // hidden by filtering the child before authorization checks. Old rows stay
    // immutable: append one constrained copy of the real withdrawn B template.
    const bad=fid(10),oldAuth=fid(11);
    const copyChild=`do $missing_identity_copy$ declare r public.merchant_attendance_missing_requests%rowtype;e public.merchant_attendance_missing_entries%rowtype;begin
      select * into strict r from public.merchant_attendance_missing_requests where merchant_id=${site} and request_id=${quote(b)};
      select * into strict e from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=${quote(b)} and revision=1;
      r.request_id:=${quote(bad)};r.actor_auth_user_id:=${quote(oldAuth)};
      e.operation_id:=r.request_id;e.request_id:=r.request_id;e.actor_auth_user_id:=r.actor_auth_user_id;
      e.command:=e.command||jsonb_build_object('operationId',r.request_id);
      insert into public.merchant_attendance_missing_requests select (r).*;insert into public.merchant_attendance_missing_entries select (e).*;
    end;$missing_identity_copy$;`;
    await run('outside_child_historical_identity_fails_closed',[...setup(),submit(b,outside,a,aa),terminal(b,bt,'withdraw'),copyChild,
      reject('old_auth','attendance_period_source_identity_changed')],(rows,output)=>{assert.equal(rows.length,0);assert.equal(output.filter(x=>x.kind==='rejection').length,1);rejectedReads++;});

    // 99 precise-span rows + one related outside pending child = exactly100.
    // Each dense root is a copy of a real submitted-and-withdrawn template;
    // unrelated root families stay size1, so the UNION cap (not root cap) fires.
    const copies=(first,last)=>`do $missing_cap_copy$ declare i integer;r public.merchant_attendance_missing_requests%rowtype;e public.merchant_attendance_missing_entries%rowtype;z public.merchant_attendance_missing_entries%rowtype;new_id uuid;new_op uuid;begin
      for i in ${first}..${last} loop
        select * into strict r from public.merchant_attendance_missing_requests where merchant_id=${site} and request_id=${quote(t)};
        select * into strict e from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=${quote(t)} and revision=1;
        select * into strict z from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=${quote(t)} and revision=2;
        new_id:=('00000000-0000-4000-8000-'||lpad((179010000+i)::text,12,'0'))::uuid;
        new_op:=('00000000-0000-4000-8000-'||lpad((179020000+i)::text,12,'0'))::uuid;
        r.request_id:=new_id;e.operation_id:=new_id;e.request_id:=new_id;e.command:=e.command||jsonb_build_object('operationId',new_id);
        z.operation_id:=new_op;z.request_id:=new_id;z.command:=z.command||jsonb_build_object('operationId',new_op,'requestId',new_id);
        insert into public.merchant_attendance_missing_requests select (r).*;
        insert into public.merchant_attendance_missing_entries select (e).*;insert into public.merchant_attendance_missing_entries select (z).*;
      end loop;end;$missing_cap_copy$;`;
    const batches=[];for(let first=1;first<=97;first+=10)batches.push(copies(first,Math.min(first+9,97)));
    await run('exact_union_100_101',[...setup(),submit(b,outside,a,aa),submit(t,templateInside),terminal(t,tt,'withdraw'),...batches,
      read('union_100'),copies(98,98),reject('union_101','attendance_period_source_too_large')],(rows,output)=>{
      assert.equal(rows.length,1);assert.equal(rows[0].raw.context.missing.length,100);assert(ids(rows[0].raw).includes(b));
      assert.equal(pending(rows[0].raw),true);assert.deepEqual(current(rows[0].raw),[a]);
      assert.equal(output.filter(x=>x.kind==='rejection').length,1);rejectedReads++;
    });

    // Interactive only to pass REAL source bytes through the existing Node
    // projection before calling149. Existing native connection deadlines remain
    // intact; no service stub or SQL-constructed imitation artifact is used.
    const label='actual_send_confirm_then_blocked_seal',connection=native.connect();
    const protectedHash=hashSql(names.filter(name=>!writable.includes(name)&&!periodTables.includes(name)));
    let protectedBefore,stepCount=0;
    const step=async sql=>{assert(++stepCount<=24,'missing_lifecycle_bounded_steps');return connection.step(scope.sql(prefix+sql));};
    try{
      await step('begin;'+initial);protectedBefore=await step('select '+protectedHash+';');
      for(const sql of [...setup(),submit(b,outside,a,aa)])await step(sql);
      const observed=lines(await step(read('lifecycle_pending')));assert.equal(observed.length,3);
      const saved=validateRead(observed[1],observed[0],observed[2]);assert.equal(pending(saved.raw),true);
      const pid=fid(100),closure=(access,command,artifact=null)=>`public.faolla_attendance_period_closure_v1(${json(pq(access,pid))},${access==='owner'?owner:auth},${json(command)},${json(artifact)},true)`;
      const command=(action,op,revision,version)=>({action,operationId:op,periodId:pid,expectedRevision:revision,expectedVersion:version,
        expectedFingerprint:saved.raw.sourceFingerprint,reason:action==='confirm'?'':'Synthetic179 missing context workflow'});
      const sent=JSON.parse(await step('set local role service_role;select '+closure('owner',command('send',fid(101),0,0),saved.artifact)+';'));
      assert.equal(sent.period.state,'review');assert.equal(sent.period.currentVersion,1);assert.equal(sent.period.confirmedVersion,null);
      const confirmed=JSON.parse(await step('set local role service_role;select '+closure('self',command('confirm',fid(102),sent.period.revision,1))+';'));
      assert.equal(confirmed.period.state,'confirmed');assert.equal(confirmed.period.confirmedVersion,1);assert.equal(confirmed.period.unresolvedDispute,false);
      const seal=closure('owner',command('seal',fid(103),confirmed.period.revision,1));
      await step(`do $missing_seal$ declare before_hash text;begin before_hash:=${allHash};
        assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(pid)}
          and confirmed_version=current_version and not unresolved_dispute and not sealed),'missing_seal_must_be_confirmed';
        begin perform ${seal};raise exception 'missing_seal_expected_rejection';
          exception when raise_exception then if sqlerrm<>'attendance_period_blocked' then raise;end if;end;
        assert ${allHash}=before_hash,'missing_blocked_seal_partial_write';
      end;$missing_seal$;`);
      assert.equal(await step('select '+protectedHash+';'),protectedBefore,'missing_lifecycle_changed_old_facts');
      await step('set constraints all immediate;rollback;');actualLifecycle=true;checks.push(label);
    }catch(error){throw new Error('period_missing_context_failed:152:'+label+':'+String(error?.message??error),{cause:error});}
    finally{await connection.close();restore(label);}
  }
  restore('complete');
  return {version:expected,checks,sourceReads,projections,rejectedReads,actualMissingRpcs:true,actualLifecycle,
    reproduced151Omission:expected==='151',directPendingChildOnly:true,recursiveWholeRootClaim:false,
    actualLegacyReportCompared:true,ownerSelfFingerprintEqual:true,allReadsAndFailuresZeroWrites:true,
    allOuterRollbacksRestored:true,protectedFactsAndDefinitionsUnchanged:true,syntheticHistoricalRows:h.syntheticHistoricalRows,
    syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Actual103 requests/decisions and149 workflow on synthetic174 past facts; dense cap and wrong-Auth rows are constrained synthetic copies. Every scenario rolls back. No real accounts, past real punches, full recursive lineage, production capacity or deployment is claimed.'};
}
