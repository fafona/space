import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {recoveryContentFixture} from './test-fixtures/database-recovery-content.mjs';
import {PRODUCTION_RELEASE_AGGREGATE_KEYS} from './production-release-attestation.mjs';
import {ATTENDANCE_RELEASE_SCOPE,assertAttendanceDatabaseReadyProof} from './online-traffic-release-policy.mjs';
import {
 attendanceProductionIdentity,attendanceProductionScopeSha256,attendanceProductionLegacy052SourceSha256,loadAttendanceProductionScope,validateAttendanceRegistry,
 attendanceReadOnlyStateSql,validateAttendanceProductionState,protectedAttendanceMigrationSql,
 validateAttendanceCompatibilityProof,validateAttendanceBackupEvidence,attendance052CompatibilityPlan,filterAttendanceCompatibilityMetadataSql,
 runAttendanceProductionMigrations,verifyAttendanceProductionDatabaseReady,parseAttendanceProductionArguments,
} from './attendance-production-database-migrations.mjs';
const target='a'.repeat(40),baseline=ATTENDANCE_RELEASE_SCOPE.baseline,sha=x=>createHash('sha256').update(x).digest('hex');
const repairTarget='a535a308e21f121e7cf410a6f7d84c974eb370a6',toolRevision='b'.repeat(40),receiptSha256='c'.repeat(64);
const managerSource=await readFile(new URL('./attendance-production-database-migrations.mjs',import.meta.url),'utf8');
function managerSection(first,next){
 const start=managerSource.indexOf(first),end=managerSource.indexOf(next,start+first.length);
 assert(start>=0&&end>start);return managerSource.slice(start,end);
}
const scope=await loadAttendanceProductionScope({rootOwned:false});
const checks=attendance052CompatibilityPlan({target,sourcePilotContainerId:'c'.repeat(64)}).checks;
const compatibility=()=>({schemaVersion:1,kind:'attendance-052-upgrade-compatibility',target,baseline,scopeSha256:attendanceProductionScopeSha256,
 databaseName:`faolla_attendance_compat_${target.slice(0,12)}`,sourcePilotContainerId:'c'.repeat(64),productionDataCopied:false,
 owner:'supabase_admin',baselineRegistryCount:60,baselineRegistryMaximum:'202609240052',initialAttendanceRelations:0,initialAttendanceFunctions:0,
 finalRegistryCount:209,finalRegistryMaximum:'202610090210',checks:Object.fromEntries(checks.map(x=>[x,true])),transcriptSha256:'d'.repeat(64),legacyFingerprintBefore:'e'.repeat(64),legacyFingerprintAfter:'e'.repeat(64),databaseOid:'20000',backendPid:500,sourcePilotSystemIdentifier:'7611111111111111111',outsideCatalogSha256Before:'1'.repeat(64),outsideCatalogSha256After:'1'.repeat(64),clusterRolesSha256Before:'2'.repeat(64),clusterRolesSha256After:'2'.repeat(64),productionMetadataSource:{identity:attendanceProductionIdentity,schemaOnly:true,productionDataCopied:false,registryCount:60,registryMaximum:'202609240052',metadataSourceSha256:'6'.repeat(64),normalizedContractSha256:'7'.repeat(64),formalStateSha256Before:'8'.repeat(64),formalStateSha256After:'8'.repeat(64)},historicalBootstrapReplayed:false,originalAttendanceSourcesInstalled:149});
