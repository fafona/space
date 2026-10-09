//204 targeted native foundation acceptance. No browser, full build, production
// connection or new cluster. Reuse exactly the explicitly named stopped PG15.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {seedPosthocNativeSources,createPosthocMissingNative} from './fixtures/attendance-plan-posthoc-sources-native.mjs';
const require=createRequire(import.meta.url),migration='202610060171_merchant_attendance_plan_posthoc_adoption.sql';
const beforeIndex=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const afterIndex=['202610050152_merchant_attendance_period_missing_context.sql','202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql','202610050155_merchant_attendance_period_fixed_boundaries.sql'];
const newContext=['202610040125_merchant_attendance_leave_notifications.sql','202610060156_merchant_attendance_work_arrangements.sql',
  '202610060157_merchant_attendance_work_arrangement_permission.sql','202610060158_merchant_attendance_work_arrangement_periods.sql',
  '202610060159_merchant_attendance_work_arrangement_exceptions.sql'];
export async function runPlanPosthocNative(args,extension=null){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER','FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED','FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS'],prior=keys.map(k=>process.env[k]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    const d=await preparePlanAdoptionViewNative(native,scope),{exec}=d;
    const install=name=>{try{return exec(boundClockMigrationBody(native.root,name).replace(/(set search_path\s*=\s*)public\b/g,`$1${d.owned.schema}`));}
      catch(e){throw new Error('install:'+name+':'+String(e),{cause:e});}};
    for(const name of beforeIndex)install(name);
    native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050151_merchant_attendance_period_source_ranges.sql'),'utf8')));
    for(const name of afterIndex)install(name);
    const h=await seedPlanExceptionHistoryNative({d,native,scope});
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');let n=204900010;
    const periodId=id(204900001),pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate,mode,periodId:pid,operationId:null,version:null});
    const periodService={rpc:async(name,a)=>{assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1'].includes(name));
      const exp=name==='faolla_attendance_period_closure_v1'?`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`:`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      try{return {data:JSON.parse(exec('set local role service_role;select '+exp+';')),error:null};}catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const period=(q,c=null)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},periodService);
    const initial=await period(pq()),pc=(action,current=null)=>({action,operationId:id(n++),periodId,expectedRevision:current?.period.revision??0,expectedVersion:current?.period.currentVersion??0,
      expectedFingerprint:current?.artifact.sourceFingerprint??initial.preview.artifact.sourceFingerprint,reason:'Synthetic204 explicit archive operation'});
    let closed=await period(pq('detail','owner',periodId),pc('send'));closed=await period(pq('detail','self',periodId),pc('confirm',closed));closed=await period(pq('detail','owner',periodId),pc('seal',closed));
    const archive=()=>JSON.parse(exec(`set local role service_role;select public.faolla_attendance_period_closure_v1(${json({...pq('export','owner',periodId),version:1})},${quote(d.owner)},null,null,false);`));
    const oldArchive=archive();
    for(const name of newContext)install(name);
    const oldNames=d.inventory().filter(t=>t!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldNames),oldDefinitions=d.definitions();
    const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
    const oldFunctionHash=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
      from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f';`);
    const functionsBefore=oldFunctionHash();
    install(migration);assert.equal(d.fingerprint(oldNames),oldFacts);
    //171 is strictly additive: all pre-existing function definitions/ACLs remain.
    const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install(migration);
    assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.notEqual(definitions,oldDefinitions);
    assert.equal(oldFunctionHash(),functionsBefore);
    const acl=JSON.parse(exec(`select jsonb_build_object('service',has_function_privilege('service_role','public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)','EXECUTE'),
      'anon',has_function_privilege('anon','public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)','EXECUTE'),
      'authenticated',has_function_privilege('authenticated','public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)','EXECUTE'),
      'private',has_function_privilege('service_role','public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)','EXECUTE'),
      'ledger',has_table_privilege('service_role','public.merchant_attendance_plan_posthoc_operations','INSERT'),
      'claims',has_table_privilege('service_role','public.merchant_attendance_plan_posthoc_claims','DELETE'));`));
    assert.deepEqual(acl,{service:true,anon:false,authenticated:false,private:false,ledger:false,claims:false});
    const {projectPlanPosthocResult,executePlanPosthoc}=require('../src/lib/merchantAttendancePlanPosthoc.server.ts');
    const core=require('../src/lib/merchantAttendancePlanExceptions.ts'),review='faolla_attendance_plan_exception_review_v1',rpc='faolla_attendance_plan_posthoc_adoption_v1';
    let reads=0,rejections=0;const all=()=>d.fingerprint(d.inventory()),next=()=>id(n++);
    const q=(op=null)=>({siteId:d.site,workerId:h.workerId,slotId:h.slot.id,mode:op?'recover':'detail',operationId:op});
    const expr=(query,command=null,allow=true,auth=d.owner)=>`public.${rpc}(${json(query)},${quote(auth)},${json(command)},${allow})`;
    const call=(query=q(),command=null,allow=true,auth=d.owner)=>JSON.parse(exec('set local role service_role;select '+expr(query,command,allow,auth)+';'));
    const read=(query=q(),auth=d.owner)=>{const before=all(),r=projectPlanPosthocResult(call(query,null,false,auth),query,auth);assert.equal(all(),before);reads++;return r;};
    const make=(view,sources=[])=>({action:'apply',operationId:next(),expectedRevision:view.revision,expectedFingerprint:view.preview.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic204 explicit post-hoc selection, not original clock intent',sources});
    const save=(command,allow=true)=>projectPlanPosthocResult(call(q(),command,allow),q(),d.owner,command);
    const reject=(query,command,pattern,{allow=true,auth=d.owner}={})=>{const before=all();assert.throws(()=>call(query,command,allow,auth),new RegExp('ERROR:\\s+(?:'+pattern+')(?:\\s|$)'));assert.equal(all(),before);rejections++;};
    const rq=(mode='detail',op=null)=>({siteId:d.site,workerId:h.workerId,slotId:h.slot.id,access:'owner',mode,operationId:op,beforeAt:null,beforeId:null});
    let pending=read();assert(pending.preview.blockers.includes('case_missing'));assert(pending.preview.blockers.includes('sealed'));
    reject(q(),make(pending),'attendance_plan_posthoc_adoption_blocked|attendance_period_sealed');
    closed=await period(pq('detail','owner',periodId),pc('reopen',closed));assert(!closed.period.sealed);
    const current=core.parsePlanExceptionResult(JSON.parse(exec(`set local role service_role;select public.${review}(${json(rq())},${quote(d.owner)},null,false);`)),rq(),{authUserId:d.owner});
    const decision={operationId:next(),expectedRevision:0,expectedFingerprint:current.detail.current.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome:'follow_up',note:'Synthetic204 explicit existing review case'};
    exec(`set local role service_role;select public.${review}(${json(rq('decide',decision.operationId))},${quote(d.owner)},${json(decision)},true);`);
    await seedPosthocNativeSources({d,h,native,scope});
    const missingRef=await createPosthocMissingNative({d,h,native,scope});
    const factsBeforeLedger=d.fingerprint(oldNames),periodBefore=await period(pq());
    pending=read();assert(pending.preview.eligible);const available=pending.preview.candidates.filter(c=>c.available);
    const session=available.find(c=>c.reference.kind==='session');assert(session,'positive historical-identity session candidate required');
    const missing=available.find(c=>c.reference.kind==='missing');assert(missing,'positive approved missing candidate required');assert.deepEqual(missing.reference,missingRef);
    const selected=[session.reference,missing.reference],apply=make(pending,selected);
    reject(q(),apply,'attendance_platform_paused|attendance_plan_posthoc_adoption_disabled',{allow:false});
    reject(q(),{...apply,expectedFingerprint:'0'.repeat(64)},'attendance_plan_posthoc_adoption_changed');
    reject(q(),{...apply,employeeAuthUserId:d.auth},'attendance_worker_changed|attendance_access_denied|attendance_plan_posthoc_adoption_changed|attendance_plan_posthoc_adoption_blocked');
    reject(q(),{...apply,sources:[session.reference,session.reference]},'attendance_invalid_request|attendance_plan_posthoc_adoption_invalid');
    reject(q(),apply,'attendance_access_denied',{auth:h.employeeAuthUserId});
    let resultView=save(apply);assert.equal(resultView.revision,1);assert.deepEqual(resultView.current.sources,selected);
    const afterApply=all();assert.deepEqual(save(apply,false).receipt,resultView.receipt);assert.equal(all(),afterApply);
    assert.deepEqual(read(q(apply.operationId)).receipt,resultView.receipt);
    reject(q(),{...apply,reason:'not the original command'},'attendance_operation_conflict');
    reject(q(next()),null,'attendance_plan_posthoc_adoption_not_found');
    assert.equal(d.fingerprint(oldNames),factsBeforeLedger);
    const revoke={action:'revoke',operationId:next(),expectedRevision:resultView.revision,expectedFingerprint:resultView.current.sourceFingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic204 explicitly release only post-hoc claims'};
    resultView=save(revoke);assert.equal(resultView.current.action,'revoke');assert.deepEqual(resultView.current.sources,[]);
    assert.deepEqual(save(revoke,false).receipt,resultView.receipt);assert.equal(read().preview.candidates.filter(c=>c.available).length,available.length);
    const leaveOnly=make(read(),[]);resultView=save(leaveOnly);assert.equal(resultView.revision,3);assert.equal(resultView.current.action,'apply');assert.deepEqual(resultView.current.sources,[]);
    const a=make(read(),selected),b={...a,operationId:next(),reason:'Synthetic204 competing explicit owner choice'};
    const race=await lifecycleRace({connect:()=>native.connect(),query:s=>native.query(s),sql:scope.sql},'set local role service_role;select '+expr(q(),a)+';','set local role service_role;select '+expr(q(),b)+';');
    assert(race.witnessed);assert.match(String(race.right.error),/attendance_version_conflict|attendance_plan_posthoc_adoption_changed/);assert.equal(race.right.output,null);
    resultView=read();assert.equal(resultView.revision,4);assert.equal(resultView.current.operationId,a.operationId);
    let boundaryRejections=0;
    const boundary=(setup,expression,expected)=>{
      const before=all();
      exec(`do $posthoc_boundary$ begin begin ${setup}perform ${expression};raise exception 'posthoc_boundary_unexpected_success';
        exception when others then if sqlerrm<>${quote(expected)} then raise;end if;end;end;$posthoc_boundary$;`);
      assert.equal(all(),before,'rollback boundary must restore all rows');boundaryRejections++;
    };
    const fresh=make(resultView,selected),freshRevoke={...revoke,operationId:next(),expectedRevision:resultView.revision,expectedFingerprint:resultView.current.sourceFingerprint};
    for(const command of [fresh,freshRevoke]){
      boundary(`update public.merchant_attendance_workers set active=false where merchant_id=${quote(d.site)} and id=${quote(h.workerId)};`,expr(q(),command),'attendance_worker_changed');
      boundary(`update public.merchant_enterprise_employees set status='disabled' where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)};`,expr(q(),command),'attendance_worker_changed');
      boundary(`update public.merchant_attendance_settings set enabled=false where merchant_id=${quote(d.site)};`,expr(q(),command),'attendance_platform_paused');
    }
    boundary(`update public.merchant_enterprise_employees set auth_user_id=${quote(next())} where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)};`,expr(q(a.operationId)),'attendance_worker_changed');
    boundary(`update public.merchants set user_id=${quote(d.auth)} where id=${quote(d.site)};`,expr(q(a.operationId)),'attendance_access_denied');
    //A changed complete basis must not reuse the previous preview fingerprint.
    boundary(`update public.merchant_attendance_workers set display_name='Synthetic204 changed source' where merchant_id=${quote(d.site)} and id=${quote(h.workerId)};`,expr(q(),fresh),'attendance_plan_posthoc_adoption_changed');
    const beforeImmutable=all();assert.throws(()=>exec(`update public.merchant_attendance_plan_posthoc_operations set recorded_at=recorded_at where merchant_id=${quote(d.site)} and operation_id=${quote(a.operationId)};`),/attendance_events_append_only/);assert.equal(all(),beforeImmutable);boundaryRejections++;
    reject(q(),fresh,'attendance_invalid_request',{allow:'null'});
    process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED='1';process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS=d.site;
    const service={rpc:async(name,args)=>{assert.equal(name,rpc);try{return {data:call(args.p_query,args.p_command,args.p_allow_write,args.p_auth_user_id),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const reread=await executePlanPosthoc({query:q(a.operationId),authUserId:d.owner,moduleEnabled:false},service);assert.equal(reread.receipt.item.operationId,a.operationId);
    const periodAfter=await period(pq());
    assert.equal(periodAfter.preview.artifact.sourceFingerprint,periodBefore.preview.artifact.sourceFingerprint);
    assert.deepEqual(periodAfter.preview.artifact.source,periodBefore.preview.artifact.source,'ledger foundation must not silently alter old canonical period source');
    assert.deepEqual(periodAfter.preview.artifact.report.totals,periodBefore.preview.artifact.report.totals,'adoption cannot count the same work twice');
    assert.equal(d.fingerprint(oldNames),factsBeforeLedger,'posthoc selection must not mutate old facts');
    assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
    result={phase:204,reads,rejections,boundaryRejections,casRace:true,positiveSession:true,positiveMissing:true,oldFactsUnchanged:true,oldPeriodUnchanged:true,old155ArchiveBytes:oldArchive.artifactBytes,
      old155ArchivePreserved:true,production:false,deployed:false,fullWorkflow:false,newCluster:false};
    native.pass('204 posthoc isolated ledger apply/revoke/replay and owned SQL/TS verification; old source/period remains unchanged');
    if(extension!==null){assert.equal(typeof extension,'function');result.extension=await extension({d,h,native,scope,install,service,q,read,save,make,selected,next,all,archive,oldArchive,period,pq,pc});}
  }));return result;}finally{keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPlanPosthocNative(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'plan_posthoc_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
