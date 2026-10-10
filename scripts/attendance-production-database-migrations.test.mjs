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
import {attendanceExtensionMetadataSupplement} from './attendance-extension-metadata.mjs';
import {syntheticAttendanceExtensionMetadata,syntheticAttendanceGraphqlInitialAclMetadata,syntheticAttendanceGraphqlInitialSchemaAclMetadata,syntheticAttendanceExtensionDump} from './test-helpers/attendance-extension-metadata.mjs';
import {
 attendanceProductionIdentity,attendanceProductionScopeSha256,attendanceProductionLegacy052SourceSha256,loadAttendanceProductionScope,validateAttendanceRegistry,
 attendanceReadOnlyStateSql,validateAttendanceProductionState,protectedAttendanceMigrationSql,
 validateAttendanceCompatibilityProof,validateAttendanceBackupEvidence,validateAttendanceExtensionCompatibilityEvidence,attendance052CompatibilityPlan,filterAttendanceCompatibilityMetadataSql,
 runAttendanceProductionMigrations,verifyAttendanceProductionDatabaseReady,parseAttendanceProductionArguments,
} from './attendance-production-database-migrations.mjs';
const target='a'.repeat(40),baseline=ATTENDANCE_RELEASE_SCOPE.baseline,sha=x=>createHash('sha256').update(x).digest('hex');
const repairTarget='a535a308e21f121e7cf410a6f7d84c974eb370a6',toolRevision='b'.repeat(40),receiptSha256='c'.repeat(64);
const followOnKind='attendance-staged-tool-repair-follow-on',sequenceFollowOnKind='attendance-staged-tool-repair-sequence-follow-on',aclFollowOnKind='attendance-staged-tool-repair-acl-follow-on',schemaFollowOnKind='attendance-staged-tool-repair-schema-follow-on';
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
function repairRouting({verifiedToolRevision=toolRevision,verifiedReceiptSha256=receiptSha256,sourceSha=verifiedToolRevision,secondSourceSha=sourceSha,deny=false,receiptKind,denyExtensions=false}={}){
 const calls=[];
 const helpers=managerSection('const hasToolRepairAudit','async function verifiedMigrationToolRepair');
 const wrapper=managerSection('async function migrationBackupEvidence','export function attendance052CompatibilityPlan');
 const route=runInNewContext(`${helpers}\n${wrapper}\nmigrationBackupEvidence`,{
  STAGED_TOOL_REPAIR_TARGET:repairTarget,SHA:/^[0-9a-f]{40}$/,HEX:/^[0-9a-f]{64}$/,
  require_:(condition,code)=>{if(!condition)throw new Error(code);},
  ownedJson:async()=>({value:{source:{sha:sourceSha}}}),
  validateDatabaseBackupSourceIdentity:source=>({valid:true,source}),
  verifiedMigrationToolRepair:async input=>{calls.push(['verify',input.target]);if(deny)throw new Error('synthetic_receipt_refused');return {receipt:{target:repairTarget},toolRevision:verifiedToolRevision,receiptSha256:verifiedReceiptSha256,...(receiptKind===undefined?{}:{receiptKind})};},
  verifyFollowOnExtensionCompatibility:async(_input,_proof,repair)=>{if(![followOnKind,sequenceFollowOnKind,aclFollowOnKind,schemaFollowOnKind].includes(repair?.receiptKind))return null;calls.push(['extensions']);if(denyExtensions)throw new Error('synthetic_extension_evidence_refused');},
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

test('only the four real follow-on kinds require extension evidence; unknown kinds never select a backup',async()=>{
 const helpers=managerSection('const hasToolRepairAudit','async function verifiedMigrationToolRepair');
 const classify=runInNewContext(`${helpers}\nrequiresFollowOnExtensionEvidence`,{
  require_:(condition,code)=>{if(!condition)throw new Error(code);},
 });
 assert.equal(classify(null),false);assert.equal(classify({}),false);
 for(const receiptKind of [followOnKind,sequenceFollowOnKind,aclFollowOnKind,schemaFollowOnKind])assert.equal(classify({receiptKind}),true);
 for(const receiptKind of [undefined,null,'','attendance-staged-tool-repair','attendance-staged-tool-repair-sequence-follow-on-extra','attendance-staged-tool-repair-acl-follow-on-extra','attendance-staged-tool-repair-schema-follow-on-extra',false,1])
  assert.throws(()=>classify({receiptKind}),/attendance_tool_repair_receipt_kind_invalid/);
 for(const receiptKind of [null,'','attendance-staged-tool-repair','unknown-follow-on']){
  const model=repairRouting({receiptKind});
  await assert.rejects(()=>model.route({target:repairTarget},auditPair()),/attendance_tool_repair_receipt_kind_invalid/);
  assert.deepEqual(model.calls,[['verify',repairTarget]]);
 }
});

test('sequence follow-on uses only its new verified revision and receipt, never either old audit',async()=>{
 const verifiedToolRevision='d'.repeat(40),verifiedReceiptSha256='e'.repeat(64);
 const audit={toolRevision:verifiedToolRevision,stagedToolRepairReceiptSha256:verifiedReceiptSha256};
 const model=repairRouting({verifiedToolRevision,verifiedReceiptSha256,receiptKind:sequenceFollowOnKind});
 const result=await model.route({target:repairTarget},audit);
 assert.deepEqual(model.calls,[['verify',repairTarget],['backup',verifiedToolRevision],['extensions']]);
 assert.deepEqual(plain(result.audit),audit);assert.equal(result.repair.receiptKind,sequenceFollowOnKind);
 for(const stale of [auditPair(),{...audit,toolRevision},{...audit,stagedToolRepairReceiptSha256:receiptSha256}]){
  const changed=repairRouting({verifiedToolRevision,verifiedReceiptSha256,receiptKind:sequenceFollowOnKind});
  await assert.rejects(()=>changed.route({target:repairTarget},stale),/compatibility_tool_repair_source_mismatch/);
  assert(!changed.calls.some(([kind])=>kind==='extensions'));
 }
 const foreign=repairRouting({verifiedToolRevision,verifiedReceiptSha256,sourceSha:toolRevision,receiptKind:sequenceFollowOnKind});
 await assert.rejects(()=>foreign.route({target:repairTarget},audit),/backup_tool_repair_source_mismatch/);
 assert.deepEqual(foreign.calls,[['verify',repairTarget]]);
});

test('ACL follow-on binds its new verified revision and receipt, not either previous follow-on pair',async()=>{
 const verifiedToolRevision='f'.repeat(40),verifiedReceiptSha256='a'.repeat(64);
 const audit={toolRevision:verifiedToolRevision,stagedToolRepairReceiptSha256:verifiedReceiptSha256};
 const model=repairRouting({verifiedToolRevision,verifiedReceiptSha256,receiptKind:aclFollowOnKind});
 const result=await model.route({target:repairTarget},audit);
 assert.deepEqual(model.calls,[['verify',repairTarget],['backup',verifiedToolRevision],['extensions']]);
 assert.deepEqual(plain(result.audit),audit);assert.equal(result.repair.receiptKind,aclFollowOnKind);
 for(const stale of [auditPair(),{toolRevision:'d'.repeat(40),stagedToolRepairReceiptSha256:'e'.repeat(64)},
  {...audit,toolRevision},{...audit,stagedToolRepairReceiptSha256:receiptSha256}]){
  const changed=repairRouting({verifiedToolRevision,verifiedReceiptSha256,receiptKind:aclFollowOnKind});
  await assert.rejects(()=>changed.route({target:repairTarget},stale),/compatibility_tool_repair_source_mismatch/);
  assert(!changed.calls.some(([kind])=>kind==='extensions'));
 }
 for(const sourceSha of [toolRevision,'d'.repeat(40)]){
  const foreign=repairRouting({verifiedToolRevision,verifiedReceiptSha256,sourceSha,receiptKind:aclFollowOnKind});
  await assert.rejects(()=>foreign.route({target:repairTarget},audit),/backup_tool_repair_source_mismatch/);
  assert.deepEqual(foreign.calls,[['verify',repairTarget]]);
 }
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

function extensionEvidenceFixture(sequence,{restoreGraphqlInitialAcl=false,restoreGraphqlInitialSchemaAcl=false}={}){
 const metadata=Buffer.from(syntheticAttendanceExtensionDump),snapshot=restoreGraphqlInitialAcl?syntheticAttendanceGraphqlInitialAclMetadata():syntheticAttendanceExtensionMetadata();
 if(sequence)snapshot.find(e=>e.name==='pg_net').members.find(m=>m.catalog==='pg_class').metadata.sequence=sequence;
 const schemaSnapshot=restoreGraphqlInitialSchemaAcl?syntheticAttendanceGraphqlInitialSchemaAclMetadata():undefined;
 const reconstructed=attendanceExtensionMetadataSupplement(metadata.toString('utf8'),snapshot,{restoreGraphqlInitialAcl,restoreGraphqlInitialSchemaAcl},schemaSnapshot);
 const schemaAudit=restoreGraphqlInitialSchemaAcl?{schemaSnapshot,schemaSnapshotSha256:reconstructed.schemaSnapshotSha256}:{};
 const extensionMetadata=Buffer.from(JSON.stringify({schemaVersion:1,kind:'attendance-actual-formal-extension-metadata',identity:attendanceProductionIdentity,originalMetadataSourceSha256:sha(metadata),snapshotSha256:reconstructed.snapshotSha256,snapshot,operations:reconstructed.operations,...schemaAudit})+'\n');
 const proof={...compatibility(),target:repairTarget,databaseName:`faolla_attendance_compat_${repairTarget.slice(0,12)}`};
 proof.productionMetadataSource={...proof.productionMetadataSource,metadataSourceSha256:sha(metadata),extensionMetadata:{sourceSha256:sha(extensionMetadata),snapshotSha256:reconstructed.snapshotSha256,supplementSha256:reconstructed.supplementSha256,restorationSha256:sha(reconstructed.sql),originalMetadataSourceSha256:sha(metadata),extensionCount:8,memberCount:96,routineCount:80,...(restoreGraphqlInitialSchemaAcl?{schemaSnapshotSha256:reconstructed.schemaSnapshotSha256}:{})}};
 return {proof,files:{metadata,extensionMetadata,supplement:Buffer.from(reconstructed.supplementSql)}};
}
test('follow-on extension gate reconstructs original dump plus actual bounded supplement, not a hash-only assertion',async()=>{
 const {proof,files}=extensionEvidenceFixture();assert.equal(await validateAttendanceExtensionCompatibilityEvidence(proof,files),proof.productionMetadataSource.extensionMetadata);
 const base=proof.productionMetadataSource.extensionMetadata;
 for(const changed of [null,{...base,extra:true},{...base,extensionCount:9},{...base,memberCount:95},{...base,routineCount:79},{...base,snapshotSha256:'f'.repeat(64)},{...base,restorationSha256:'f'.repeat(64)},{...base,originalMetadataSourceSha256:'f'.repeat(64)}]){
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence({...proof,productionMetadataSource:{...proof.productionMetadataSource,extensionMetadata:changed}},files),/attendance_extension_/);
 }
 for(const key of Object.keys(files))await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(proof,{...files,[key]:Buffer.concat([files[key],Buffer.from('\nchanged')])}),/artifact_changed/);
 const artifact=JSON.parse(files.extensionMetadata.toString('utf8'));artifact.operations=[];
 const changedBytes=Buffer.from(JSON.stringify(artifact));
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence({...proof,productionMetadataSource:{...proof.productionMetadataSource,extensionMetadata:{...base,sourceSha256:sha(changedBytes)}}},{...files,extensionMetadata:changedBytes}),/operations/);
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence({...proof,target},files),/evidence_target/);
});

test('extension reconstruction accepts only its exact optional boolean; no inherited or unknown ACL opt-in',async()=>{
 const {proof,files}=extensionEvidenceFixture(),expected=proof.productionMetadataSource.extensionMetadata;
 for(const options of [{},{restoreGraphqlInitialAcl:false},Object.create({restoreGraphqlInitialAcl:true})])
  assert.equal(await validateAttendanceExtensionCompatibilityEvidence(proof,files,options),expected);
 for(const options of [null,false,true,[],{restoreGraphqlInitialAcl:undefined},{restoreGraphqlInitialAcl:null},
  {restoreGraphqlInitialAcl:1},{restoreGraphqlInitialAcl:'true'},{restoreGraphqlInitialAcl:false,extra:true},
  {[Symbol('restoreGraphqlInitialAcl')]:true}])
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(proof,files,options),/^Error: attendance_extension_evidence_options$/);
});

