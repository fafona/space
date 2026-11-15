// Fails closed outside one disposable GitHub-hosted PostgreSQL service.
import {execFileSync,execFile} from 'node:child_process';import{promisify}from'node:util';import fs from'node:fs';
import assert from'node:assert/strict';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.FAOLLA_GUEST_CHAT_DISPOSABLE_DB,'1');
const args=['-X','--set','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U','postgres','-d','faolla_guest_chat_test','-qAt'];
const options={encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,PGPASSFILE:'/dev/null'}};
const run=sql=>execFileSync('psql',[...args,'-c',sql],options).trim();
assert.equal(run('select current_database() || \'|\' || current_user;'),'faolla_guest_chat_test|postgres');
run('create role anon;create role authenticated;create role service_role bypassrls;create table public.faolla_schema_migrations(version bigint primary key,name text not null);');
run(fs.readFileSync('scripts/supabase-migrations/202611160215_merchant_guest_chat.sql','utf8'));
run(fs.readFileSync('scripts/guest-chat-db-acceptance.sql','utf8'));
run("select public.merchant_guest_chat_create_session(repeat('d',64),repeat('4',64));");
const command="select public.merchant_guest_chat_send('99990001',null,repeat('d',64),'guest','11111111-1111-4111-8111-111111111111','concurrent-safe',null);";
await Promise.all(Array.from({length:6},()=>promisify(execFile)('psql',[...args,'-c',command],options)));
assert.equal(run("select count(*) from public.merchant_guest_chat_messages where text='concurrent-safe';"),'1');
assert.equal(run("set role service_role;select count(*)>0 from public.merchant_guest_chat_messages;reset role;"),'t');
console.log('Guest chat PostgreSQL: all SQL/ACL assertions and six-process idempotency passed.');
