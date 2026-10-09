//185 LOCAL acceptance only: one stopped, identity-checked synthetic PG15.
//No production account, new cluster, dependency copy, deployment or full build.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyPeriodSourceNative} from './fixtures/attendance-period-source-native.mjs';
import {verifyPeriodTimezoneResumeNative} from './fixtures/attendance-period-timezone-resume-native.mjs';
import {runPeriodClosureBrowserAcceptance} from './fixtures/attendance-period-closure-browser.mjs';
const require=createRequire(import.meta.url);
const beforeRanges=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const rangesMigration='202610050151_merchant_attendance_period_source_ranges.sql';
const afterRanges=['202610050152_merchant_attendance_period_missing_context.sql','202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql'];
const repairMigration='202610050155_merchant_attendance_period_fixed_boundaries.sql';
let phase='entry';
export async function runPeriodTimezoneResumeNative(args,browserCheck=null){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(key=>process.env[key]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope),{exec}=d;
    for(const migration of beforeRanges)exec(boundClockMigrationBody(native.root,migration));
    //151 owns explicit transactions and CONCURRENTLY stages; execute unchanged.
    exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',rangesMigration),'utf8')));exec('select 1;');
    for(const migration of afterRanges)exec(boundClockMigrationBody(native.root,migration));
    phase='history154';const h=await seedPlanExceptionHistoryNative({d,native,scope});
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const source=await verifyPeriodSourceNative({d,native,scope,h});
    const {parseUnifiedSource}=require('../src/lib/merchantAttendanceUnifiedTimesheet.ts');
    assert.deepEqual(source.ownerProjection.artifact.report,parseUnifiedSource(source.ownerRaw.report,source.q),'period_projection_changed_original_algorithm');
    const pid=id(185900001),q=(mode='list',access='owner',periodId=null,operationId=null,version=null)=>({...source.q,mode,access,periodId,operationId,version});
    const expression=(query,actor,command=null,artifact=null,allow=true)=>`public.faolla_attendance_period_closure_v1(${json(query)},${quote(actor)},${json(command)},${json(artifact)},${allow})`;
    let next=185900010;
    const command=(action,current,fp=null)=>({action,operationId:id(next++),periodId:pid,expectedRevision:current?.period.revision??0,
      expectedVersion:current?.period.currentVersion??0,expectedFingerprint:fp??current?.artifact?.sourceFingerprint??null,reason:'Synthetic185 fixed-boundary acceptance'});
    const first=command('send',null,source.ownerRaw.sourceFingerprint);
    phase='actual154-archive';const saved=JSON.parse(exec('set local role service_role;select '+expression(q('detail','owner',pid),d.owner,first,source.ownerProjection.artifact)+';'));
    assert.equal(saved.period.currentVersion,1);assert.equal(saved.artifact.report.base.rows.length,1);
    const hashes=()=>JSON.parse(exec(`select coalesce(jsonb_object_agg(p.oid::text,jsonb_build_object('name',p.proname,'hash',md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')))),'{}')
      from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f';`));
    const oldFunctions=hashes(),business=d.inventory().filter(t=>t!=='faolla_schema_migrations'),beforeFacts=d.fingerprint(business),beforeCatalog=d.tableCatalog();
    const indexSql=`select coalesce(jsonb_agg(jsonb_build_array(c.oid,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive) order by c.oid),'[]') from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${d.owned.oid};`;
    const oldIndexes=exec(indexSql),install=()=>exec(boundClockMigrationBody(native.root,repairMigration));
    phase='install155';install();assert.equal(d.fingerprint(business),beforeFacts);assert.equal(d.tableCatalog(),beforeCatalog);assert.equal(exec(indexSql),oldIndexes);
    const installed=hashes(),added=Object.entries(installed).filter(([oid])=>!Object.hasOwn(oldFunctions,oid)).map(([,v])=>v.name).sort();
    assert.deepEqual(added,['faolla_attendance_period_closure_report_v1','faolla_attendance_period_closure_scoped_report_v1','faolla_attendance_period_closure_source_v1','faolla_attendance_period_closure_unified_report_v1']);
    for(const [oid,value] of Object.entries(oldFunctions))if(value.name==='faolla_attendance_period_closure_v1')assert.notEqual(installed[oid].hash,value.hash);else assert.deepEqual(installed[oid],value,'unrelated_function_changed:'+value.name);
    let comparisonReads=0;
    for(const access of ['owner','self'])for(const periodId of [null,pid]){
      const before=d.fingerprint(),raw=JSON.parse(exec('set local role service_role;select public.faolla_attendance_period_closure_source_v1('+json({...source.q,access,periodId})+','+quote(access==='owner'?d.owner:h.employeeAuthUserId)+');'));
      assert.equal(d.fingerprint(),before);assert.equal(raw.sourceFingerprint,source.ownerRaw.sourceFingerprint);assert.deepEqual(raw.sourceCanonical,source.ownerRaw.sourceCanonical);comparisonReads++;
    }
    const exportFixed=access=>JSON.parse(exec('set local role service_role;select '+expression(q('export',access,pid,null,1),access==='owner'?d.owner:h.employeeAuthUserId,null,null,false)+';'));
    const compareSaved=raw=>{assert.equal(raw.artifactText,saved.artifactText);assert.equal(raw.artifactSha256,saved.artifactSha256);assert.equal(raw.artifactBytes,saved.artifactBytes);assert.deepEqual(raw.artifact,saved.artifact);};
    for(const access of ['owner','self']){const before=d.fingerprint();compareSaved(exportFixed(access));assert.equal(d.fingerprint(),before);}
    const reapplyFacts=d.fingerprint(),reapplyDefs=d.definitions();install();assert.equal(d.fingerprint(),reapplyFacts);assert.equal(d.definitions(),reapplyDefs);compareSaved(exportFixed('owner'));
    native.pass('155 only replaces period lifecycle source wiring; normal nonempty canonical, old154 archive bytes, all other definitions/ACLs and migration reentry preserved');
    phase='timezone-resume';const before=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
    const resume=await verifyPeriodTimezoneResumeNative({d,native,scope,h});
    assert.equal(d.fingerprint(),before);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
    native.pass('155 actual timezone changes resume original fixed periods; new periods use current settings and historical-event settings guard remains');
    // Real route→server→SQL for the same nonempty saved period. Auth itself is synthetic.
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');
    const {parsePeriodClosureResponse,periodClosureQueryString}=require('../src/lib/merchantAttendancePeriodClosure.ts');
    const {handlePeriodClosures}=require('../src/app/api/merchant-enterprise/attendance/period-closures/route-handler.ts');
    const calls=[],service={rpc:async(name,a)=>{calls.push(name);let sql;
      if(name==='faolla_attendance_period_closure_source_v1')sql=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      else{assert.equal(name,'faolla_attendance_period_closure_v1');sql=expression(a.p_query,a.p_auth_user_id,a.p_command,a.p_artifact,a.p_allow_write);}
      try{return {data:JSON.parse(exec('set local role service_role;select '+sql+';')),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
    const handle=(request,access='owner',enabled=true)=>handlePeriodClosures(request,{siteEnabled:()=>enabled,allow:()=>true,
      authenticate:async()=>({user:{id:access==='owner'?d.owner:h.employeeAuthUserId},authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executePeriodClosures(input,service)});
    const success=async(query,c=null,enabled=true)=>{
      const headers={host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin',...(c?{'content-type':'application/json'}:{})};
      const request=new Request('https://www.faolla.com/api/merchant-enterprise/attendance/period-closures'+(c?'':'?'+periodClosureQueryString(query)),{method:c?'POST':'GET',headers,...(c?{body:JSON.stringify({query,command:c})}:{})});
      const response=await handle(request,query.access,enabled),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
      return parsePeriodClosureResponse(body,query,{authUserId:query.access==='owner'?d.owner:h.employeeAuthUserId},c).data;
    };
    phase='handler-resume';let current=await success(q('detail','self',pid));current=await success(q('detail','self',pid),command('confirm',current));
    current=await success(q('detail','owner',pid),command('seal',current));current=await success(q('detail','owner',pid),command('reopen',current),false);
    const preview=await success(q('preview','owner',pid));current=await success(q('detail','owner',pid),command('send',current,preview.preview.artifact.sourceFingerprint));
    assert.equal(current.period.currentVersion,2);current=await success(q('detail','self',pid),command('confirm',current));
    current=await success(q('detail','owner',pid),command('seal',current));assert.equal(current.period.sealed,true);
    compareSaved(exportFixed('owner'));assert.equal(exec(`select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${quote(d.site)} and period_id=${quote(pid)};`),'1');
    native.pass('155 actual route/server/SQL original archive resume, confirmed seal and paused-write reopen preserve one physical artifact');
    phase='browser';const browser=browserCheck?await browserCheck({d,native,scope,h,q,handle,pid}):null;
    phase='final-reapply';const finalFacts=d.fingerprint(),finalDefs=d.definitions();install();assert.equal(d.fingerprint(),finalFacts);assert.equal(d.definitions(),finalDefs);compareSaved(exportFixed('owner'));assert.equal(exec(indexSql),oldIndexes);
    result={resume,normalCanonicalComparisonReads:comparisonReads,old154ArchiveBytes:saved.artifactBytes,old154ArchivePreserved:true,
      unrelatedFunctionsAndAclsUnchanged:true,addedPrivateReports:3,addedServiceCollector:1,existingLifecycleReplacement:1,
      noNewTablesOrIndexes:true,migrationReentry:true,handlerRpcCalls:calls.length,browser,
      productionAccess:false,newCluster:false,deployment:false,migrationCandidate:155};
  }));return result;}finally{keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),browser=args.includes('--with-browser');
  runPeriodTimezoneResumeNative(args.filter(x=>x!=='--with-browser'),browser?runPeriodClosureBrowserAcceptance:null).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'period_timezone_resume_native_failed',phase,detail:String(error).slice(0,6500)}));process.exitCode=1;
  });
}