function state(installed=0){return {...attendanceProductionIdentity,currentUser:'supabase_admin',adminSuperuser:true,postgresSuperuser:false,primary:true,
 registry:[...scope.manifest.baseline,...scope.manifest.migrations.slice(0,installed).map(({version,name})=>({version,name}))],
 owners:Object.fromEntries(['merchants','merchant_enterprise_roles','merchant_enterprise_employees'].map(x=>[x,'supabase_admin'])),
 attendanceRelations:installed?120:0,attendanceFunctions:installed?550:0,
 functions:Object.fromEntries(['faolla_valid_merchant_enterprise_permissions_v1(text[])','faolla_update_merchant_enterprise_employee_v1(jsonb)','faolla_update_merchant_enterprise_employee_v1_preaudit_019(jsonb)',...(installed?['faolla_attendance_valid_zone_v1(text)']:[])].map((x,i)=>[x,{oid:i+10,owner:'supabase_admin',kind:'f',sourceSha256:i===2||(i===0&&installed<2)||(i===1&&installed<104)?attendanceProductionLegacy052SourceSha256[x]:x.includes('valid_zone')&&installed===149?'03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6':'f'.repeat(64),metadata:{oid:i+10,proowner:10,prolang:14,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,proretset:false,pronargdefaults:0,proargdefaults:null,proargnames:['p_input'],proargmodes:null,proallargtypes:null,proargtypes:'3802',proconfig:i===1&&installed>=104?['search_path=pg_catalog']:['search_path=public'],proacl:['supabase_admin=X/supabase_admin'],procost:100,prorows:0,prosecdef:true,prokind:'f',prorettype:3802,prosupport:'-',prosqlbody:null}}]))};}
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'faolla-attendance-production-test-'));
 const paths={directory,compatibility:path.join(directory,'compat.json'),progress:path.join(directory,'progress.json'),ready:path.join(directory,'ready.json')};
 await writeFile(paths.compatibility,JSON.stringify(compatibility()));const backup=path.join(directory,'synthetic.enc');await writeFile(backup,'SYNTHETIC NOT A BACKUP');
 const source={strategy:'docker_exec_postgres',databaseImage:'supabase/postgres:15.8.1.085',storageImage:'supabase/storage-api:v1.37.8',storageBackend:'file',repository:'fafona/space',sha:target,originMainSha:target,detached:true,treeState:'clean',stability:{source:'matched_before_after',database:'matched_before_after'},
 database:{...attendanceProductionIdentity,imageId:'sha256:'+'c'.repeat(64),containerStartedAt:'2026-10-09T10:00:00Z',postmasterStartedAt:'2026-10-09T10:00:01Z',primary:true,
 baseline:{...Object.fromEntries(PRODUCTION_RELEASE_AGGREGATE_KEYS.map(x=>[x,'0'])),ordinaryIdentityContentSha256:'1'.repeat(64)},recoveryContent:recoveryContentFixture({receipts:true})}};
 const create={schemaVersion:2,status:'created',createdAt:new Date().toISOString(),format:'self-hosted-supabase-dr-v2',outputFile:path.basename(backup),outputBytes:Buffer.byteLength('SYNTHETIC NOT A BACKUP'),outputSha256:sha('SYNTHETIC NOT A BACKUP'),dumpFiles:[{name:'database.sql.gz',bytes:20,sha256:'5'.repeat(64)}],source};
 const verify={schemaVersion:2,status:'verified',manifestSchemaVersion:2,format:create.format,inputFile:create.outputFile,inputBytes:create.outputBytes,inputSha256:create.outputSha256,backupCreatedAt:create.createdAt,dumpFiles:create.dumpFiles,source};
 const createReport=path.join(directory,'create.json'),verifyReport=path.join(directory,'verify.json');await writeFile(createReport,JSON.stringify(create));await writeFile(verifyReport,JSON.stringify(verify));
 return {directory,paths,backup,createReport,verifyReport,rootOwned:false,lockPath:path.join(directory,'lock')};
}
function mock(initial=0,{failAt=null,commitBeforeFailure=false}={}){
 let installed=initial;const writes=[];let failed=false;
 return {writes,get installed(){return installed;},run:async(command,args,options)=>{
  assert.equal(command,'docker');assert.equal(args.at(-1)===attendanceProductionIdentity.containerId||args.includes(attendanceProductionIdentity.containerId),true);
  assert(!args.join(' ').includes('.Config.Env'));
  if(args[0]==='inspect')return {status:0,stdout:JSON.stringify({id:attendanceProductionIdentity.containerId,name:'/supabase-db',running:true,mounts:[{Type:'bind',Source:attendanceProductionIdentity.dataSource,RW:true}]})};
  if(options.input.startsWith('begin read only;'))return {status:0,stdout:JSON.stringify(state(installed))};
  const source=scope.sources[installed];assert(source);assert.equal(options.input,protectedAttendanceMigrationSql(source,installed,scope.manifest));
  writes.push(source.version);
  if(failAt===installed&&!failed){failed=true;if(commitBeforeFailure)installed++;return {status:1,stdout:'',stderr:'synthetic transport failure'};}
  installed++;return {status:0,stdout:''};
 }};
}