test('ACL artifact reconstruction requires explicit opt-in and preserves the exact original dump and seven ACL operations',async()=>{
 const {proof,files}=extensionEvidenceFixture(undefined,{restoreGraphqlInitialAcl:true});
 assert.equal(await validateAttendanceExtensionCompatibilityEvidence(proof,files,{restoreGraphqlInitialAcl:true}),proof.productionMetadataSource.extensionMetadata);
 assert.equal(files.metadata.toString('utf8'),syntheticAttendanceExtensionDump);
 const artifact=JSON.parse(files.extensionMetadata.toString('utf8'));
 assert.equal(artifact.operations.length,10);
 const aclOperations=artifact.operations.filter(operation=>operation.operation==='restore-actual-initial-acl');
 assert.equal(aclOperations.length,7);
 assert.deepEqual(aclOperations.map(operation=>operation.signature),[
  'graphql.seq_schema_version','graphql._internal_resolve(text,jsonb,text,jsonb)','graphql.comment_directive(text)',
  'graphql.exception(text)','graphql.get_schema_version()','graphql.increment_schema_version()','graphql.resolve(text,jsonb,text,jsonb)']);
 for(const operation of aclOperations){
  assert.equal(operation.extension,'pg_graphql');assert.equal(operation.version,'1.5.11');assert.equal(operation.grantor,'supabase_admin');
  assert.deepEqual(operation.missingGrantees,['anon','authenticated','postgres','service_role']);
 }
 for(const options of [undefined,{restoreGraphqlInitialAcl:false},Object.create({restoreGraphqlInitialAcl:true})])
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence({...proof,restoreGraphqlInitialAcl:true},files,options),/attendance_extension_evidence_reconstruction/);
 const changed=plain(artifact);changed.operations[3].missingGrantees.push('unapproved_role');
 const changedBytes=Buffer.from(JSON.stringify(changed)+'\n');
 const changedProof={...proof,productionMetadataSource:{...proof.productionMetadataSource,extensionMetadata:{...proof.productionMetadataSource.extensionMetadata,sourceSha256:sha(changedBytes)}}};
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(changedProof,{...files,extensionMetadata:changedBytes},{restoreGraphqlInitialAcl:true}),/attendance_extension_evidence_operations/);
});
test('follow-on routing requires extra artifacts after independent receipt and backup checks',async()=>{
 for(const receiptKind of [followOnKind,sequenceFollowOnKind,aclFollowOnKind,schemaFollowOnKind]){
  const model=repairRouting({receiptKind});await model.route({target:repairTarget},auditPair());
  assert.deepEqual(model.calls,[['verify',repairTarget],['backup',toolRevision],['extensions']]);
  const denied=repairRouting({receiptKind,denyExtensions:true});await assert.rejects(()=>denied.route({target:repairTarget},auditPair()),/synthetic_extension_evidence_refused/);
  assert.deepEqual(denied.calls,[['verify',repairTarget],['backup',toolRevision],['extensions']]);
 }
});

