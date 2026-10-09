//200 synthetic acceptance only; no configured application database is read.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
import {verifyEventNotificationExceptionRaces} from './attendance-event-notifications-races-native.mjs';
const require=createRequire(import.meta.url),migration='202610060169_merchant_attendance_event_notifications.sql';
const rpc='faolla_attendance_event_notifications_v1';
export const eventNotificationsExpression=(q,a,c=null,allow=true)=>`public.${rpc}(${json(q)},${quote(a)},${json(c)},${allow})`;
const wrapped=(name,q,a,c=null,allow=true,extra='')=>`public.${name}(${json(q)},${quote(a)},${json(c)},${allow}${extra})`;
export async function verifyEventNotificationsNative(ctx,browserCheck=null){
  const {d,h,native,scope,all,call}=ctx,{exec}=d;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  let phase='install',counter=200100000,reads=0,writes=0,rejections=0;
  const next=()=>id(++counter),oldTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(oldTables);
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const definitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text) from pg_proc where oid=any(${quote(oldOids)}::oid[]);`);
  const oldDefinitions=definitions(),install=()=>exec(boundClockMigrationBody(native.root,migration));
  install();assert.equal(d.fingerprint(oldTables),facts);assert.equal(definitions(),oldDefinitions);
  const installed=all(),installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog();install();
  assert.equal(all(),installed);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const core=require('../../src/lib/merchantAttendanceEventNotifications.ts');
  const acl=JSON.parse(exec(`select jsonb_build_object('service',has_function_privilege('service_role','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'anon',has_function_privilege('anon','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'private',has_table_privilege('service_role','public.merchant_attendance_event_notifications','SELECT'));`));
  assert.deepEqual(acl,{service:true,anon:false,authenticated:false,private:false});
  const q=(p,patch={})=>({siteId:p.site,expectedEmployeeId:p.employee,expectedWorkerId:p.worker,notificationId:null,beforeAt:null,beforeId:null,...patch});
  const read=(p,query=q(p),allow=true)=>{const before=all(),r=core.parseEventNotificationsResult(call(eventNotificationsExpression(query,p.auth,null,allow)),query,p.auth);assert.equal(all(),before);reads++;return r;};
  const mark=(p,notificationId,allow=true)=>{const query=q(p,{notificationId}),command={action:'mark_read',notificationId};
    const r=core.parseEventNotificationsResult(call(eventNotificationsExpression(query,p.auth,command,allow)),query,p.auth,command);writes++;return r;};
  const reject=(expression,pattern)=>{const before=all();assert.throws(()=>call(expression),new RegExp('ERROR:\\s+(?:'+pattern+')(?:\\s|$)'));assert.equal(all(),before);rejections++;};
  const captures=(p,op=null)=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(x) order by occurred_at,notification_id),'[]') from public.merchant_attendance_event_notifications x where merchant_id=${quote(p.site)}${op?` and operation_id=${quote(op)}`:''};`));
  const schedule=(p,command,evidence=true)=>call(wrapped('faolla_attendance_schedule_event_v1',ctx.oq(p),p.owner,command,true,','+evidence));
  const scheduleCommand=(p,slots=p.slots,operationId=next())=>{const s=ctx.oldRead(p);return {action:'publish',operationId,expectedRevision:s.revision,expectedSettingsVersion:ctx.settings(p).version,
    reason:'Synthetic200 notification publication',locationId:p.location,timeZone:'UTC',slots};};
  const cancelCommand=(p,slotId)=>{const s=ctx.oldRead(p);return {action:'cancel',operationId:next(),expectedRevision:s.revision,expectedSettingsVersion:ctx.settings(p).version,reason:'Synthetic200 cancellation',slotId};};
  // These six explicitly unused slots are within198's fixed synthetic seed range.
  // No new database, copied schema, production Auth or merchant is selected.
  for(const n of [12,13,14,15,16,17])assert.equal(exec(`select count(*) from public.merchants where id=${quote(String(99990200+n))};`),'0');
  try{
    phase='schedule-original-and-capture';const p=ctx.seed(12),publication=scheduleCommand(p),published=schedule(p,publication);
    assert.equal(captures(p).length,1);assert.equal(captures(p)[0].capture_status,'ready');
    let list=read(p);assert.equal(list.items.length,1);assert.equal(list.items[0].type,'published');
    const first=list.items[0],detail=read(p,q(p,{notificationId:first.notificationId})).detail;
    assert.equal(detail.summary.segments.length,1);assert.equal(detail.sourceOperationId,publication.operationId);
    const beforeReplay=all();schedule(p,publication);assert.equal(all(),beforeReplay);
    const cc=cancelCommand(p,published.entries[0].id);schedule(p,cc);assert.equal(captures(p).length,2);assert.equal(read(p).items[0].type,'cancelled');
    const legacy=ctx.seed(13),lc=scheduleCommand(legacy);schedule(legacy,lc,false);
    assert.equal(captures(legacy)[0].capture_status,'recipient_unavailable');assert.equal(read(legacy).items.length,0);
    assert.equal(exec(`select count(*) from public.merchant_attendance_schedule_publication_evidence where merchant_id=${quote(legacy.site)};`),'0');
    schedule(legacy,cancelCommand(legacy,ctx.oldRead(legacy).entries[0].id),false);assert.equal(captures(legacy).length,2);
    assert(captures(legacy).every(x=>x.capture_status==='recipient_unavailable'));
    //136's historical unbound shape remains a defensive branch. Current member
    //constraints require active/Auth, so do not disable guards to manufacture an
    //unreachable live publication. The actual099 unavailable path is tested above.
    const off=ctx.seed(14),beforeCapture=ctx.oldPublish(off);assert.equal(captures(off).length,0);
    const oldCommand=JSON.parse(exec(`select command from public.merchant_attendance_schedule_commands where merchant_id=${quote(off.site)} order by revision desc limit 1;`));
    schedule(off,oldCommand);assert.equal(captures(off).length,0,'no_later_flag_backfill');
    assert.equal(beforeCapture.entries.length,1);
    native.pass('200 owner publish/cancel ready; original099 unavailable stays legal with no136 upgrade; old operation never backfilled');

    phase='schedule-delegate-and-multisegment';const delegated=ctx.seed(15);await ctx.grant(delegated);
    const dc=ctx.publish(delegated),dq=ctx.sq(delegated);
    const dr=call(wrapped('faolla_attendance_schedule_delegation_event_v1',dq,delegated.delegateAuth,dc));
    assert.equal(dr.receipt.actorId,delegated.delegateAuth);assert.equal(captures(delegated).length,1);assert.equal(read(delegated).items[0].type,'published');
    const cancelled=ctx.cancel(delegated,ctx.read(delegated,dq).schedule.entries[0].slotId);
    call(wrapped('faolla_attendance_schedule_delegation_event_v1',dq,delegated.delegateAuth,cancelled));
    assert.equal(read(delegated).items[0].type,'cancelled');
    const batch=ctx.seed(16),base=Date.parse(batch.slots[0][0]),slots=Array.from({length:32},(_,n)=>[new Date(base+n*900000).toISOString(),new Date(base+n*900000+600000).toISOString()]);
    schedule(batch,scheduleCommand(batch,slots));const batchItem=read(batch).items[0];
    assert.equal(read(batch,q(batch,{notificationId:batchItem.notificationId})).detail.summary.segments.length,32);assert.equal(captures(batch).length,1);
    native.pass('200 actual167 delegated publish/cancel and one bounded notification for32 published segments');

    phase='work-owner-and-delegate';const browserDate=new Date(Date.now()+40*86400000).toISOString().slice(0,10),
      workSubject={site:d.site,owner:d.owner,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:d.location,
        fromDate:browserDate,throughDate:browserDate,slots:[[browserDate+'T08:00:00.000Z',browserDate+'T09:00:00.000Z']]};
    const workq=(requestId=null)=>ctx.oldQuery('work_arrangement',{access:'owner',requestId});
    const work=(query,command)=>call(wrapped('faolla_attendance_work_arrangement_event_v1',query,d.owner,command));
    const request=await ctx.submit('work_arrangement','remote'),ownerDetail=await ctx.old('work_arrangement',workq(request.requestId));
    const approval={action:'approve',operationId:next(),requestId:request.requestId,expectedRevision:1,reason:'Synthetic200 explicit original owner approval',
      expectedConflictsFingerprint:ownerDetail.detail.conflictsFingerprint,confirmConflicts:ownerDetail.detail.conflicts.length>0};
    work(workq(request.requestId),approval);assert.equal(captures(workSubject,approval.operationId)[0].event_type,'approved');
    const cancelApproval={action:'cancel',operationId:next(),requestId:request.requestId,expectedRevision:2,reason:'Synthetic200 original owner cancel'};
    work(workq(request.requestId),cancelApproval);assert.equal(captures(workSubject,cancelApproval.operationId)[0].source_revision,3);
    const declined=await ctx.submit('work_arrangement','field'),rejection={action:'reject',operationId:next(),requestId:declined.requestId,expectedRevision:1,reason:'Synthetic200 rejection'};
    work(workq(declined.requestId),rejection);assert.equal(captures(workSubject,rejection.operationId)[0].event_type,'rejected');
    const grantCommand={action:'grant',operationId:next(),delegateEmployeeId:ctx.delegateEmployee,delegateAuthUserId:ctx.delegateAuth,
      workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,category:'work_arrangement',kinds:['remote'],includePending:false,
      validFrom:new Date(Date.now()-60000).toISOString().replace('Z','000Z'),validUntil:new Date(Date.now()+3600000).toISOString().replace('Z','000Z'),reason:'Synthetic200 delegated notification scope'};
    ctx.raw(ctx.ownerQuery(),grantCommand);
    for(const action of ['approve','reject']){
      const r=await ctx.submit('work_arrangement','remote'),v=ctx.detail(grantCommand.operationId,r),c=ctx.decide(grantCommand.operationId,r,v,action),query=ctx.post(grantCommand.operationId,r);
      const saved=call(wrapped('faolla_attendance_delegated_applications_event_v1',query,ctx.delegateAuth,c,true,',true'));
      assert.equal(saved.receipt.category,'work_arrangement');assert.equal(captures(workSubject,c.decision.operationId).length,1);
      assert.equal(captures(workSubject,c.decision.operationId)[0].actor_auth_user_id,ctx.delegateAuth);
    }
    const rebound=await ctx.submit('work_arrangement','remote'),reboundOp=next(),replacementAuth=next();
    try{exec(`update public.merchant_enterprise_employees set auth_user_id=${quote(replacementAuth)} where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)};`);
      work(workq(rebound.requestId),{action:'reject',operationId:reboundOp,requestId:rebound.requestId,expectedRevision:1,reason:'Synthetic200 safely close original identity request'});
      assert.equal(captures(workSubject,reboundOp)[0].recipient_auth_user_id,h.employeeAuthUserId);
      assert.equal(read({...workSubject,auth:replacementAuth}).items.length,0);}
    finally{exec(`update public.merchant_enterprise_employees set auth_user_id=${quote(h.employeeAuthUserId)} where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)};`);}
    native.pass('200 actual156 owner approve/reject/cancel and162 delegated work approve/reject retain original recipient and actor');

    phase='exception-and-category-collision';
    schedule(workSubject,scheduleCommand(workSubject,workSubject.slots,approval.operationId));
    const exceptionBase={siteId:d.site,access:'owner',mode:'detail',workerId:h.workerId,slotId:h.slot.id,operationId:null,beforeAt:null,beforeId:null};
    const er=call(wrapped('faolla_attendance_plan_exception_review_v1',exceptionBase,d.owner));
    const source=call(`public.faolla_attendance_plan_exception_source_v1(${json({siteId:d.site,workerId:h.workerId,slotId:h.slot.id})},${quote(d.owner)})`);
    const exceptionOp=approval.operationId,eq={...exceptionBase,mode:'decide',operationId:exceptionOp};
    const ec={operationId:exceptionOp,expectedRevision:er.detail?.revision??0,expectedFingerprint:source.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome:'follow_up',note:'Synthetic200 explicit owner follow-up'};
    const exceptionResult=call(wrapped('faolla_attendance_plan_exception_review_event_v1',eq,d.owner,ec));
    assert.equal(exceptionResult.receipt.operationId,exceptionOp);assert.equal(captures(workSubject,exceptionOp).length,3,'three_categories_share_operation_uuid');
    const immutableReads=d.fingerprint(['merchant_attendance_plan_exception_reads']);
    const ownMessages=read(workSubject),exceptionItem=ownMessages.items.find(x=>x.sourceCategory==='plan_exception');assert(exceptionItem);
    const marked=mark(workSubject,exceptionItem.notificationId).detail;assert(marked.readAt);assert.equal(marked.summary.outcome,'follow_up');
    assert.equal(d.fingerprint(['merchant_attendance_plan_exception_reads']),immutableReads,'notification_read_must_not_ack_business');
    const markBefore=all();assert.equal(mark(workSubject,exceptionItem.notificationId,false).detail.readAt,marked.readAt);assert.equal(all(),markBefore);
    assert.equal(read(workSubject,q(workSubject,{notificationId:exceptionItem.notificationId}),false).detail.readAt,marked.readAt);
    native.pass('200 actual159 decision and category-colliding operation IDs; explicit mark-read is independent of original exception ack and survives lost response');

    phase='pagination';
    // 32 actual published slots each legally cancelled produce33 messages total.
    for(const entry of ctx.oldRead(batch).entries)schedule(batch,cancelCommand(batch,entry.id));
    const one=read(batch);assert.equal(one.items.length,25);assert(one.nextCursor);
    const two=read(batch,q(batch,{beforeAt:one.nextCursor.at,beforeId:one.nextCursor.id}));assert.equal(two.items.length,8);assert.equal(two.nextCursor,null);
    assert.equal(new Set([...one.items,...two.items].map(x=>x.notificationId)).size,33);
    reject(eventNotificationsExpression(q(batch,{expectedWorkerId:p.worker}),batch.auth),'attendance_worker_changed|attendance_access_denied');
    reject(eventNotificationsExpression(q(batch,{notificationId:first.notificationId}),batch.auth),'attendance_event_notification_not_found|attendance_notification_not_found|attendance_access_denied');
    reject(eventNotificationsExpression({...q(batch),siteId:p.site},batch.auth),'attendance_access_denied');
    const unread=one.items[0].notificationId;reject(eventNotificationsExpression(q(batch,{notificationId:unread}),batch.auth,{action:'mark_read',notificationId:unread},false),'attendance_platform_paused');
    native.pass('200 actual25+1 keyset pagination covers33 messages without duplicate; cross-worker/message and first mark while paused refuse');

    phase='identity-roles-and-paused-worker';
    const originalPermissions=exec(`select to_jsonb(permissions) from public.merchant_enterprise_roles where merchant_id=${quote(p.site)} and id=${quote(p.role)};`);
    try{
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view']::text[] where merchant_id=${quote(p.site)} and id=${quote(p.role)};`);
      reject(eventNotificationsExpression(q(p),p.auth),'attendance_access_denied');
    }finally{exec(`update public.merchant_enterprise_roles set permissions=array(select jsonb_array_elements_text(${originalPermissions?quote(originalPermissions)+'::jsonb':"'[]'::jsonb"})) where merchant_id=${quote(p.site)} and id=${quote(p.role)};`);}
    const state=ctx.worker(p);ctx.admin(p,'worker',{id:p.worker,employeeId:p.employee,workerNo:p.workerNo,displayName:p.name,locationId:p.location,active:false,startsOn:state.employment_start_date??'2000-01-01'});
    assert.equal(read(p).items.length,2,'paused_worker_keeps_personal_history');
    const replacement=next();
    try{
      exec(`update public.merchant_enterprise_employees set auth_user_id=${quote(replacement)} where merchant_id=${quote(p.site)} and id=${quote(p.employee)};`);
      reject(eventNotificationsExpression(q(p),p.auth),'attendance_access_denied');
      assert.equal(read({...p,auth:replacement}).items.length,0,'new_auth_does_not_inherit_messages');
      reject(eventNotificationsExpression(q(p,{notificationId:first.notificationId}),replacement),'attendance_event_notification_not_found|attendance_notification_not_found|attendance_access_denied');
    }finally{exec(`update public.merchant_enterprise_employees set auth_user_id=${quote(p.auth)} where merchant_id=${quote(p.site)} and id=${quote(p.employee)};`);}
    ctx.status(p,'disabled',p.employee,false);reject(eventNotificationsExpression(q(p),p.auth),'attendance_access_denied');
    ctx.status(p,'active',p.employee,false);assert.equal(read(p).items.length,2);
    const unboundMember={...p,employee:p.delegateEmployee,auth:p.delegateAuth,worker:null},empty=read(unboundMember);
    assert.equal(empty.workerId,null);assert.deepEqual(empty.items,[]);assert.equal(empty.canMarkRead,false);
    native.pass('200 role withdrawal and Auth replacement cannot read original message; worker pause remains readable');

    phase='capture-atomicity';const atomic=ctx.seed(17),ac=scheduleCommand(atomic);
    const atomicWork=await ctx.submit('work_arrangement','remote'),atomicOwnerCommand={action:'reject',operationId:next(),requestId:atomicWork.requestId,expectedRevision:1,reason:'Synthetic200 atomic owner'};
    const atomicDelegateWork=await ctx.submit('work_arrangement','remote'),atomicDelegateView=ctx.detail(grantCommand.operationId,atomicDelegateWork),
      atomicDelegateCommand=ctx.decide(grantCommand.operationId,atomicDelegateWork,atomicDelegateView,'reject');
    const atomicScheduleCommand=ctx.publish(delegated),atomicExceptionSource=call(`public.faolla_attendance_plan_exception_source_v1(${json({siteId:d.site,workerId:h.workerId,slotId:h.slot.id})},${quote(d.owner)})`),
      atomicExceptionCurrent=call(wrapped('faolla_attendance_plan_exception_review_v1',exceptionBase,d.owner)),atomicExceptionOp=next(),
      atomicExceptionQuery={...exceptionBase,mode:'decide',operationId:atomicExceptionOp},atomicExceptionCommand={...ec,operationId:atomicExceptionOp,
        expectedRevision:atomicExceptionCurrent.detail.revision,expectedFingerprint:atomicExceptionSource.fingerprint};
    assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
    exec(`create function public.synthetic200_capture_fail() returns trigger language plpgsql as $f$ begin raise exception 'synthetic200_capture_failure';end;$f$;
      create trigger synthetic200_capture_fail before insert on public.merchant_attendance_event_notifications for each row execute function public.synthetic200_capture_fail();`);
    const atomicExpressions=[wrapped('faolla_attendance_schedule_event_v1',ctx.oq(atomic),atomic.owner,ac,true,',true'),
        wrapped('faolla_attendance_schedule_delegation_event_v1',dq,delegated.delegateAuth,atomicScheduleCommand),
        wrapped('faolla_attendance_work_arrangement_event_v1',workq(atomicWork.requestId),d.owner,atomicOwnerCommand),
        wrapped('faolla_attendance_delegated_applications_event_v1',ctx.post(grantCommand.operationId,atomicDelegateWork),ctx.delegateAuth,atomicDelegateCommand,true,',true'),
        wrapped('faolla_attendance_plan_exception_review_event_v1',atomicExceptionQuery,d.owner,atomicExceptionCommand)];
    try{
      for(const expression of atomicExpressions)
        reject(expression,'attendance_[a-z_]+|synthetic200_capture_failure');
    }
    finally{exec('drop trigger synthetic200_capture_fail on public.merchant_attendance_event_notifications;drop function public.synthetic200_capture_fail();');}
    assert.equal(ctx.oldRead(atomic).entries.length,0);assert.equal(captures(atomic).length,0);
    // The exact formerly failing writes must all succeed once only the injected
    // failure is removed: a preexisting business rejection is not failure proof.
    for(const expression of atomicExpressions)call(expression);
    for(const [subject,op] of [[atomic,ac.operationId],[delegated,atomicScheduleCommand.decision.operationId],
      [workSubject,atomicOwnerCommand.operationId],[workSubject,atomicDelegateCommand.decision.operationId],[workSubject,atomicExceptionOp]])
      assert.equal(captures(subject,op).length,1);
    native.pass('200 real capture-table failure rolls all five source writes back; original schedule ID can then succeed');

    phase='original-wrapper-races';
    const newSlot=[[new Date(base+9*3600000).toISOString(),new Date(base+9*3600000+600000).toISOString()]];
    const raceCommand=scheduleCommand(atomic,newSlot),newExp=wrapped('faolla_attendance_schedule_event_v1',ctx.oq(atomic),atomic.owner,raceCommand,true,',true');
    const oldExp=wrapped('faolla_attendance_schedule_evidenced_v1',ctx.oq(atomic),atomic.owner,raceCommand);
    const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
    const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},prefix+'select '+oldExp+';',prefix+'select '+newExp+';');
    assert(race.witnessed&&!race.right.error);assert.equal(captures(atomic,raceCommand.operationId).length,0,'old_winner_not_backfilled');
    const mr=read(atomic).items[0],mq=q(atomic,{notificationId:mr.notificationId}),mc={action:'mark_read',notificationId:mr.notificationId};
    const me=eventNotificationsExpression(mq,atomic.auth,mc);
    const readRace=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},prefix+'select '+me+';',prefix+'select '+me+';');
    assert(readRace.witnessed&&!readRace.right.error);assert(read(atomic,mq).detail.readAt);
    native.pass('200 witnessed two-PID original/capture race does not backfill old winner; concurrent first-read records once');

    phase='exception-original-wrapper-races';
    const exceptionRaces=await verifyEventNotificationExceptionRaces({native,scope,d,call,captures,workSubject,exceptionBase,next});

    phase='service-and-browser';
    const sourceServices=await verifyEventSourceServices({ctx,operations:[
      {file:'merchantAttendanceSchedule.server.ts',name:'executeAttendanceSchedule',query:ctx.oq(atomic),command:ac,authUserId:atomic.owner,rpc:'faolla_attendance_schedule_event_v1'},
      {file:'merchantAttendanceScheduleDelegation.server.ts',name:'executeScheduleDelegation',query:dq,command:atomicScheduleCommand,authUserId:delegated.delegateAuth,rpc:'faolla_attendance_schedule_delegation_event_v1'},
      {file:'merchantAttendanceWorkArrangement.server.ts',name:'executeWorkArrangement',query:workq(atomicWork.requestId),command:atomicOwnerCommand,authUserId:d.owner,rpc:'faolla_attendance_work_arrangement_event_v1'},
      {file:'merchantAttendanceApplicationDelegation.server.ts',name:'executeApplicationDelegation',query:ctx.post(grantCommand.operationId,atomicDelegateWork),command:atomicDelegateCommand,authUserId:ctx.delegateAuth,rpc:'faolla_attendance_delegated_applications_event_v1'},
      {file:'merchantAttendancePlanExceptions.server.ts',name:'executePlanExceptions',query:atomicExceptionQuery,command:atomicExceptionCommand,authUserId:d.owner,rpc:'faolla_attendance_plan_exception_review_event_v1'},
    ]});
    const ports={...ctx,subject:workSubject,notificationSubject:workSubject,q,read,mark,captures,next};
    const integration=await prepareEventNotificationsBrowser(ports);
    const browser=browserCheck?await browserCheck(ports):null;
    phase='reapply';const endFacts=all(),endDefinitions=d.definitions(),endCatalog=d.tableCatalog();install();
    assert.equal(all(),endFacts);assert.equal(d.definitions(),endDefinitions);assert.equal(d.tableCatalog(),endCatalog);assert.equal(definitions(),oldDefinitions);
    return {reads,writes,rejections,exceptionRaces,sourceServices,integration,browser,actualFiveSourcePaths:true,sourceCategoryCollision:true,oldDefinitionsProtected:true,production:false,deployed:false};
  }catch(error){throw Error('event_notifications_phase='+phase+': '+String(error),{cause:error});}
}

