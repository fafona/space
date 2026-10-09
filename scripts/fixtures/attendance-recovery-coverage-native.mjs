//226 missing-table coverage in the caller-owned synthetic schema only.
//Historical clock/position rows below are explicitly synthetic prerequisites;
//the nine subsequent annotation/setup/template/capture/export writes are real RPCs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './attendance-bound-clocks-native.mjs';
import {runAttendanceRecoveryReadProbe} from '../merchant-attendance-recovery-native-checks.mjs';

const require=createRequire(import.meta.url),site='99990227',fid=n=>id(226700000+n);
export const attendanceRecoveryCoverageTables=Object.freeze([
 'merchant_attendance_location_reviews','merchant_attendance_location_discussion','merchant_attendance_location_setup_operations',
 'merchant_attendance_unified_exports','merchant_attendance_shift_templates','merchant_attendance_shift_template_operations',
 'merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations',
]);
export const attendanceRecoveryCoverageMigrations=Object.freeze([
 '202609300074_merchant_attendance_location_reviews.sql','202609300075_merchant_attendance_location_discussion.sql',
 '202609300078_merchant_attendance_location_setup.sql','202610010102_merchant_attendance_unified_export.sql',
 '202610030119_merchant_attendance_shift_templates.sql','202610040131_merchant_attendance_rule_captures.sql',
]);
const versions=attendanceRecoveryCoverageMigrations.map(name=>name.slice(0,12));
export function attendanceRecoveryCoveragePlan(day){
 assert(/^20\d\d-\d\d-\d\d$/.test(day));assert.equal(new Date(day+'T00:00:00Z').toISOString().slice(0,10),day);
 const owner=fid(1),auth=fid(2),employee=fid(3),role=fid(4),worker=fid(5),location=fid(6),event=fid(10);
 const reviewQuery={siteId:site,mode:'detail',eventId:event,operationId:null};
 const reviewCommand={eventId:event,operationId:fid(20),expectedRevision:0,outcome:'follow_up',note:'Synthetic226 private owner annotation 中文'};
 const discussionQuery=access=>({siteId:site,access,mode:'detail',expectedWorkerId:access==='self'?worker:null,eventId:event,operationId:null});
 const discussionCommands=[{eventId:event,operationId:fid(21),expectedRevision:0,note:'Synthetic226 employee explanation'},
  {eventId:event,operationId:fid(22),expectedRevision:1,note:'Synthetic226 explicit owner reply'}];
 const setupQuery={siteId:site,locationId:location,operationId:null};
 const setupCommand={action:'pause',operationId:fid(23),expectedSettingsVersion:1,expectedLocationVersion:1,expectedChannelVersion:1,draftRevision:null,reason:'Synthetic226 reversible location-channel pause'};
 const templateQuery={siteId:site,view:'archived',cursorId:null,operationId:null};
 const templateCommands=[{operationId:fid(24),templateId:fid(24),expectedRevision:0,action:'save',template:{name:'Synthetic226 overnight pattern',segments:[{start:'22:00',end:'06:00',nextDay:true}]}},
  {operationId:fid(25),templateId:fid(24),expectedRevision:1,action:'archive',template:null}];
 const captureCommands=[26,27].map(n=>({operationId:fid(n),fromDate:day,throughDate:day,reason:'Synthetic226 observe current unconfigured rule context '+n,employeeId:employee,employeeAuthUserId:auth}));
 const exportCommand={siteId:site,operationId:fid(28),query:{access:'owner',workerId:worker,locationId:null,expectedWorkerId:null,
  fromDate:day,throughDate:day,expectedTimeZone:'UTC',expectedScopeRevision:null}};
 return {site,owner,auth,employee,role,worker,location,event,day,reviewQuery,reviewCommand,discussionQuery,discussionCommands,setupQuery,setupCommand,
  templateQuery,templateCommands,captureCommands,exportCommand};
}

