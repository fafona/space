// Mandatory CI-only PG15 test, on a separately created database within the
// already identity-bound disposable service. No host/URL/credential overrides.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {resolvePagesAclIntegrationConfig} from './pages-acl-integration/run.mjs';
import {templateMigrationSql} from './application-release-template-migrate.mjs';
import {TEMPLATE_TABLE_EXPRESSION,assertTemplateTable,TEMPLATE_SCHEMA} from './application-release-template-contract.mjs';
export function runTemplatePostgresAcceptance(env=process.env,args=process.argv.slice(2)){
 assert.equal(args.length,0);assert.equal(env.WEBSITE_TEMPLATE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE,'1');
 assert.equal(fs.existsSync('/var/lib/faolla-online-release/active.json'),false,'never run on a formal host');
 const config=resolvePagesAclIntegrationConfig(env,[]),database='faolla_website_template_test';
 const run=(sql,target=config.database)=>{
  const argv=config.args.map(a=>a.startsWith('--dbname=')?'--dbname='+target:a);
  const r=spawnSync('psql',argv,{input:sql,encoding:'utf8',env:config.env,timeout:25000,maxBuffer:1024**2,windowsHide:true});
  assert.ifError(r.error);assert.equal(r.signal,null);return r;
 };
 const query=(sql,target)=>{const r=run(sql,target);assert.equal(r.status,0,'synthetic SQL failed: '+(r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??'unknown'));return r.stdout.trim();};
 const identity=JSON.parse(query("select jsonb_build_object('database',current_database(),'user',current_user,'address',host(inet_server_addr()),'major',current_setting('server_version_num')::int/10000,'directory',current_setting('data_directory'),'newdb',(select count(*) from pg_database where datname='faolla_website_template_test'),'newrole',(select count(*) from pg_roles where rolname='supabase_admin'));"));
 assert.deepEqual(identity,{database:config.database,user:'postgres',address:config.serverAddress,major:15,directory:'/var/lib/postgresql/data',newdb:0,newrole:0});
 query('create role supabase_admin nologin;create database faolla_website_template_test;');
 const sql=fs.readFileSync(new URL('./supabase-migrations/202611100214_website_template_library.sql',import.meta.url));
 const registry=Array.from({length:212},(_,i)=>({version:i===211?'202611050213':String(202600000000+i),name:'synthetic_'+i}));
 query(`grant usage,create on schema public to supabase_admin;grant usage on schema public to anon,authenticated,service_role;
 set role supabase_admin;create table public.faolla_schema_migrations(version bigint primary key,name text not null);
 insert into public.faolla_schema_migrations select (r->>'version')::bigint,r->>'name' from jsonb_array_elements('${JSON.stringify(registry)}'::jsonb)r;
 create table public.template_protected(id integer primary key,value text);insert into public.template_protected values(1,'unchanged');`,database);
 const guarded=templateMigrationSql(sql,registry);
 // A raised transaction guard cannot leave the table or registration behind.
 const rejected=run(`set role supabase_admin;${guarded.replace('select pg_advisory_xact_lock(20260731,1);',"select pg_advisory_xact_lock(20260731,1);select 1/0;")}`,database);
 assert.notEqual(rejected.status,0);
 assert.equal(query("select to_regclass('public.website_templates') is null;",database),'t');
 query('set role supabase_admin;'+guarded,database);
 const table=JSON.parse(query('select '+TEMPLATE_TABLE_EXPRESSION+';',database));assertTemplateTable(table);
 assert.equal(query('select value from public.template_protected;',database),'unchanged');
 const after=JSON.parse(query("select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations;",database));
 assert.deepEqual(after.slice(0,-1),registry);assert.deepEqual(after.at(-1),{version:TEMPLATE_SCHEMA.version,name:TEMPLATE_SCHEMA.name});
 const row=`('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Synthetic','娱乐','{"desktop":[],"mobile":[]}',1,1,'00000001','plan-3')`;
 for(const role of ['anon','authenticated'])for(const statement of ['select * from public.website_templates;',`insert into public.website_templates(id,revision,name,category,design,desktop_page_count,mobile_page_count,source_site_id,source_plan_id) values ${row};`,"update public.website_templates set name='denied';",'delete from public.website_templates;']){
  const r=run('set role '+role+';'+statement,database);assert.notEqual(r.status,0);assert.match(r.stderr,/42501/);
 }
 query('set role service_role;insert into public.website_templates(id,revision,name,category,design,desktop_page_count,mobile_page_count,source_site_id,source_plan_id) values '+row+';',database);
 assert.equal(query("set role service_role;select name from public.website_templates;",database),'Synthetic');
 assert.equal(query("set role service_role;with changed as(update public.website_templates set name='New' where revision='33333333-3333-4333-8333-333333333333' returning id)select count(*)from changed;",database),'0');
 const replay=run('set role supabase_admin;'+guarded,database);assert.notEqual(replay.status,0);
 assert.equal(query('select count(*) from public.website_templates;',database),'1');
 console.log('[website-template-postgres] PASS: atomic DDL, exact schema, private ACL/RLS, role boundaries, CAS, replay refusal and unrelated data preserved');
 return {passed:true,database,productionModified:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)runTemplatePostgresAcceptance();
