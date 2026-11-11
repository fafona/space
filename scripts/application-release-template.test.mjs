import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {templateMigrationWorkflow} from './application-release-template-workflow.mjs';
import {TEMPLATE_SCHEMA,TEMPLATE_COLUMNS,templateGitBlob,assertTemplateSql,assertTemplateTable} from './application-release-template-contract.mjs';
import {templateMigrationSql,assertTemplateDryRun,templateProcessPid,templateProcessIdentity,assertTemplateProcessesUnchanged} from './application-release-template-migrate.mjs';
import {assertTemplateDatabaseObservation,templateStateSql} from './application-release-template-database.mjs';
import {templateSeedHash} from './application-release-template-seed.mjs';
import {createApplicationReleaseManifest,assertApplicationReleaseManifest,RECORDED_APPLICATION_ARTIFACTS as records} from './application-release-compatibility.mjs';
import {createApplicationReleaseManifest as original} from './application-release-policy.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=fs.readFileSync(new URL('./supabase-migrations/202611100214_website_template_library.sql',import.meta.url));
const row=(file,oid='a'.repeat(40))=>({file,mode:'100644',oid});
function fixture(){return {baseline:'c'.repeat(40),purpose:'Publish an independently validated template library, without executing SQL in the web publisher',focusedTests:['src/example.test.ts'],
 baselineRows:[row('src/example.ts'),row('src/example.test.ts'),...records.filter(r=>r.before).map(r=>({file:r.file,mode:r.before[0],oid:r.before[1]}))],
 targetRows:[row('src/example.ts','b'.repeat(40)),row('src/example.test.ts','b'.repeat(40)),...records.map(r=>({file:r.file,mode:r.after[0],oid:r.after[1]})),row(TEMPLATE_SCHEMA.file,templateGitBlob(sql))]};}
