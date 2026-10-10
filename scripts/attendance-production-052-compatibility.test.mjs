import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {attendanceProductionLegacy052SourceSha256,attendanceProductionIdentity,validateAttendanceCompatibilityProof} from './attendance-production-database-migrations.mjs';
import {loadAttendance052CompatibilitySources,validateAttendance052SchemaOnlySql,
 attendanceCompatibilityPublicAclSql,attendanceCompatibilityFixturesSql,attendanceCompatibilityEmployeeSql,
 attendanceCompatibilityFactsSql,attendanceCompatibilityUtcCases,guardedAttendanceCompatibilitySourceSql,
 runAttendance052Compatibility,parseAttendanceCompatibilityArguments} from './attendance-production-052-compatibility.mjs';
import {syntheticAttendanceExtensionMetadata,syntheticAttendanceExtensionDump} from './test-helpers/attendance-extension-metadata.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const target='a'.repeat(40),baseline='b1304d5d58841c2247b93229b90bb7adcfd64965',pilot='c'.repeat(64);
const assets=await loadAttendance052CompatibilitySources({rootOwned:false});
const acl={publicAcl:{owner:'postgres',entries:[{grantor:'postgres',grantee:'postgres',privilege:'USAGE',grantable:false},{grantor:'postgres',grantee:'PUBLIC',privilege:'USAGE',grantable:false}]},defaultAcls:[{owner:'supabase_admin',schema:'public',type:'r',entries:[{grantor:'supabase_admin',grantee:'postgres',privilege:'SELECT',grantable:false}]}]};
const tables=['merchants','merchant_enterprise_roles','merchant_enterprise_employees','pages'].map(name=>({name,columns:['id','created_at']}));
const fnKeys=Object.keys(attendanceProductionLegacy052SourceSha256);
const truncateMetadata=[
 ...Array.from({length:8},(_,i)=>`CREATE TRIGGER protect_${i} BEFORE TRUNCATE ON storage.synthetic_${i} FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();`),
 ...['postgres','anon','authenticated','service_role'].map(role=>`GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.synthetic TO ${role};`)
].join('\n')+'\n';
function formalState(){return {...attendanceProductionIdentity,currentUser:'supabase_admin',adminSuperuser:true,postgresSuperuser:false,primary:true,registry:assets.manifest.baseline,owners:{merchants:'supabase_admin',merchant_enterprise_roles:'supabase_admin',merchant_enterprise_employees:'supabase_admin'},attendanceRelations:0,attendanceFunctions:0,functions:Object.fromEntries(fnKeys.map((f,i)=>[f,{oid:i+50,owner:'supabase_admin',kind:'f',sourceSha256:attendanceProductionLegacy052SourceSha256[f],metadata:{oid:i+50,proowner:10,prolang:14,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,proretset:false,pronargdefaults:0,proargdefaults:null,proargnames:['p_input'],proargmodes:null,proallargtypes:null,proargtypes:'3802',proconfig:['search_path=public'],proacl:['supabase_admin=X/supabase_admin'],procost:100,prorows:0,prosecdef:true,prokind:'f',prorettype:3802,prosupport:'-',prosqlbody:null}}]))};}
function snapshot(installed=0){return {databaseOid:'20000',backendPid:550,owner:'supabase_admin',registry:[...assets.manifest.baseline,...assets.manifest.migrations.slice(0,installed).map(({version,name})=>({version,name}))],attendanceRelations:installed?100:0,attendanceFunctions:installed?600:0,authUsers:0,outsideSha256:'d'.repeat(64),rolesSha256:'e'.repeat(64),tables,functions:Object.fromEntries(fnKeys.map((f,i)=>[f,{metadata:{oid:i+50,proowner:10,prolang:14,proacl:['supabase_admin=X/supabase_admin'],proconfig:i===1&&installed===149?['search_path=pg_catalog']:['search_path=public']},sourceSha256:attendanceProductionLegacy052SourceSha256[f]}]))};}
function fake({failMigration=null,mismatch=false,sourceOverride={},metadataSuffix='',extensionDrift=null}={}){
 let created=false,installed=0,formalReads=0;const writes=[],commands=[];
 const runCommand=async(command,args,options={})=>{
  assert.equal(command,'docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);assert(!args.join(' ').includes('.Config.Env'));commands.push(args);
  if(args.includes(attendanceProductionIdentity.containerId)){
   if(args[2]==='inspect')return {status:0,stdout:JSON.stringify({id:attendanceProductionIdentity.containerId,name:'/supabase-db',running:true,mounts:[{Type:'bind',Source:attendanceProductionIdentity.dataSource,RW:true}]})};
   if(args.at(-1).includes('exec pg_dump')){assert(args.at(-1).includes('--schema-only'));assert(args.at(-1).includes('default_transaction_read_only=on'));return {status:0,stdout:syntheticAttendanceExtensionDump+'CREATE SCHEMA auth;\nCREATE TABLE auth.users(id uuid);\nCREATE TABLE public.faolla_schema_migrations(version bigint,name text);\nCREATE TRIGGER project AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.project_fn();\n'+truncateMetadata+metadataSuffix+'\n'};}
   if(options.input.startsWith('-- attendance_compatibility_extension_metadata')){const extensions=syntheticAttendanceExtensionMetadata();if(extensionDrift==='formal'&&++formalReads>1)extensions[0].members.at(-1).metadata.enabled='D';return {status:0,stdout:JSON.stringify(extensions)};}
   assert(options.input.startsWith('begin read only;')||options.input.startsWith('-- attendance_compatibility_metadata_contract\nbegin read only;'));return {status:0,stdout:JSON.stringify(options.input.startsWith('begin read only;')?formalState():'9'.repeat(64))};
  }
  if(args[2]==='inspect')return {status:0,stdout:JSON.stringify({id:pilot,name:'/faolla-attendance-pilot-db',image:'sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d',running:true,network:'none',ports:{},privileged:false,labels:{'com.docker.compose.project':'faolla-attendance-pilot','io.faolla.isolated-pilot':'attendance-pilot-20261009'},mounts:[{Type:'bind',Source:'/opt/faolla-attendance-pilot/runtime/db/data',RW:true}]})};
  const s=options.input;assert.equal(typeof s,'string');
  const result=x=>({status:0,stdout:JSON.stringify(x)});
  if(s.startsWith('-- attendance_compatibility_source_probe'))return result({...acl,databaseOid:'5',databaseName:'postgres',systemIdentifier:'7611111111111111111',serverVersionNum:'150008',currentUser:'supabase_admin',adminSuperuser:true,postgresSuperuser:false,legacyAdminEdge:false,existingCompatibilityDatabase:created,authUsers:0,merchants:0,staff:0,storageObjects:0,rolesSha256:'e'.repeat(64),catalogSha256:'f'.repeat(64),...sourceOverride});
  if(s.startsWith('create database ')){created=true;writes.push('CREATE_DATABASE');return {status:0,stdout:''};}
  if(s.startsWith('-- attendance_compatibility_snapshot'))return result(snapshot(installed));
  if(s.startsWith('-- attendance_compatibility_extension_metadata')){const extensions=syntheticAttendanceExtensionMetadata();if(extensionDrift==='clone'&&args.at(-1).includes('-d faolla_attendance_compat_'))extensions[0].members.at(-1).metadata.enabled='D';return result(extensions);}
  if(s.startsWith('-- attendance_compatibility_metadata_contract'))return result('9'.repeat(64));
  if(s.startsWith('-- attendance_compatibility_baseline_facts'))return result(mismatch&&installed===149?'0'.repeat(64):'1'.repeat(64));
  if(s.startsWith('-- attendance_compatibility_permission_inputs'))return result([{input:['enterprise.view'],accepted:true}]);
  if(s.startsWith('-- attendance_compatibility_employee_legacy_')){assert(s.endsWith('rollback;\n'));assert(!s.includes('attendance_suspension_enabled'));return result({legacyInput:true,result:{affected_task_count:0},employee:{version:2,status:s.includes('_disable')?'disabled':'active'}});}
  if(s.startsWith('-- attendance_compatibility_utc_25'))return result({metadata:{oid:100,proacl:['supabase_admin=X/supabase_admin'],proconfig:['search_path=pg_catalog']},sourceSha256:installed===149?'03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6':'3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d',cases:attendanceCompatibilityUtcCases.map(input=>({input,old:input==='UTC',current:input==='UTC'}))});
  if(s.startsWith('-- attendance_compatibility_no_backfill'))return result({settings:0,workers:0,newRolePermissions:false});
  if(s.includes('$attendance_production_prestate$')){
   const m=assets.sources[installed];assert(m);assert(s.includes(m.source.slice(0,m.source.indexOf('begin;'))));
   writes.push(m.version);if(installed===failMigration)return {status:1,stdout:'',stderr:'synthetic failure'};installed++;return {status:0,stdout:''};
  }
  assert(args.at(-1).includes(`-d faolla_attendance_compat_${target.slice(0,12)}`));writes.push('SCOPED_SQL');return {status:0,stdout:''};
 };
 return {runCommand,writes,commands};
}
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),'faolla-052-compatibility-test-'));return {directory,paths:{directory,attempt:path.join(directory,'attempt.json'),proof:path.join(directory,'proof.json'),metadata:path.join(directory,'metadata.sql'),extensionMetadata:path.join(directory,'extension-metadata.json'),extensionSupplement:path.join(directory,'extension-supplement.sql')},target,baseline,sourcePilotContainerId:pilot,testOnly:true,rootOwned:false};}