async function verifyEventSourceServices({ctx,operations}){
  const keys=['FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED','FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES',
    'FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED','FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS'];
  const previous=keys.map(k=>process.env[k]),seen=[];
  process.env[keys[1]]=[...new Set(operations.map(x=>x.query.siteId))].join(',');
  process.env[keys[2]]='1';process.env[keys[3]]=process.env[keys[1]];
  const names=new Set(operations.map(x=>x.rpc));
  ['faolla_attendance_schedule_evidenced_v1','faolla_attendance_schedule_v1','faolla_attendance_schedule_delegation_v1',
    'faolla_attendance_work_arrangement_v1','faolla_attendance_delegated_applications_v1','faolla_attendance_plan_exception_review_v1'].forEach(x=>names.add(x));
  const service={rpc:async(name,a)=>{assert(names.has(name));seen.push(name);
    const extra=Object.hasOwn(a,'p_capture_publication_evidence')?','+a.p_capture_publication_evidence:Object.hasOwn(a,'p_capture_notifications')?','+a.p_capture_notifications:'';
    try{return {data:ctx.call(wrapped(name,a.p_query,a.p_auth_user_id,a.p_command,a.p_allow_write,extra)),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  try{for(const op of operations){const execute=require('../../src/lib/'+op.file)[op.name],input={query:op.query,command:op.command,authUserId:op.authUserId,allowWrite:true,moduleEnabled:true},before=ctx.all();
    process.env[keys[0]]='0';const original=await execute(input,service);assert(!seen.at(-1).includes('_event_v1'));
    process.env[keys[0]]='1';const captured=await execute(input,service);assert.equal(seen.at(-1),op.rpc);
    assert.deepEqual(captured.receipt,original.receipt);assert.equal(ctx.all(),before,'source_service_replay_wrote');
  }
    ctx.native.pass('200 all five actual server dispatches and strict original response parsers retain flag-off/on receipts without replay writes');
    return {actualServices:5,sqlCalls:seen.length,originalResponsePreserved:true};
  }finally{keys.forEach((k,n)=>{if(previous[n]===undefined)delete process.env[k];else process.env[k]=previous[n];});}
}

async function prepareEventNotificationsBrowser(ctx){
  const {executeEventNotifications}=require('../../src/lib/merchantAttendanceEventNotifications.server.ts');
  const {handleEventNotifications}=require('../../src/app/api/merchant-enterprise/attendance/event-notifications/route-handler.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
  const {eventNotificationsQueryString}=require('../../src/lib/merchantAttendanceEventNotifications.ts');
  const {resolveCanonicalPortalOrigin}=require('../../src/lib/canonicalPortalRequest.ts');
  const calls=[],p=ctx.subject,service={rpc:async(name,args)=>{
    assert([rpc,'faolla_attendance_self_v1'].includes(name));calls.push({name,write:args.p_command!==null});
    const exp=name===rpc?eventNotificationsExpression(args.p_query,args.p_auth_user_id,args.p_command,args.p_allow_write)
      :`public.${name}(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},null,${quote(args.p_operation_id)})`;
    try{return {data:ctx.call(exp),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const auth=async()=>({user:{id:p.auth},authenticationMethods:['password']}),entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}});
  const handleNotifications=(request,options={})=>handleEventNotifications(request,{authenticate:auth,entitlement,allow:()=>true,enabled:()=>true,execute:input=>executeEventNotifications(input,service),...options});
  const handleSelf=request=>{assert.equal(request.method,'GET');return handleAttendanceSelf(request,{authenticate:auth,entitlement,allow:()=>true,execute:input=>executeAttendanceSelf(input,service)});};
  const origin=resolveCanonicalPortalOrigin(),headers={origin,'sec-fetch-site':'same-origin','content-type':'application/json'},url=origin+'/api/merchant-enterprise/attendance/event-notifications';
  const before=ctx.all(),response=await handleNotifications(new Request(url+'?'+eventNotificationsQueryString(ctx.q(p)),{headers}));
  assert.equal(response.status,200,await response.clone().text());assert.equal(ctx.all(),before);
  const body=await response.json();assert.equal(body.ok,true);assert(body.items.length>0);
  Object.assign(ctx,{handleNotifications,handleSelf,readState:()=>ctx.read(p),fingerprint:ctx.all,origin});
  ctx.native.pass('200 real event-notification handler/service/RPC read with strong synthetic Auth; no real login or production');
  return {actualHandlerService:true,sqlCalls:calls.length,realLogin:false};
}