//Only this new merchant's rows and the six exact migration registrations may
//be appended. Existing settings are compared after removing ONLY the new078
//column; its value on every prior row is separately required to remain one.
export function attendanceRecoveryCoverageProtectedSql(names){
 assert(Array.isArray(names)&&names.length>0&&new Set(names).size===names.length);
 return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const body=name==='merchant_attendance_settings'?"to_jsonb(r)-'location_channel_version'":'to_jsonb(r)';
  const where=name==='merchants'?`r.id<>${quote(site)}`:name==='faolla_schema_migrations'?`r.version not in(${versions.join(',')})`:
   name==='merchant_attendance_location_results'?`r.event_id<>${quote(fid(10))}::uuid`:`coalesce(to_jsonb(r)->>'merchant_id','')<>${quote(site)}`;
  return `select ${quote(name)} name,(select coalesce(jsonb_agg(${body} order by (${body})::text),'[]') from public.${name} r where ${where}) rows`;
 }).join(' union all ')+') coverage_prior_facts)';
}
export function attendanceRecoveryCoverageSeedSql(p){
 assert.equal(p.site,site);assert.equal(p.worker,fid(5));assert.equal(p.event,fid(10));assert(/^20\d\d-\d\d-\d\d$/.test(p.day));
 return `do $coverage_seed_guard$ begin assert not exists(select 1 from public.merchants where id=${quote(site)}),'coverage_new_merchant_required';end;$coverage_seed_guard$;
 insert into public.merchants(id,user_id) values(${quote(site)},${quote(p.owner)});
 insert into public.merchant_attendance_settings(merchant_id,enabled,time_zone,web_clock_enabled,location_clock_enabled)
  values(${quote(site)},true,'UTC',true,true);
 insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(p.role)},${quote(site)},'Synthetic226 recovery coverage',array['enterprise.view','attendance.self.view','attendance.self.clock']);
 insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
  values(${quote(p.employee)},${quote(site)},${quote(p.auth)},'recovery226@example.invalid','Synthetic226 employee 中文',${quote(p.role)},'active');
 insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
  values(${quote(p.location)},${quote(site)},'Synthetic226 historical place','UTC',true);
 insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
  values(${quote(p.worker)},${quote(site)},${quote(p.employee)},'REC226','Synthetic226 worker',true,${quote(p.location)});
 insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on)
  values(${quote(fid(7))},${quote(site)},${quote(p.worker)},'2000-01-01');
 --Two explicit historical fixtures, NOT successful past clock requests or real GPS evidence.
 insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,actor_employee_id)
  values(${quote(p.event)},${quote(site)},${quote(p.worker)},${quote(p.location)},${quote(fid(12))},1,'clock_in','web','UTC',${quote(p.day+'T10:00:00Z')},${quote(p.day+'T10:00:00Z')},${quote(p.employee)}),
  (${quote(fid(11))},${quote(site)},${quote(p.worker)},${quote(p.location)},${quote(fid(13))},2,'clock_out','web','UTC',${quote(p.day+'T12:00:00Z')},${quote(p.day+'T12:00:00Z')},${quote(p.employee)});
 insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review,captured_at,accuracy_meters,distance_meters)
  values(${quote(p.event)},1,1,1,1,'denied',true,null,null,null);`;
}
function callExpression(p,kind,q,c=null){
 const withoutSite=query=>{const {siteId,...body}=query;assert.equal(siteId,site);return json(body);};
 if(kind==='review')return `public.faolla_attendance_location_reviews_v1(${quote(site)},${quote(p.owner)},${withoutSite(q)},${json(c)})`;
 if(kind==='discussion')return `public.faolla_attendance_location_discussion_v1(${quote(site)},${quote(q.access==='self'?p.auth:p.owner)},${withoutSite(q)},${json(c)})`;
 if(kind==='setup')return `public.faolla_attendance_location_setup_v1(${quote(site)},${quote(p.owner)},${quote(p.location)},${json(c)},${quote(q.operationId)},false)`;
 if(kind==='templates')return `public.faolla_attendance_shift_templates_v1(${json(q)},${quote(p.owner)},${json(c)},${c!==null})`;
 if(kind==='captures')return `public.faolla_attendance_rule_captures_v1(${json(q)},${quote(p.owner)},${json(c)},${c!==null})`;
 assert.equal(kind,'export');assert.equal(c,null);return `public.faolla_attendance_unified_export_v1(${quote(site)},${quote(p.owner)},${quote(p.exportCommand.operationId)},${json(p.exportCommand.query)})`;
}
function project(p,kind,raw,q,c=null){
 if(kind==='review')return require('../../src/lib/merchantAttendanceLocationReview.ts').parseAttendanceLocationReviewResult(raw,c?{...q,operationId:c.operationId}:q);
 if(kind==='discussion')return require('../../src/lib/merchantAttendanceLocationDiscussion.ts').parseDiscussionResult(raw,c?{...q,operationId:c.operationId}:q);
 if(kind==='setup')return require('../../src/lib/merchantAttendanceLocationSetup.ts').parseLocationSetupResult(raw,{...q,ownerId:p.owner,operationId:c?.operationId??q.operationId});
 if(kind==='templates')return require('../../src/lib/merchantAttendanceShiftTemplates.ts').parseShiftTemplatesResult(raw,q,c);
 if(kind==='captures')return require('../../src/lib/merchantAttendanceRuleCaptures.ts').parseRuleCapturesResult(raw,q,c,p.owner);
 return require('../../src/lib/merchantAttendanceUnifiedExport.ts').parseUnifiedExportSource(raw,p.exportCommand);
}
function receipt(p,kind,raw,q,c=null){
 const value=project(p,kind,raw,q,c);assert(value.receipt,'coverage_receipt_required:'+kind);
 if(kind==='captures'){
  const r=value.receipt;assert.equal(r.sourceBytes,Buffer.byteLength(r.sourceText));assert.equal(r.sourceSha256,createHash('sha256').update(r.sourceText).digest('hex'));
  assert.equal(r.applied,false);assert.equal(r.historicalApplicationProven,false);
 }
 return value.receipt;
}
function sampleExpression(){
 return 'jsonb_build_object('+attendanceRecoveryCoverageTables.map(name=>quote(name)+`,(select jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text,'UTF8')),'hex')) from public.${name} r where merchant_id=${quote(site)})`).join(',')+')';
}

