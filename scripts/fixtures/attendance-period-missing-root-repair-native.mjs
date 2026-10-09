//183 inert owned-fixture proof. Runtime belongs to root. Actual103 templates
//and constrained synthetic density/corruption are reported separately.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const fid=n=>id(183000000+n);
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const lines=value=>value.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const offset=(value,minutes)=>new Date(Date.parse(value)+minutes*60000).toISOString().replace(/Z$/,'000Z');
const perform=sql=>`do $repair_rpc$ begin perform ${sql};end;$repair_rpc$;`;
function hashSql(names){
  assert(names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r) rows`;
  }).join(' union all ')+') repair_rows)';
}
const observedReport=raw=>{const r=structuredClone(raw);delete r.base.asOf;return r;};
const archivedMetadata=raw=>{const r=structuredClone(raw);delete r.actorId;delete r.access;delete r.readAt;return r;};
function fixture({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof d?.tableCatalog,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  const q={siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const site=quote(d.site),worker=quote(h.workerId),owner=quote(d.owner),auth=quote(h.employeeAuthUserId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),allHash=hashSql(names);
  const restore=label=>{assert.equal(d.fingerprint(),baseline,label+':facts');assert.equal(d.definitions(),definitions,label+':definitions');assert.equal(d.tableCatalog(),catalog,label+':catalog');};
  const mark=(kind,hash=allHash)=>prefix+`select jsonb_build_object('kind',${quote(kind)},'hash',${hash});`;
  const source=access=>`public.faolla_attendance_period_source_v1(${json({...q,access})},${access==='owner'?owner:auth})`;
  const report=access=>`public.faolla_attendance_unified_report_v1(${site},${access==='owner'?owner:auth},${json(access==='owner'?
    {access,workerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate}:
    {access,workerId:null,locationId:null,expectedWorkerId:h.workerId,fromDate:q.fromDate,throughDate:q.throughDate})})`;
  const read=(label,access,kind)=>mark('before_read')+`set local role service_role;select jsonb_build_object('kind','read','label',${quote(label)},'access',${quote(access)},'reader',${quote(kind)},'raw',${kind==='source'?source(access):report(access)});`+mark('after_read');
  const reads=label=>['owner','self'].flatMap(access=>['report','source'].map(kind=>read(label,access,kind))).join('\n');
  const reject=(label,code)=>['owner','self'].map(access=>mark('before_failure')+`set local role service_role;do $repair_reject$ begin
    begin perform ${source(access)};raise exception 'repair_expected_failure_missing';exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
    end;$repair_reject$;${prefix}select jsonb_build_object('kind','rejection','label',${quote(label)},'access',${quote(access)},'error',${quote(code)});`+mark('after_failure')).join('\n');
  const initial=version=>`do $repair_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=${version}),'repair_required_reader';
    ${version===202610050153?"assert not exists(select 1 from public.faolla_schema_migrations where version=202610050154),'repair_exact153';":''}
    assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}),'repair_before_period_creation';
    assert not exists(select 1 from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker}),'repair_empty_missing_history';
    assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
      where e.merchant_id=${site} and e.id=${quote(h.employeeId)} and e.auth_user_id=${auth} and e.status='active' and r.status='active'
      and 'attendance.self.request'=any(r.permissions) and 'attendance.self.export'=any(r.permissions)),'repair_existing_permissions';
    assert not exists(select 1 from pg_trigger t join pg_class x on x.oid=t.tgrelid where x.relnamespace=${owned.oid} and t.tgenabled<>'O'),'repair_guards_enabled';
  end;$repair_initial$;`;
  const writable=['merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries'];
  const run=async(label,steps,extra=[],version=202610050154)=>{
    const protectedHash=hashSql(names.filter(name=>![...writable,...extra].includes(name)));
    const statements=['begin;'+prefix+initial(version)+mark('protected_before',protectedHash),...steps.map(sql=>prefix+sql),mark('protected_after',protectedHash)+'set constraints all immediate;rollback;'];
    assert(statements.length<=40,'repair_bounded_steps');let rows;
    try{rows=lines(await native.querySteps(statements.map(sql=>scope.sql(sql))));}
    catch(error){throw new Error('period_missing_root_repair:'+label+':'+String(error?.message??error),{cause:error});}
    finally{restore(label);}
    assert.equal(rows[0].kind,'protected_before');assert.equal(rows.at(-1).kind,'protected_after');assert.equal(rows[0].hash,rows.at(-1).hash,'repair_protected_tables');
    for(let i=0;i<rows.length;i++)if(['read','export','rejection'].includes(rows[i].kind)){
      const bad=rows[i].kind==='rejection';assert.equal(rows[i-1].kind,bad?'before_failure':'before_read');assert.equal(rows[i+1].kind,bad?'after_failure':'after_read');assert.equal(rows[i-1].hash,rows[i+1].hash,'repair_read_or_failure_wrote');
    }
    return rows;
  };
  return {d,native,scope,h,owned,q,site,worker,owner,auth,prefix,names,allHash,mark,source,reads,reject,run,restore};
}
function missing(f){
  const {d,h,site,owner,auth,q,prefix}=f;
  // Setup-context read only; RPC arguments remain literal primitives under
  // service_role, which intentionally has no private-table SELECT grant.
  const v=JSON.parse(d.exec(`select jsonb_build_object('settings',(select version from public.merchant_attendance_settings where merchant_id=${site}),
    'policy',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}));`));
  assert(Number.isSafeInteger(v.settings)&&v.settings>=1);assert(Number.isSafeInteger(v.policy)&&v.policy>=0&&v.policy<Number.MAX_SAFE_INTEGER);
  const policy=fid(1),a=fid(2),aa=fid(3),b=fid(4),bt=fid(5),c=fid(6),ct=fid(7),z=fid(8),zt=fid(9);
  const inside={startAt:offset(h.slot.startAt,-120),endAt:offset(h.slot.startAt,-60),breaks:[]};
  const outside={startAt:offset(h.slot.startAt,1320),endAt:offset(h.slot.startAt,1380),breaks:[]};
  const movedInside={startAt:offset(h.slot.startAt,-240),endAt:offset(h.slot.startAt,-180),breaks:[]};
  const mq=(access,requestId=null)=>({siteId:d.site,access,fromDate:q.fromDate,throughDate:outside.startAt.slice(0,10),requestId,operationId:null,beforeAt:null,beforeId:null});
  const rpc=(access,requestId,command)=>`public.faolla_attendance_missing_v1(${json(mq(access,requestId))},${access==='owner'?owner:auth},${command},true)`;
  const role=sql=>'set local role service_role;'+sql;
  const submit=(op,proposal,parent=null,approval=null)=>role(perform(rpc('self',null,json({action:parent?'revise':'submit',operationId:op,reason:'Synthetic183 declaration',
    expectedWorkerId:h.workerId,expectedSettingsVersion:v.settings,expectedPolicyRevision:v.policy+1,locationId:h.slot.locationId,timeZone:'UTC',proposal,
    ...(parent?{supersedesRequestId:parent,expectedApprovalOperationId:approval}:{})}))));
  const terminal=(requestId,op,action)=>role(action==='withdraw'?perform(rpc('self',requestId,json({action,operationId:op,requestId,expectedRevision:1,reason:'Synthetic183 withdrawal'}))):
    `do $repair_decide$ declare r jsonb;cmd jsonb;begin r:=${rpc('owner',requestId,'null')};
      assert r->'detail'->>${quote(action==='approve'?'canApprove':'canReject')}='true','repair_actual_decision_eligible';
      cmd:=jsonb_build_object('action',${quote(action)},'operationId',${quote(op)},'requestId',${quote(requestId)},'expectedRevision',1,'evidenceToken',r->'detail'->>'evidenceToken','reason','Synthetic183 decision');
      perform ${rpc('owner',requestId,'cmd')};end;$repair_decide$;`);
  const setup=[`do $repair_versions$ begin assert (select version from public.merchant_attendance_settings where merchant_id=${site})=${v.settings}
      and (select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site})=${v.policy},'repair_prepared_versions_stable';end;$repair_versions$;`+
    role(perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},${json({action:'set_policy',operationId:policy,expectedRevision:v.policy,expectedSettingsVersion:v.settings,submissionWindowDays:365,reason:'Synthetic183 policy'})},null,null,true)`))+
    prefix+`do $repair_policy$ begin assert (select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})=${v.policy+1},'repair_actual_policy_revision';end;$repair_policy$;`,
    submit(a,inside),terminal(a,aa,'approve')];
  const copies=(template,first,last,pending=false)=>`set constraints all deferred;do $repair_copies$ declare i integer;r public.merchant_attendance_missing_requests%rowtype;
    s public.merchant_attendance_missing_entries%rowtype;t public.merchant_attendance_missing_entries%rowtype;n uuid;o uuid;begin
    for i in ${first}..${last} loop
      select * into strict r from public.merchant_attendance_missing_requests where merchant_id=${site} and request_id=${quote(template)};
      select * into strict s from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=r.request_id and revision=1;
      select * into strict t from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=r.request_id and revision=2;
      n:=('00000000-0000-4000-8000-'||lpad((183010000+i)::text,12,'0'))::uuid;o:=('00000000-0000-4000-8000-'||lpad((183020000+i)::text,12,'0'))::uuid;
      r.request_id:=n;s.request_id:=n;s.operation_id:=n;s.command:=s.command||jsonb_build_object('operationId',n);
      t.request_id:=n;t.operation_id:=o;t.command:=t.command||jsonb_build_object('operationId',o,'requestId',n);
      insert into public.merchant_attendance_missing_requests select (r).*;insert into public.merchant_attendance_missing_entries select (s).*;
      ${pending?'':"assert t.action='withdraw','repair_withdrawn_template';insert into public.merchant_attendance_missing_entries select (t).*;"}
    end loop;end;$repair_copies$;set constraints all immediate;`;
  return {a,aa,b,bt,c,ct,z,zt,inside,outside,movedInside,setup,submit,terminal,copies};
}
function validateReads(f,rows){
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const groups=new Map();
  for(const row of rows.filter(row=>row.kind==='read')){if(!groups.has(row.label))groups.set(row.label,{});const g=groups.get(row.label),k=row.access+row.reader;assert.equal(g[k],undefined);g[k]=row.raw;}
  for(const g of groups.values()){
    for(const access of ['owner','self']){
      const raw=g[access+'source'],report=g[access+'report'];assert.equal(raw.complete,true);assert.equal(report.complete,true);
      assert.equal(raw.employeeId,f.h.employeeId);assert.equal(raw.employeeAuthUserId,f.h.employeeAuthUserId);assert.equal(sha(raw.sourceText),raw.sourceFingerprint);assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
      assert(Buffer.byteLength(raw.sourceText,'utf8')<=1048576);assert(Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304);
      assert.deepEqual(observedReport(raw.report),observedReport(report));
      const p=projectPeriodClosureSource(raw,{...f.q,access,mode:'preview',periodId:null,operationId:null,version:null});g[access+'projection']=p;
      assert.deepEqual(report.base.items.map(item=>item.startEventId),[f.h.startEventId]);
    }
    assert.equal(g.ownersource.sourceFingerprint,g.selfsource.sourceFingerprint);assert.deepEqual(g.ownersource.sourceCanonical,g.selfsource.sourceCanonical);
    assert.deepEqual(g.ownerprojection.artifact.report.totals,g.selfprojection.artifact.report.totals);
  }
  return groups;
}
const currentIds=g=>g.ownerreport.missing.map(x=>x.requestId).sort();
const contextIds=g=>g.ownersource.context.missing.map(x=>x.requestId).sort();