test('full manifest-byte SHA pins exact 149 sources, unused165, 210 last; no060/bootstrap',async()=>{
 assert.equal(scope.sources.length,149);assert.equal(scope.manifest.baseline.length,60);assert.equal(scope.sources.at(-1).version,'202610090210');
 assert(!scope.sources.some(x=>Number(x.version.slice(-4))<=60||x.version.endsWith('0165')));
 assert.equal(scope.sources.reduce((n,x)=>n+x.bytes,0),7676165);
 assert.equal(sha(await readFile(new URL('./attendance-production-database-migrations.manifest.json',import.meta.url))),attendanceProductionScopeSha256);
});
test('exact registry permits only known052 + ordered attendance prefix, rejects060/hole/name',()=>{
 assert.equal(validateAttendanceRegistry(state(149).registry,scope.manifest,{complete:true}),149);
 for(const rows of [[...state().registry,{version:'202609280060',name:'customer_membership_profile_projection'}],state(2).registry.toSpliced(60,1),state().registry.map((x,i)=>i?x:{...x,name:'wrong'})])assert.throws(()=>validateAttendanceRegistry(rows,scope.manifest));
});
test('formal identity, ownership, primary, superuser and zero attendance preflight are exact',()=>{
 assert.equal(validateAttendanceProductionState(state(),scope.manifest,{fresh:true}),0);
 for(const mutation of [{containerName:'unused'},{databaseOid:'8'},{systemIdentifier:'1'},{currentUser:'postgres'},{primary:false},{postgresSuperuser:true},{attendanceRelations:1}]){
  if('containerName'in mutation)continue;assert.throws(()=>validateAttendanceProductionState({...state(),...mutation},scope.manifest,{fresh:true}));
 }
 assert.throws(()=>validateAttendanceProductionState({...state(),owners:{merchants:'postgres'}},scope.manifest));
 assert.throws(()=>validateAttendanceProductionState({...state(),functions:{...state().functions,'faolla_valid_merchant_enterprise_permissions_v1(text[])':{...state().functions['faolla_valid_merchant_enterprise_permissions_v1(text[])'],sourceSha256:'f'.repeat(64)}}},scope.manifest),/052_function_drift/);
});
test('live probe is explicitly read-only, bounded, no secret/row projection',()=>{
 const sql=attendanceReadOnlyStateSql();assert(sql.startsWith('begin read only;'));assert(sql.includes("statement_timeout='8s'"));
 assert(!/config\.env|password|select \*/i.test(sql));assert(sql.includes('pg_control_system'));assert(sql.endsWith('commit;\n'));
});
test('all original149 SQL bytes preserved after removing only new guards; one short transaction each',()=>{
 for(let i=0;i<149;i++){
  const source=scope.sources[i].source,wrapped=protectedAttendanceMigrationSql(scope.sources[i],i,scope.manifest);
  assert(wrapped.includes('set transaction isolation level repeatable read'));
  assert(wrapped.includes('pg_try_advisory_xact_lock(20260731,1)'));
  assert(wrapped.includes('attendance_production_legacy_rows_changed'));
  assert(!wrapped.includes('reassign owned'));assert(!wrapped.includes('alter default privileges')||source.includes('alter default privileges'));
  assert(wrapped.includes('merchant_enterprise_roles'));assert(wrapped.includes('merchant_enterprise_employees'));
  assert.equal((wrapped.match(/\$attendance_production_prestate\$/g)||[]).length,2);
 }
 assert.throws(()=>protectedAttendanceMigrationSql(scope.sources[1],0,scope.manifest));
});
test('052 compatibility proof rejects final-only installs, real data, production DB and incomplete checks',()=>{
 const args={target,baseline,scopeSha256:attendanceProductionScopeSha256};assert.equal(validateAttendanceCompatibilityProof(compatibility(),args).finalRegistryCount,209);
 for(const changed of [{baselineRegistryCount:210},{initialAttendanceRelations:1},{finalRegistryCount:210},{productionDataCopied:true},{sourcePilotContainerId:attendanceProductionIdentity.containerId},{checks:{}}])assert.throws(()=>validateAttendanceCompatibilityProof({...compatibility(),...changed},args));
});
test('metadata clone plan never executes, recreates globals, copies data or uses production',()=>{
 const plan=attendance052CompatibilityPlan({target,sourcePilotContainerId:'c'.repeat(64)});assert.equal(plan.automaticExecution,false);assert.equal(plan.rolesInit,false);
 assert.equal(plan.metadataClone.schemaOnly,true);assert.equal(plan.metadataClone.excludePublicDependencyTriggers,false);assert.equal(plan.realHttpAuthAccepted,false);
 assert.throws(()=>attendance052CompatibilityPlan({target,sourcePilotContainerId:attendanceProductionIdentity.containerId}));
});
test('metadata filter removes only Auth triggers referencing project public functions',()=>{
 const ordinary='CREATE TABLE auth.users (id uuid);\nCREATE TRIGGER auth_native BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.native_guard();\n';
 const project='CREATE TRIGGER project AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_merchant();\n';
 const result=filterAttendanceCompatibilityMetadataSql(ordinary+project);assert.equal(result.removedProjectTriggers,1);assert.equal(result.sql,ordinary.slice(0,-1)+'\n');
 assert(result.sql.includes('auth.native_guard'));assert.equal(result.sourceSha256,sha(ordinary+project));
 const writeFunction='CREATE FUNCTION storage.can_insert_object() RETURNS void LANGUAGE plpgsql AS $$ begin INSERT INTO storage.objects VALUES (1); end; $$;\n';assert.equal(filterAttendanceCompatibilityMetadataSql(writeFunction).sql,writeFunction);
 for(const unsafe of ['CREATE ROLE a;','ALTER USER a SUPERUSER;','COPY auth.users FROM stdin;','INSERT INTO auth.users VALUES (1);','\\connect postgres','CREATE TABLE public.real (id int);'])assert.throws(()=>filterAttendanceCompatibilityMetadataSql(unsafe));
});
test('CLI denies unknown flags/apply-without-backup/dry-run mutation options/duplicate proof paths',()=>{
 assert.deepEqual(parseAttendanceProductionArguments(['scope']),{command:'scope'});
 for(const args of [['apply'],['verify','--proof-file','x'],['dry-run','--confirm','yes'],['scope','--target','a','--target','b'],['apply','--through','202610090210']])assert.throws(()=>parseAttendanceProductionArguments(args));
});
test('backup must be same fresh encrypted archive and DB; verification never claims restore',async()=>{
 const f=await fixture();try{
  const result=await validateAttendanceBackupEvidence(f);assert.equal(result.restoreRehearsed,false);
  const verify=JSON.parse(await readFile(f.verifyReport,'utf8'));
  for(const changed of [{inputSha256:'6'.repeat(64)},{backupCreatedAt:'2026-01-01T00:00:00Z'},{dumpFiles:[]},{format:'self-hosted-supabase-dr-v1'}]){await writeFile(f.verifyReport,JSON.stringify({...verify,...changed}));await assert.rejects(()=>validateAttendanceBackupEvidence(f));}
  await writeFile(f.verifyReport,JSON.stringify(verify));
  await writeFile(f.backup,'CHANGED');await assert.rejects(()=>validateAttendanceBackupEvidence(f));
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('dry-run checks actual052 and returns plan; executes no migration or evidence writes',async()=>{
 const f=await fixture(),db=mock();try{
  const report=await runAttendanceProductionMigrations({...f,target,baseline,runCommand:db.run});assert.equal(report.pending,149);assert.deepEqual(db.writes,[]);
  await assert.rejects(()=>readFile(f.paths.progress));
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('apply refuses missing explicit approval/compat proof before first mutation',async()=>{
 const f=await fixture(),db=mock();try{
  await assert.rejects(()=>runAttendanceProductionMigrations({...f,target,baseline,apply:true,runCommand:db.run}),/explicit_apply/);assert.deepEqual(db.writes,[]);
  await writeFile(f.paths.compatibility,JSON.stringify({...compatibility(),checks:{}}));
  await assert.rejects(()=>runAttendanceProductionMigrations({...f,target,baseline,apply:true,confirm:'approved-attendance-061-210',runCommand:db.run}),/compatibility_check/);assert.deepEqual(db.writes,[]);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('mock apply performs149 exact originals with guards and live verification yields209 proof',async()=>{
 const f=await fixture(),db=mock();try{
  const ready=await runAttendanceProductionMigrations({...f,target,baseline,apply:true,confirm:'approved-attendance-061-210',runCommand:db.run});
  assert.equal(ready.registryCount,209);assert.equal(db.writes.length,149);assert.equal(db.writes.at(-1),'202610090210');
  const verified=await verifyAttendanceProductionDatabaseReady({...f,target,baseline,runCommand:db.run});assert.equal(verified.proofSha256,ready.proofSha256);
  assert.equal(assertAttendanceDatabaseReadyProof(verified,{target,baseline,scopeSha256:attendanceProductionScopeSha256,proofSha256:ready.proofSha256}),verified);
  const altered={...JSON.parse(await readFile(f.paths.ready,'utf8')),functions:{}};await writeFile(f.paths.ready,JSON.stringify(altered));
  await assert.rejects(()=>verifyAttendanceProductionDatabaseReady({...f,target,baseline,runCommand:db.run}),/functions_changed/);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('failed migration stops immediately; explicit SHA-bound resume never replays committed original',async()=>{
 const f=await fixture(),db=mock(0,{failAt:2,commitBeforeFailure:true});try{
  const args={...f,target,baseline,apply:true,confirm:'approved-attendance-061-210',runCommand:db.run};
  await assert.rejects(()=>runAttendanceProductionMigrations(args),/inspect_registry/);assert.equal(db.installed,3);assert.equal(db.writes.length,3);
  const resumeSha256=sha(await readFile(f.paths.progress));await assert.rejects(()=>runAttendanceProductionMigrations({...args,resume:true,resumeSha256:'0'.repeat(64)}),/resume_proof_changed/);
  await runAttendanceProductionMigrations({...args,resume:true,resumeSha256});assert.equal(db.writes.length,149);
  assert.equal(db.writes.filter(x=>x==='202609290063').length,1);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('fixed repaired compatibility audit is optional for old evidence but a present pair must be complete',()=>{
 const proof={...compatibility(),target:repairTarget,databaseName:`faolla_attendance_compat_${repairTarget.slice(0,12)}`};
 const args={target:repairTarget,baseline,scopeSha256:attendanceProductionScopeSha256};
 assert.equal(validateAttendanceCompatibilityProof(proof,args),proof);
 const audited={...proof,toolRevision,stagedToolRepairReceiptSha256:receiptSha256};
 // This is a pure shape check, not acceptance of a real runtime repair receipt.
 assert.equal(validateAttendanceCompatibilityProof(audited,args),audited);
 for(const pair of [
  {toolRevision},{stagedToolRepairReceiptSha256:receiptSha256},
  {toolRevision:repairTarget,stagedToolRepairReceiptSha256:receiptSha256},
  {toolRevision:'B'.repeat(40),stagedToolRepairReceiptSha256:receiptSha256},
  {toolRevision,stagedToolRepairReceiptSha256:'c'.repeat(63)},
  {toolRevision,stagedToolRepairReceiptSha256:null},
 ])assert.throws(()=>validateAttendanceCompatibilityProof({...proof,...pair},args),/tool_repair_audit_invalid/);
});

test('general backup contract is byte-identical and still rejects a mismatched source for the fixed target',async()=>{
 const original=managerSection('export async function validateAttendanceBackupEvidence(input){','\nconst hasToolRepairAudit').trimEnd();
 assert.equal(sha(original),'402e0e717ab5fc2b9ed874249374ed14298924368e321e2f4fe370591cc8921a');
 const f=await fixture();try{
  await assert.rejects(()=>validateAttendanceBackupEvidence({...f,target:repairTarget,testOnly:true,toolRevision,
   verifyAttendanceStagedToolRepairReceipt:()=>({toolRevision,receiptSha256})}),/backup_source_not_target/);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

// Extract the actual small routing/binding functions into a synthetic VM.
// The verifier stub here proves branch ordering only; production has no
// injectable verifier and these tests do not establish real receipt acceptance.
function repairRouting({sourceSha=toolRevision,secondSourceSha=sourceSha,deny=false}={}){
 const calls=[];
 const helpers=managerSection('const hasToolRepairAudit','async function verifiedMigrationToolRepair');
 const wrapper=managerSection('async function migrationBackupEvidence','export function attendance052CompatibilityPlan');
 const route=runInNewContext(`${helpers}\n${wrapper}\nmigrationBackupEvidence`,{
  STAGED_TOOL_REPAIR_TARGET:repairTarget,SHA:/^[0-9a-f]{40}$/,HEX:/^[0-9a-f]{64}$/,
  require_:(condition,code)=>{if(!condition)throw new Error(code);},
  ownedJson:async()=>({value:{source:{sha:sourceSha}}}),
  validateDatabaseBackupSourceIdentity:source=>({valid:true,source}),
  verifiedMigrationToolRepair:async input=>{calls.push(['verify',input.target]);if(deny)throw new Error('synthetic_receipt_refused');return {receipt:{target:repairTarget},toolRevision,receiptSha256};},
  validateAttendanceBackupEvidence:async input=>{calls.push(['backup',input.target]);if(secondSourceSha!==input.target)throw new Error('attendance_backup_source_not_target');return {source:{sha:secondSourceSha},restoreRehearsed:false};},
 });
 return {calls,route};
}
const auditPair=()=>({toolRevision,stagedToolRepairReceiptSha256:receiptSha256});
const plain=value=>JSON.parse(JSON.stringify(value));

test('routing contract never calls the repair verifier for ordinary or unchanged fixed sources',async()=>{
 const ordinary=repairRouting({sourceSha:target});
 assert.deepEqual(plain((await ordinary.route({target},{})).audit),{});
 assert.deepEqual(ordinary.calls,[['backup',target]]);
 const mismatch=repairRouting();await assert.rejects(()=>mismatch.route({target},{}),/backup_source_not_target/);
 assert.deepEqual(mismatch.calls,[['backup',target]]);
 const unchanged=repairRouting({sourceSha:repairTarget});
 assert.deepEqual(plain((await unchanged.route({target:repairTarget},{})).audit),{});
 assert.deepEqual(unchanged.calls,[['backup',repairTarget]]);
});

test('fixed repaired routing binds the real-verifier result before selecting one exact backup source',async()=>{
 const model=repairRouting();const result=await model.route({target:repairTarget},auditPair());
 assert.deepEqual(model.calls,[['verify',repairTarget],['backup',toolRevision]]);
 assert.deepEqual(plain(result.audit),auditPair());assert.equal(result.backup.source.sha,toolRevision);
 const refused=repairRouting({deny:true});
 await assert.rejects(()=>refused.route({target:repairTarget},auditPair()),/synthetic_receipt_refused/);
 assert.deepEqual(refused.calls,[['verify',repairTarget]]);
 const foreign=repairRouting({sourceSha:'d'.repeat(40)});
 await assert.rejects(()=>foreign.route({target:repairTarget},auditPair()),/backup_tool_repair_source_mismatch/);
 assert.deepEqual(foreign.calls,[['verify',repairTarget]]);
 const swapped=repairRouting({secondSourceSha:repairTarget});
 await assert.rejects(()=>swapped.route({target:repairTarget},auditPair()),/backup_source_not_target/);
});

test('fixed repaired routing refuses absent or changed compatibility audit and cannot attach an audit to an unrepaired source',async()=>{
 for(const proof of [{},{toolRevision},{...auditPair(),toolRevision:'d'.repeat(40)},
  {...auditPair(),stagedToolRepairReceiptSha256:'d'.repeat(64)}]){
  const model=repairRouting();await assert.rejects(()=>model.route({target:repairTarget},proof),/compatibility_tool_repair_source_mismatch/);
 }
 const unchanged=repairRouting({sourceSha:repairTarget});
 await assert.rejects(()=>unchanged.route({target:repairTarget},auditPair()),/compatibility_tool_repair_source_mismatch/);
 assert.deepEqual(unchanged.calls,[['backup',repairTarget]]);
});

test('one exact audit binder rejects missing, cross-revision and cross-receipt progress or ready evidence',()=>{
 const helpers=managerSection('const hasToolRepairAudit','async function verifiedMigrationToolRepair');
 const bind=runInNewContext(`${helpers}\nbindToolRepairAudit`,{
  STAGED_TOOL_REPAIR_TARGET:repairTarget,SHA:/^[0-9a-f]{40}$/,HEX:/^[0-9a-f]{64}$/,
  require_:(condition,code)=>{if(!condition)throw new Error(code);},
 });
 const repair={toolRevision,receiptSha256};assert.doesNotThrow(()=>bind(auditPair(),repair,'synthetic_audit_refused'));
 for(const changed of [{},{toolRevision},{...auditPair(),toolRevision:'d'.repeat(40)},
  {...auditPair(),stagedToolRepairReceiptSha256:'d'.repeat(64)}])
  assert.throws(()=>bind(changed,repair,'synthetic_audit_refused'),/synthetic_audit_refused/);
 assert.throws(()=>bind(auditPair(),null,'synthetic_audit_refused'),/synthetic_audit_refused/);
});

test('runtime repair cannot be injected; resumed writes and ready acceptance stay behind the same fixed receipt binding',()=>{
 const verifier=managerSection('async function verifiedMigrationToolRepair','async function migrationBackupEvidence');
 assert(verifier.includes("await import('./attendance-staged-tool-repair.mjs')"));
 assert(verifier.includes("rootDir:input.rootDir??ROOT,phase:'migration'"));
 assert(verifier.includes('input.target===STAGED_TOOL_REPAIR_TARGET'));
 assert(!/input\.(?:testOnly|verifyAttendanceStagedToolRepairReceipt|toolRevision|receiptSha256)/.test(verifier));
 const run=managerSection('export async function runAttendanceProductionMigrations','export async function verifyAttendanceProductionDatabaseReady');
 const binding=run.indexOf("bindToolRepairAudit(progress,repair,'attendance_resume_tool_repair_source_mismatch')");
 assert(binding>0&&binding<run.indexOf('if(count===progress.installed+1)'));
 assert(run.includes('scopeSha256:scope.scopeSha256,...audit,dbIdentity:attendanceProductionIdentity'));
 const ready=managerSection('export async function verifyAttendanceProductionDatabaseReady','export function parseAttendanceProductionArguments');
 assert(ready.includes('input.target===STAGED_TOOL_REPAIR_TARGET&&hasToolRepairAudit(proof)'));
 assert(ready.includes('await verifiedMigrationToolRepair(input)'));
 assert(ready.includes("bindToolRepairAudit(proof,repair,'attendance_ready_tool_repair_source_mismatch')"));
 assert(ready.indexOf('bindToolRepairAudit(proof')<ready.indexOf('actual=await state('));
 assert(ready.includes('same(actual.registry,proof.registry'));
 assert(ready.includes('same(actual.functions,proof.functions'));
});
