//191 imports are inert; only the guarded, caller-owned synthetic database is used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const rpcFor=q=>q.access==='owner'?'faolla_attendance_application_delegations_v1':'faolla_attendance_delegated_applications_v1';
export const applicationDelegationExpression=(q,actor,c=null,allow=true,capture=false)=>`public.${rpcFor(q)}(${json(q)},${quote(actor)},${json(c)},${allow},${capture})`;
const instant=date=>date.toISOString().replace('Z','000Z');
export async function verifyApplicationDelegationNative({d,h,native,scope},browserCheck=null,afterVerified=null){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const {exec}=d;let phase='install',sequence=191100000,reads=0,rejections=0,rpcCalls=0,slot=0;
  const next=()=>id(++sequence),previousCapture=process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;
  process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED='1';
  try{
    // The minimal schedule/period preparation intentionally omits optional125.
    // This feature consumes its actual notification table, so install it explicitly.
    if(exec('select count(*) from public.faolla_schema_migrations where version=202610040125;')==='0')
      exec(boundClockMigrationBody(native.root,'202610040125_merchant_attendance_leave_notifications.sql'));
    // Preserve189 unchanged and its transaction-outside-CIC installation.
    native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610060160_merchant_attendance_missing_delegation.sql'),'utf8')));
    exec(boundClockMigrationBody(native.root,'202610060161_merchant_attendance_missing_delegation_permission.sql'));
    const prior=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(prior);
    const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
    const oldDefs=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
      from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.proname<>'faolla_valid_merchant_enterprise_permissions_v1';`);
    const originalDefs=oldDefs();
    const install=()=>{for(const m of ['202610060162_merchant_attendance_application_delegation.sql','202610060163_merchant_attendance_application_delegation_permissions.sql'])exec(boundClockMigrationBody(native.root,m));};
    install();assert.equal(d.fingerprint(prior),facts);assert.equal(oldDefs(),originalDefs);
    const installed=d.fingerprint(),definitions=d.definitions();install();assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);
    native.pass('162/163 installation and reentry preserve all prior facts and old function definitions except additive permission catalog');
    phase='owned-role-setup';
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['enterprise.view','attendance.self.view','attendance.self.leave','attendance.self.work_arrangement','attendance.self.export','attendance.leave.review','attendance.work_arrangement.review']) p order by p)
      where merchant_id=${quote(d.site)} and id in(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id in(${quote(d.employee)},${quote(h.employeeId)}));`);
    const delegateAuth=d.auth,delegateEmployee=d.employee;
    const ownerQuery=(patch={})=>({siteId:d.site,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null,...patch});
    const delegateQuery=(patch={})=>({siteId:d.site,access:'delegate',mode:'grants',grantId:null,requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null,...patch});
    const expr=(q,c=null,allow=true,actor=q.access==='owner'?d.owner:delegateAuth,capture=true)=>applicationDelegationExpression(q,actor,c,allow,capture);
    const {parseApplicationDelegationResult,applicationDelegationQueryString,applicationDelegationFingerprintText}=require('../../src/lib/merchantAttendanceApplicationDelegation.ts');
    const {executeApplicationDelegation}=require('../../src/lib/merchantAttendanceApplicationDelegation.server.ts');
    const {handleApplicationDelegation}=require('../../src/app/api/merchant-enterprise/attendance/application-delegation/route-handler.ts');
    const raw=(q,c=null,allow=true,a=q.access==='owner'?d.owner:delegateAuth,capture=true)=>{
      const value=JSON.parse(exec('set local role service_role;select '+expr(q,c,allow,a,capture)+';'));
      try{return parseApplicationDelegationResult(value,q,{authUserId:a},c);}catch(error){throw new Error('application_wire_rejected:'+JSON.stringify({q,c,value}).slice(0,9000),{cause:error});}
    };
    const read=(q,allow=true,a=q.access==='owner'?d.owner:delegateAuth)=>{const before=d.fingerprint(),r=raw(q,null,allow,a);assert.equal(d.fingerprint(),before);reads++;return r;};
    const reject=(pattern,q,c=null,allow=true,a=q.access==='owner'?d.owner:delegateAuth)=>{const before=d.fingerprint();assert.throws(()=>raw(q,c,allow,a),new RegExp('ERROR:\\s+(?:'+pattern+')(?:\\s|$)'));assert.equal(d.fingerprint(),before);rejections++;};
    const service={rpc:async(name,a)=>{assert.equal(name,rpcFor(a.p_query));rpcCalls++;try{return {data:JSON.parse(exec('set local role service_role;select '+expr(a.p_query,a.p_command,a.p_allow_write,a.p_auth_user_id,a.p_capture_notifications)+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const execute=(q,c=null,allow=true,a=q.access==='owner'?d.owner:delegateAuth)=>executeApplicationDelegation({query:q,command:c,authUserId:a,allowWrite:allow},service);
    const handle=(request,access='delegate',enabled=true)=>handleApplicationDelegation(request,{enabled:()=>enabled,allow:()=>true,
      authenticate:async()=>({user:{id:access==='owner'?d.owner:delegateAuth},authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executeApplicationDelegation(input,service)});
    const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts'),{executeWorkArrangement}=require('../../src/lib/merchantAttendanceWorkArrangement.server.ts');
    const oldQuery=(category,patch={})=>({siteId:d.site,access:'self',requestId:null,operationId:null,beforeAt:null,beforeId:null,...(category==='work_arrangement'?{preview:null}:{}),...patch});
    const oldService={rpc:async(name,a)=>{assert(['faolla_attendance_leave_v1','faolla_attendance_leave_notify_v1','faolla_attendance_work_arrangement_v1'].includes(name));
      try{return {data:JSON.parse(exec(`set local role service_role;select public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_write});`)),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const old=(category,q,c=null)=> (category==='leave'?executeLeave:executeWorkArrangement)({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},oldService);
    const oldRead=(category,requestId)=>old(category,oldQuery(category,{requestId}));
    const submit=async(category='leave',kind='trip',overrides={})=>{
      const home=await old(category,oldQuery(category));assert(home.canSubmit,'old_self_can_submit');
      const day=new Date(Date.now()+(3+(slot++))*86400000).toISOString().slice(0,10);
      const c={action:'submit',operationId:next(),reason:'Synthetic191 employee original application',expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,
        timeZone:home.timeZone,startAt:day+'T05:00:00.000Z',endAt:day+'T06:00:00.000Z',...(category==='work_arrangement'?{kind,expectedPolicyRevision:home.policy.revision}:{}),...overrides};
      const result=await old(category,oldQuery(category),c);assert.equal(result.detail.status,'submitted');return {...result.detail,operationId:c.operationId,command:c};
    };
    const grant=(category='leave',overrides={})=>({action:'grant',operationId:next(),delegateEmployeeId:delegateEmployee,delegateAuthUserId:delegateAuth,
      workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,category,kinds:category==='leave'?[]:['remote'],includePending:false,
      validFrom:instant(new Date(Date.now()-60000)),validUntil:instant(new Date(Date.now()+3600000)),reason:'Synthetic191 explicit independent scope',...overrides});
    const detail=(g,r)=>read(delegateQuery({mode:'detail',grantId:g,requestId:r.requestId})).detail;
    const decide=(g,r,v,action='approve')=>({grantId:g,expectedGrantRevision:1,expectedEvidenceFingerprint:v.evidenceFingerprint,
      decision:{action,operationId:next(),requestId:r.requestId,expectedRevision:1,reason:'Synthetic191 真正受托审批 "原号" \\结果',
        ...(v.category==='work_arrangement'&&action==='approve'?{expectedConflictsFingerprint:v.conflictsFingerprint,confirmConflicts:v.conflicts.length>0}:{})}});
    const post=(g,r)=>delegateQuery({mode:'decide',grantId:g,requestId:r.requestId});
    const fingerprint=(q,c)=>createHash('sha256').update(applicationDelegationFingerprintText(q.siteId,q.access,c),'utf8').digest('hex');
    phase='catalog-history';
    assert(read(ownerQuery({mode:'catalog',catalog:'delegates'})).catalogItems.some(x=>x.id===delegateEmployee));
    assert(read(ownerQuery({mode:'catalog',catalog:'workers'})).catalogItems.some(x=>x.id===h.workerId));
    const historical=await submit(),lg=grant(),lr=raw(ownerQuery(),lg);assert.equal(lr.receipt.commandFingerprint,fingerprint(ownerQuery(),lg));
    assert.equal(read(delegateQuery({mode:'list',grantId:lg.operationId})).items.some(x=>x.requestId===historical.requestId),false);
    reject('attendance_(access_denied|application_delegation_not_found)',delegateQuery({mode:'detail',grantId:lg.operationId,requestId:historical.requestId}));
    const replayBefore=d.fingerprint();assert.deepEqual(raw(ownerQuery(),lg).receipt,lr.receipt);assert.equal(d.fingerprint(),replayBefore);
    // A period can only be sealed after its saved local date has ended. Use an
    // actual recent request outside the older compatibility archive, not a future day.
    const completedDay=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const fresh=await submit('leave','trip',{startAt:completedDay+'T05:00:00.000Z',endAt:completedDay+'T06:00:00.000Z'}),fv=detail(lg.operationId,fresh);assert(fv.canApprove&&!fv.blocked);
    const command=decide(lg.operationId,fresh,fv),query=post(lg.operationId,fresh),terminal=await execute(query,command);
    assert.equal(terminal.receipt.actorId,delegateAuth);assert.equal(terminal.receipt.commandFingerprint,fingerprint(query,command));
    assert.equal((await oldRead('leave',fresh.requestId)).detail.status,'approved');
    const entry=JSON.parse(exec(`select jsonb_build_object('actor',actor_auth_user_id,'command',command) from public.merchant_attendance_leave_entries where merchant_id=${quote(d.site)} and operation_id=${quote(command.decision.operationId)};`));
    assert.equal(entry.actor,delegateAuth);assert.deepEqual(entry.command,command.decision);
    assert.equal(Number(exec(`select count(*) from public.merchant_attendance_leave_notifications where merchant_id=${quote(d.site)} and notification_id=${quote(command.decision.operationId)};`)),1);
    const include=grant('leave',{includePending:true});raw(ownerQuery(),include);const hv=detail(include.operationId,historical);assert(hv.canReject);
    raw(post(include.operationId,historical),decide(include.operationId,historical,hv,'reject'));
    assert.equal((await oldRead('leave',historical.requestId)).detail.status,'rejected');
    native.pass('separate role/catalog, future-only and explicit old-pending grant, real leave approval/rejection and original notification/employee result agree');
    phase='work';const wg=grant('work_arrangement');raw(ownerQuery(),wg);
    const wrongKind=await submit('work_arrangement','trip');reject('attendance_(access_denied|application_delegation_not_found)',delegateQuery({mode:'detail',grantId:wg.operationId,requestId:wrongKind.requestId}));
    const work=await submit('work_arrangement','remote'),wv=detail(wg.operationId,work);assert(wv.canApprove);
    const workCommand=decide(wg.operationId,work,wv),workTerminal=raw(post(wg.operationId,work),workCommand);
    assert.equal(workTerminal.receipt.category,'work_arrangement');assert.equal(workTerminal.receipt.commandFingerprint,fingerprint(post(wg.operationId,work),workCommand));
    const oldWork=await oldRead('work_arrangement',work.requestId);assert.equal(oldWork.detail.status,'approved');assert.equal(oldWork.detail.history.at(-1).actorId,delegateAuth);
    const ownerWork=await old('work_arrangement',oldQuery('work_arrangement',{access:'owner',requestId:wrongKind.requestId}));
    await old('work_arrangement',oldQuery('work_arrangement',{access:'owner',requestId:wrongKind.requestId}),{action:'reject',operationId:next(),requestId:wrongKind.requestId,expectedRevision:1,reason:'Synthetic191 original owner rejection'});
    assert(ownerWork.detail.canReject);assert.equal((await oldRead('work_arrangement',wrongKind.requestId)).detail.status,'rejected');
    native.pass('work kind scope and actual delegate actor retain original work/owner/self protocols');
    phase='period';
    const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
    const periodService={rpc:async(name,a)=>{assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1'].includes(name));
      const expression=name==='faolla_attendance_period_closure_v1'?`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`:`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const period=(q,c=null)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},periodService);
    const day=fresh.startAt.slice(0,10),periodId=next();
    const pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:day,throughDate:day,mode,periodId:pid,operationId:null,version:null});
    const preview=await period(pq());assert(JSON.stringify(preview.preview.artifact).includes(fresh.requestId));assert.deepEqual(preview.preview.blockers,[]);
    const pc=(action,current=null)=>({action,operationId:next(),periodId,expectedRevision:current?.period.revision??0,expectedVersion:current?.period.currentVersion??0,
      expectedFingerprint:current?.artifact.sourceFingerprint??preview.preview.artifact.sourceFingerprint,reason:'Synthetic191 approval in saved period'});
    let current=await period(pq('detail','owner',periodId),pc('send'));current=await period(pq('detail','self',periodId),pc('confirm',current));current=await period(pq('detail','owner',periodId),pc('seal',current));assert(current.period.sealed);
    const sealedRequest=await submit('leave','trip',{startAt:day+'T10:00:00.000Z',endAt:day+'T11:00:00.000Z'}),sv=detail(lg.operationId,sealedRequest);assert(sv.sealed&&!sv.canApprove);
    reject('attendance_period_sealed|attendance_access_denied',post(lg.operationId,sealedRequest),decide(lg.operationId,sealedRequest,sv));
    raw(post(lg.operationId,sealedRequest),decide(lg.operationId,sealedRequest,sv,'reject'));
    native.pass('delegated leave feeds genuine period send/self-confirm/seal; new delegated sealed approval refuses without changing old owner rule');
    phase='recovery-revocation';
    const recovery=delegateQuery({mode:'recover',operationId:command.decision.operationId});
    const revoke={action:'revoke',operationId:next(),grantId:lg.operationId,expectedRevision:1,reason:'Synthetic191 revoke'};
    raw(ownerQuery({mode:'detail',grantId:lg.operationId}),revoke,false);assert.deepEqual(read(recovery,false).receipt,terminal.receipt);
    const handlerResponse=await handle(new Request('https://www.faolla.com/api/merchant-enterprise/attendance/application-delegation?'+applicationDelegationQueryString(recovery),
      {headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}}),'delegate',false);
    assert.equal(handlerResponse.status,200);assert.deepEqual((await handlerResponse.json()).receipt,terminal.receipt);
    const roleWithoutSelf=async callback=>{
      assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
      const before=d.fingerprint(),role=JSON.parse(exec(`select jsonb_build_object('id',r.id,'permissions',r.permissions) from public.merchant_enterprise_roles r
        join public.merchant_enterprise_employees e on e.merchant_id=r.merchant_id and e.role_id=r.id where e.merchant_id=${quote(d.site)} and e.id=${quote(delegateEmployee)};`));
      assert(role?.id&&Array.isArray(role.permissions));
      try{
        exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view']::text[] where merchant_id=${quote(d.site)} and id=${quote(role.id)};`);
        assert.deepEqual(JSON.parse(exec(`select to_jsonb(permissions) from public.merchant_enterprise_roles where merchant_id=${quote(d.site)} and id=${quote(role.id)};`)),['enterprise.view']);
        const withdrawn=d.fingerprint(),result=await callback();assert.equal(d.fingerprint(),withdrawn,'recovery_after_role_withdrawal_wrote');return result;
      }finally{
        exec(`update public.merchant_enterprise_roles set permissions=array(select jsonb_array_elements_text(${json(role.permissions)})) where merchant_id=${quote(d.site)} and id=${quote(role.id)};`);
        assert.equal(d.fingerprint(),before,'synthetic_role_not_restored');
      }
    };
    const context={d,h,native,scope,ownerQuery,delegateQuery,expr,raw,read,reject,execute,handle,service,submit,oldRead,old,oldQuery,grant,detail,decide,post,next,fingerprint,roleWithoutSelf,
      delegateAuth,delegateEmployee,captureNotifications:true,approved:{request:fresh,query,command,receipt:terminal.receipt,recovery},revokedGrantId:lg.operationId};
    // Exact two-PID revoke/approve contention; the preexisting receipt is kept.
    const rg=grant();raw(ownerQuery(),rg);const rr=await submit(),rv=detail(rg.operationId,rr),rc=decide(rg.operationId,rr,rv);
    const revokeRace={action:'revoke',operationId:next(),grantId:rg.operationId,expectedRevision:1,reason:'Synthetic191 concurrent revoke wins'};
    const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
    const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
      prefix+'select '+expr(ownerQuery({mode:'detail',grantId:rg.operationId}),revokeRace)+';',prefix+'select '+expr(post(rg.operationId,rr),rc)+';');
    assert(race.witnessed&&race.right.error);assert.match(String(race.right.error),/attendance_access_denied|attendance_application_delegation_[a-z_]+/);
    assert.equal((await oldRead('leave',rr.requestId)).detail.status,'submitted');
    native.pass('feature-off exact receipt and current-owner safe revoke remain available; concurrent revoke prevents a waiting approval');
    phase='security';const security=await (await import('./attendance-application-delegation-security-native.mjs')).verifyApplicationDelegationSecurityNative(context);
    phase='browser';const browser=browserCheck?await browserCheck(context):null;
    phase='recovery-browser';const recoveryBrowser=browserCheck?await (await import('./attendance-delegation-recovery-browser.mjs')).runDelegationRecoveryBrowserAcceptance(context):null;
    const finalFacts=d.fingerprint(),finalDefs=d.definitions();install();assert.equal(d.fingerprint(),finalFacts);assert.equal(d.definitions(),finalDefs);assert.equal(oldDefs(),originalDefs);
    // Optional later-feature checks run only after191's complete old-definition
    // and installation assertions; default191 behavior remains unchanged.
    const extension=afterVerified?await afterVerified(context):null;
    return {reads,rejections,rpcCalls,realActor:true,historyOptIn:true,kindScope:true,notificationAtomic:true,periodSourceAndSeal:true,revocationRace:true,security,browser,recoveryBrowser,extension,
      existingDatabaseReused:true,productionAccess:false,newDatabase:false,deployment:false};
  }catch(error){throw new Error('application_delegation_phase='+phase+': '+String(error),{cause:error});}
  finally{if(previousCapture===undefined)delete process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED;else process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED=previousCapture;}
}