export async function verifyPeriodMissingRootRepairNative(args){
  const f=fixture(args),m=missing(f),{site,h,q}=f;let successfulReads=0,rejectedReads=0;
  const record=rows=>{successfulReads+=rows.filter(r=>r.kind==='read').length;rejectedReads+=rows.filter(r=>r.kind==='rejection').length;return validateReads(f,rows);};
  const batches=(template,n,pending=false)=>Array.from({length:Math.ceil(n/10)},(_,i)=>m.copies(template,i*10+1,Math.min(i*10+10,n),pending));
  const rows=await f.run('unrelated_terminal_history',[
    ...m.setup,f.reads('root1'),m.submit(m.b,m.outside,m.a,m.aa),m.terminal(m.b,m.bt,'withdraw'),m.submit(m.c,m.outside,m.a,m.aa),m.terminal(m.c,m.ct,'reject'),
    ...batches(m.b,98),f.reads('root101'),m.copies(m.b,99,100),f.reads('root103'),
    `do $repair_density$ begin assert (select count(*) from public.merchant_attendance_missing_requests where merchant_id=${site} and coalesce(root_request_id,request_id)=${quote(m.a)})=103,'repair_exact_root103';
      assert not exists(select 1 from public.merchant_attendance_missing_requests r where r.merchant_id=${site} and r.supersedes_request_id=${quote(m.a)} and not exists(select 1 from public.merchant_attendance_missing_entries e where e.merchant_id=r.merchant_id and e.request_id=r.request_id and e.revision=2)),'repair_no_pending_extra';end;$repair_density$;`
  ]);
  const dense=record(rows),first=dense.get('root1');
  for(const g of dense.values()){
    assert.deepEqual(currentIds(g),[m.a]);assert.deepEqual(contextIds(g),[m.a]);assert.equal(g.ownersource.context.missing[0].isCurrentApproved,true);
    assert.equal(g.ownersource.blockers.includes('pending_missing'),false);assert.equal(g.ownersource.sourceFingerprint,first.ownersource.sourceFingerprint);
    assert.deepEqual(g.ownersource.sourceCanonical,first.ownersource.sourceCanonical);assert.deepEqual(observedReport(g.ownerreport),observedReport(first.ownerreport));
    assert.equal(g.ownerprojection.artifact.report.totals.missingSelected.workedUs,3600000000);
  }
  const capRows=await f.run('related_100_101',[...m.setup,...batches(m.a,99,true),f.reads('related100'),m.copies(m.a,100,100,true),f.reject('related101','attendance_period_source_too_large')]);
  const cap=record(capRows).get('related100');assert.equal(cap.ownersource.context.missing.length,100);assert.equal(cap.ownersource.blockers.includes('pending_missing'),true);assert.deepEqual(currentIds(cap),[m.a]);
  assert.equal(capRows.filter(r=>r.kind==='rejection').length,2);
  const chainRows=await f.run('actual103_multihop',[...m.setup,f.reads('A_inside'),m.submit(m.b,m.outside,m.a,m.aa),m.terminal(m.b,m.bt,'approve'),f.reads('B_outside'),
    m.submit(m.c,m.movedInside,m.b,m.bt),m.terminal(m.c,m.ct,'approve'),f.reads('C_inside'),m.submit(m.z,m.outside,m.c,m.ct),f.reads('C_with_pending_outside'),m.terminal(m.z,m.zt,'withdraw'),f.reads('C_after_withdraw')]);
  const chain=record(chainRows);
  assert.deepEqual(currentIds(chain.get('A_inside')),[m.a]);assert.deepEqual(currentIds(chain.get('B_outside')),[]);assert.deepEqual(contextIds(chain.get('B_outside')),[m.a]);
  assert.equal(chain.get('B_outside').ownersource.context.missing[0].isCurrentApproved,false);
  for(const label of ['C_inside','C_with_pending_outside','C_after_withdraw'])assert.deepEqual(currentIds(chain.get(label)),[m.c]);
  assert.deepEqual(contextIds(chain.get('C_inside')),[m.a,m.c].sort());assert.deepEqual(contextIds(chain.get('C_with_pending_outside')),[m.a,m.c,m.z].sort());
  assert.equal(chain.get('C_with_pending_outside').ownersource.blockers.includes('pending_missing'),true);
  assert.equal(chain.get('C_inside').ownersource.sourceFingerprint,chain.get('C_after_withdraw').ownersource.sourceFingerprint);
  // The following inserted rows are intentionally schema-valid but semantically
  // corrupt, not outputs claimed to be reachable through the actual103 writer.
  const seed=(variant,n=1)=>{
    const incoming=variant.startsWith('incoming_'),kind=variant.replace(/^incoming_/,''),parent=incoming?m.z:m.a,parentApproval=incoming?m.zt:m.aa,proposal=incoming?m.movedInside:m.outside;
    return `set constraints all deferred;do $repair_bad$ declare r public.merchant_attendance_missing_requests%rowtype;s public.merchant_attendance_missing_entries%rowtype;t public.merchant_attendance_missing_entries%rowtype;
    parent_at timestamptz;new_id uuid:=${quote(fid(100+n))};new_op uuid:=${quote(fid(200+n))};begin
    select * into strict r from public.merchant_attendance_missing_requests where merchant_id=${site} and request_id=${quote(parent)};
    select * into strict s from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=r.request_id and revision=1;
    select * into strict t from public.merchant_attendance_missing_entries where merchant_id=${site} and request_id=r.request_id and revision=2;parent_at:=t.recorded_at;
    r.request_id:=new_id;r.supersedes_request_id:=${quote(parent)};r.supersedes_operation_id:=${quote(parentApproval)};r.root_request_id:=${quote(parent)};
    r.proposal:=${json(proposal)};r.start_at:=${quote(proposal.startAt)};r.end_at:=${quote(proposal.endAt)};r.submitted_at:=clock_timestamp();
    s.operation_id:=new_id;s.request_id:=new_id;s.recorded_at:=r.submitted_at;
    s.command:=s.command||jsonb_build_object('action','revise','operationId',new_id,'proposal',r.proposal,'supersedesRequestId',r.supersedes_request_id,'expectedApprovalOperationId',r.supersedes_operation_id);
    t.operation_id:=new_op;t.request_id:=new_id;t.recorded_at:=clock_timestamp();t.command:=t.command||jsonb_build_object('operationId',new_op,'requestId',new_id);
    ${kind==='identity'?`r.actor_auth_user_id:=${quote(fid(900))};s.actor_auth_user_id:=r.actor_auth_user_id;`:''}
    ${kind==='root'?`r.root_request_id:=${quote(m.z)};`:''}
    ${kind==='approval'?`r.supersedes_operation_id:=${quote(incoming?m.aa:m.zt)};s.command:=s.command||jsonb_build_object('expectedApprovalOperationId',r.supersedes_operation_id);`:''}
    ${kind==='time'?"r.submitted_at:=parent_at-interval '1 microsecond';s.recorded_at:=r.submitted_at;":''}
    ${kind==='submit_receipt'?"s.command:=s.command||jsonb_build_object('action','submit');":''}
    ${kind==='approval_receipt'?`t.command:=t.command||jsonb_build_object('requestId',${quote(m.a)});`:''}
    ${kind==='historical_owner'?`t.actor_auth_user_id:=${quote(fid(901))};t.recorded_at:=r.submitted_at;`:''}
    insert into public.merchant_attendance_missing_requests select (r).*;insert into public.merchant_attendance_missing_entries select (s).*;insert into public.merchant_attendance_missing_entries select (t).*;
    end;$repair_bad$;set constraints all immediate;`;
  };
  const cases=['identity','root','approval','time','submit_receipt','approval_receipt','duplicate','incoming_approval','incoming_time'];
  const invalidSteps=cases.flatMap(kind=>['savepoint bad_case;'+seed(kind)+(kind==='duplicate'?seed('valid',2):''),
    f.reject(kind,kind==='identity'?'attendance_period_source_identity_changed':'attendance_period_source_invalid'),'rollback to savepoint bad_case;release savepoint bad_case;']);
  const badRows=await f.run('semantic_invalid_direct_successors',[...m.setup,m.submit(m.z,m.outside),m.terminal(m.z,m.zt,'approve'),
    'savepoint prior_owner;'+seed('historical_owner'),f.reads('historical_owner'), 'rollback to savepoint prior_owner;release savepoint prior_owner;',...invalidSteps]);
  const historical=record(badRows).get('historical_owner');assert.deepEqual(currentIds(historical),[]);assert.equal(historical.ownersource.context.missing.find(x=>x.requestId===m.a).isCurrentApproved,false);
  assert.equal(badRows.filter(r=>r.kind==='rejection').length,cases.length*2);
  assert.equal(q.fromDate,h.slot.workDate);assert.equal(successfulReads,40);assert.equal(rejectedReads,20);
  return {readerVersion:'154',groups:4,rootRows:[1,101,103],irrelevantTerminalChildren:102,related100Accepted:true,related101Rejected:true,
    actual103Multihop:true,invalidDirectSuccessors:cases,historicalApprovalActorAccepted:true,syntheticHistoricalApprovalActorOnly:true,actualOwnerTransfer:false,successfulReads,rejectedReads,
    actualMissingWriteCalls:20,actualMissingReviewReads:8,actualPolicyWriteCalls:4,syntheticDensityRequestCopies:200,syntheticSemanticSuccessorRows:11,
    normalCanonicalFingerprint:first.ownersource.sourceFingerprint,ownerSelfCanonicalEqual:true,allReadsAndFailuresZeroWrites:true,
    outerRollbackTransactions:4,allFactsDefinitionsCatalogRestored:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Actual103 baseline/terminal/multihop commands; 100 constrained withdrawn siblings and 100 pending density copies, plus savepoint-isolated schema-valid corrupt successors. No disabled constraints, real data, complete ancestry audit, SLA or deployment claim.'};
}

export async function verifyPeriodMissingRootRepairInstallNative(args){
  const f=fixture(args),m=missing(f),{source}=args,{q,d,h,native,owner,auth}=f,artifact=source?.ownerProjection?.artifact;
  assert.deepEqual(source?.q,q);assert.equal(artifact?.sourceFingerprint,source.ownerRaw?.sourceFingerprint);assert.equal(sha(source.ownerRaw.sourceText),artifact.sourceFingerprint);
  assert.deepEqual(JSON.parse(source.ownerRaw.sourceText),artifact.source);
  const migration='202610050154_merchant_attendance_period_missing_root_capacity.sql',body=boundClockMigrationBody(native.root,migration);
  assert.doesNotMatch(body,/^\s*(?:begin|commit|rollback)\s*;/im);assert.doesNotMatch(body,/create\s+index\s+concurrently/i);
  const pid=fid(9001),op=fid(9002),command={action:'send',operationId:op,periodId:pid,expectedRevision:0,expectedVersion:0,expectedFingerprint:artifact.sourceFingerprint,reason:'Synthetic183 archive before154'};
  const call=(access,send=false)=>`public.faolla_attendance_period_closure_v1(${json({...q,access,mode:send?'detail':'export',periodId:pid,operationId:null,version:send?null:1})},${access==='owner'?owner:auth},${json(send?command:null)},${json(send?artifact:null)},${send})`;
  const read=(label,access)=>f.mark('before_read')+`set local role service_role;select jsonb_build_object('kind','export','label',${quote(label)},'access',${quote(access)},'raw',${call(access)});`+f.mark('after_read');
  const business=hashSql(f.names.filter(name=>name!=='faolla_schema_migrations'));
  const metadata=`(select md5(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)) order by p.oid),'[]') from pg_proc p where p.pronamespace=${f.owned.oid} and p.prokind in('f','p')),
    'relations',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity) order by c.oid),'[]') from pg_class c where c.relnamespace=${f.owned.oid}),
    'columns',(select coalesce(jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum),'[]') from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace=${f.owned.oid}),
    'indexes',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive) order by c.oid),'[]') from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${f.owned.oid}),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_array(t.oid,t.tgenabled,pg_get_triggerdef(t.oid)) order by t.oid),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${f.owned.oid})
  )::text))`;
  const rows=await f.run('install_fixed153_archive',[
    `set local role service_role;select jsonb_build_object('kind','send','raw',${call('owner',true)});`,
    ...m.setup,m.submit(m.b,m.outside,m.a,m.aa),m.terminal(m.b,m.bt,'approve'),f.reads('before154'),read('before154','owner'),
    f.mark('before_install',business),body,f.mark('after_install',business),f.mark('before_reapply',f.allHash)+f.mark('before_reapply_meta',metadata),body,
    f.mark('after_reapply',f.allHash)+f.mark('after_reapply_meta',metadata),f.reads('after154'),read('after154_owner','owner'),read('after154_self','self')
  ],['faolla_schema_migrations','merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'],202610050153);
  const one=kind=>{const values=rows.filter(row=>row.kind===kind);assert.equal(values.length,1);return values[0];};
  assert.equal(one('before_install').hash,one('after_install').hash,'repair_install_changed_saved_rows');
  assert.equal(one('before_reapply').hash,one('after_reapply').hash,'repair_reapply_changed_rows_including_registry');
  assert.equal(one('before_reapply_meta').hash,one('after_reapply_meta').hash,'repair_reapply_changed_definitions_indexes_catalog');
  const sent=one('send').raw;assert.equal(sent.period.periodId,pid);assert.equal(sent.period.currentVersion,1);assert.equal(sent.replayed,false);assert.deepEqual(sent.operation.command,command);
  const groups=validateReads(f,rows);assert.equal(groups.get('before154').ownersource.sourceFingerprint,groups.get('after154').ownersource.sourceFingerprint);
  assert.deepEqual(groups.get('before154').ownersource.sourceCanonical,groups.get('after154').ownersource.sourceCanonical);
  assert.deepEqual(contextIds(groups.get('before154')),[m.a]);assert.deepEqual(currentIds(groups.get('before154')),[]);
  assert.equal(groups.get('before154').ownersource.context.missing[0].isCurrentApproved,false);
  assert.notEqual(groups.get('before154').ownersource.sourceFingerprint,artifact.sourceFingerprint,'repair_saved_archive_precedes_actual_revision');
  const exports=rows.filter(row=>row.kind==='export');assert.deepEqual(exports.map(row=>row.label),['before154','after154_owner','after154_self']);
  for(const row of exports){const r=row.raw;assert.equal(r.actorId,row.access==='owner'?d.owner:h.employeeAuthUserId);assert.equal(r.access,row.access);assert.equal(r.artifactVersion,1);assert.equal(r.sourceChanged,null);
    assert.equal(sha(r.artifactText),r.artifactSha256);assert.equal(Buffer.byteLength(r.artifactText,'utf8'),r.artifactBytes);assert(r.artifactBytes<=2097152);assert.deepEqual(JSON.parse(r.artifactText),artifact);
    assert.equal(r.artifactText,exports[0].raw.artifactText);assert.equal(r.artifactSha256,exports[0].raw.artifactSha256);assert.deepEqual(archivedMetadata(r),archivedMetadata(exports[0].raw));}
  return {actual149Send:true,actual154Install:true,actual154Reapply:true,reapplyRowsDefinitionsIndexesCatalogUnchanged:true,fixed153Version:1,exactArchiveBytesAndMetadataPreserved:true,normal153154CanonicalEqual:true,actual103ApprovedEdgeCompared:true,
    normalCanonicalFingerprint:groups.get('before154').ownersource.sourceFingerprint,artifactSha256:exports[0].raw.artifactSha256,artifactBytes:exports[0].raw.artifactBytes,
    actualFixedExports:3,actualSourceAndReportReads:8,actualMissingWriteCalls:4,actualMissingReviewReads:2,actualPolicyWriteCalls:1,allReadsZeroWrites:true,installBusinessRowsUnchanged:true,outerRollbackTransactions:1,
    allFactsDefinitionsCatalogRestored:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true};
}
