import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{spawnSync}from'node:child_process';
import{GUEST_SCHEMA,GUEST_BASELINE,GUEST_TABLES,GUEST_FUNCTIONS,GUEST_COLUMNS,guestSqlBytes,guestBlob,assertGuestSchema}from'./application-release-guest-chat-contract.mjs';
import{guestMigrationSql,assertGuestDryRun}from'./application-release-guest-chat-migrate.mjs';
import{createApplicationReleaseManifest,assertApplicationReleaseManifest}from'./application-release-compatibility.mjs';
import{createApplicationReleaseManifest as original}from'./application-release-policy.mjs';
import{assertGuestDatabaseObservation,guestStateSql}from'./application-release-guest-chat-database.mjs';
import{TEMPLATE_SCHEMA,TEMPLATE_COLUMNS}from'./application-release-template-contract.mjs';
import{guestMigrationWorkflow}from'./application-release-guest-chat-workflow.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8').replaceAll('\r\n','\n'),row=(file,oid='a'.repeat(40))=>({file,mode:'100644',oid});
const fixture=()=>({baseline:GUEST_BASELINE,purpose:'Publish mobile stability and independently migrated visitor conversations',focusedTests:['src/example.test.ts'],baselineRows:[row('src/example.ts'),row('src/example.test.ts')],targetRows:[row('src/example.ts','b'.repeat(40)),row('src/example.test.ts','b'.repeat(40)),row(GUEST_SCHEMA.file,guestBlob(guestSqlBytes())),row('scripts/guest-chat-db-acceptance.mjs'),row('scripts/guest-chat-db-acceptance.sql')]});
test('only pinned guest migration and two exact verification paths compose with unchanged original code-only admission',()=>{
 const input=fixture(),manifest=createApplicationReleaseManifest(input);assert.equal(manifest.schemaVersion,5);assert.equal(manifest.database,'unchanged');assert.equal(manifest.guestSchema.databaseExecution,'forbidden');assert.equal(assertApplicationReleaseManifest(manifest,input).guestSchemaVerified,true);assert.throws(()=>original(input));
 for(const mutate of [x=>x.targetRows.find(r=>r.file===GUEST_SCHEMA.file).oid='d'.repeat(40),x=>x.targetRows.find(r=>r.file===GUEST_SCHEMA.file).mode='100755',x=>x.targetRows.push(row('scripts/supabase-migrations/unapproved.sql')),x=>x.targetRows.push(row('scripts/other-acceptance.sql')),x=>x.targetRows=x.targetRows.filter(r=>r.file!=='scripts/guest-chat-db-acceptance.sql')]){const bad=structuredClone(input);mutate(bad);assert.throws(()=>createApplicationReleaseManifest(bad));}
 for(const mutate of [x=>x.guestSchema.databaseExecution='allow',x=>x.changes.pop(),x=>x.extra=true,x=>x.guestBaseSchemaVersion=2]){const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>assertApplicationReleaseManifest(bad,input));}
 const future={...input,baselineRows:input.targetRows,targetRows:input.targetRows.map(r=>r.file.startsWith('src/')?{...r,oid:'c'.repeat(40)}:r)};
 assert.equal(assertApplicationReleaseManifest(createApplicationReleaseManifest(future),future).guestSchemaVerified,true);
 const absent=fixture();absent.targetRows=absent.targetRows.filter(r=>!r.file.startsWith('scripts/'));assert.equal(createApplicationReleaseManifest(absent).schemaVersion,1);
});
function schema(){const bodies=[...guestSqlBytes().toString().matchAll(/create function public\.(merchant_guest_chat_\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)];return{
 tables:GUEST_TABLES.map((name,i)=>({name,owner:'supabase_admin',rls:true,forceRls:false,columns:GUEST_COLUMNS[name].map(c=>[...c,null]),policies:0,triggers:0,constraints:Array([6,4,6][i]).fill('synthetic'),indexes:Array([4,3,4][i]).fill('synthetic'),grants:[{role:'service_role',privilege:'SELECT',grantable:false}]})),
 functions:GUEST_FUNCTIONS.map(signature=>({signature,owner:'supabase_admin',definer:true,config:['search_path=pg_catalog, public'],bodyMd5:createHash('md5').update(bodies.find(m=>signature.startsWith('public.'+m[1]+'('))[2].replaceAll('\r','')).digest('hex'),grants:[{role:'service_role',privilege:'EXECUTE',grantable:false}]})),sequence:{name:'merchant_guest_chat_messages_sequence_seq',owner:'supabase_admin',grants:[]}};}
test('schema verification denies role, function-body, identity-sequence and table drift',()=>{
 assertGuestSchema(schema());for(const mutate of [x=>x.tables[0].rls=false,x=>x.tables[0].owner='anon',x=>x.tables[0].columns.pop(),x=>x.tables[0].triggers=1,x=>x.functions[0].bodyMd5='0'.repeat(32),x=>x.functions[0].definer=false,x=>x.functions[0].config=[],x=>x.functions.pop(),x=>x.tables[0].grants.push({role:'anon',privilege:'SELECT'}),x=>x.tables[0].grants.push({role:'service_role',privilege:'INSERT',grantable:false}),x=>x.sequence.grants.push({role:'anon',privilege:'USAGE'}),x=>x.functions[0].grants.push({role:'PUBLIC',privilege:'EXECUTE'})]){const bad=schema();mutate(bad);assert.throws(()=>assertGuestSchema(bad));}
});
test('installation uses the exact old registry, booking identity, shared transaction lock and no replay',()=>{
 const registry=Array.from({length:213},(_,i)=>({version:i===212?'202611100214':String(i),name:i===212?'website_template_library':'synthetic'})),sql=guestMigrationSql(guestSqlBytes(),registry);
 for(const pattern of [/lock_timeout='2s'/,/statement_timeout='10s'/,/pg_advisory_xact_lock\(20260731,1\)/,/merchant_guest_chat_precondition/,/09fa13e69856221d61b6eaa544927b2a/,/singleton and active and protocol=2/,/merchant_guest_chat_messages_sequence_seq/])assert.match(sql,pattern);
 assert.doesNotMatch(sql,/\b(?:drop table|truncate|delete from public\.)/i);assert.throws(()=>guestMigrationSql(Buffer.concat([guestSqlBytes(),Buffer.from('-- extra')]),registry));assert.throws(()=>guestMigrationSql(guestSqlBytes(),registry.slice(1)));
 const dry={ok:true,lane:'merchant_guest_chat_online',mode:'dry_run',status:'dry_run',through:GUEST_SCHEMA.version,databaseContainer:'supabase-db',executed:[],registeredVersions:registry.map(r=>r.version),pending:[{version:GUEST_SCHEMA.version,name:GUEST_SCHEMA.name,fileName:GUEST_SCHEMA.file.split('/').at(-1)}]};assertGuestDryRun(dry);
 for(const mutate of [x=>x.executed.push({}),x=>x.pending.push({}),x=>x.through='other',x=>x.registeredVersions.pop()]){const bad=structuredClone(dry);mutate(bad);assert.throws(()=>assertGuestDryRun(bad));}
});
function legacy(){
 const state={actor:'supabase_admin',database:'postgres',oid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',function:{owner:'supabase_admin',bodyMd5:'09fa13e69856221d61b6eaa544927b2a'},access:{anon:false,authenticated:false,service:true},control:{singleton:true,active:true,protocol:2,generation:'synthetic'},registry:Array.from({length:212},(_,i)=>({version:i===211?'202611050213':String(i),name:'synthetic'}))};
 const evidence={before:{state:{function:{bodyMd5:'310b382802e94af2997b1b9751fab0bc'}}},applied:{target:'ba27e903ba13f8e9f17be357da4412c1fe5792d6',processesUnchanged:true,mailEnabled:false,transactionCheckedBookingRowsAndAcl:true,state:structuredClone(state)},result:{ok:true,status:'applied',executed:[{version:'202611050213',name:'booking_atomic_safeupdate_singleton',fileName:'202611050213_booking_atomic_safeupdate_singleton.sql'}]}};
 state.registry.push({version:TEMPLATE_SCHEMA.version,name:TEMPLATE_SCHEMA.name});state.templateTable={owner:'supabase_admin',rls:true,forceRls:false,columns:TEMPLATE_COLUMNS,constraints:[{type:'p',definition:'PRIMARY KEY (id)'},...['length(name)','category = ANY','status = ANY','jsonb_typeof(design)','source_plan_id = ANY'].map(definition=>({type:'c',definition}))],indexes:['primary','catalog (status, sort_order, updated_at DESC)'],triggers:0,policies:0,grants:['DELETE','INSERT','SELECT','UPDATE'].map(privilege=>({role:'service_role',privilege,grantable:false})),access:{anon:false,authenticated:false,service:true}};
 const template={kind:'website-template-schema-installed',version:TEMPLATE_SCHEMA.version,migrationSha256:TEMPLATE_SCHEMA.sha256,createdRowCount:0,businessDataWritten:false,mailEnabled:false,processesUnchanged:true,table:structuredClone(state.templateTable)};
 return{state,evidence,template};
}
test('new proof projects only its exact appended registration and preserves every original database check',()=>{
 const{state,evidence,template}=legacy();state.guestSchema={tables:[],functions:[],sequence:null};assertGuestDatabaseObservation(state,evidence,template);
 state.guestSchema=schema();state.registry.push({version:GUEST_SCHEMA.version,name:GUEST_SCHEMA.name});
 const receipt={kind:'merchant-guest-chat-schema-installed',version:GUEST_SCHEMA.version,migrationSha256:GUEST_SCHEMA.sha256,createdRowCount:0,businessDataWritten:false,mailEnabled:false,processesUnchanged:true,schema:structuredClone(state.guestSchema)};
 assertGuestDatabaseObservation(state,evidence,template,receipt);
 for(const mutate of [x=>x.registry[0].name='changed',x=>x.registry.push({version:'other'}),x=>x.function.bodyMd5='bad',x=>x.access.anon=true,x=>x.control.generation='changed',x=>x.templateTable.rls=false,x=>x.guestSchema.tables[0].columns[0][4]='changed']){const bad=structuredClone(state);mutate(bad);assert.throws(()=>assertGuestDatabaseObservation(bad,evidence,template,receipt));}
 assert.match(guestStateSql,/^begin read only;/);assert.doesNotMatch(guestStateSql,/\b(?:create|drop|update|insert|delete|alter|grant|revoke)\s+public\./i);
});
test('new migration workflow retains all previous backup, identity, source and no-maintenance gates',()=>{
 const old=read('.github/workflows/website-template-table-online.yml'),actual=read('.github/workflows/merchant-guest-chat-online.yml');assert.equal(actual,guestMigrationWorkflow(old).trimEnd()+'\n');
 const yaml=createRequire(import.meta.url)('js-yaml'),a=yaml.load(old),b=yaml.load(actual);assert.deepEqual(b.concurrency,a.concurrency);assert.deepEqual(b.permissions,a.permissions);assert.deepEqual(b.on.workflow_dispatch.inputs.backup_run_id,a.on.workflow_dispatch.inputs.backup_run_id);assert.equal(b.jobs.migrate.steps.length,a.jobs.migrate.steps.length);
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
 for(const step of b.jobs.migrate.steps)if(step.run){const r=spawnSync(bash,['-n'],{input:step.run,encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,step.name+': '+r.stderr);}
 const migrate=read('scripts/application-release-guest-chat-migrate.mjs');assert.match(migrate,/O_EXCL/);assert.match(migrate,/--nonblock/);assert.ok(migrate.indexOf("write(directory+'/apply-attempt.json'")<migrate.indexOf('templateQuery(guestMigrationSql'));
 assert.doesNotMatch(migrate,/\['stop'|\['restart'|drop table|truncate table/);
 assert.match(read('scripts/online-traffic-release.mjs'),/\[2,3,5\]\.includes\(closure.manifest.schemaVersion\)\)assertRecordedSchemaDatabase/);
});
