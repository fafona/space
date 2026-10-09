//206 local-only source acceptance. The original stopped synthetic runtime and
//owned namespace are reused; this does not enable a formal decision writer.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runPlanPosthocNative} from './merchant-attendance-plan-posthoc-native.mjs';
import {lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {checkPosthocChangedNative} from './fixtures/attendance-plan-posthoc-changed-native.mjs';
const require=createRequire(import.meta.url);
const migration='202610060173_merchant_attendance_plan_posthoc_formal_source.sql';
const rpc='faolla_attendance_plan_posthoc_formal_source_v1';
const compute='faolla_attendance_plan_posthoc_formal_compute_v1';

export async function runPlanPosthocFormalSourceNative(args){
  return runPlanPosthocNative(args,async ctx=>{
    const {d,h,native,scope,install,read,save,make,selected,next,all,archive,oldArchive,period,pq}=ctx,{exec}=d;
    install('202610060172_merchant_attendance_plan_posthoc_evaluation.sql');
    const oldNames=d.inventory().filter(t=>t!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldNames);
    const oldOids=exec('select array_agg(oid order by oid)::text from pg_proc where pronamespace='+d.owned.oid+" and prokind='f';");
    const definitions=()=>exec('select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text) from pg_proc p where p.oid=any('+quote(oldOids)+"::oid[]) and p.prokind='f';");
    const oldDefinitions=definitions(),catalog=d.tableCatalog(),periodBefore=await period(pq());
    const unchangedTables=oldNames.filter(t=>!['merchant_enterprise_roles','merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'].includes(t));
    const protectedFacts=d.fingerprint(unchangedTables);
    install(migration);assert.equal(d.fingerprint(oldNames),oldFacts);assert.equal(definitions(),oldDefinitions);assert.equal(d.tableCatalog(),catalog);
    const installed=all(),installedDefinitions=d.definitions();install(migration);
    assert.equal(all(),installed);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),catalog);
    const query={siteId:d.site,workerId:h.workerId,slotId:h.slot.id};
    const expression=(q=query,auth=d.owner)=>'public.'+rpc+'('+json(q)+','+quote(auth)+')';
    const call=(q=query,auth=d.owner)=>JSON.parse(exec('set local role service_role;select '+expression(q,auth)+';'));
    const {projectPlanPosthocFormalSource,executePlanPosthocFormalSource}=require('../src/lib/merchantAttendancePlanPosthocFormalSource.server.ts');
    const service={rpc:async(name,a)=>{
      assert.equal(name,rpc);try{return {data:call(a.p_query,a.p_auth_user_id),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    }};
    let reads=0;
    const evaluate=async(q=query)=>{const before=all(),value=await executePlanPosthocFormalSource({query:q,authUserId:d.owner},service);assert.equal(all(),before);reads++;return value;};
    const permissions=JSON.parse(exec("select jsonb_build_object('service',has_function_privilege('service_role','public."+rpc+"(jsonb,uuid)','EXECUTE'),'anon',has_function_privilege('anon','public."+rpc+"(jsonb,uuid)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public."+rpc+"(jsonb,uuid)','EXECUTE'),'compute',has_function_privilege('service_role','public."+compute+"(jsonb)','EXECUTE'));"));
    assert.deepEqual(permissions,{service:true,anon:false,authenticated:false,compute:false});
    const first=await evaluate();assert.equal(first.protocol,'plan-exception-source-v3');assert.equal(first.state,'required',JSON.stringify(first.blockers));
    assert.equal((await evaluate()).fingerprint,first.fingerprint,'readAt is not a source change');
    const denied=all();assert.throws(()=>call(query,h.employeeAuthUserId),/attendance_access_denied/);
    assert.throws(()=>call({...query,mode:'detail'}),/attendance_invalid_request/);assert.equal(all(),denied);

    //An existing plan with no adoption ledger and no exception case must keep
    //the exact old source, including old v1/v2 protocol and canonical bytes.
    const legacyQuery={siteId:d.site,workerId:d.worker,slotId:d.slots.main.id};
    const legacyBefore=all();
    const legacyPair=JSON.parse(exec('set local role service_role;select jsonb_build_array(public.faolla_attendance_plan_exception_source_v1('+json(legacyQuery)+','+quote(d.owner)+'),'+expression(legacyQuery)+');'));
    assert.equal(all(),legacyBefore);assert.equal(legacyPair[0].sourceText,legacyPair[1].sourceText);assert.equal(legacyPair[0].fingerprint,legacyPair[1].fingerprint);
    const withoutReadAt=({readAt:_,...value})=>{void _;return value;};
    assert.deepEqual(withoutReadAt(legacyPair[0]),withoutReadAt(legacyPair[1]));
    assert.notEqual(projectPlanPosthocFormalSource(legacyPair[1],legacyQuery,d.owner).protocol,'plan-exception-source-v3');

    //Pure bounded fixtures test SQL calculation, not SQL authentication or
    //historical proof. Both a hand-asserted TS suite and independent SQL must
    //agree on all five derived fields, including UTC microseconds and work-v2.
    const {createPlanPosthocFormalCases}=require('./fixtures/attendance-plan-posthoc-formal-cases.ts');
    const cases=createPlanPosthocFormalCases().filter(c=>c.facts.source.posthoc.current!==null);assert(cases.length>=15&&cases.length<=100);
    const matrixBefore=all();
    const matrix=JSON.parse(exec('select jsonb_agg(public.'+compute+"(v.value->'facts') order by v.n) from jsonb_array_elements("+json(cases.map(({facts})=>({facts})))+') with ordinality v(value,n);'));
    assert.equal(all(),matrixBefore);assert.equal(matrix.length,cases.length);
    matrix.forEach((result,i)=>assert.deepEqual(result,cases[i].expectedDerived5,cases[i].group));
    native.pass('206 independent SQL/TS geometry matrix, exact old no-ledger source and bounded owner source reads');

    //Sealing itself is not a fact change. This deliberately uses a rolled-back
    //SYNTHETIC closure projection, not an actual seal request or employee
    //confirmation. It proves the fingerprint/write-gate separation only.
    const beforeSeal=all(),freshView=read(),freshApply=make(freshView,selected);
    const freshRevoke={action:'revoke',operationId:next(),expectedRevision:freshView.revision,expectedFingerprint:freshView.current.sourceFingerprint,
      employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic206 sealed write must remain refused'};
    const closureIds=JSON.parse(exec('select jsonb_agg(period_id) from public.merchant_attendance_period_closures where merchant_id='+quote(d.site)+' and worker_id='+quote(h.workerId)+';'));
    assert.equal(closureIds.length,1);
    const adoptedExpression=command=>'public.faolla_attendance_plan_posthoc_adoption_v1('+json(ctx.q())+','+quote(d.owner)+','+json(command)+',true)';
    const sealed=JSON.parse(exec('begin;update public.merchant_attendance_period_closures set state=\'sealed\',sealed=true,confirmed_version=current_version where merchant_id='+quote(d.site)+' and period_id='+quote(closureIds[0])+';\n'
      +'do $sealed_gate$ begin '+[freshApply,freshRevoke].map(command=>'begin perform '+adoptedExpression(command)+";raise exception 'unexpected_sealed_write';exception when others then if sqlerrm not in('attendance_period_sealed','attendance_plan_posthoc_adoption_blocked') then raise;end if;end;").join('\n')+'end;$sealed_gate$;\n'
      +'set local role service_role;select jsonb_build_array(public.faolla_attendance_plan_posthoc_evaluation_v1('+json(query)+','+quote(d.owner)+'),'+expression()+');rollback;'));
    assert.equal(all(),beforeSeal);assert(sealed[0].source.observations.some(o=>o.current?.blockers.includes('sealed')));
    const sealedFormal=projectPlanPosthocFormalSource(sealed[1],query,d.owner);
    assert.equal(sealedFormal.fingerprint,first.fingerprint);assert.deepEqual(sealedFormal.source,first.source);
    assert.equal(sealedFormal.state,'required');assert(!sealedFormal.blockers.includes('sealed'));

    //An actual existing171 write holds the normal locks while a new173 read
    //waits. The exact PID wait is witnessed, then the reader sees the committed
    //new head; no SHARE -> UPDATE upgrade is hidden inside this new RPC.
    const apply=make(read(),selected);
    const race=await lifecycleRace({connect:()=>native.connect(),query:s=>native.query(s),sql:scope.sql},
      'set local role service_role;select '+adoptedExpression(apply)+';',
      'set local role service_role;select '+expression()+';');
    assert(race.witnessed);assert.equal(race.right.error,null);
    const afterRace=projectPlanPosthocFormalSource(JSON.parse(race.right.output),query,d.owner);
    assert.equal(afterRace.source.evaluation.posthoc.current.operationId,apply.operationId);assert.notEqual(afterRace.fingerprint,first.fingerprint);
    const revokeView=read();save({action:'revoke',operationId:next(),expectedRevision:revokeView.revision,expectedFingerprint:revokeView.current.sourceFingerprint,
      employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic206 explicit revoke then blocked v3, never legacy downgrade'});
    const revoked=await evaluate();assert.equal(revoked.protocol,'plan-exception-source-v3');assert.equal(revoked.state,'blocked');assert(revoked.blockers.includes('posthoc_inactive'));
    save(make(read(),selected));const beforeLeave=await evaluate();assert.equal(beforeLeave.state,'required');

    //Real122 submit/approve/cancel commands, scoped to this synthetic employee.
    exec("update public.merchant_enterprise_roles set permissions=array(select distinct permission from unnest(permissions||array['attendance.self.leave']) permission order by permission) where merchant_id="+quote(d.site)+' and id=(select role_id from public.merchant_enterprise_employees where merchant_id='+quote(d.site)+' and id='+quote(h.employeeId)+');');
    const {executeLeave}=require('../src/lib/merchantAttendanceLeave.server.ts');
    const leaveService={rpc:async(name,a)=>{
      assert.equal(name,'faolla_attendance_leave_v1');try{return {data:JSON.parse(exec('set local role service_role;select public.'+name+'('+json(a.p_query)+','+quote(a.p_auth_user_id)+','+json(a.p_command)+','+a.p_allow_write+');')),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    }};
    const leave=(access,command=null,requestId=null)=>executeLeave({query:{siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null},command,authUserId:access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},leaveService);
    const settings=await leave('self'),tailStart=new Date(Date.parse(h.slot.endAt)-300000).toISOString(),requestId=next();
    await leave('self',{operationId:requestId,action:'submit',reason:'Synthetic206 leave edge calculation',expectedWorkerId:h.workerId,expectedSettingsVersion:settings.settingsVersion,timeZone:h.slot.timeZone,startAt:tailStart,endAt:h.slot.endAt});
    const pending=await evaluate();assert.equal(pending.state,'blocked');assert(pending.blockers.includes('leave_pending'));
    await leave('owner',{operationId:next(),action:'approve',requestId,expectedRevision:1,reason:'Synthetic206 approve genuine leave head'},requestId);
    const approved=await evaluate();assert.equal(approved.state,'required',JSON.stringify(approved.blockers));assert.equal(approved.leaveEdges.requiredEndAt,tailStart.replace('Z','000Z'));assert.equal(approved.candidate.early.rawDeltaUs,'0');
    assert.notEqual(approved.fingerprint,beforeLeave.fingerprint);
    await leave('owner',{operationId:next(),action:'cancel',requestId,expectedRevision:2,reason:'Synthetic206 cancel genuine leave head'},requestId);
    const cancelled=await evaluate();assert.equal(cancelled.leaveEdges.requiredEndAt,h.slot.endAt.replace('Z','000Z'));assert.notEqual(cancelled.fingerprint,approved.fingerprint);
    assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
    assert.deepEqual((await period(pq())).preview.artifact.report.totals,periodBefore.preview.artifact.report.totals);
    assert.equal(d.fingerprint(unchangedTables),protectedFacts);
    assert.equal(definitions(),oldDefinitions);
    //Reuse the already verified actual103 replacement fixture; it accepts the
    //new source only through a minimal view adapter, never replacing snapshots.
    const changed=await checkPosthocChangedNative({d,h,native,scope,selected,next,evaluate:async()=>{
      const result=await evaluate();assert.equal(result.protocol,'plan-exception-source-v3');return {...result,source:result.source.evaluation};
    }});
    assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
    native.pass('206 locked SQL calculation, revoke invalidation, real leave/missing change; synthetic seal projection fingerprint stable and old writes still blocked');
    return {phase:206,reads,matrixCases:cases.length,oldNoLedgerSourceExact:true,oldFunctionsUnchanged:true,old155ArchivePreserved:true,
      syntheticSealProjection:true,actualNewSeal:false,writeReadLockRace:true,realLeave:true,changed,formalDecisionWriter:false,fullWorkflow:false,browser:false,production:false};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPlanPosthocFormalSourceNative(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'plan_posthoc_formal_source_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