test('schema artifact reconstruction binds the independent actual snapshot and cannot reuse the prior ACL opt-in',async()=>{
 const options={restoreGraphqlInitialAcl:true,restoreGraphqlInitialSchemaAcl:true};
 const {proof,files}=extensionEvidenceFixture(undefined,options);
 assert.equal(await validateAttendanceExtensionCompatibilityEvidence(proof,files,options),proof.productionMetadataSource.extensionMetadata);
 const artifact=JSON.parse(files.extensionMetadata.toString('utf8'));
 assert.deepEqual(artifact.schemaSnapshot,syntheticAttendanceGraphqlInitialSchemaAclMetadata());
 assert.equal(artifact.schemaSnapshotSha256,sha(JSON.stringify(artifact.schemaSnapshot)));
 assert.equal(files.metadata.toString('utf8'),syntheticAttendanceExtensionDump);
 for(const oldOptions of [undefined,{}, {restoreGraphqlInitialAcl:true},Object.create(options)])
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(proof,files,oldOptions),/attendance_extension_evidence_shape/);
 for(const bad of [undefined,null,1,'true']){
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(proof,files,{...options,restoreGraphqlInitialSchemaAcl:bad}),/attendance_extension_evidence_options/);
 }
 const updateArtifact=changed=>{
  const bytes=Buffer.from(JSON.stringify(changed)+'\n');
  return {proof:{...proof,productionMetadataSource:{...proof.productionMetadataSource,extensionMetadata:{...proof.productionMetadataSource.extensionMetadata,sourceSha256:sha(bytes)}}},files:{...files,extensionMetadata:bytes}};
 };
 for(const key of ['schemaSnapshot','schemaSnapshotSha256']){
  const changed=plain(artifact);delete changed[key];const modified=updateArtifact(changed);
  await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(modified.proof,modified.files,options),/attendance_extension_evidence_artifact_shape/);
 }
 const changed=plain(artifact);changed.schemaSnapshotSha256='0'.repeat(64);const modified=updateArtifact(changed);
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(modified.proof,modified.files,options),/attendance_extension_evidence_schema_snapshot/);
 const extra=plain(artifact);extra.schemaSnapshot.push(plain(extra.schemaSnapshot[0]));const doubled=updateArtifact(extra);
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(doubled.proof,doubled.files,options),/attendance_(?:extension|graphql)_/);
});