test('only the exact additive table is admitted, preserving the original code-only guard',()=>{
 const input=fixture(),manifest=createApplicationReleaseManifest(input),proof=assertApplicationReleaseManifest(manifest,input);
 assert.equal(manifest.schemaVersion,3);assert.equal(proof.templateSchemaVerified,true);assert.throws(()=>original(input));
 assert.equal(manifest.changes.filter(r=>r.role==='already-applied-template-schema').length,1);
 for(const mutate of [v=>v.targetRows.push(row('scripts/supabase-migrations/202611120215_other.sql')),
  v=>v.targetRows.find(r=>r.file===TEMPLATE_SCHEMA.file).oid='e'.repeat(40),v=>v.targetRows.find(r=>r.file===TEMPLATE_SCHEMA.file).mode='100755']){
  const changed=structuredClone(input);mutate(changed);assert.throws(()=>createApplicationReleaseManifest(changed));
 }
 for(const mutate of [v=>v.templateSchema.databaseExecution='allow',v=>v.templateSchema.sha256='0'.repeat(64),v=>v.changes.pop(),v=>v.extra=true,v=>v.baseSchemaVersion=1]){
  const changed=structuredClone(manifest);mutate(changed);assert.throws(()=>assertApplicationReleaseManifest(changed,input));
 }
 // A future web-only successor still proves the installed template schema.
 const future={...input,baselineRows:input.targetRows,targetRows:input.targetRows.map(r=>['src/example.ts','src/example.test.ts'].includes(r.file)?{...r,oid:'d'.repeat(40)}:r)};
 const next=createApplicationReleaseManifest(future);assert.equal(next.schemaVersion,3);assert.equal(next.baseSchemaVersion,1);assertApplicationReleaseManifest(next,future);
});
test('real admission callers provide only Git evidence; reviewed metadata stays in the manifest',()=>{
 const input=fixture(),manifest=createApplicationReleaseManifest(input);
 const structural={baseline:input.baseline,baselineRows:input.baselineRows,targetRows:input.targetRows};
 assert.equal(assertApplicationReleaseManifest(manifest,structural).templateSchemaVerified,true);
 for(const change of [{...manifest,purpose:''},{...manifest,focusedTests:[]},{...manifest,purpose:undefined}])assert.throws(()=>assertApplicationReleaseManifest(change,structural));
});
test('migration byte pin, transaction boundary and exact old registry prevent extra SQL and replay',()=>{
 assertTemplateSql(sql);assert.throws(()=>assertTemplateSql(Buffer.concat([sql,Buffer.from('-- changed')])));
 const registry=Array.from({length:212},(_,i)=>({version:i===211?'202611050213':String(i),name:'fixture'}));
 const guarded=templateMigrationSql(sql,registry);assert.match(guarded,/pg_advisory_xact_lock\(20260731,1\)/);
 assert.match(guarded,/to_regclass\('public.website_templates'\) is not null/);assert.match(guarded,/lock_timeout='2s'/);assert.match(guarded,/statement_timeout='10s'/);
 assert.doesNotMatch(guarded,/drop table|truncate|update public\.(?:pages|merchants)|delete from/i);
 assert.throws(()=>templateMigrationSql(sql,registry.slice(1)));
 const dry={ok:true,lane:'website_template_table_online',status:'dry_run',mode:'dry_run',through:TEMPLATE_SCHEMA.version,databaseContainer:'supabase-db',executed:[],registeredVersions:registry.map(r=>r.version),pending:[{version:TEMPLATE_SCHEMA.version,name:TEMPLATE_SCHEMA.name}]};
 assertTemplateDryRun(dry);for(const mutate of [v=>v.executed.push({}),v=>v.pending.push({}),v=>v.registeredVersions.pop(),v=>v.through='other']){const bad=structuredClone(dry);mutate(bad);assert.throws(()=>assertTemplateDryRun(bad));}
});
test('stopped PM2 registrations have one explicit PID and survive the actual JSON evidence round trip',()=>{
 const omitted={name:'stopped-registration',pm_id:4,pm2_env:{status:'stopped'}};
 const old={name:omitted.name,id:omitted.pm_id,pid:omitted.pid,status:'stopped',ticks:null,environmentSha256:null};
 assert.notDeepEqual(old,JSON.parse(JSON.stringify(old)),'reproduce undefined own-property loss in the old observation');
 assert.equal(templateProcessPid(omitted),0);
 const rows=Array.from({length:18},(_,i)=>templateProcessIdentity({...omitted,name:'stopped-'+i,pm_id:i+4},{ticks:null,environmentSha256:null}));
 rows.push(templateProcessIdentity({name:'live',pm_id:25,pid:685108,pm2_env:{status:'online'}},{ticks:'123456',environmentSha256:'a'.repeat(64)}));
 const saved=JSON.parse(JSON.stringify(rows));assert.deepEqual(rows,saved);assertTemplateProcessesUnchanged(saved,rows);
 assert.deepEqual(templateProcessIdentity({...omitted,pid:0},{ticks:null,environmentSha256:null}),{...rows[0],name:omitted.name});
 const errored=templateProcessIdentity({...omitted,pid:0,pm2_env:{status:'errored'}},{ticks:null,environmentSha256:null});assert.deepEqual(errored,JSON.parse(JSON.stringify(errored)));
 for(const row of [{...omitted,pm2_env:{status:'online'}},{...omitted,pm2_env:{status:'errored'}},
  ...[-1,1.5,'0',null,NaN].map(pid=>({...omitted,pid}))])assert.throws(()=>templateProcessPid(row),/application_template_process_pid/);
});
test('canonical process evidence still refuses every changed identity, missing registration and malformed live observation',()=>{
 const live={name:'live',pm_id:25,pid:685108,pm2_env:{status:'online'}},metadata={ticks:'123456',environmentSha256:'a'.repeat(64)};
 const expected=[templateProcessIdentity(live,metadata)];
 for(const change of [{name:'other'},{id:26},{pid:685109},{status:'stopped'},{ticks:'123457'},{environmentSha256:'b'.repeat(64)}]){
  assert.throws(()=>assertTemplateProcessesUnchanged(expected,[{...expected[0],...change}]),/application_template_processes_changed/);
 }
 for(const changed of [[],[...expected,...expected],undefined])assert.throws(()=>assertTemplateProcessesUnchanged(expected,changed));
 for(const row of [{...live,name:undefined},{...live,pm_id:undefined},{...live,pm2_env:{}},
  {...live,pid:undefined},{...live,pid:0}])assert.throws(()=>templateProcessIdentity(row,metadata));
 for(const data of [{...metadata,ticks:undefined},{...metadata,ticks:'NaN'},{...metadata,environmentSha256:null}])assert.throws(()=>templateProcessIdentity(live,data));
 assert.throws(()=>templateProcessIdentity({name:'stopped',pm_id:4,pm2_env:{status:'stopped'}},metadata));
});
function observation(){
 const state={actor:'supabase_admin',database:'postgres',oid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',
  function:{oid:1,owner:'supabase_admin',acl:['private'],config:['search_path=pg_catalog, public'],definer:true,bodyMd5:'09fa13e69856221d61b6eaa544927b2a'},
  access:{anon:false,authenticated:false,service:true},control:{singleton:true,active:true,protocol:2,generation:'synthetic',revision:1},registry:Array.from({length:212},(_,i)=>({version:i===211?'202611050213':String(i),name:'fixture'}))};
 const evidence={before:{state:{function:{bodyMd5:'310b382802e94af2997b1b9751fab0bc'}}},applied:{target:'ba27e903ba13f8e9f17be357da4412c1fe5792d6',processesUnchanged:true,mailEnabled:false,transactionCheckedBookingRowsAndAcl:true,state:structuredClone(state)},
  result:{ok:true,status:'applied',executed:[{version:'202611050213',name:'booking_atomic_safeupdate_singleton',fileName:'202611050213_booking_atomic_safeupdate_singleton.sql'}]}};
 const table={owner:'supabase_admin',rls:true,forceRls:false,columns:TEMPLATE_COLUMNS,constraints:[{type:'p',definition:'PRIMARY KEY (id)'},...['length(name)','category = ANY','status = ANY','jsonb_typeof(design)','source_plan_id = ANY'].map(definition=>({type:'c',definition}))],indexes:['primary','catalog (status, sort_order, updated_at DESC)'],triggers:0,policies:0,grants:['DELETE','INSERT','SELECT','UPDATE'].map(privilege=>({role:'service_role',privilege,grantable:false})),access:{anon:false,authenticated:false,service:true}};
 return {state,evidence,table};
}
test('installed schema retains every original database proof and rejects unknown registry, ACL or metadata drift',()=>{
 const {state,evidence,table}=observation();assertTemplateTable(table);assertTemplateDatabaseObservation({...state,templateTable:null},evidence);
 state.registry.push({version:TEMPLATE_SCHEMA.version,name:TEMPLATE_SCHEMA.name});state.templateTable=table;
 const receipt={kind:'website-template-schema-installed',version:TEMPLATE_SCHEMA.version,migrationSha256:TEMPLATE_SCHEMA.sha256,table:structuredClone(table),createdRowCount:0,businessDataWritten:false,mailEnabled:false,processesUnchanged:true};
 assertTemplateDatabaseObservation(state,evidence,receipt);
 for(const mutate of [v=>v.registry.push({version:'other'}),v=>v.registry[0].name='changed',v=>v.function.acl=[],v=>v.control.generation='other',v=>v.templateTable.grants.push({role:'PUBLIC',privilege:'SELECT'}),v=>v.templateTable.rls=false,v=>v.templateTable.columns.pop(),v=>v.templateTable.triggers=1]){
  const bad=structuredClone(state);mutate(bad);assert.throws(()=>assertTemplateDatabaseObservation(bad,evidence,receipt));
 }
 assert.match(templateStateSql,/^begin read only;/);assert.doesNotMatch(templateStateSql,/\b(?:update|insert|delete|alter|create|drop|grant|revoke)\s+public\./i);
});
test('separate migration workflow retains every prior gate, source template and shell limit',()=>{
 const old=read('.github/workflows/booking-safeupdate-online.yml'),actual=read('.github/workflows/website-template-table-online.yml');
 assert.equal(actual,templateMigrationWorkflow(old).trimEnd()+'\n');
 const yaml=createRequire(import.meta.url)('js-yaml'),before=yaml.load(old),after=yaml.load(actual);
 assert.deepEqual(after.concurrency,before.concurrency);assert.deepEqual(after.permissions,before.permissions);
 assert.deepEqual(Object.keys(after.on.workflow_dispatch.inputs).sort(),Object.keys(before.on.workflow_dispatch.inputs).sort());
 const steps=after.jobs.migrate.steps,prior=before.jobs.migrate.steps;
 assert.equal(steps.length,prior.length);
 for(let i=0;i<steps.length;i++){
  const a=steps[i],b=prior[i];if(!a.run){assert.deepEqual(a,b);continue;}
  assert.ok(a.run.length<=21000,a.name);
  const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
  const parsed=spawnSync(bash,['-n'],{input:a.run,encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(parsed.status,0,a.name+': '+parsed.stderr);
 }
 const ci=read('.github/workflows/ci.yml');assert.match(ci,/WEBSITE_TEMPLATE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE: "1"/);assert.match(ci,/run: node scripts\/application-release-template-postgres-acceptance.mjs/);
 const migrate=read('scripts/application-release-template-migrate.mjs');assert.match(migrate,/O_EXCL/);assert.match(migrate,/apply-attempt\.json/);assert.match(migrate,/--nonblock/);assert.doesNotMatch(migrate,/\['restart'|\['stop'|rollback.*query\(/);
});
test('the actual new workflow emits exactly one apply JSON document and keeps all confirmations on stderr',()=>{
 const yaml=createRequire(import.meta.url)('js-yaml'),flow=yaml.load(read('.github/workflows/website-template-table-online.yml'));
 const step=flow.jobs.migrate.steps.find(s=>s.name==='Revalidate Evidence And Apply Exact Through');
 const commands=step.run.split('\n').filter(line=>/^node scripts\/application-release-template-migrate\.mjs (?:dry-run|prepare|apply|verify) /.test(line.trim()));
 assert.equal(commands.length,4);assert.match(commands[0],/dry-run "\$dry_report_path" >&2$/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'faolla-template-report-')),bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';let passed=false;
 try{
  // A transport-only fixture. No production source/database/CI guard is
  // replaced or granted authority: execute the four actual redirect lines.
  const script=lines=>`set -euo pipefail\nnode() {\ncase "$2" in\ndry-run) printf '%s\\n' '{"dryRunVerified":true}' ;;\nprepare) printf '%s\\n' '{"prepared":true}' ;;\napply) printf '%s\\n' '{"ok":true,"mode":"apply","status":"applied"}' ;;\nverify) printf '%s\\n' '{"applied":true}' ;;\n*) return 1 ;;\nesac\n}\n${lines.join('\n')}\ncat "$apply_report_path"\n`;
  const run=(lines,file)=>spawnSync(bash,['--noprofile','--norc','-s'],{input:script(lines),encoding:'utf8',windowsHide:true,timeout:10000,
   env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,FAOLLA_REPORT_DIR:dir.replaceAll('\\','/'),dry_report_path:'/unused-readonly-fixture',apply_report_path:path.join(dir,file).replaceAll('\\','/')}});
  const good=run(commands,'good.json');assert.ifError(good.error);assert.equal(good.status,0,good.stderr);
  assert.deepEqual(JSON.parse(good.stdout),{ok:true,mode:'apply',status:'applied'});
  assert.deepEqual(good.stderr.trim().split(/\r?\n/).map(s=>JSON.parse(s)),[{dryRunVerified:true},{prepared:true},{applied:true}]);
  const prior=commands.map(line=>line.includes(' dry-run ')?line.replace(' >&2',''):line),bad=run(prior,'prior.json');
  assert.ifError(bad.error);assert.equal(bad.status,0,bad.stderr);assert.throws(()=>JSON.parse(bad.stdout),SyntaxError);
  assert.equal(bad.stdout.trim().split(/\r?\n/).length,2,'reproduce the original line-2 JSON parse failure');passed=true;
 }finally{
  if(passed){for(const file of ['good.json','prior.json']){const target=path.join(dir,file),st=fs.lstatSync(target);assert.ok(st.isFile()&&!st.isSymbolicLink());fs.unlinkSync(target);}fs.rmdirSync(dir);}
 }
});
test('first seed compares JSONB semantically and cannot mint sessions or write a source draft',()=>{
 assert.equal(templateSeedHash({b:1,a:[{z:2,x:3}]}),templateSeedHash({a:[{x:3,z:2}],b:1}));
 assert.notEqual(templateSeedHash({a:[1,2]}),templateSeedHash({a:[2,1]}));
 const source=read('scripts/application-release-template-seed.mjs');
 for(const guard of ['observeApplicationRelease(target)','reviewedHash===designHash','ignoreDuplicates:true','sourceWritten:false','existingUserCopiesWritten:false'])assert.ok(source.includes(guard));
 assert.doesNotMatch(source,/createSession|mintSession|setCookie|loadCookie|\.from\(['"]pages['"]\)|\/api\/merchant-draft/);
});
test('seed loads the actual server modules through the same tsx runtime, without credentials or network calls',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const result=spawnSync(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'scripts/test-support/template-seed-runtime-fixture.mjs')],{
  cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,TEMP:process.env.TEMP,TMP:process.env.TMP,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'dummy-anon-key'}
 });
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/template-seed-runtime-imports-passed/);
});
