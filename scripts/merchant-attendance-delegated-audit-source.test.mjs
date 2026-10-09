import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {managementDelegationMigration} from './merchant-attendance-management-delegation-source.mjs';
import {delegatedAuditApplyForward,delegatedAuditFreezeSql,delegatedAuditInstallRecipe,delegatedAuditLimits,delegatedAuditMigration,delegatedAuditOwnManifest,delegatedAuditTable} from './merchant-attendance-delegated-audit-source.mjs';

const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'supabase-migrations');
const sql=readFileSync(path.join(directory,delegatedAuditMigration),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<delegatedAuditMigration).sort().map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
const foundation=migrations.find(m=>m.name===managementDelegationMigration).text;
const recipe=delegatedAuditInstallRecipe(sql,migrations);
const bodies=new Map(dayReviewSqlFunctions(sql).map(f=>[f.name,f.body]));
const body=name=>{assert(bodies.has(name));return bodies.get(name);};
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');

test('203 mechanical SOURCE freeze is exact and idempotent; no install side effect',()=>{
 assert.equal(delegatedAuditFreezeSql(sql,migrations),sql);
 assert.equal(delegatedAuditFreezeSql(delegatedAuditFreezeSql(sql,migrations),migrations),sql);
 assert(!sql.includes('source_not_frozen'));
 assert.equal(recipe.recipeHash.length,64);
 const generator=readFileSync(new URL('./merchant-attendance-delegated-audit-source.mjs',import.meta.url),'utf8');
 assert(!/child_process|createConnection|new Pool|pg_ctl|psql|supabase\.rpc/.test(generator));
 assert(generator.includes("assert.deepEqual(process.argv.slice(2),['--write']"));
});
test('203 has one new private table and exactly nine pinned own functions',()=>{
 assert.equal((sql.match(/^create table if not exists public\./gm)||[]).length,1);
 assert.equal(delegatedAuditOwnManifest(sql).length,9);
 assert.equal(recipe.own.filter(f=>f.isRpc).length,1);
 const rpc=recipe.own.find(f=>f.isRpc);
 assert.deepEqual(rpc.args,['p_query','p_auth_user_id','p_command','p_allow_access']);
 assert.equal(rpc.defaultExpression,'NULL::jsonb, false');
 assert.equal(rpc.definer,true);
 for(const f of recipe.own)assert.equal(f.hash,sha(body(f.name)));
 assert(sql.includes(`revoke all on public.${delegatedAuditTable} from public,anon,authenticated,service_role`));
 assert(sql.includes(`alter table public.${delegatedAuditTable} enable row level security`));
});
test('203 sole shared function forward is exact audit_export branch; other families still reject',()=>{
 const f=recipe.forwardRecipe;
 assert.equal(f.name,'faolla_attendance_management_insert_v1');
 assert.equal(delegatedAuditApplyForward(f.oldBody,f),f.newBody);
 assert.equal(f.newBody.replace(f.to,f.from),f.oldBody);
 assert(f.to.includes("new.delegated_action='audit_export'"));
 assert(f.to.includes('faolla_attendance_management_audit_authority_v1(new);return new;'));
 assert(f.to.includes("raise exception 'attendance_management_executor_unavailable'"));
 assert.throws(()=>delegatedAuditApplyForward(f.oldBody+' ',f));
 assert.throws(()=>delegatedAuditInstallRecipe(sql,migrations.map(m=>m.name===managementDelegationMigration?{...m,text:m.text.replace(f.from,f.from.replace('executor_unavailable','executor_unavailable_changed'))}:m)));
 assert(!/create or replace function public\.faolla_attendance_(?:audit_v1|audit_export_v1|config_v1|scopes_v1)\(/.test(sql));
});
test('203 preflight pins all202 functions plus old whitelist/hash guards and metadata',()=>{
 assert.equal(recipe.dependencies.length,16);
 assert(recipe.dependencies.some(f=>f.name==='faolla_attendance_audit_value_v1'));
 assert(recipe.dependencies.some(f=>f.name==='faolla_attendance_management_delegations_v1'&&f.isRpc));
 for(const needle of ['proowner','prosecdef','proconfig','provolatile','proargnames','proargdefaults','proacl','proparallel','prosupport','newHash','audit_forward_metadata'])assert(recipe.preflight.includes(needle),needle);
 assert(recipe.preflight.includes("version=202610080202 and name='merchant_attendance_management_delegations'"));
 assert(recipe.final.includes("(to_jsonb(proc)-'prosrc') is distinct from original.metadata"));
});
test('203 table/index/trigger recipe keeps real TEMP FKs and exact c/p/u/f catalog properties',()=>{
 assert(!/references public\./.test(recipe.preflight));
 assert(recipe.preflight.includes('references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id)'));
 assert(recipe.preflight.includes('references pg_temp.management_expected_employees(merchant_id,id)'));
 assert(recipe.tableChecks.includes('actual_constraint.connoinherit'));
 assert(recipe.tableChecks.includes('constraint_spec.connoinherit'));
 assert(!/or actual_constraint\.connoinherit(?:\s|\n)/.test(recipe.tableChecks));
 for(const needle of ['convalidated','confrelid','confkey','confdeltype','indnatts','indnkeyatts','indisunique','indisprimary','indpred','indexprs','indoption','indcollation','indclass','tgenabled','tgfoid','tgname=trigger_spec.name::name'])assert(recipe.tableChecks.includes(needle),needle);
 assert.equal((sql.match(/^create index if not exists /gm)||[]).length,4);
 assert.equal(recipe.parentExtraIndexes.length,2);
 assert(recipe.parentExtraIndexes.every(s=>s.includes('recorded_at desc')&&!s.includes(delegatedAuditTable)));
 assert(!/drop index|reindex|alter index/.test(sql));
});
test('203 original GET and both exact POST recovery paths precede current grant and admission checks',()=>{
 const rpc=body('faolla_attendance_delegated_audit_v1');
 const first=rpc.indexOf("if mode='recover' then"),lock=rpc.indexOf('perform 1 from public.merchants');
 const settings=rpc.indexOf('perform 1 from public.merchant_attendance_settings');
 const second=rpc.indexOf('--After the settings wait');
 const auth=rpc.indexOf('g:=public.faolla_attendance_management_audit_authorize_v1');
 const flag=rpc.indexOf('if p_allow_access is distinct from true');
 assert(first>=0&&lock>first&&settings>lock&&second>settings&&auth>second&&flag>auth);
 assert.equal((rpc.match(/saved\.actor_auth_user_id is distinct from p_auth_user_id or saved\.query is distinct from p_query or saved\.command is distinct from p_command or saved\.command_fingerprint is distinct from fingerprint/g)||[]).length,2);
 const receipt=body('faolla_attendance_management_audit_receipt_v1');
 assert(!receipt.includes('faolla_attendance_management_current_v1'));
 for(const needle of ['original.delegate_auth_user_id is distinct from actor','original.employee_generation','proof.delegate_generation=saved.delegate_generation','proof.business_fingerprint=saved.result_fingerprint','proof.command_fingerprint=saved.command_fingerprint'])assert(receipt.includes(needle),needle);
 const returned=receipt.slice(receipt.indexOf("return jsonb_build_object('operationId'"));
 assert(!/'query'|'command'|'payload'|'rows'|'snapshotText'/.test(returned));
});
test('203 collector bounds each indexed branch, merged sentinel and stable snapshot keyset',()=>{
 assert.deepEqual(delegatedAuditLimits,{days:31,branchRows:1001,mergedRows:1001,projectedRows:1000,page:25,export:250,bytes:1572864});
 const collect=body('faolla_attendance_management_audit_collect_v1');
 assert.equal((collect.match(/limit 1001/g)||[]).length,6);
 //The export branch itself has an as_of column; the function parameter must
 //stay qualified without changing its public signature or snapshot boundary.
 assert.equal((collect.match(/actual\.recorded_at>=from_at and actual\.recorded_at<least\(to_at,faolla_attendance_management_audit_collect_v1\.as_of\)/g)||[]).length,5);
 assert(!collect.includes('least(to_at,as_of)'));
 assert.equal((collect.match(/cursor_id is null or \(actual\.recorded_at,/g)||[]).length,5);
 assert(collect.indexOf("if scanned>1000 then raise exception 'attendance_delegated_audit_too_large'")<collect.indexOf('projected:=public.faolla_attendance_management_audit_project_v1'));
 assert(collect.includes("if mode='export' then raise exception 'attendance_export_too_large'"));
 assert(collect.includes("next_cursor:=jsonb_build_object('recordedAt',rows->24->'item'->'recordedAt','operationId',rows->24->'item'->'operationId')"));
 assert(collect.includes("if result is not null then raise exception 'attendance_delegated_audit_invalid'"));
 assert(collect.includes('octet_length(convert_to(result::text,\'UTF8\'))>1572864'));
});
test('203 worker resource projection never assigns old supervisor or current Auth as historical worker proof',()=>{
 const project=body('faolla_attendance_management_audit_project_v1');
 assert(project.includes("value->'workerIds' is distinct from jsonb_build_array(scope->'workerId') then return null"));
 assert(project.includes("before_value->>'employeeId' is distinct from scope->>'employeeId' then return null"));
 assert(project.includes("holder:=md5('attendance-audit-holder:'||site||':'||(raw->>'employee_id'))"));
 assert(project.includes("'byCurrentOwner',(raw->>'actor_auth_user_id')::uuid=owner"));
 assert(!project.includes("'employeeAuthUserId',"));
 assert(!/jsonb_(?:set|delete)|jsonb_agg/.test(project));
 assert(project.includes('faolla_attendance_audit_value_v1'));
 assert(!project.includes('from public.merchant_attendance_workers'));
});
test('203 exports atomic real snapshot/authority pair; read branches do not write',()=>{
 const rpc=body('faolla_attendance_delegated_audit_v1');
 const earlyReturn=rpc.indexOf("if mode<>'export' then return common");
 const save=rpc.indexOf('insert into public.'+delegatedAuditTable);
 const sidecar=rpc.indexOf('insert into public.merchant_attendance_management_delegation_operations');
 assert(earlyReturn>=0&&save>earlyReturn&&sidecar>save);
 assert.equal((rpc.match(/insert into public\./g)||[]).length,2);
 const insert=body('faolla_attendance_management_audit_insert_v1');
 assert(insert.includes('faolla_attendance_management_audit_collect_v1(new.query,g,new.as_of,owner)'));
 assert(insert.includes('new.result_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(canonical)'));
 const authority=body('faolla_attendance_management_audit_authority_v1');
 assert(authority.includes('saved.employee_generation'));
 assert(authority.includes('saved.result_fingerprint,saved.command_fingerprint,saved.recorded_at'));
 assert(!/update public\.|delete from public\.|truncate /i.test(rpc));
});
test('203 single private canonicalText and proof validation cannot silently omit an invalid saved export',()=>{
 const collect=body('faolla_attendance_management_audit_collect_v1');
 assert(!collect.includes('join public.merchant_attendance_management_delegation_operations proof'));
 assert(collect.includes("perform public.faolla_attendance_management_audit_receipt_v1(site,raw.operation_id,(raw.data->>'actor_auth_user_id')::uuid)"));
 const rpc=body('faolla_attendance_delegated_audit_v1');
 assert(rpc.includes("'snapshotBytes',octet_length(convert_to(canonical::text,'UTF8'))"));
 assert(rpc.includes("octet_length(convert_to(private_wire::text,'UTF8'))>2097152"));
 const output=rpc.slice(rpc.indexOf('private_wire:=common'));
 assert(!output.includes("'payload',payload"));assert(!output.includes('snapshotCanonical'));
 assert(body('faolla_attendance_management_audit_project_v1').includes("'revocationReason',raw->'reason'"));
});
test('203 hash preimage binds exact query and actor; saved fingerprint and source pins change on drift',()=>{
 const hash=body('faolla_attendance_management_audit_hash_v1');
 assert(hash.includes("'attendance-delegated-audit-command-v1',site,actor"));
 for(const key of ['grantId','source','fromAt','toAt'])assert(hash.includes("q->'"+key+"'"));
 assert(hash.includes("c->'action',c->'operationId'"));
 const changed=sql.replace("'attendance-delegated-audit-command-v1',site,actor","'attendance-delegated-audit-command-v2',site,actor");
 assert.notEqual(delegatedAuditInstallRecipe(changed,migrations).recipeHash,recipe.recipeHash);
 assert.equal(foundation.includes("then raise exception 'attendance_management_executor_unavailable';end if;"),true);
});
