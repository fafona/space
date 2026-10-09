//176 explicit LOCAL ONLY: reuse one stopped, identity-checked synthetic cluster.
// No production URL/environment, database copy, new cluster or real user account.
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
import {verifyPeriodSourceNative} from './fixtures/attendance-period-source-native.mjs';
import {verifyPeriodSourceRangesNative} from './fixtures/attendance-period-source-ranges-native.mjs';
import {verifyPeriodMissingContextNative} from './fixtures/attendance-period-missing-context-native.mjs';
import {verifyPeriodSessionCapacityNative} from './fixtures/attendance-period-session-capacity-native.mjs';
import {verifyPeriodSessionCapacityInstallNative} from './fixtures/attendance-period-session-capacity-install-native.mjs';
import {verifyPeriodSessionBoundariesNative} from './fixtures/attendance-period-session-boundaries-native.mjs';
import {verifyPeriodSealGuardsNative} from './fixtures/attendance-period-seal-guards-native.mjs';
import {runPeriodClosureBrowserAcceptance} from './fixtures/attendance-period-closure-browser.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);let phase='entry';
const migrations=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const rangesMigration='202610050151_merchant_attendance_period_source_ranges.sql';
const missingContextMigration='202610050152_merchant_attendance_period_missing_context.sql';
const sessionCapacityMigration='202610050153_merchant_attendance_period_session_capacity.sql';
export async function runPeriodClosuresNative(args,browserCheck=null){
  let result;const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope),{exec,site,owner}=d;
    const oldDefinitions=d.definitions();
    const functionHashes=()=>JSON.parse(exec(`select coalesce(jsonb_object_agg(p.oid::text,md5(pg_get_functiondef(p.oid))),'{}'::jsonb)::text from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f';`));
    const protectedFunctions=functionHashes();
    for(const migration of migrations){phase='install:'+migration;exec(boundClockMigrationBody(native.root,migration));}
    const installedFunctions=functionHashes();for(const [oid,hash] of Object.entries(protectedFunctions))assert.equal(installedFunctions[oid],hash,'preexisting_function_changed:'+oid);
    phase='history';const h=await seedPlanExceptionHistoryNative({d,native,scope});
    // Only the named synthetic employee's role. No production role is touched.
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(site)} and id=${quote(h.employeeId)});`);
    phase='source148-baseline';const originalSource=await verifyPeriodSourceNative({d,native,scope,h});
    const sourceOid=exec("select 'public.faolla_attendance_period_source_v1(jsonb,uuid)'::regprocedure::oid;"),beforeRangesFunctions=functionHashes();
    const businessTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),beforeRangesFacts=d.fingerprint(businessTables);
    const indexes=()=>JSON.parse(exec(`select coalesce(jsonb_agg(jsonb_build_array(c.oid,c.relname,pg_get_indexdef(c.oid),i.indisvalid,i.indisready,i.indislive) order by c.oid),'[]')
      from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace=${d.owned.oid};`));
    const beforeIndexes=indexes();
    const rangesSql=readFileSync(path.join(native.root,'scripts/supabase-migrations',rangesMigration),'utf8');
    //151 has explicit preflight/final transactions and CONCURRENTLY in between.
    //The verified local psql runner executes the file unchanged; never use the
    //single-transaction migration-body helper for this file.
    const installRanges=()=>{exec('select 1;');native.query(scope.sql(rangesSql));exec('select 1;');};
    phase='151-valid-orphan';const concurrentStatements=[...rangesSql.matchAll(/create index concurrently if not exists [\s\S]*?;/g)].map(m=>m[0]);
    assert.equal(concurrentStatements.length,2);exec('select 1;');native.query(scope.sql(concurrentStatements[0]));
    const orphanOid=exec("select 'public.attendance_correction_proposal_period_idx'::regclass::oid;");
    phase='install151';installRanges();
    assert.equal(exec("select 'public.attendance_correction_proposal_period_idx'::regclass::oid;"),orphanOid,'151_replaced_valid_orphan_index');
    assert.equal(d.fingerprint(businessTables),beforeRangesFacts,'151_changed_existing_business_facts');
    const afterRangesFunctions=functionHashes();assert.deepEqual(Object.keys(afterRangesFunctions),Object.keys(beforeRangesFunctions));
    for(const [oid,hash] of Object.entries(beforeRangesFunctions))if(oid!==sourceOid)assert.equal(afterRangesFunctions[oid],hash,'151_changed_unrelated_function:'+oid);
    assert.notEqual(afterRangesFunctions[sourceOid],beforeRangesFunctions[sourceOid]);
    const afterIndexes=indexes(),addedIndexes=afterIndexes.filter(i=>!beforeIndexes.some(old=>old[0]===i[0]));
    assert.deepEqual(addedIndexes.map(i=>i[1]).sort(),['attendance_correction_proposal_period_idx','attendance_revision_proposal_period_idx']);
    assert(addedIndexes.every(i=>i[3]&&i[4]&&i[5]));assert.deepEqual(afterIndexes.filter(i=>beforeIndexes.some(old=>old[0]===i[0])),beforeIndexes);
    phase='151-index-conflict-probes';const preflight=rangesSql.match(/do \$period_source_ranges_index_preflight\$[\s\S]*?\$period_source_ranges_index_preflight\$;/)?.[0];assert(preflight);
    const installedRangesFacts=d.fingerprint();
    for(const [indexName,table,wrongDefinition] of [
      ['attendance_correction_proposal_period_idx','merchant_attendance_correction_entries',"(merchant_id,worker_id,(public.faolla_attendance_instant_v1(proposal->>'endAt')),(public.faolla_attendance_instant_v1(proposal->>'startAt')),request_id) where action='submit'"],
      ['attendance_revision_proposal_period_idx','merchant_attendance_revision_requests',"(merchant_id,worker_id,(public.faolla_attendance_instant_v1(command->'proposal'->>'startAt')),(public.faolla_attendance_instant_v1(command->'proposal'->>'endAt')),request_id) where action='withdraw'"],
    ]){
      //Only disposable same-name synthetic objects in one rollback transaction;
      //do not mutate pg_index or manufacture invalid production index state.
      exec(`begin;alter index public.${indexName} rename to qa_period_ranges_saved_idx;
        create index ${indexName} on public.${table}${wrongDefinition};
        do $wrong_index$ begin begin execute ${quote(preflight)};raise exception '151_wrong_index_accepted';
          exception when sqlstate 'P0001' then if sqlerrm<>'merchant_attendance_period_source_ranges_index_conflict' then raise;end if;end;end;$wrong_index$;rollback;`);
      assert.equal(d.fingerprint(),installedRangesFacts);assert.deepEqual(indexes(),afterIndexes);
    }
    phase='source151';const rangesSource=await verifyPeriodSourceNative({d,native,scope,h});
    assert.equal(rangesSource.ownerRaw.sourceFingerprint,originalSource.ownerRaw.sourceFingerprint,'151_changed_existing_complete_source_hash');
    assert.deepEqual(rangesSource.ownerRaw.sourceCanonical,originalSource.ownerRaw.sourceCanonical,'151_changed_existing_complete_source_content');
    native.pass('151 concurrent indexes and source-only replacement preserve all existing facts, old functions and normal owner/self canonical content');
    phase='missing-context151-reproduction';const missingBefore=await verifyPeriodMissingContextNative({d,native,scope,h,expected:'151'});
    native.pass('151 actual approved missing declaration and pending out-of-period revision reproduce the omitted context/blocker without changing selected hours');
    phase='install152';const beforeMissingFunctions=functionHashes(),beforeMissingFacts=d.fingerprint(businessTables),beforeMissingCatalog=d.tableCatalog();
    const installMissingContext=()=>exec(boundClockMigrationBody(native.root,missingContextMigration));installMissingContext();
    assert.equal(d.fingerprint(businessTables),beforeMissingFacts);assert.equal(d.tableCatalog(),beforeMissingCatalog);assert.deepEqual(indexes(),afterIndexes);
    const afterMissingFunctions=functionHashes();assert.deepEqual(Object.keys(afterMissingFunctions),Object.keys(beforeMissingFunctions));
    for(const [oid,hash] of Object.entries(beforeMissingFunctions))if(oid!==sourceOid)assert.equal(afterMissingFunctions[oid],hash,'152_changed_unrelated_function:'+oid);
    assert.notEqual(afterMissingFunctions[sourceOid],beforeMissingFunctions[sourceOid]);
    phase='source152';const sourceBeforeCapacity=await verifyPeriodSourceNative({d,native,scope,h});
    assert.equal(sourceBeforeCapacity.ownerRaw.sourceFingerprint,rangesSource.ownerRaw.sourceFingerprint,'152_changed_unaffected_source_hash');
    assert.deepEqual(sourceBeforeCapacity.ownerRaw.sourceCanonical,rangesSource.ownerRaw.sourceCanonical,'152_changed_unaffected_source_content');
    phase='session-capacity152-reproduction';const sessionCapacity152=await verifyPeriodSessionCapacityNative({d,native,scope,h,expected:'152'});
    native.pass('152 diagnostic only: irrelevant preceding session consumes original report capacity; no business reader or stored fact is changed');
    phase='session-capacity153-saved-version';const savedVersion153=await verifyPeriodSessionCapacityInstallNative({d,native,scope,h,source:sourceBeforeCapacity});
    phase='install153';const beforeCapacityFunctions=functionHashes(),beforeCapacityFacts=d.fingerprint(businessTables),beforeCapacityCatalog=d.tableCatalog();
    const reportOids=JSON.parse(exec("select jsonb_build_array('public.faolla_attendance_period_report_v2(text,uuid,jsonb)'::regprocedure::oid::text,'public.faolla_attendance_scoped_period_report_v2(text,uuid,jsonb)'::regprocedure::oid::text);"));
    assert.equal(reportOids.length,2);assert(reportOids.every(oid=>Object.hasOwn(protectedFunctions,oid)));
    const changedReaderOids=new Set([sourceOid,...reportOids]);assert.equal(changedReaderOids.size,3);
    const installSessionCapacity=()=>exec(boundClockMigrationBody(native.root,sessionCapacityMigration));installSessionCapacity();
    assert.equal(d.fingerprint(businessTables),beforeCapacityFacts);assert.equal(d.tableCatalog(),beforeCapacityCatalog);assert.deepEqual(indexes(),afterIndexes);
    const afterCapacityFunctions=functionHashes();assert.deepEqual(Object.keys(afterCapacityFunctions),Object.keys(beforeCapacityFunctions));
    for(const [oid,hash] of Object.entries(beforeCapacityFunctions)){
      if(changedReaderOids.has(oid))assert.notEqual(afterCapacityFunctions[oid],hash,'153_expected_reader_replacement:'+oid);
      else assert.equal(afterCapacityFunctions[oid],hash,'153_changed_unrelated_function:'+oid);
    }
    phase='source153';const source=await verifyPeriodSourceNative({d,native,scope,h});
    assert.equal(source.ownerRaw.sourceFingerprint,sourceBeforeCapacity.ownerRaw.sourceFingerprint,'153_changed_normal_source_hash');
    assert.deepEqual(source.ownerRaw.sourceCanonical,sourceBeforeCapacity.ownerRaw.sourceCanonical,'153_changed_normal_source_content');
    phase='session-capacity153';const sessionCapacity153=await verifyPeriodSessionCapacityNative({d,native,scope,h,expected:'153'});
    for(const [stage,fingerprint] of Object.entries(sessionCapacity152.canonicalFingerprints))assert.equal(sessionCapacity153.canonicalFingerprints[stage],fingerprint,'153_changed_normal_dense_source:'+stage);
    phase='session-boundaries153';const sessionBoundaries=await verifyPeriodSessionBoundariesNative({d,native,scope,h});
    native.pass('153 exact related-session capacity preserves old saved versions and normal source; unrelated preceding no longer consumes100, true101 still fails closed');
    phase='missing-context152-under153';const missingAfter=await verifyPeriodMissingContextNative({d,native,scope,h,expected:'152'});
    native.pass('152 pending missing context regression under153 preserves approved reports and blocks unresolved sealing');
    phase='source-ranges';const sourceRanges=await verifyPeriodSourceRangesNative({d,native,scope,h});
    native.pass('151 range regression under153: dense history, exact ranges, pending heads, capacity boundaries and index access paths');
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');
    const {parsePeriodClosureResponse,periodClosureQueryString}=require('../src/lib/merchantAttendancePeriodClosure.ts');
    const {handlePeriodClosures}=require('../src/app/api/merchant-enterprise/attendance/period-closures/route-handler.ts');
    const q=(mode='list',access='owner',periodId=null,operationId=null,version=null)=>({...source.q,mode,access,periodId,operationId,version});
    const expression=(query,actor,command=null,artifact=null,allow=true)=>`public.faolla_attendance_period_closure_v1(${json(query)},${quote(actor)},${json(command)},${json(artifact)},${allow})`;
    const calls=[],service={rpc:async(name,a)=>{calls.push(name);let sql;
      if(name==='faolla_attendance_period_source_v1')sql=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      else{assert.equal(name,'faolla_attendance_period_closure_v1');sql=expression(a.p_query,a.p_auth_user_id,a.p_command,a.p_artifact,a.p_allow_write);}
      try{return {data:JSON.parse(exec('set local role service_role;select '+sql+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const handle=(req,access='owner',enabled=true)=>handlePeriodClosures(req,{siteEnabled:()=>enabled,allow:()=>true,
      authenticate:async()=>({user:{id:access==='owner'?owner:h.employeeAuthUserId},authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:i=>executePeriodClosures(i,service)});
    const request=async(query,command=null,enabled=true)=>{const headers={host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin',...(command?{'content-type':'application/json'}:{})};
      const req=new Request('https://www.faolla.com/api/merchant-enterprise/attendance/period-closures'+(command?'':'?'+periodClosureQueryString(query)),{method:command?'POST':'GET',headers,...(command?{body:JSON.stringify({query,command})}:{})});
      const response=await handle(req,query.access,enabled);const body=await response.json();return {status:response.status,body};};
    const success=async(query,command=null,enabled=true)=>{const r=await request(query,command,enabled);assert.equal(r.status,200,JSON.stringify(r));return parsePeriodClosureResponse(r.body,query,{authUserId:query.access==='owner'?owner:h.employeeAuthUserId},command).data;};
    const pid=id(176001);let op=176010;
    const make=(action,detail,reason='',fp=null)=>({action,operationId:id(op++),periodId:pid,expectedRevision:detail?.period.revision??0,expectedVersion:detail?.period.currentVersion??0,
      expectedFingerprint:fp??detail?.artifact?.sourceFingerprint??null,reason});
    phase='unfinished-send';const unfinishedFacts=d.fingerprint();
    const unfinishedQuery={...q('preview'),fromDate:d.day(1),throughDate:d.day(1)};
    const unfinishedPreview=await success(unfinishedQuery);assert(unfinishedPreview.preview.blockers.includes('period_in_progress'));
    const unfinishedCommand={...make('send',null,'Synthetic177 unfinished review must not persist',unfinishedPreview.preview.artifact.sourceFingerprint),periodId:id(177001)};
    const unfinishedReply=await request({...unfinishedQuery,mode:'detail',periodId:unfinishedCommand.periodId},unfinishedCommand);
    assert.equal(unfinishedReply.status,409);assert.equal(unfinishedReply.body.error,'attendance_period_blocked');assert.equal(d.fingerprint(),unfinishedFacts);
    native.pass('149 real future-period preview is complete but fresh send is rejected without persisting facts');
    phase='preview-send';const preview=await success(q('preview'));assert.deepEqual(preview.preview.blockers,[]);
    const send=make('send',null,'Synthetic176 send complete period',preview.preview.artifact.sourceFingerprint);
    let current=await success(q('detail','owner',pid),send);assert.equal(current.period.state,'review');assert.equal(current.artifactVersion,1);
    const originalArtifact=current.artifact,immutable=JSON.stringify(originalArtifact),initialStored=exec(`select artifact_sha256 from public.merchant_attendance_period_artifacts where merchant_id=${quote(site)} and period_id=${quote(pid)};`);
    const self=await success(q('detail','self',pid));assert.deepEqual(self.artifact,originalArtifact);
    phase='dispute';current=await success(q('detail','self',pid),make('dispute',self,'Synthetic176 employee disagrees'));
    assert.equal(current.period.unresolvedDispute,true);current=await success(q('detail','owner',pid),make('respond',current,'Synthetic176 owner explanation'));
    assert.equal(current.period.unresolvedDispute,true);
    const earlySeal=await request(q('detail','owner',pid),make('seal',current,'Synthetic176 must wait for explicit employee confirmation'));assert.equal(earlySeal.status,409);assert.equal(earlySeal.body.error,'attendance_period_not_confirmed');
    current=await success(q('detail','self',pid),make('confirm',current));assert.equal(current.period.unresolvedDispute,false);
    phase='seal';const seal=make('seal',current,'Synthetic176 owner seals agreed version');current=await success(q('detail','owner',pid),seal);assert.equal(current.period.sealed,true);
    const beforeRecovery=d.fingerprint(),callStart=calls.length;
    const recovered=await success(q('detail','owner',pid),send,false);assert.equal(recovered.replayed,true);assert.deepEqual(recovered.operation.command,send);assert.equal(d.fingerprint(),beforeRecovery);
    assert.deepEqual(calls.slice(callStart),['faolla_attendance_period_closure_v1']);
    const exported=await success(q('export','self',pid,null,1),null,false);assert.equal(JSON.stringify(exported.artifact),immutable);
    native.pass('149 actual handler/service/SQL owner send, self dispute, owner response, explicit self confirmation, owner seal and original replay without source reads');
    phase='guard';const guardBefore=d.fingerprint();
    const stamp=s=>new Date(s).toISOString().replace('Z','000Z');
    const spans=[{startAt:stamp(h.slot.startAt),endAt:stamp(h.slot.endAt)}];
    const assertGuard=(worker,values,error=null)=>{const statement=`perform public.faolla_attendance_period_assert_open_v1(${quote(site)},${quote(worker)},${json(values)});`;
      return error?`do $deny$ begin begin ${statement} raise exception 'expected_gate_rejection';exception when others then if sqlerrm<>${quote(error)} then raise;end if;end;end;$deny$;`:statement.replace(/^perform/,'select');};
    exec(assertGuard(h.workerId,spans,'attendance_period_sealed'));exec(assertGuard(d.worker,spans));
    exec(assertGuard(h.workerId,[{startAt:current.period.endAt,endAt:current.period.endAt}]));
    exec(assertGuard(h.workerId,[{startAt:current.period.startAt,endAt:current.period.startAt}],'attendance_period_sealed'));
    assert.equal(d.fingerprint(),guardBefore);
    const sealGuards=await verifyPeriodSealGuardsNative({d,native,scope,h,q,pid});
    native.pass('150 real old correction/revision/missing writers reject sealed ranges atomically; capacity keeps owner reopening and real clocks available');
    phase='reopen';const reopen=make('reopen',current,'Synthetic176 authorized correction review');current=await success(q('detail','owner',pid),reopen,false);
    assert.equal(current.period.state,'open');assert.equal(current.period.confirmedVersion,null);exec(assertGuard(h.workerId,spans));
    const fresh=await success(q('preview','owner',pid));const sendAgain=make('send',current,'Synthetic176 new review round',fresh.preview.artifact.sourceFingerprint);
    current=await success(q('detail','owner',pid),sendAgain);assert.equal(current.period.currentVersion,2);assert.equal(current.period.confirmedVersion,null);
    assert.equal(exec(`select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${quote(site)} and period_id=${quote(pid)};`),'1');
    assert.equal(exec(`select artifact_sha256 from public.merchant_attendance_period_artifacts where merchant_id=${quote(site)} and period_id=${quote(pid)};`),initialStored);
    assert.equal(JSON.stringify((await success(q('export','owner',pid,null,1))).artifact),immutable);
    native.pass('149 reopen does not inherit confirmation; identical source reuses one physical artifact across two logical versions; frozen export bytes unchanged');
    phase='changed-source-and-identity';const negativeBaseline=d.fingerprint();
    const reject=(sql,code)=>`begin perform ${sql};raise exception 'period_expected_rejection';exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;`;
    const confirmChanged=make('confirm',current);
    exec(`begin;reset role;update public.merchant_attendance_workers set display_name='Synthetic176 changed after review' where merchant_id=${quote(site)} and id=${quote(h.workerId)};
      set local role service_role;do $changed$ declare r jsonb;begin
        r:=${expression(q('detail','owner',pid),owner)};assert r->'sourceChanged'='true'::jsonb;
        assert r->>'artifactSha256'=${quote(initialStored)};
        r:=${expression(q('detail','owner',pid,null,2),owner)};assert r->'sourceChanged'='null'::jsonb;
        ${reject(expression(q('detail','self',pid),h.employeeAuthUserId,confirmChanged),'attendance_period_source_changed')}
      end;$changed$;rollback;`);
    assert.equal(d.fingerprint(),negativeBaseline);
    exec(`begin;reset role;update public.merchant_enterprise_employees set auth_user_id=${quote(id(176982))} where merchant_id=${quote(site)} and id=${quote(h.employeeId)};
      set local role service_role;do $identity$ begin
        ${reject(expression(q('detail','owner',pid),owner),'attendance_period_identity_changed')}
        ${reject(expression(q('recover','owner',pid,send.operationId),owner),'attendance_period_identity_changed')}
        ${reject(expression(q('export','self',pid,null,1),id(176982)),'attendance_period_identity_changed')}
      end;$identity$;rollback;`);
    assert.equal(d.fingerprint(),negativeBaseline);
    native.pass('149 changed current source cannot be confirmed; explicit saved version stays fixed; changed employee Auth cannot inherit details, export or original receipt');
    phase='race';current=await success(q('detail','self',pid),make('confirm',current));
    const first=make('seal',current,'Synthetic176 race one'),second=make('seal',current,'Synthetic176 race two');
    const holder=`reset role;${d.guard}set local role service_role;select ${expression(q('detail','owner',pid),owner,first)};`;
    const waiter=`reset role;${d.guard}set local role service_role;do $race$ begin begin perform ${expression(q('detail','owner',pid),owner,second)};raise exception 'race_expected_conflict';exception when others then if sqlerrm<>'attendance_version_conflict' then raise;end if;end;end;$race$;`;
    const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(race.witnessed);assert.equal(race.right.error,null);
    native.pass('149 exact-PID concurrent sealing accepts one matching revision and rejects stale second command');
    phase='browser';const browser=browserCheck?await browserCheck({d,native,scope,h,q,handle,request,success,pid}):null;
    phase='reapply';const facts=d.fingerprint(),defs=d.definitions();for(const m of migrations.slice(3))exec(boundClockMigrationBody(native.root,m));installRanges();installMissingContext();installSessionCapacity();
    assert.equal(d.fingerprint(),facts);assert.equal(d.definitions(),defs);
    assert.deepEqual(indexes(),afterIndexes);
    const finalFunctions=functionHashes();for(const [oid,hash] of Object.entries(protectedFunctions))assert.equal(finalFunctions[oid],reportOids.includes(oid)?afterCapacityFunctions[oid]:hash,'preexisting_function_changed:'+oid);
    for(const oid of changedReaderOids)assert.equal(finalFunctions[oid],afterCapacityFunctions[oid],'153_reapply_changed_target:'+oid);
    result={sourceChecks:source.checks,sourceReads:source.sourceReads,sourceRanges,missingContext:{before:missingBefore,after:missingAfter},sessionCapacity152,sessionCapacity153,sessionBoundaries,savedVersion153,normalSourcePreserved:true,concurrentIndexes:addedIndexes.map(i=>i[1]),validOrphanAdopted:true,wrongIndexProbes:2,sealGuards,unfinishedSendRejected:true,handlerSql:calls.length,exactPidRaces:1,browser,
      protectedFunctions:Object.keys(protectedFunctions).length-reportOids.length,changedExistingReaders:reportOids.length,targetFunctionReplacements:changedReaderOids.size,syntheticHistoricalRows:h.syntheticHistoricalRows,actualPastPublication:false,productionAccess:false,newCluster:false,oldDefinitions};
  }));return result;}finally{keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),browser=args.includes('--with-browser');
  runPeriodClosuresNative(args.filter(x=>x!=='--with-browser'),browser?runPeriodClosureBrowserAcceptance:null).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({error:'period_closures_native_failed',phase,detail:String(e).slice(0,4500)}));process.exitCode=1;});
}
