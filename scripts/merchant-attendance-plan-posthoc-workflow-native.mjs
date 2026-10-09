//205 local owner client -> actual handler -> service -> SQL, plus exact read-only
//evaluation. Reuses204's existing owned stopped-cluster setup; no new copy.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runPlanPosthocNative} from './merchant-attendance-plan-posthoc-native.mjs';
import {lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {checkPosthocChangedNative} from './fixtures/attendance-plan-posthoc-changed-native.mjs';
const require=createRequire(import.meta.url),migration='202610060172_merchant_attendance_plan_posthoc_evaluation.sql';
export async function runPlanPosthocWorkflowNative(args){
  return runPlanPosthocNative(args,async ctx=>{
    const {d,h,install,service,read,save,make,selected,next,all,archive,oldArchive,native,period,pq}=ctx,{exec}=d;
    const oldOids=exec("select array_agg(oid order by oid)::text from pg_proc where pronamespace="+d.owned.oid+" and prokind='f';");
    const definitions=()=>exec("select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text) from pg_proc p where p.oid=any("+quote(oldOids)+"::oid[]) and p.prokind='f';");
    const oldDefinitions=definitions(),oldNames=d.inventory().filter(t=>t!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldNames);
    const unchangedTables=oldNames.filter(t=>!['merchant_enterprise_roles','merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'].includes(t)),protectedFacts=d.fingerprint(unchangedTables);
    const periodBefore=await period(pq());
    install(migration);assert.equal(definitions(),oldDefinitions);assert.equal(d.fingerprint(oldNames),oldFacts);
    const catalog=d.tableCatalog(),afterInstall=all(),afterDefinitions=d.definitions();install(migration);
    assert.equal(all(),afterInstall);assert.equal(d.tableCatalog(),catalog);assert.equal(d.definitions(),afterDefinitions);
    const rpc='faolla_attendance_plan_posthoc_evaluation_v1',query={siteId:d.site,workerId:h.workerId,slotId:h.slot.id};
    const expression=(q=query,auth=d.owner)=>"public."+rpc+"("+json(q)+","+quote(auth)+")";
    const call=(q=query,auth=d.owner)=>JSON.parse(exec("set local role service_role;select "+expression(q,auth)+";"));
    const {executePlanPosthocEvaluation}=require('../src/lib/merchantAttendancePlanPosthocEvaluation.server.ts');
    const evalService={rpc:async(name,a)=>{assert.equal(name,rpc);try{return {data:call(a.p_query,a.p_auth_user_id),error:null};}catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    let reads=0;
    const evaluate=async()=>{const before=all();const value=await executePlanPosthocEvaluation({query,authUserId:d.owner},evalService);assert.equal(all(),before);reads++;return value;};
    const permissions=JSON.parse(exec("select jsonb_build_object('service',has_function_privilege('service_role','public."+rpc+"(jsonb,uuid)','EXECUTE'),'anon',has_function_privilege('anon','public."+rpc+"(jsonb,uuid)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public."+rpc+"(jsonb,uuid)','EXECUTE'),'private',has_function_privilege('service_role','public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone)','EXECUTE'));"));
    assert.deepEqual(permissions,{service:true,anon:false,authenticated:false,private:false});
    const first=await evaluate();assert.equal(first.state,'required',JSON.stringify(first.blockers));assert.equal(first.source.posthoc.selected.length,2);assert.equal(first.source.observations.length,2);
    assert.equal((await evaluate()).fingerprint,first.fingerprint);
    const deniedBefore=all();assert.throws(()=>call(query,h.employeeAuthUserId),/attendance_access_denied/);assert.throws(()=>call({...query,mode:'detail'}),/attendance_invalid_request/);assert.equal(all(),deniedBefore);

    //Actual browser-controller/handler chain in memory (not a real browser or
    //real Auth login). Only authentication+entitlement are synthetic injections.
    const {AttendancePlanPosthocClient}=require('../src/lib/merchantAttendancePlanPosthocClient.ts');
    const {handlePlanPosthoc}=require('../src/app/api/merchant-enterprise/attendance/plan-posthoc/route-handler.ts');
    const {handlePlanPosthocEvaluation}=require('../src/app/api/merchant-enterprise/attendance/plan-posthoc-evaluation/route-handler.ts');
    const {executePlanPosthoc}=require('../src/lib/merchantAttendancePlanPosthoc.server.ts');
    const storage=new Map();let postCalls=0,getCalls=0,loseResponse=true;
    const apiFetch=async(url,init)=>{
      if(init.method==='POST')postCalls++;else getCalls++;
      const request=new Request('https://www.faolla.com'+url,{...init,headers:{...init.headers,host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}});
      if(url.startsWith('/api/merchant-enterprise/attendance/plan-posthoc-evaluation?'))return handlePlanPosthocEvaluation(request,{
        authenticate:async()=>({user:{id:d.owner},accessToken:'synthetic205',authenticationMethods:['password']}),
        entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),allow:()=>true,
        execute:input=>executePlanPosthocEvaluation(input,evalService),
      });
      const result=await handlePlanPosthoc(request,{
        siteEnabled:()=>true,authenticate:async()=>({user:{id:d.owner},accessToken:'synthetic205',authenticationMethods:['password']}),
        entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),allow:()=>true,
        execute:input=>executePlanPosthoc(input,service),
      });
      if(init.method==='POST'&&loseResponse){assert.equal(result.status,200,await result.clone().text());loseResponse=false;throw Error('Synthetic lost committed response');}
      return result;
    };
    const client=new AttendancePlanPosthocClient({...query,actorId:d.owner,enabled:true,apiFetch,
      storage:()=>({getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{storage.delete(k);}}),operationId:next});
    await client.initialize();assert.equal(getCalls,0);await client.load();assert.equal(client.getSnapshot().phase,'ready');
    await client.apply({sources:selected,reason:'Synthetic205 full owner HTTP path without touching original facts'});
    assert.equal(client.getSnapshot().phase,'unconfirmed');assert.equal(postCalls,1);assert.equal(storage.size,1);
    const committed=all();await client.recover();assert.equal(client.getSnapshot().phase,'ready');assert.equal(postCalls,1);assert.equal(storage.size,0);assert.equal(all(),committed);
    const evalBefore=all();await client.evaluate();assert.equal(client.getSnapshot().evaluation.state,'required');assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().canWrite,false);assert.equal(all(),evalBefore);
    const adopted=await evaluate();assert.equal(adopted.state,'required');assert.notEqual(adopted.fingerprint,first.fingerprint);
    const beforeRevoke=read();await client.load();await client.revoke('Synthetic205 explicitly revoke only post-hoc use');
    assert.equal(client.getSnapshot().phase,'ready');assert.equal(client.getSnapshot().result.current.action,'revoke');
    const revoked=await evaluate();assert.equal(revoked.state,'not_active');assert.equal(revoked.source.posthoc.revision,beforeRevoke.revision+1);assert.deepEqual(revoked.source.observations,[]);
    save(make(read(),selected));const beforeLeave=await evaluate();assert.equal(beforeLeave.state,'required');

    //Grant only the existing self-leave permission on the isolated synthetic
    //role. Every submit/approve/cancel below goes through actual122 SQL+parser.
    exec("update public.merchant_enterprise_roles set permissions=array(select distinct permission from unnest(permissions||array['attendance.self.leave']) permission order by permission) where merchant_id="+quote(d.site)+" and id=(select role_id from public.merchant_enterprise_employees where merchant_id="+quote(d.site)+" and id="+quote(h.employeeId)+");");
    const {executeLeave}=require('../src/lib/merchantAttendanceLeave.server.ts');
    const leaveRpc='faolla_attendance_leave_v1',leaveService={rpc:async(name,a)=>{
      assert.equal(name,leaveRpc);try{return {data:JSON.parse(exec("set local role service_role;select public."+name+"("+json(a.p_query)+","+quote(a.p_auth_user_id)+","+json(a.p_command)+","+a.p_allow_write+");")),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
    }};
    const leave=(access,command=null,requestId=null)=>executeLeave({query:{siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null},command,authUserId:access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},leaveService);
    const settings=await leave('self'),tailStart=new Date(Date.parse(h.slot.endAt)-300000).toISOString(),requestId=next();
    await leave('self',{operationId:requestId,action:'submit',reason:'Synthetic205 leave last five minutes',expectedWorkerId:h.workerId,expectedSettingsVersion:settings.settingsVersion,timeZone:h.slot.timeZone,startAt:tailStart,endAt:h.slot.endAt});
    const pending=await evaluate();assert.equal(pending.state,'blocked');assert(pending.blockers.includes('leave_pending'));
    await leave('owner',{operationId:next(),action:'approve',requestId,expectedRevision:1,reason:'Synthetic205 approve exact half-open leave'},requestId);
    const approved=await evaluate();assert.equal(approved.state,'required',JSON.stringify(approved.blockers));assert.equal(approved.leaveEdges.requiredEndAt,tailStart.replace('Z','000Z'));assert.equal(approved.candidate.early.rawDeltaUs,'0');assert.deepEqual(approved.leaveEdges.workLeaveOverlaps,[]);
    assert.notEqual(approved.fingerprint,beforeLeave.fingerprint);
    await leave('owner',{operationId:next(),action:'cancel',requestId,expectedRevision:2,reason:'Synthetic205 cancel approved leave without changing work'},requestId);
    const cancelled=await evaluate();assert.equal(cancelled.leaveEdges.requiredEndAt,h.slot.endAt.replace('Z','000Z'));assert.equal(cancelled.source.leave.items[0].status,'cancelled');assert.notEqual(cancelled.fingerprint,approved.fingerprint);
    const fullId=next();await leave('self',{operationId:fullId,action:'submit',reason:'Synthetic205 full-plan conflict test',expectedWorkerId:h.workerId,expectedSettingsVersion:settings.settingsVersion,timeZone:h.slot.timeZone,startAt:h.slot.startAt,endAt:h.slot.endAt});
    await leave('owner',{operationId:next(),action:'approve',requestId:fullId,expectedRevision:1,reason:'Synthetic205 approved leave preserves contradictory work'},fullId);
    const conflict=await evaluate();assert.equal(conflict.state,'blocked');assert.equal(conflict.leaveEdges.fullCoverage,true);assert(conflict.blockers.includes('work_leave_overlap'));assert.notEqual(conflict.candidate.selected.startAt,null);
    await leave('owner',{operationId:next(),action:'cancel',requestId:fullId,expectedRevision:2,reason:'Synthetic205 end conflict scenario'},fullId);
    const final=await evaluate();assert.equal(final.state,'required');
    //The old archive is read from saved bytes; added context is not permitted
    //to rewrite a prior sealed export or change recorded/selected time totals.
    assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
    const currentPeriod=await period(pq());assert.deepEqual(currentPeriod.preview.artifact.report.totals,periodBefore.preview.artifact.report.totals);
    assert.equal(d.fingerprint(unchangedTables),protectedFacts);
    assert.equal(definitions(),oldDefinitions);
    const changed=await checkPosthocChangedNative({d,h,native,scope:ctx.scope,evaluate,selected,next});
    assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
    native.pass('205 owner client-handler-service-SQL lost-response recovery and real leave submit/approve/cancel; independent evaluation only, no formal decision activation');
    return {phase:205,reads,postCalls,getCalls,ownerHttpSql:true,realLeave:true,changed,old155ArchivePreserved:true,fullWorkflow:false,browser:false,production:false};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPlanPosthocWorkflowNative(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'plan_posthoc_workflow_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