test('actual052 metadata clone seeds only frozen60 registry names; original149 source pins unchanged',()=>{
 assert.equal(assets.baseline.length,60);assert.equal(assets.sources.length,149);assert(assets.baseline.every(x=>Object.keys(x).length===2));
 assert(!Object.hasOwn(assets,'init'));assert(!assets.baseline.some(x=>x.version>'202609240052'));assert(!assets.sources.some(x=>x.version.endsWith('0165')));
});
test('clone role guard retains full metadata bytes and never writes cluster memberships',()=>{
 for(const m of [{source:'begin;\nCREATE TABLE public.synthetic(id int);\ncommit;\n'}]){
  const wrapped=guardedAttendanceCompatibilitySourceSql(m.source,'faolla_attendance_compat_aaaaaaaaaaaa');assert(wrapped.includes("current_database()<>'faolla_attendance_compat_aaaaaaaaaaaa'"));assert(wrapped.includes('attendance_compatibility_roles_changed'));
  const isolation=wrapped.indexOf('set transaction isolation level');if(isolation>=0)assert(isolation<wrapped.indexOf('$attendance_compatibility_database_guard$'));
  assert(!/alter role|create role/i.test(wrapped.replace(m.source,'')));
 }
});
test('schema-only validator retains public/Auth triggers but denies data/globals/database switching',()=>{
 const source='CREATE TABLE public.synthetic(id int);\nCREATE TRIGGER project AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.project_fn();\nCREATE FUNCTION public.native() RETURNS void AS $$ begin DELETE FROM public.synthetic;end; $$ LANGUAGE plpgsql;\n';assert.equal(validateAttendance052SchemaOnlySql(source).sql,source);
 for(const s of ['INSERT INTO public.merchants VALUES(1);','COPY auth.users FROM stdin;','CREATE ROLE fake;','ALTER DATABASE postgres SET a=1;','\\connect postgres'])assert.throws(()=>validateAttendance052SchemaOnlySql(s));
});

