//189 caller-owned synthetic namespace only. Importing starts nothing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const migration='202610060160_merchant_attendance_missing_delegation.sql';
const permission='202610060161_merchant_attendance_missing_delegation_permission.sql';
const rpcFor=q=>q.access==='owner'?'faolla_attendance_missing_delegations_v1':'faolla_attendance_delegated_missing_v1';
export const missingDelegationExpression=(q,actor,c=null,allow=true)=>`public.${rpcFor(q)}(${json(q)},${quote(actor)},${json(c)},${allow})`;
const instant=date=>date.toISOString().replace('Z','000Z');
export async function verifyMissingDelegationNative({d,h,native,scope},browserCheck=null){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const {exec}=d;let phase='install';
  try{
    const prior=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(prior);
    const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
    const oldDefs=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
      from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.proname<>'faolla_valid_merchant_enterprise_permissions_v1';`);
    const originalDefs=oldDefs();
    const install=()=>{
      //160 contains CIC: never wrap the whole migration in d.exec's transaction.
      native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',migration),'utf8')));
      exec(boundClockMigrationBody(native.root,permission));
    };
    install();assert.equal(d.fingerprint(prior),facts);assert.equal(oldDefs(),originalDefs);
    const installed=d.fingerprint(),definitions=d.definitions();install();assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);
    native.pass('160/161 reentry preserves every prior fact and all old functions except additive permission catalog');
    phase='synthetic-role-setup';
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['enterprise.view','attendance.self.view','attendance.self.request','attendance.missing.review']) p order by p)
      where merchant_id=${quote(d.site)} and id in(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id in(${quote(d.employee)},${quote(h.employeeId)}));`);
    const actor=d.auth,employee=d.employee;
    assert.notEqual(actor,h.employeeAuthUserId);assert.notEqual(actor,d.owner);
    const ownerQuery=(patch={})=>({siteId:d.site,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null,...patch});
    const delegateQuery=(patch={})=>({siteId:d.site,access:'delegate',mode:'grants',grantId:null,requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null,...patch});
    const expr=(q,c=null,allow=true,a=q.access==='owner'?d.owner:actor)=>missingDelegationExpression(q,a,c,allow);
    let reads=0,negativeChecks=0,sequence=189100000;
    const next=()=>id(++sequence);
    const {parseMissingDelegationResult,missingDelegationQueryString}=require('../../src/lib/merchantAttendanceMissingDelegation.ts');
    const {executeMissingDelegation}=require('../../src/lib/merchantAttendanceMissingDelegation.server.ts');
    const {handleMissingDelegation}=require('../../src/app/api/merchant-enterprise/attendance/missing-delegation/route-handler.ts');
    const raw=(q,c=null,allow=true,a=q.access==='owner'?d.owner:actor)=>{
      const value=JSON.parse(exec('set local role service_role;select '+expr(q,c,allow,a)+';'));
      try{return parseMissingDelegationResult(value,q,{authUserId:a},c);}
      catch(error){throw new Error('synthetic_wire_rejected:'+JSON.stringify({query:q,command:c,value}).slice(0,6000),{cause:error});}
    };
    let rpcCalls=0;
    const service={rpc:async(name,a)=>{assert.equal(name,rpcFor(a.p_query));rpcCalls++;
      try{return {data:JSON.parse(exec('set local role service_role;select '+expr(a.p_query,a.p_command,a.p_allow_write,a.p_auth_user_id)+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const execute=(q,c=null,allow=true,a=q.access==='owner'?d.owner:actor)=>executeMissingDelegation({query:q,command:c,authUserId:a,allowWrite:allow},service);
    const handle=(request,access='delegate',enabled=true)=>handleMissingDelegation(request,{enabled:()=>enabled,allow:()=>true,
      authenticate:async()=>({user:{id:access==='owner'?d.owner:actor},authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executeMissingDelegation(input,service)});
    const read=(q,allow=true,a=q.access==='owner'?d.owner:actor)=>{const before=d.fingerprint();const r=raw(q,null,allow,a);assert.equal(d.fingerprint(),before);reads++;return r;};
    const reject=(code,q,c=null,allow=true,a=q.access==='owner'?d.owner:actor)=>{const before=d.fingerprint();assert.throws(()=>raw(q,c,allow,a),new RegExp('ERROR:\\s+'+code+'(?:\\s|$)'));assert.equal(d.fingerprint(),before);negativeChecks++;};
    phase='catalog';
    const catalogs=Object.fromEntries(['delegates','workers','locations'].map(catalog=>[catalog,read(ownerQuery({mode:'catalog',catalog})).catalogItems]));
    assert(catalogs.delegates.some(e=>e.id===employee&&e.employeeAuthUserId===actor));
    assert(catalogs.workers.some(w=>w.id===h.workerId&&w.employeeId===h.employeeId&&w.employeeAuthUserId===h.employeeAuthUserId));
    assert(catalogs.locations.some(l=>l.id===d.location));
    assert.deepEqual(read(delegateQuery()).grants,[]);
    const grant=(patch={})=>({action:'grant',operationId:next(),delegateEmployeeId:employee,delegateAuthUserId:actor,
      workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,locationId:d.location,
      validFrom:instant(new Date(Date.now()-3600000)),validUntil:instant(new Date(Date.now()+86400000)),reason:'Synthetic189 授权 "范围" \\核验',...patch});
    const fingerprint=(q,c)=>{
      const tail=c.action==='grant'?[c.action,c.operationId,c.delegateEmployeeId,c.delegateAuthUserId,c.workerId,c.employeeId,c.employeeAuthUserId,c.locationId,c.validFrom,c.validUntil,c.reason]
        :c.action==='revoke'?[c.action,c.operationId,c.grantId,c.expectedRevision,c.reason]
          :[c.decision.action,c.decision.operationId,c.grantId,c.expectedGrantRevision,c.decision.requestId,c.decision.expectedRevision,c.decision.evidenceToken,c.decision.reason];
      return createHash('sha256').update('['+['attendance-missing-delegation-v1',q.siteId,q.access,...tail].map(v=>JSON.stringify(v)).join(', ')+']').digest('hex');
    };
    const granted=grant(),grantId=granted.operationId,gq=delegateQuery({mode:'list',grantId});
    phase='grant';const saved=raw(ownerQuery(),granted);assert.equal(saved.receipt.commandFingerprint,fingerprint(ownerQuery(),granted));
    assert.equal(saved.receipt.grantId,grantId);
    assert.deepEqual(read(ownerQuery({mode:'recover',operationId:grantId}),false).receipt,saved.receipt);
    assert(read(delegateQuery()).grants.some(g=>g.grantId===grantId&&g.usable));
    const replayBefore=d.fingerprint();assert.deepEqual(raw(ownerQuery(),granted).receipt,saved.receipt);assert.equal(d.fingerprint(),replayBefore);
    reject('attendance_operation_conflict',ownerQuery(),{...granted,reason:'Different original command'});
    phase='real-self-submit';
    const {executeAttendanceMissing}=require('../../src/lib/merchantAttendanceMissing.server.ts');
    const today=new Date().toISOString().slice(0,10),mq=(patch={})=>({siteId:d.site,access:'self',fromDate:today,throughDate:today,requestId:null,operationId:null,beforeAt:null,beforeId:null,...patch});
    const oldExpression=(q,c=null,a=q.access==='owner'?d.owner:h.employeeAuthUserId)=>`public.faolla_attendance_missing_v1(${json(q)},${quote(a)},${json(c)},true)`;
    const oldService={rpc:async(name,a)=>{assert.equal(name,'faolla_attendance_missing_v1');try{return {data:JSON.parse(exec('set local role service_role;select '+oldExpression(a.p_query,a.p_command,a.p_auth_user_id)+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const missing=async(q,c=null)=>{try{return await executeAttendanceMissing({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},oldService);}
      catch(error){throw new Error('synthetic_old_missing:'+JSON.stringify({q,c}).slice(0,2500)+':'+(error?.stack??String(error)),{cause:error});}};
    phase='self-home';let home=await missing(mq());assert(home.canRequest);let slot=0;
    if(home.policyRevision===0){
      const revision=Number(exec(`select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${quote(d.site)};`));
      exec(`set local role service_role;select public.faolla_attendance_correction_controls_v2(${quote(d.site)},${quote(d.owner)},${json({action:'set_policy',operationId:next(),expectedRevision:revision,expectedSettingsVersion:home.settingsVersion,reason:'Synthetic189 explicit correction policy',submissionWindowDays:365})},null,null,true);`);
      home=await missing(mq());assert(home.policyRevision>0);
    }
    const submit=async()=>{
      const day=new Date(Date.now()-(8+(slot++))*86400000).toISOString().slice(0,10);
      const c={action:'submit',operationId:next(),reason:'Synthetic189 employee genuine missing request',expectedWorkerId:h.workerId,
        expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policyRevision,locationId:d.location,timeZone:home.timeZone,
        proposal:{startAt:day+'T08:00:00.000000Z',endAt:day+'T10:00:00.000000Z',breaks:[]}};
      const r=await missing(mq(),c);assert.equal(r.detail.status,'submitted');return c;
    };
    phase='self-first-submit';const first=await submit(),dq=delegateQuery({mode:'detail',grantId,requestId:first.operationId});
    phase='delegate-list';
    assert(read(gq).items.some(r=>r.requestId===first.operationId));
    phase='delegate-detail';const detail=read(dq).detail;assert(detail.canApprove&&detail.canReject&&!detail.blocked);
    assert.equal(detail.employeeAuthUserId,h.employeeAuthUserId);assert(!Object.hasOwn(detail,'lineage'));assert(!Object.hasOwn(detail,'issues'));
    const decide=(request,review,action='approve',g=grantId)=>({grantId:g,expectedGrantRevision:1,decision:{action,operationId:next(),requestId:request.operationId,expectedRevision:1,evidenceToken:review.evidenceToken,reason:'Synthetic189 授权审核 "本人" \\结果'}});
    const decision=decide(first,detail),postQuery=delegateQuery({mode:'decide',grantId,requestId:first.operationId});
    phase='delegate-approve';const terminal=raw(postQuery,decision);assert.equal(terminal.receipt.commandFingerprint,fingerprint(postQuery,decision));assert.equal(terminal.receipt.actorId,actor);
    assert.equal(terminal.receipt.status,'approved');assert.equal(terminal.detail,null);assert.deepEqual(terminal.items,[]);
    phase='self-approved-detail';const selfResult=await missing(mq({requestId:first.operationId}));assert.equal(selfResult.detail.status,'approved');assert.equal(selfResult.detail.terminal.reason,decision.decision.reason);
    const oldEntry=JSON.parse(exec(`select jsonb_build_object('actor',actor_auth_user_id,'command',command) from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and operation_id=${quote(decision.decision.operationId)};`));
    assert.equal(oldEntry.actor,actor);assert.deepEqual(oldEntry.command,decision.decision);
    const recovery=delegateQuery({mode:'recover',operationId:decision.decision.operationId});assert.deepEqual(read(recovery,false).receipt,terminal.receipt);
    assert.equal(read(gq).items.some(r=>r.requestId===first.operationId),false);
    native.pass('actual employee request, owner exact grant, delegate approval, old employee result and real reviewer ledger agree');
    phase='period-source-compat';
    const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
    const day=first.proposal.startAt.slice(0,10),periodId=next();
    const pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:day,throughDate:day,mode,periodId:pid,operationId:null,version:null});
    const periodService={rpc:async(name,a)=>{let expression;
      if(name==='faolla_attendance_period_closure_v1')expression=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`;
      else{assert.equal(name,'faolla_attendance_period_closure_source_v1');expression=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;}
      try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const period=(q,c=null)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},periodService);
    const beforePeriodRead=d.fingerprint(),preview=await period(pq());assert.equal(d.fingerprint(),beforePeriodRead);
    assert(preview.preview.artifact.report.missing.some(r=>r.requestId===first.operationId&&r.operationId===decision.decision.operationId));
    assert.deepEqual(preview.preview.blockers,[]);
    const periodCommand=(action,current=null)=>({action,operationId:next(),periodId,expectedRevision:current?.period.revision??0,expectedVersion:current?.period.currentVersion??0,
      expectedFingerprint:current?.artifact.sourceFingerprint??preview.preview.artifact.sourceFingerprint,reason:'Synthetic189 delegated approval fixed archive'});
    let current=await period(pq('detail','owner',periodId),periodCommand('send'));
    current=await period(pq('detail','self',periodId),periodCommand('confirm',current));
    current=await period(pq('detail','owner',periodId),periodCommand('seal',current));assert.equal(current.period.sealed,true);
    assert(current.artifact.report.missing.some(r=>r.operationId===decision.decision.operationId));
    native.pass('delegated approval enters genuine period source, self-confirmed fixed version and guarded seal with reviewer actor unchanged');
    phase='reject-and-owner-compat';const second=await submit(),secondQ=delegateQuery({mode:'detail',grantId,requestId:second.operationId});
    raw({...secondQ,mode:'decide'},decide(second,read(secondQ).detail,'reject'));
    assert.equal((await missing(mq({requestId:second.operationId}))).detail.status,'rejected');
    const third=await submit(),ownerDetail=await missing(mq({access:'owner',requestId:third.operationId}));
    await missing(mq({access:'owner',requestId:third.operationId}),{action:'approve',operationId:next(),requestId:third.operationId,expectedRevision:1,evidenceToken:ownerDetail.detail.evidenceToken,reason:'Synthetic189 unchanged owner path'});
    assert.equal((await missing(mq({requestId:third.operationId}))).detail.status,'approved');
    phase='revoke-race';const fourth=await submit(),fourthQ=delegateQuery({mode:'detail',grantId,requestId:fourth.operationId}),fourthDecision=decide(fourth,read(fourthQ).detail);
    const revoke={action:'revoke',operationId:next(),grantId,expectedRevision:1,reason:'Synthetic189 concurrent withdrawal of authority'};
    const revokeQ=ownerQuery({mode:'detail',grantId});
    const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
    const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},prefix+'select '+expr(revokeQ,revoke)+';',prefix+'select '+expr({...fourthQ,mode:'decide'},fourthDecision)+';');
    assert(race.witnessed&&race.right.error);assert.match(String(race.right.error),/attendance_access_denied|attendance_missing_delegation_[a-z_]+/);
    assert.equal((await missing(mq({requestId:fourth.operationId}))).detail.status,'submitted');
    assert.deepEqual(read(recovery,false).receipt,terminal.receipt);
    const minimal=read(recovery,false);assert.deepEqual(minimal.grants,[]);assert.deepEqual(minimal.items,[]);assert.equal(minimal.detail,null);
    assert.equal(JSON.stringify(minimal).includes(decision.decision.reason),false);
    assert.deepEqual(read(ownerQuery({mode:'recover',operationId:revoke.operationId}),false).receipt,JSON.parse(race.left).receipt);
    native.pass('real two-connection revoke wins over waiting approval; original minimal receipt survives without old request body');
    phase='handler';
    const handlerRead=await handle(new Request('https://www.faolla.com/api/merchant-enterprise/attendance/missing-delegation?'+missingDelegationQueryString(recovery),
      {headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}}),'delegate',false);
    const handlerBody=await handlerRead.json();assert.equal(handlerRead.status,200,JSON.stringify(handlerBody));assert.deepEqual(handlerBody.receipt,terminal.receipt);
    assert.equal(handlerRead.headers.get('cache-control'),'private, no-store');
    assert.deepEqual((await execute(recovery,null,false)).receipt,terminal.receipt);
    const context={d,h,native,scope,ownerQuery,delegateQuery,raw,read,reject,grant,decide,submit,missing,mq,expr,oldExpression,next,actor,employee,fingerprint,service,handle,execute,
      approved:{request:first,decision,receipt:terminal.receipt,recovery},revokedGrantId:grantId};
    phase='security';const security=(await import('./attendance-missing-delegation-security-native.mjs')).verifyMissingDelegationSecurityNative;
    const securityResult=await security(context);
    phase='atomicity';const atomicity=await (await import('./attendance-missing-delegation-atomic-native.mjs')).verifyMissingDelegationAtomicNative(context);
    phase='browser';const browser=browserCheck?await browserCheck(context):null;
    const finalFacts=d.fingerprint(),finalDefs=d.definitions();install();assert.equal(d.fingerprint(),finalFacts);assert.equal(d.definitions(),finalDefs);assert.equal(oldDefs(),originalDefs);
    return {reads,negativeChecks,rpcCalls,oldOwnerSelfUnchanged:true,realActor:true,fingerprintParity:true,periodSourceAndSeal:true,revocationRace:true,security:securityResult,atomicity,browser,
      existingDatabaseReused:true,productionAccess:false,newDatabase:false,deployment:false};
  }catch(error){throw new Error('missing_delegation_phase='+phase+': '+String(error),{cause:error});}
}