test('schema restore runtime selection remains sealed-receipt derived, not a caller option',()=>{
 const actual=managerSection('async function verifyFollowOnExtensionCompatibility','async function migrationBackupEvidence');
 assert(actual.includes("const restoreGraphqlInitialSchemaAcl=repair.receiptKind==='attendance-staged-tool-repair-schema-follow-on'"));
 assert(actual.includes("restoreGraphqlInitialAcl:repair.receiptKind==='attendance-staged-tool-repair-acl-follow-on'||restoreGraphqlInitialSchemaAcl"));
 assert(!/input\.(?:restoreGraphqlInitialAcl|restoreGraphqlInitialSchemaAcl|schemaSnapshot)/.test(actual));
});

test('self-hashed old numeric sequence artifacts are refused; exact text survives reconstruction without changing dump',async()=>{
 const sequence=['bigint','0','1','9223372036854775807','-9223372036854775808','1',false];
 const {proof,files}=extensionEvidenceFixture(sequence);
 assert.equal(await validateAttendanceExtensionCompatibilityEvidence(proof,files),proof.productionMetadataSource.extensionMetadata);
 const artifact=JSON.parse(files.extensionMetadata.toString('utf8'));
 const expectedSnapshot=JSON.stringify(artifact.snapshot),expectedHex=Buffer.from(expectedSnapshot).toString('hex');
 const reconstructed=attendanceExtensionMetadataSupplement(files.metadata.toString('utf8'),artifact.snapshot);
 assert.equal(reconstructed.sourceSha256,sha(files.metadata));assert.equal(files.metadata.toString('utf8'),syntheticAttendanceExtensionDump);
 assert(files.supplement.toString('utf8').includes(expectedHex));
 const expected=JSON.parse(Buffer.from(expectedHex,'hex').toString('utf8'));
 assert.deepEqual(expected.find(e=>e.name==='pg_net').members.find(m=>m.catalog==='pg_class').metadata.sequence,sequence);
 artifact.snapshot.find(e=>e.name==='pg_net').members.find(m=>m.catalog==='pg_class').metadata.sequence=sequence.map((value,i)=>i>0&&i<6?Number(value):value);
 const oldSnapshot=JSON.stringify(artifact.snapshot),oldHex=Buffer.from(oldSnapshot).toString('hex');
 assert(oldSnapshot.includes('9223372036854776000'));assert(!oldSnapshot.includes('"9223372036854775807"'));
 artifact.snapshotSha256=sha(oldSnapshot);
 const oldSupplement=Buffer.from(files.supplement.toString('utf8').replace(expectedHex,oldHex));
 const oldMetadata=Buffer.from(JSON.stringify(artifact)+'\n'),oldRestoration=reconstructed.sql.replace(expectedHex,oldHex);
 const oldEvidence={...proof.productionMetadataSource.extensionMetadata,sourceSha256:sha(oldMetadata),snapshotSha256:artifact.snapshotSha256,supplementSha256:sha(oldSupplement),restorationSha256:sha(oldRestoration)};
 const oldProof={...proof,productionMetadataSource:{...proof.productionMetadataSource,extensionMetadata:oldEvidence}};
 await assert.rejects(()=>validateAttendanceExtensionCompatibilityEvidence(oldProof,{...files,extensionMetadata:oldMetadata,supplement:oldSupplement}),/^Error: attendance_extension_metadata_unsafe_number$/);
});

