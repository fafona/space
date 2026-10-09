// Extends the existing owned PG sandbox. No cluster, listener or auth server is
// created. Auth transport is synthetic; resolver, SDK, handlers and role ACLs are real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import authFixture from './fixtures/attendance-application-auth.ts';
import enterpriseAuth from '../src/lib/merchantEnterpriseAuth.server.ts';
import historyHttp from '../src/app/api/merchant-enterprise/attendance/revision-history/route-handler.ts';
import revisionHttp from '../src/app/api/merchant-enterprise/attendance/revision-requests/route-handler.ts';
import decisionHttp from '../src/app/api/merchant-enterprise/attendance/revision-decisions/route-handler.ts';
import reviewHttp from '../src/app/api/merchant-enterprise/attendance/revision-reviews/route-handler.ts';
import correctionHttp from '../src/app/api/merchant-enterprise/attendance/correction-decisions/route-handler.ts';
import historyProtocol from '../src/lib/merchantAttendanceRevisionHistory.ts';
import revisionProtocol from '../src/lib/merchantAttendanceRevision.ts';

export async function checkAttendanceApplicationAccess({root,exec,pass,site,owner,auth,otherAuth,employee,worker,role,oldRequest,oldOperation,proposal,id,fingerprint,ownerHistory,selfHistory}){
  const migration=readFileSync(path.join(root,'scripts/supabase-migrations/202610010098_merchant_attendance_revision_application_access.sql'),'utf8');
  const signatures={faolla_attendance_revision_self_v2:'text,uuid,jsonb,jsonb,boolean',faolla_attendance_revision_owner_review_v3:'text,uuid,uuid',
    faolla_attendance_revision_decide_v2:'text,uuid,uuid,jsonb,uuid,boolean',faolla_attendance_correction_decide_v2:'text,uuid,uuid,jsonb,uuid,boolean',faolla_attendance_revision_history_v1:'text,uuid,jsonb'};
  const literal=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'",json=v=>literal(JSON.stringify(v))+'::jsonb';
  // The sandbox rewriter only changes schema-qualified public names, so use a
  // schema-qualified regclass to resolve the exact disposable function namespace.
  const state=()=>JSON.parse(exec("select coalesce(jsonb_object_agg(proname,jsonb_build_object('acl',proacl::text,'body',md5(prosrc),'definer',prosecdef,'config',proconfig)),'{}'::jsonb) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_settings'::regclass) and proname like 'faolla_attendance_%';"));
  const before=state(),facts=fingerprint();
  assert.throws(()=>exec("begin;delete from public.faolla_schema_migrations where version=202610010097;\n"+migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/attendance_application_prerequisite_required/);
  assert.deepEqual(state(),before);exec(migration);const after=state();exec(migration);assert.deepEqual(state(),after);
  const changed=Object.keys(after).filter(name=>JSON.stringify(before[name])!==JSON.stringify(after[name])).sort();assert.deepEqual(changed,[...Object.keys(signatures),'faolla_attendance_revision_decision_link_v1'].sort());
  const changedAcl=Object.keys(after).filter(name=>before[name].acl!==after[name].acl).sort();assert.deepEqual(changedAcl,Object.keys(signatures).sort());
  for(const name of changed)assert.equal(before[name].body,after[name].body);
  assert.equal(before.faolla_attendance_revision_decision_link_v1.definer,false);assert.equal(after.faolla_attendance_revision_decision_link_v1.definer,true);
  assert.deepEqual(after.faolla_attendance_revision_decision_link_v1.config,['search_path=pg_catalog']);
  for(const [name,signature] of Object.entries(signatures)){
    for(const roleName of ['anon','authenticated','service_role'])assert.equal(exec(`select has_function_privilege('${roleName}','public.${name}(${signature})','execute');`),roleName==='service_role'?'t':'f');
  }
  for(const signature of ['faolla_attendance_revision_decide_v1(text,uuid,uuid,jsonb,uuid,boolean)','faolla_attendance_revision_owner_review_v2(text,uuid,uuid)',
    'faolla_attendance_revision_effect_at_v1(text,uuid,uuid,timestamptz)','faolla_attendance_decision_checks_v2(text,jsonb)','faolla_attendance_revision_decision_link_v1()'])assert.equal(exec(`select has_function_privilege('service_role','public.${signature}','execute');`),'f');
  for(const table of ['events','revision_requests','revision_decisions','effect_versions','correction_decisions'])assert.equal(exec(`select has_table_privilege('service_role','public.merchant_attendance_${table}','INSERT,UPDATE,DELETE,TRUNCATE');`),'f');
  assert.throws(()=>exec(`set role authenticated;select public.faolla_attendance_revision_history_v1('${site}','${owner}',${json({...ownerHistory,siteId:undefined})});`),/permission denied/);
  pass('candidate access is atomic/idempotent, only five server RPC ACLs change, internal helpers and all direct record writes stay denied');
  const decisionCount=exec('select count(*) from public.merchant_attendance_revision_decisions;');
  assert.throws(()=>exec(`begin;
    insert into public.merchant_attendance_revision_decisions(merchant_id,request_id,operation_id,base_request_id,worker_id,action,actor_auth_user_id,request_revision,base_operation_id,evidence_token,reason,command,recorded_at)
    select merchant_id,request_id,'${id(950090)}',base_request_id,worker_id,'approve','${owner}',revision,base_operation_id,repeat('0',32),'Synthetic invalid missing effect','{}',clock_timestamp()
    from public.merchant_attendance_revision_requests r where r.action='submit' and not exists(select 1 from public.merchant_attendance_revision_decisions d where d.merchant_id=r.merchant_id and d.request_id=r.request_id) limit 1;
    commit;`),/attendance_revision_decision_effect_mismatch/);
  assert.equal(exec('select count(*) from public.merchant_attendance_revision_decisions;'),decisionCount);assert.equal(fingerprint(),facts);
  pass('private definer constraint still rejects an approval with no matching effect at COMMIT; malformed synthetic transaction rolls back rather than bypassing consistency');
  const rpcCalls=[],rpcFailures=[];
  const rpc=async(name,args)=>{
    assert(Object.hasOwn(signatures,name),'application_unexpected_rpc');rpcCalls.push({name,actor:args.p_auth_user_id});
    const params=[literal(args.p_site_id),literal(args.p_auth_user_id)];
    if(name==='faolla_attendance_revision_history_v1')params.push(json(args.p_query));
    else if(name==='faolla_attendance_revision_self_v2'){assert.equal(typeof args.p_platform_enabled,'boolean');params.push(json(args.p_query),args.p_command?json(args.p_command):'null',String(args.p_platform_enabled));}
    else{params.push(literal(args.p_request_id));if(name!=='faolla_attendance_revision_owner_review_v3'){assert.equal(typeof args.p_allow_write,'boolean');params.push(args.p_command?json(args.p_command):'null',literal(args.p_operation_id),String(args.p_allow_write));}}
    try{return {data:JSON.parse(exec(`set role service_role;select public.${name}(${params.join(',')});`)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code){rpcFailures.push(String(e).slice(0,1600));throw e;}return {data:null,error:{message:code}};}
  };
  const actors=[{id:owner,email:'owner@example.test'},{id:auth,email:'self@example.test'},{id:otherAuth,email:'other@example.test'}];
  await authFixture.withAttendanceApplicationAuth(actors,rpc,async fixture=>{
    const tokens=await Promise.all(actors.map(a=>fixture.login(a)));let enabled=true;
    const entitlement=siteId=>enterpriseAuth.requireMerchantEnterpriseEntitlement(siteId,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:enabled}}]);
    const handlers={'revision-history':historyHttp.handleRevisionHistory,'revision-requests':revisionHttp.handleAttendanceRevision,'revision-decisions':decisionHttp.handleRevisionDecision,
      'revision-reviews':reviewHttp.handleAttendanceRevisionReview,'correction-decisions':correctionHttp.handleCorrectionDecision};
    const send=async(route,token,params='',body=null,extraHeaders={})=>{
      assert.equal(typeof handlers[route],'function',route);const headers={...(token!==null?{'x-merchant-access-token':token}:{}),...(body?{origin:'https://www.faolla.com','content-type':'application/json'}:{}),...extraHeaders};
      const response=await handlers[route](new Request('https://www.faolla.com/api/merchant-enterprise/attendance/'+route+(params?'?'+params:''),{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}),{entitlement});
      assert.equal(response.headers.get('cache-control'),'private, no-store');return {status:response.status,body:await response.json()};
    };
    const checkStatus=(reply,status)=>{assert.equal(reply.status,status,JSON.stringify({body:reply.body,rpcFailures}));return reply.body;};
    const historyQuery=historyProtocol.revisionHistoryQueryString(ownerHistory),ownQuery=historyProtocol.revisionHistoryQueryString(selfHistory);
    const own=checkStatus(await send('revision-history',tokens[0],historyQuery),200);assert(own.items.length>0);
    assert.equal(checkStatus(await send('revision-history',tokens[1],ownQuery),200).employeeId,employee);
    assert.equal(checkStatus(await send('correction-decisions',tokens[0],`siteId=${site}&requestId=${oldRequest}&operationId=${oldOperation}`),200).receipt.operationId,oldOperation);
    checkStatus(await send('revision-history',tokens[1],historyQuery),403);checkStatus(await send('revision-history',tokens[2],ownQuery),403);
    pass('actual SDK password protocol, unchanged auth resolver, gated GETs and default service executor reach real SQL as service_role for owner/self; cross-identity access is denied');
    const baselineCalls=rpcCalls.length;
    for(const token of [null,'',fixture.tamper(tokens[1],{sub:owner}),fixture.issue(actors[1],['password'],-10)])checkStatus(await send('revision-history',token,ownQuery),401);
    for(const methods of [['invite'],['recovery'],['magiclink'],['oauth']])checkStatus(await send('revision-history',fixture.issue(actors[1],methods),ownQuery),403);
    checkStatus(await send('revision-history','',ownQuery,null,{cookie:'__Host-faolla-merchant-auth-v2='+tokens[0]}),401);
    checkStatus(await send('revision-history',tokens[0],historyQuery,null,{'sec-fetch-site':'cross-site',origin:'https://outside.invalid'}),403);
    assert.equal(rpcCalls.length,baselineCalls);
    const oauth=fixture.issue(actors[0],['oauth']);checkStatus(await send('revision-history',oauth,historyQuery),200);
    process.env.FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED='0';const offCalls=rpcCalls.length;checkStatus(await send('revision-history',tokens[0],historyQuery),404);assert.equal(rpcCalls.length,offCalls);process.env.FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED='1';
    pass('invalid/expired/forged/partial sessions, employee OAuth, explicit-empty owner fallback and cross-site reads stop before SQL; owner OAuth stays supported and actual flag gates are enforced');
    const prepare={siteId:site,mode:'prepare',expectedWorkerId:worker,baseRequestId:oldRequest,requestId:null,operationId:null};
    const prepared=checkStatus(await send('revision-requests',tokens[1],revisionProtocol.attendanceRevisionQueryString(prepare)),200);
    const command={action:'submit',operationId:id(950001),expectedRevision:prepared.revision,expectedBaseOperationId:oldOperation,expectedEffectiveOperationId:prepared.current.operationId,expectedPolicyRevision:1,reason:'Synthetic application-role submission',proposal:proposal(1)};
    const submitted=checkStatus(await send('revision-requests',tokens[1],'',{siteId:site,expectedWorkerId:worker,baseRequestId:oldRequest,command}),200);
    assert.equal(submitted.item.status,'submitted');assert.equal(submitted.receipt.operationId,command.operationId);
    const requestQuery=`siteId=${site}&requestId=${command.operationId}`;
    assert.equal(checkStatus(await send('revision-reviews',tokens[0],requestQuery),200).requestState,'submitted');
    const review=checkStatus(await send('revision-decisions',tokens[0],requestQuery),200);
    const decision={requestId:command.operationId,operationId:id(950002),action:'approve',expectedRevision:review.review.submittedRevision,expectedEvidence:review.evidenceToken,expectedBaseOperationId:review.current.operationId,reason:'Synthetic application-role approval'};
    assert.equal(review.canApprove,true);
    const journalCount=()=>exec('select jsonb_build_array((select count(*) from public.merchant_attendance_revision_decisions),(select count(*) from public.merchant_attendance_effect_versions));');
    const beforeCommit=journalCount();
    exec('alter function public.faolla_attendance_revision_decision_link_v1() security invoker;');
    try{
      checkStatus(await send('revision-decisions',tokens[0],'',{siteId:site,...decision}),503);
      assert(rpcFailures.some(e=>e.includes('permission denied for table merchant_attendance_revision_decisions')));assert.equal(journalCount(),beforeCommit);
    }finally{exec('alter function public.faolla_attendance_revision_decision_link_v1() security definer;');rpcFailures.length=0;}
    const decided=checkStatus(await send('revision-decisions',tokens[0],'',{siteId:site,...decision}),200);assert.equal(decided.current.revision,prepared.current.revision+1);
    assert.equal(decided.current.workedUs,3600000000);assert.equal(decided.receipt.operationId,decision.operationId);
    enabled=false;const receipt=checkStatus(await send('revision-decisions',tokens[0],requestQuery+'&operationId='+decision.operationId),200);assert.equal(receipt.receipt.operationId,decision.operationId);assert.equal(receipt.moduleEnabled,false);
    const detail={...prepare,mode:'detail',requestId:command.operationId,operationId:command.operationId};
    const recovered=checkStatus(await send('revision-requests',tokens[1],revisionProtocol.attendanceRevisionQueryString(detail)),200);assert.equal(recovered.item.status,'approved');assert.equal(recovered.receipt.operationId,command.operationId);assert.equal(recovered.canSubmit,false);
    const replay=checkStatus(await send('revision-decisions',tokens[0],'',{siteId:site,...decision}),200);assert.equal(replay.replayed,true);assert.equal(replay.effectiveChanged,false);
    const paused=checkStatus(await send('revision-requests',tokens[1],revisionProtocol.attendanceRevisionQueryString(prepare)),200);
    const pausedNew={...command,operationId:id(950003),expectedRevision:paused.revision,expectedEffectiveOperationId:paused.current.operationId,proposal:proposal(2)};
    checkStatus(await send('revision-requests',tokens[1],'',{siteId:site,expectedWorkerId:worker,baseRequestId:oldRequest,command:pausedNew}),403);
    checkStatus(await send('revision-decisions',tokens[1],requestQuery),403);
    assert.equal(fingerprint(),facts);assert.deepEqual([...new Set(rpcCalls.map(c=>c.name))].sort(),Object.keys(signatures).sort());
    pass('server role completes new self submission, owner review/approval, paused exact GET recovery and idempotent original POST replay through real default executors; all five new grants exercised without changing original facts');
    pass('regression reproduces deferred-trigger invoker permission failure with whole approval rollback; private definer commits same operation without direct table grants, pause rejects new submissions and employee cannot approve');
    fixture.revoke(tokens[1]);const beforeRevoke=rpcCalls.length;checkStatus(await send('revision-history',tokens[1],ownQuery),401);assert.equal(rpcCalls.length,beforeRevoke);
    const fresh=await fixture.login(actors[1]);
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';`);
    try{checkStatus(await send('revision-history',fresh,ownQuery),403);}finally{exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.request'] where id='${role}';`);}
    assert.equal(fingerprint(),facts);assert(fixture.calls.every(c=>c.path.startsWith('/auth/v1/')||c.path.startsWith('/rest/v1/rpc/')));
    pass('session revocation stops at actual auth resolver and current employee permission revocation stops inside server-role SQL; fixture made no external requests or persistent auth changes');
  });
}