test('schema-only TRUNCATE events and exact TABLE privilege lists retain every original byte',()=>{
 for(const source of [truncateMetadata,
  'CREATE OR REPLACE TRIGGER "protect;quoted"\nBEFORE INSERT OR TRUNCATE OR UPDATE OF "column,name" ON "storage"."synthetic;quoted"\nFOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"(\'argument;value\');',
  'CREATE /* outer /* nested */ comment */ TRIGGER protect AFTER TRUNCATE ON storage.synthetic FOR EACH STATEMENT EXECUTE PROCEDURE storage.protect_delete();',
  'GRANT SELECT ("column,name"),\nTRUNCATE /* privilege only */ , UPDATE (id) ON TABLE "public"."synthetic;quoted", public.other TO "role;quoted", service_role WITH GRANT OPTION GRANTED BY postgres;',
  'GRANT TRUNCATE ON public.synthetic TO postgres;\nGRANT TRUNCATE ON TABLE public.other TO anon;',
  'CREATE FUNCTION public.native() RETURNS void AS $native$ begin TRUNCATE public.synthetic; end; $native$ LANGUAGE plpgsql;'
 ])assert.deepEqual(validateAttendance052SchemaOnlySql(source),{sql:source,sha256:sha(source)});
});

test('real TRUNCATE statements are denied with qualified/quoted/ONLY/TABLE/comment and prior-statement variants',()=>{
 const statements=[
  'TRUNCATE public.synthetic;',
  'truncate "public"."synthetic;quoted";',
  'TRUNCATE\nTABLE\nONLY public.synthetic RESTART IDENTITY CASCADE;',
  'TRUNCATE ONLY public.synthetic;',
  'TRUNCATE/* comment */public.synthetic;',
  'TRUNCATE -- comment\n TABLE public.synthetic;',
  '-- comment\rTRUNCATE/* comment */public.synthetic;',
  'TRUNCATE /* outer /* nested */ comment */ "public"."synthetic";',
  'TRUNCATE(public.synthetic);'
 ];
 for(const statement of statements)for(const prefix of ['', '-- schema metadata\n', '/* comment; */\n', 'CREATE TABLE public.synthetic(id int);', truncateMetadata]){
  assert.throws(()=>validateAttendance052SchemaOnlySql(prefix+statement),/attendance_compatibility_metadata_not_schema_only/);
 }
});