function extensionArtifactRouting(fixture){
 const calls=[],directory=`/synthetic/${repairTarget}`,compatibilityFile=`${directory}/attendance-database-compatibility.json`;
 const proofBytes=Buffer.from(JSON.stringify(fixture.proof)+'\n');
 const artifacts=new Map([[compatibilityFile,proofBytes],
  [`${directory}/attendance-compatibility-metadata.sql`,fixture.files.metadata],
  [`${directory}/attendance-compatibility-extension-metadata.json`,fixture.files.extensionMetadata],
  [`${directory}/attendance-compatibility-extension-supplement.sql`,fixture.files.supplement]]);
 const helpers=managerSection('const hasToolRepairAudit','async function verifiedMigrationToolRepair');
 const gate=managerSection('async function verifyFollowOnExtensionCompatibility','async function migrationBackupEvidence');
 const verify=runInNewContext(`${helpers}\n${gate}\nverifyFollowOnExtensionCompatibility`,{
  STAGED_TOOL_REPAIR_TARGET:repairTarget,SHA:/^[0-9a-f]{40}$/,HEX:/^[0-9a-f]{64}$/,
  attendanceProductionScopeSha256,path:path.posix,digest:sha,
  require_:(condition,code)=>{if(!condition)throw new Error(code);},
  same:(actual,expected,code)=>assert.deepEqual(plain(actual),plain(expected),code),
  runtimePaths:target=>{assert.equal(target,repairTarget);return {directory,compatibility:compatibilityFile};},
  ownedRuntime:async observed=>{assert.equal(observed,directory);calls.push(['owned',observed]);},
  privateExtensionEvidenceBytes:async(file,maximum)=>{calls.push(['read',file,maximum]);if(!artifacts.has(file))throw Error('synthetic_artifact_missing');return artifacts.get(file);},
  validateAttendanceCompatibilityProof:(proof,options)=>validateAttendanceCompatibilityProof(plain(proof),plain(options)),validateAttendanceExtensionCompatibilityEvidence,
 });
 return {verify,calls,artifacts,proofSha256:sha(proofBytes),directory,compatibilityFile};
}