export async function prepareAttendanceRecoveryCoverage(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive,period,pq,periodId}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(ctx.outageRelationsRacesFoundation?.phase,223);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const oldNames=d.inventory(),protectedSql=attendanceRecoveryCoverageProtectedSql(oldNames),before=d.exec('select '+protectedSql+';');
 const existingOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const oldDefinitions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
  from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(existingOids)}::oid[]) and p.prokind='f';`);
 const functionsBefore=oldDefinitions(),savedArchive=periodArchive();
 d.exec(`do $coverage_install_guard$ begin
  ${attendanceRecoveryCoverageTables.map(name=>`assert to_regclass('public.${name}') is null,'coverage_missing_table_expected';`).join('\n')}
  assert not exists(select 1 from public.faolla_schema_migrations where version in(${versions.join(',')})),'coverage_migrations_expected_absent';
  assert not exists(select 1 from pg_attribute where attrelid='public.merchant_attendance_settings'::regclass and attname='location_channel_version' and not attisdropped),'coverage_078_column_expected_absent';
  assert not exists(select 1 from public.merchants where id=${quote(site)}),'coverage_fresh_merchant_required';end;$coverage_install_guard$;`);
 for(const name of attendanceRecoveryCoverageMigrations)d.exec(boundClockMigrationBody(native.root,name));
 assert.deepEqual(d.inventory().slice().sort(),[...oldNames,...attendanceRecoveryCoverageTables].sort());
 const preserve=()=>{
  assert.equal(d.exec('select '+protectedSql+';'),before,'coverage_old_fields_or_rows_changed');assert.equal(oldDefinitions(),functionsBefore,'coverage_replaced_old_function');
  assert.equal(d.exec(`select bool_and(location_channel_version=1) from public.merchant_attendance_settings where merchant_id<>${quote(site)};`),'t','coverage_old_settings_new_column_default');
  for(const [actual,expected]of [[archive(),oldArchive],[periodArchive(),savedArchive]]){
   assert.equal(actual.artifactText,expected.artifactText);assert.equal(actual.artifactSha256,expected.artifactSha256);assert.equal(actual.artifactBytes,expected.artifactBytes);
  }
 };
 preserve();const day=d.exec("select ((clock_timestamp() at time zone 'UTC')::date-1)::text;"),p=attendanceRecoveryCoveragePlan(day);
 d.exec(attendanceRecoveryCoverageSeedSql(p));preserve();
 const expected=[],probes=[];
 const write=(kind,q,c=null)=>{
  const raw=JSON.parse(d.exec(`begin;set local role service_role;