test('metadata exemptions never cover other tokens, appended commands or malformed privilege/trigger contexts',()=>{
 const trigger='CREATE TRIGGER protect BEFORE TRUNCATE ON storage.synthetic FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete()';
 const grant='GRANT SELECT,TRUNCATE ON TABLE public.synthetic TO service_role';
 for(const source of [
  trigger+' TRUNCATE public.synthetic;',
  grant+' TRUNCATE public.synthetic;',
  trigger+';TRUNCATE public.synthetic;',
  grant+';/* separated */TRUNCATE public.synthetic;',
  trigger+';-- pretend GRANT TRUNCATE ON TABLE x TO y;\nTRUNCATE public.synthetic;',
  'CREATE TRIGGER protect BEFORE TRUNCATE public.synthetic;',
  'CREATE TRIGGER protect BEFORE TRUNCATE ON storage.synthetic FOR EACH ROW EXECUTE FUNCTION storage.protect_delete();',
  'GRANT TRUNCATE public.synthetic;',
  'GRANT unknown,TRUNCATE ON TABLE public.synthetic TO anon;',
  'GRANT SELECT ON TABLE public.synthetic TO TRUNCATE;',
  'GRANT TRUNCATE ON TABLE public.synthetic TO anon DELETE FROM public.synthetic;',
  grant+';INSERT INTO public.synthetic VALUES(1);',
  trigger+';DELETE FROM public.synthetic;',
  grant+';COPY public.synthetic FROM stdin;',
  'CREATE TRIGGER protect BEFORE TRUNCATE ON storage.synthetic FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete(\'a;\');TRUNCATE public.synthetic;',
  'GRANT TRUNCATE ON TABLE "public"."synthetic;TRUNCATE public.other" TO anon;TRUNCATE public.synthetic;',
  "SELECT E'escaped\\\'quote';TRUNCATE/* comment */public.synthetic;"
 ])assert.throws(()=>validateAttendance052SchemaOnlySql(source),/attendance_compatibility_metadata_not_schema_only/);
});
test('ACL clone retains postgres bootstrap defaults and is database scoped, never memberships',()=>{
 const source=attendanceCompatibilityPublicAclSql(acl);assert(source.includes('for role "supabase_admin" in schema "public" grant SELECT on TABLES to "postgres"'));
 assert(!/alter role|create role|reassign owned|cascade/i.test(source));
 assert.throws(()=>attendanceCompatibilityPublicAclSql({...acl,defaultAcls:[{owner:'admin',type:'?',entries:[]}]}));
});
test('synthetic actors are accepted old employees, no passwords/auth accounts; legacy writes rollback',()=>{
 const source=attendanceCompatibilityFixturesSql();assert(source.includes('accepted_at'));assert(source.includes('example.invalid'));assert(!/insert into auth\.users|password_hash|encrypted_password/.test(source));
 for(const actor of ['owner','employee'])for(const disable of [false,true]){const sql=attendanceCompatibilityEmployeeSql(actor,disable);assert(sql.endsWith('rollback;\n'));assert(sql.includes('set local role service_role'));assert(sql.includes('grant insert on table pg_temp.'));assert(!sql.includes('attendance_operation_id'));}
});
test('facts hash projects fixed052 columns, includes count and JSON-encoded digest; UTC exact25',()=>{
 const source=attendanceCompatibilityFactsSql(tables);assert(source.includes("key<>all(array['id','created_at']::text[])"));assert(source.includes('select count(*)'));assert(source.includes('select to_jsonb(encode(sha256'));assert.equal(attendanceCompatibilityUtcCases.length,25);
 assert.throws(()=>attendanceCompatibilityFactsSql([...tables,{name:'../../x',columns:['id']}]));
});
test('CLI has no production/data dump/source/proof/roles/testOnly bypass flag',()=>{
 const valid=['dry-run','--target',target,'--baseline',baseline,'--source-pilot-container-id',pilot];assert.equal(parseAttendanceCompatibilityArguments(valid).apply,false);
 for(const extra of [['--test-only','true'],['--proof-file','/tmp/true.json'],['--source-database','production'],['--confirm','yes']])assert.throws(()=>parseAttendanceCompatibilityArguments([...valid,...extra]));
 assert.throws(()=>parseAttendanceCompatibilityArguments(['dry-run','--target',target,'--baseline',baseline,'--source-pilot-container-id',attendanceProductionIdentity.containerId]));
});
test('mock dry-run only inspects pilot/source and creates no DB, metadata or proof',async()=>{
 const f=await fixture(),db=fake();try{const r=await runAttendance052Compatibility({...f,runCommand:db.runCommand});assert.equal(r.executed,false);assert.deepEqual(db.writes,[]);await assert.rejects(()=>readFile(f.paths.proof));}finally{await rm(f.directory,{recursive:true,force:true});}
});
test('mock metadata containing a real TRUNCATE fails before any attempt, metadata, proof or new DB write',async()=>{
 const f=await fixture(),db=fake({metadataSuffix:'TRUNCATE/* data command */public.synthetic;'});try{
  await assert.rejects(()=>runAttendance052Compatibility({...f,apply:true,confirm:'approved-isolated-052-210-compatibility',runCommand:db.runCommand}),/attendance_compatibility_metadata_not_schema_only/);
  assert.deepEqual(db.writes,[]);for(const file of [f.paths.attempt,f.paths.metadata,f.paths.proof])await assert.rejects(()=>readFile(file),{code:'ENOENT'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('mock formal member drift fails before artifacts; clone member drift never installs149 or emits proof',async()=>{
 for(const extensionDrift of ['formal','clone']){
  const f=await fixture(),db=fake({extensionDrift});try{
   await assert.rejects(()=>runAttendance052Compatibility({...f,apply:true,confirm:'approved-isolated-052-210-compatibility',runCommand:db.runCommand}),new RegExp(extensionDrift==='formal'?'attendance_compatibility_formal_metadata_drift':'attendance_compatibility_clone_extension_metadata'));
   assert.equal(db.writes.filter(x=>/^\d+$/.test(x)).length,0);await assert.rejects(()=>readFile(f.paths.proof),{code:'ENOENT'});
   if(extensionDrift==='formal'){assert.deepEqual(db.writes,[]);for(const file of [f.paths.attempt,f.paths.metadata,f.paths.extensionMetadata,f.paths.extensionSupplement])await assert.rejects(()=>readFile(file),{code:'ENOENT'});}
  }finally{await rm(f.directory,{recursive:true,force:true});}
 }
});
test('mock exclusive supplement collision preserves old evidence and cannot create DB or success proof',async()=>{
 const f=await fixture(),db=fake();try{
  await writeFile(f.paths.extensionSupplement,'previous-failure-evidence\n',{flag:'wx',mode:0o600});
  await assert.rejects(()=>runAttendance052Compatibility({...f,apply:true,confirm:'approved-isolated-052-210-compatibility',runCommand:db.runCommand}),{code:'EEXIST'});
  assert.equal(await readFile(f.paths.extensionSupplement,'utf8'),'previous-failure-evidence\n');assert.deepEqual(db.writes,[]);
  for(const file of [f.paths.attempt,f.paths.proof])await assert.rejects(()=>readFile(file),{code:'ENOENT'});
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('mock executor derives proof after actual052 schema-only clone+149 measured comparisons',async()=>{
 const f=await fixture(),db=fake();try{
  const r=await runAttendance052Compatibility({...f,apply:true,confirm:'approved-isolated-052-210-compatibility',runCommand:db.runCommand});assert.equal(r.finalRegistryCount,209);assert.equal(r.utcCases,25);assert.equal(r.employeeLegacyCases,4);assert.equal(r.realHttpAuthAccepted,false);assert.equal(r.productionRestoreProved,false);
  assert.equal(db.writes.filter(x=>/^\d+$/.test(x)).length,149);assert.equal(db.writes.at(-1),'202610090210');validateAttendanceCompatibilityProof(r,{target,baseline,scopeSha256:assets.scopeSha256});assert.equal(sha(await readFile(f.paths.proof)),r.proofSha256);
  assert.equal(r.historicalBootstrapReplayed,false);assert.equal(r.productionMetadataSource.productionDataCopied,false);assert.equal(r.productionMetadataSource.schemaOnly,true);
  assert((await readFile(f.paths.metadata,'utf8')).includes(truncateMetadata));
  assert((await readFile(f.paths.metadata,'utf8')).startsWith('\n-- Synthetic'));assert((await readFile(f.paths.metadata,'utf8')).endsWith('\n\n'));
  const extension=r.productionMetadataSource.extensionMetadata;
  assert.equal(extension.originalMetadataSourceSha256,r.productionMetadataSource.metadataSourceSha256);
  assert.equal(extension.sourceSha256,sha(await readFile(f.paths.extensionMetadata)));assert.equal(extension.supplementSha256,sha(await readFile(f.paths.extensionSupplement)));
  assert.deepEqual([extension.extensionCount,extension.memberCount,extension.routineCount],[8,96,80]);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('mock failure or changed synthetic facts leaves no success proof and never drops/rebuilds',async()=>{
 for(const options of [{failMigration:3},{mismatch:true},{sourceOverride:{legacyAdminEdge:true}},{sourceOverride:{existingCompatibilityDatabase:true}}]){
  const f=await fixture(),db=fake(options);try{await assert.rejects(()=>runAttendance052Compatibility({...f,apply:true,confirm:'approved-isolated-052-210-compatibility',runCommand:db.runCommand}));await assert.rejects(()=>readFile(f.paths.proof));assert(!db.commands.some(x=>x.join(' ').includes('drop database')));}finally{await rm(f.directory,{recursive:true,force:true});}
 }
});