test('actual sequence follow-on artifact gate binds new receipt and all four fixed private evidence paths',async()=>{
 const verifiedToolRevision='d'.repeat(40),verifiedReceiptSha256='e'.repeat(64);
 const repair={receiptKind:sequenceFollowOnKind,toolRevision:verifiedToolRevision,receiptSha256:verifiedReceiptSha256};
 const fixture=extensionEvidenceFixture(['bigint','0','1','9223372036854775807','-9223372036854775808','1',false]);
 Object.assign(fixture.proof,{toolRevision:verifiedToolRevision,stagedToolRepairReceiptSha256:verifiedReceiptSha256});
 const input={target:repairTarget,baseline},model=extensionArtifactRouting(fixture);
 assert.equal(await model.verify(input,fixture.proof,repair),model.proofSha256);
 assert.deepEqual(model.calls,[['owned',model.directory],['read',model.compatibilityFile,2000000],
  ['read',`${model.directory}/attendance-compatibility-metadata.sql`,16000000],
  ['read',`${model.directory}/attendance-compatibility-extension-metadata.json`,2000000],
  ['read',`${model.directory}/attendance-compatibility-extension-supplement.sql`,2000000]]);
 for(const file of model.artifacts.keys()){
  const missing=extensionArtifactRouting(fixture);missing.artifacts.delete(file);
  await assert.rejects(()=>missing.verify(input,fixture.proof,repair),/synthetic_artifact_missing/);
 }
 for(const changed of [{...repair,toolRevision},{...repair,receiptSha256}, {...repair,receiptKind:'unknown-follow-on'}]){
  const stale=extensionArtifactRouting(fixture);
  await assert.rejects(()=>stale.verify(input,fixture.proof,changed),/attendance_(?:extension_evidence_tool_repair|tool_repair_receipt_kind_invalid)/);
  assert(!stale.calls.some(row=>row[1]?.endsWith('attendance-compatibility-metadata.sql')));
 }
 const changedProof=extensionArtifactRouting(fixture);
 await assert.rejects(()=>changedProof.verify(input,{...fixture.proof,transcriptSha256:'f'.repeat(64)},repair),/canonical_proof/);
});