do $coverage_write_role$ begin assert current_user='service_role','coverage_write_service_role_required';end;$coverage_write_role$;
select ${callExpression(p,kind,q,c)};commit;`));
  const saved=receipt(p,kind,raw,q,c);preserve();
  probes.push({kind,q:kind==='export'?null:{...q,operationId:c.operationId}});expected.push(saved);return {raw,saved};
 };
 write('review',p.reviewQuery,p.reviewCommand);
 write('discussion',p.discussionQuery('self'),p.discussionCommands[0]);
 write('discussion',p.discussionQuery('owner'),p.discussionCommands[1]);
 const setup=write('setup',p.setupQuery,p.setupCommand);assert.equal(setup.saved.after.channelEnabled,false);assert.equal(setup.saved.after.channelVersion,2);
 write('templates',p.templateQuery,p.templateCommands[0]);const archived=write('templates',p.templateQuery,p.templateCommands[1]);assert(archived.saved.item.archived);
 const captures=p.captureCommands.map(c=>write('captures',{siteId:site,workerId:p.worker,operationId:c.operationId},c).saved);
 assert.equal(captures[0].sourceId,captures[1].sourceId);assert.equal(captures[0].sourceText,captures[1].sourceText);
 const exported=write('export',null);assert.equal(exported.saved.sessionCount,1);assert.equal(exported.saved.missingCount,0);
 const parsedExport=project(p,'export',exported.raw,null);assert.equal(parsedExport.report.totals.selected.workedUs,7200000000);
 const names=d.inventory(),config={schema:scope.schema,names},sourceExec=sql=>native.query(scope.sql(sql));
 const read=async(exec,probe)=>{
  const packet=await runAttendanceRecoveryReadProbe(exec,{...config,expression:callExpression(p,probe.kind,probe.q)});
  assert.equal(packet.error,null,'coverage_restore_rpc:'+probe.kind+':'+packet.error);
  if(probe.kind==='export'){assert.equal(packet.value.replayed,true);assert.equal(packet.value.report,null);}
  return receipt(p,probe.kind,packet.value,probe.q);
 };
 for(let i=0;i<probes.length;i++)assert.deepEqual(await read(sourceExec,probes[i]),expected[i],'coverage_original_receipt_before_dump');
 const snapshot=await runAttendanceRecoveryReadProbe(sourceExec,{...config,expression:sampleExpression(),serviceRole:false});assert.equal(snapshot.error,null);
 const counts=Object.fromEntries(Object.entries(snapshot.value).map(([name,value])=>[name,value.count]));
 assert.deepEqual(counts,{merchant_attendance_location_reviews:1,merchant_attendance_location_discussion:2,merchant_attendance_location_setup_operations:1,
  merchant_attendance_unified_exports:1,merchant_attendance_shift_templates:1,merchant_attendance_shift_template_operations:2,
  merchant_attendance_rule_capture_artifacts:1,merchant_attendance_rule_capture_operations:2});
 preserve();const current=await period(pq('detail','owner',periodId));assert(current.period.sealed);assert.equal(current.sourceChanged,false);
 return {summary:{tablesAdded:attendanceRecoveryCoverageTables.length,migrations:[...attendanceRecoveryCoverageMigrations],sampleRows:counts,actualRpcWrites:9,
  historicalClockFixtureRows:2,syntheticLocationEvidenceRows:1,actualHistoricalClockRequests:0,realLocationCapture:false,
  settingsColumnAdded:'location_channel_version DEFAULT 1',priorSettingsFieldsUnchanged:true,priorFunctionsUnchanged:true,oldArchivesUnchanged:true,
  templateArchived:true,candidateCapturesDeduplicate:true,capturesAreNotAppliedRules:true,legacyExportIsMetadataOnly:true,
  committedOnlyInCallerOwnedSchema:true,realAuthentication:false},
  verifyRestored:async restoredExec=>{
   assert.equal(typeof restoredExec,'function');const packet=await runAttendanceRecoveryReadProbe(restoredExec,{...config,expression:sampleExpression(),serviceRole:false});
   assert.equal(packet.error,null);assert.deepEqual(packet.value,snapshot.value,'coverage_restored_sample_facts_changed');
   for(let i=0;i<probes.length;i++)assert.deepEqual(await read(restoredExec,probes[i]),expected[i],'coverage_restored_receipt:'+probes[i].kind);
   const end=await runAttendanceRecoveryReadProbe(restoredExec,{...config,expression:sampleExpression(),serviceRole:false});assert.equal(end.error,null);
   assert.deepEqual(end.value,snapshot.value);assert.equal(end.before,packet.before,'coverage_target_probes_changed_facts');
   return {coveredTables:8,meaningfulSampleRows:counts,originalReceiptsEqual:9,probeTransactions:11,
    ruleCaptureOriginalTextBytesAndShaEqual:true,archivedTemplateOriginalSaveAndArchiveReceiptsEqual:true,
    legacyUnifiedExportOriginalMetadataReplay:true,allTargetProbesZeroFactWrites:true,allTargetProbeTransactionsRolledBack:true,
    targetFreshWrites:0,sourceWritesDuringVerification:0,realAuthentication:false};
  }};
}