test('actual ACL follow-on gate derives opt-in only from its verified kind and requires new audit plus all private artifacts',async()=>{
 const verifiedToolRevision='f'.repeat(40),verifiedReceiptSha256='a'.repeat(64);
 const repair={receiptKind:aclFollowOnKind,toolRevision:verifiedToolRevision,receiptSha256:verifiedReceiptSha256};
 const fixture=extensionEvidenceFixture(undefined,{restoreGraphqlInitialAcl:true});
 Object.assign(fixture.proof,{toolRevision:verifiedToolRevision,stagedToolRepairReceiptSha256:verifiedReceiptSha256});
 const input={target:repairTarget,baseline},model=extensionArtifactRouting(fixture);
 assert.equal(await model.verify(input,fixture.proof,repair),model.proofSha256);
 assert.deepEqual(model.calls,[['owned',model.directory],['read',model.compatibilityFile,2000000],
  ['read',`${model.directory}/attendance-compatibility-metadata.sql`,16000000],
  ['read',`${model.directory}/attendance-compatibility-extension-metadata.json`,2000000],
  ['read',`${model.directory}/attendance-compatibility-extension-supplement.sql`,2000000]]);
 for(const file of model.artifacts.keys()){
  const missing=extensionArtifactRouting(fixture);missing.artifacts.delete(file);
  await assert.rejects(()=>missing.verify(input,fixture.proof,repair),/synthetic_artifact_missing/);
 }
 for(const receiptKind of [followOnKind,sequenceFollowOnKind])
  await assert.rejects(()=>extensionArtifactRouting(fixture).verify(input,fixture.proof,{...repair,receiptKind}),/attendance_extension_evidence_reconstruction/);
 for(const changed of [{...repair,toolRevision},{...repair,receiptSha256},
  {...repair,toolRevision:'d'.repeat(40),receiptSha256:'e'.repeat(64)}, {...repair,receiptKind:'attendance-staged-tool-repair-acl-follow-on-extra'}]){
  const stale=extensionArtifactRouting(fixture);
  await assert.rejects(()=>stale.verify(input,fixture.proof,changed),/attendance_(?:extension_evidence_tool_repair|tool_repair_receipt_kind_invalid)/);
  assert(!stale.calls.some(row=>row[1]?.endsWith('attendance-compatibility-metadata.sql')));
 }
 const changedProof=extensionArtifactRouting(fixture);
 await assert.rejects(()=>changedProof.verify(input,{...fixture.proof,transcriptSha256:'b'.repeat(64)},repair),/canonical_proof/);
});
test('schema follow-on actual manager routing binds its new pair and four artifacts without caller-selected restoration (VM/synthetic evidence)',async()=>{
 const verifiedToolRevision='1'.repeat(40),verifiedReceiptSha256='2'.repeat(64);
 const repair={receiptKind:schemaFollowOnKind,toolRevision:verifiedToolRevision,receiptSha256:verifiedReceiptSha256};
 const fixture=extensionEvidenceFixture(undefined,{restoreGraphqlInitialAcl:true,restoreGraphqlInitialSchemaAcl:true});
 Object.assign(fixture.proof,{toolRevision:verifiedToolRevision,stagedToolRepairReceiptSha256:verifiedReceiptSha256});
 // The actual extracted gate must ignore caller overrides, even when false or
 // carrying a different snapshot; only its already-verified repair kind routes.
 const input={target:repairTarget,baseline,restoreGraphqlInitialAcl:false,restoreGraphqlInitialSchemaAcl:false,schemaSnapshot:[{name:'public'}]};
 const model=extensionArtifactRouting(fixture);
 assert.equal(await model.verify(input,fixture.proof,repair),model.proofSha256);
 assert.deepEqual(model.calls,[['owned',model.directory],['read',model.compatibilityFile,2000000],
  ['read',`${model.directory}/attendance-compatibility-metadata.sql`,16000000],
  ['read',`${model.directory}/attendance-compatibility-extension-metadata.json`,2000000],
  ['read',`${model.directory}/attendance-compatibility-extension-supplement.sql`,2000000]]);
 assert.equal(fixture.proof.productionMetadataSource.extensionMetadata.schemaSnapshotSha256,
  sha(JSON.stringify(JSON.parse(fixture.files.extensionMetadata.toString('utf8')).schemaSnapshot)));
 for(const file of model.artifacts.keys()){
  const missing=extensionArtifactRouting(fixture);missing.artifacts.delete(file);
  await assert.rejects(()=>missing.verify(input,fixture.proof,repair),/synthetic_artifact_missing/);
 }
 for(const file of [...model.artifacts.keys()].filter(file=>file!==model.compatibilityFile)){
  const changed=extensionArtifactRouting(fixture);
  changed.artifacts.set(file,Buffer.concat([changed.artifacts.get(file),Buffer.from('\n')]));
  await assert.rejects(()=>changed.verify(input,fixture.proof,repair),/attendance_extension_evidence_artifact_changed/);
 }
 for(const receiptKind of [followOnKind,sequenceFollowOnKind,aclFollowOnKind]){
  const older=extensionArtifactRouting(fixture);
  await assert.rejects(()=>older.verify({...input,restoreGraphqlInitialSchemaAcl:true},fixture.proof,{...repair,receiptKind}),/attendance_extension_evidence_shape/);
 }
 for(const changed of [{...repair,toolRevision},{...repair,receiptSha256},
  {...repair,receiptKind:'attendance-staged-tool-repair-schema-follow-on-extra'}]){
  const stale=extensionArtifactRouting(fixture);
  await assert.rejects(()=>stale.verify(input,fixture.proof,changed),/attendance_(?:extension_evidence_tool_repair|tool_repair_receipt_kind_invalid)/);
  assert(!stale.calls.some(row=>row[1]?.endsWith('attendance-compatibility-metadata.sql')));
 }
 const changedProof=extensionArtifactRouting(fixture);
 await assert.rejects(()=>changedProof.verify(input,{...fixture.proof,transcriptSha256:'3'.repeat(64)},repair),/canonical_proof/);
 assert.equal(fixture.files.metadata.toString('utf8'),syntheticAttendanceExtensionDump);
});
test('follow-on artifact paths are fixed/private/stable and ready rebinds their canonical proof before actual DB reads',()=>{
 const artifacts=managerSection('async function privateExtensionEvidenceBytes','async function migrationBackupEvidence');
 assert(artifacts.includes('before.uid===0')&&artifacts.includes('(before.mode&0o777)===0o600')&&artifacts.includes('before.nlink===1'));
 assert(artifacts.includes('after.ino')&&artifacts.includes('after.ctimeMs')&&artifacts.includes('bytes.length===before.size'));
 assert(artifacts.includes('const fixed=runtimePaths(input.target)'));
 assert(artifacts.includes("validateAttendanceExtensionCompatibilityEvidence(proof,files,{restoreGraphqlInitialAcl:repair.receiptKind==='attendance-staged-tool-repair-acl-follow-on'||restoreGraphqlInitialSchemaAcl,restoreGraphqlInitialSchemaAcl})"));
 assert(!/restoreGraphqlInitialAcl:(?:proof|compatibility|input|files)\./.test(artifacts));
 assert(!/input\.(?:paths|rootOwned|testOnly|verifyAttendance|toolRevision|receiptSha256)/.test(artifacts));
 const ready=managerSection('export async function verifyAttendanceProductionDatabaseReady','export function parseAttendanceProductionArguments');
 assert(ready.includes('if(requiresFollowOnExtensionEvidence(repair))'));
 assert(ready.indexOf('verifyFollowOnExtensionCompatibility(input,compatibility.value,repair)')<ready.indexOf('actual=await state('));
 assert(ready.includes('compatibility.sha256===proof.compatibilityProofSha256'));
});
