// Local owner-only template acceptance inside the established owned namespace.
// Only merchant/settings fixture rows are seeded; every template uses119's RPC.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),rpc='faolla_attendance_shift_templates_v1';
const migrationName='202610030119_merchant_attendance_shift_templates.sql';
const templateTables=Object.freeze(['merchant_attendance_shift_templates','merchant_attendance_shift_template_operations']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'shift templates install and reapply with preserved owner/ACL/index and no pre-created template or attendance data',
  'shift templates actual owner RPC saves, updates and archives with immutable original command snapshots',
  'shift templates list every active/archived UUID once with20-row pages and exact unknown-operation null receipts',
  'shift templates paused GET and exact original POST replay preserve old snapshots without repeating writes',
  'shift templates current-owner authorization and same-actor receipts reject cross-tenant and reused operations',
  'shift templates reject stale revisions, archived edits, missing targets and malformed daily patterns without writes',
  'shift templates enforce100 active maximum and allow archive to free a slot; settings-lock structure is not a two-connection race test',
  'shift templates browser execute and all direct table privileges remain denied, with append-only receipts',
  'shift templates all reads preserve full facts; writes touch only the two new tables and rollback probes restore the baseline',
]);
let phase='entry';
export const shiftTemplatesQueryInput=(patch={})=>({siteId:site,view:'active',cursorId:null,operationId:null,...patch});
export const shiftTemplateNativeCommand=(n,patch={})=>({operationId:id(n),templateId:id(n),expectedRevision:0,action:'save',template:{name:`Synthetic daily pattern ${n}`,segments:[{start:'08:00',end:'12:00',nextDay:false},{start:'13:00',end:'17:00',nextDay:false}]},...patch});
const expression=(query=shiftTemplatesQueryInput(),command=null,allow=false,actor=owner)=>
  `public.${rpc}(${typeof query==='string'?query:json(query)},'${actor}',${typeof command==='string'?command:json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'shift_templates_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;

export function shiftTemplatesNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_version_conflict',
    'attendance_operation_conflict','attendance_platform_paused','attendance_template_archived','attendance_template_limit','attendance_not_available',
    'merchant_attendance_shift_templates_prerequisite_required','merchant_attendance_shift_templates_installation_conflict']);
  return {error:'shift_templates_native_failed',phase,code:allowed.has(code)?code:'local_check_failed',
    sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function shiftTemplatesMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));
  return {name:migrationName,source,body,statement};
}
function guardFor(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid} and n.nspname=${quote(owned.schema)}
    and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'shift_templates_owned_schema_required';end if;end;$owned$;`;
}
export function shiftTemplatesNativePlan(owned,tables){
  const guard=guardFor(owned);assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  assert(tables.includes('merchants')&&tables.includes('merchant_attendance_settings'));
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const seed=`begin;reset role;${guard}do $fresh$ begin assert not exists(select 1 from public.merchants),'shift_templates_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);commit;`;
  return {site,foreign,owner,other,guard,seed,fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!templateTables.includes(t))),labels:[...labels]};
}

export async function prepareShiftTemplatesNativeFixture(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=s=>native.query(scope.sql(s)),owned=assertLifecycleSandbox(raw);assert.equal(owned.schema,scope.schema);const guard=guardFor(owned);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'shift_templates_namespace_changed');
    const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);};
  const migration=shiftTemplatesMigrationPlan(native.root,scope);exec(migration.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=shiftTemplatesNativePlan(owned,inventory());
  const fingerprint=()=>exec(`select ${shiftTemplatesNativePlan(owned,inventory()).fingerprint};`);
  const protectedFingerprint=()=>exec(`select ${shiftTemplatesNativePlan(owned,inventory()).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl,
    'index',pg_get_indexdef('public.attendance_shift_templates_list_idx'::regclass),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid='public.merchant_attendance_shift_template_operations'::regclass and not t.tgisinternal))
    from pg_proc p where p.oid='public.${rpc}(jsonb,uuid,jsonb,boolean)'::regprocedure;`);
  const facts=fingerprint(),definition=installed();exec(migration.body);assert.equal(installed(),definition,'shift_templates_reapply_changed_owner_acl_index');assert.equal(fingerprint(),facts,'shift_templates_reapply_changed_facts');
  phase='minimal-owned-seed';exec(plan.seed);
  const call=(query=shiftTemplatesQueryInput(),command=null,allow=false,actor=owner)=>JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`));
  return {site,foreign,owner,other,exec,sql:scope.sql,owned,queryInput:shiftTemplatesQueryInput,command:shiftTemplateNativeCommand,call,
    read:(patch={})=>call(shiftTemplatesQueryInput(patch)),fingerprint,protectedFingerprint,plan,syntheticOnly:true};
}

export async function checkAttendanceShiftTemplatesNative(native,scope){
  const data=await prepareShiftTemplatesNativeFixture(native,scope),{exec,plan,call}=data;phase='actual-owner-commands';
  const protectedBefore=data.protectedFingerprint(),empty=data.read();assert.deepEqual(empty,{siteId:site,view:'active',items:[],nextCursor:null,receipt:null});
  const originals=new Map();
  for(let n=1001;n<=1025;n++){
    const command=shiftTemplateNativeCommand(n),result=call(shiftTemplatesQueryInput(),command,true);
    assert.deepEqual(result.receipt.command,command);assert.equal(result.receipt.item.templateId,id(n));assert.equal(result.receipt.item.revision,1);assert.equal(result.receipt.item.archived,false);
    assert.match(result.receipt.item.updatedAt,/\.\d{6}Z$/);originals.set(id(n),result.receipt);
  }
  const update=shiftTemplateNativeCommand(2001,{templateId:id(1001),expectedRevision:1,template:{name:'Synthetic overnight pattern',segments:[{start:'22:00',end:'06:00',nextDay:true}]}});
  const updated=call(shiftTemplatesQueryInput(),update,true);assert.deepEqual(updated.receipt.command,update);assert.equal(updated.receipt.item.revision,2);
  const archive=shiftTemplateNativeCommand(2002,{templateId:id(1001),expectedRevision:2,action:'archive',template:null});
  const archived=call(shiftTemplatesQueryInput(),archive,true);assert.equal(archived.receipt.item.revision,3);assert.equal(archived.receipt.item.archived,true);assert.deepEqual(archived.receipt.item.template,update.template);
  assert.equal(data.protectedFingerprint(),protectedBefore,'shift_templates_writes_touched_old_business_tables');
  const baseline=data.fingerprint();phase='read-and-recovery';
  const all=[];let cursor=null,pages=0;
  do{const result=data.read({cursorId:cursor});assert(++pages<=2);assert.equal(result.receipt,null);all.push(...result.items.map(r=>r.templateId));cursor=result.nextCursor;}while(cursor);
  assert.deepEqual(all,Array.from({length:24},(_,n)=>id(1025-n)));assert.equal(pages,2);
  assert.deepEqual(data.read({view:'archived'}).items,[archived.receipt.item]);
  assert.equal(data.read({operationId:id(9999)}).receipt,null);
  for(const [command,expected] of [[shiftTemplateNativeCommand(1001),originals.get(id(1001))],[update,updated.receipt],[archive,archived.receipt]]){
    assert.deepEqual(data.read({operationId:command.operationId}).receipt,expected);
    assert.deepEqual(call(shiftTemplatesQueryInput(),command,false).receipt,expected);
  }
  assert.equal(data.fingerprint(),baseline,'shift_templates_reads_or_replays_changed_facts');
  const rollbackCheck=(setup,checks)=>`begin;reset role;${plan.guard}${setup}
    create temp table templates_before(value text) on commit drop;insert into templates_before values(${plan.fingerprint});
    set local role service_role;do $check$ declare a jsonb;b jsonb;begin ${checks} end;$check$;reset role;
    do $unchanged$ begin assert (select value from templates_before)=${plan.fingerprint},'shift_templates_rejection_or_read_changed_facts';end;$unchanged$;rollback;`;
  exec(rollbackCheck('',denied('attendance_platform_paused',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(3001),false))+
    denied('attendance_operation_conflict',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(1002,{template:{name:'Different command',segments:[{start:'09:00',end:'17:00',nextDay:false}]}}),false))+
    denied('attendance_version_conflict',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(3002,{templateId:id(1002),expectedRevision:2}),true))+
    denied('attendance_template_archived',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(3003,{templateId:id(1001),expectedRevision:3}),true))+
    denied('attendance_template_archived',expression(shiftTemplatesQueryInput(),{...archive,operationId:id(3004),expectedRevision:3},true))+
    denied('attendance_not_available',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(3005,{templateId:id(9999),expectedRevision:1}),true))+
    denied('attendance_access_denied',expression(shiftTemplatesQueryInput(),null,false,other))+
    denied('attendance_access_denied',expression(shiftTemplatesQueryInput({siteId:foreign}),null,false,owner))));
  exec(rollbackCheck(`update public.merchants set user_id='${other}' where id='${site}';`,
    denied('attendance_access_denied',expression(shiftTemplatesQueryInput({operationId:id(1002)})))+
    `a:=${expression(shiftTemplatesQueryInput({operationId:id(1002)}),null,false,other)};assert a->'receipt'='null'::jsonb,'new owner must not read former actor receipt';`+
    denied('attendance_operation_conflict',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(1002),false,other))));
  exec(rollbackCheck(`insert into public.merchants(id,user_id) values('99990003','${owner}');`,denied('attendance_settings_required',expression(shiftTemplatesQueryInput({siteId:'99990003'})))));
  const invalidQueries=[null,{}, {...shiftTemplatesQueryInput(),extra:1},{...shiftTemplatesQueryInput(),view:'all'},
    {...shiftTemplatesQueryInput(),cursorId:1},{...shiftTemplatesQueryInput(),cursorId:id(1002),operationId:id(1002)}];
  const invalidTemplates=[{name:' leading',segments:[{start:'08:00',end:'09:00',nextDay:false}]},{name:'x\u0085',segments:[{start:'08:00',end:'09:00',nextDay:false}]},
    {name:'x',segments:[]},{name:'x',segments:[{start:'24:00',end:'01:00',nextDay:true}]},
    {name:'x',segments:[{start:'08:00',end:'08:00',nextDay:false}]},{name:'x',segments:[{start:'08:00',end:'09:00',nextDay:true}]},
    {name:'x',segments:[{start:'10:00',end:'12:00',nextDay:false},{start:'09:00',end:'10:00',nextDay:false}]},
    {name:'x',segments:[{start:'08:00',end:'12:00',nextDay:false},{start:'11:00',end:'14:00',nextDay:false}]},
    {name:'x',segments:[{start:'22:00',end:'06:00',nextDay:true},{start:'23:00',end:'23:30',nextDay:false}]},
    {name:'x',segments:[{start:'08:00',end:'09:00',nextDay:'false'}]},
    {name:'x',segments:[{start:'08:00',end:'09:00',nextDay:false,paid:true}]},
    {name:'x',segments:[{start:'08:00',end:'09:00',nextDay:false}],weekdays:[1]}];
  const invalidCommands=[{...shiftTemplateNativeCommand(4001),extra:1},{...shiftTemplateNativeCommand(4001),templateId:id(4002)},
    {...shiftTemplateNativeCommand(4001),expectedRevision:1.5},{...shiftTemplateNativeCommand(4001),expectedRevision:9007199254740990},
    {...shiftTemplateNativeCommand(4001),action:'archive',template:null},{...archive,template:update.template},
    ...invalidTemplates.map(template=>shiftTemplateNativeCommand(4001,{template}))];
  exec(rollbackCheck('',invalidQueries.map(q=>denied('attendance_invalid_request',expression(q))).join('\n')+
    invalidCommands.map(c=>denied('attendance_invalid_request',expression(shiftTemplatesQueryInput(),c,true))).join('\n')+
    denied('attendance_invalid_request',expression(shiftTemplatesQueryInput({cursorId:id(1002)}),shiftTemplateNativeCommand(4001),true))+
    denied('attendance_invalid_request',expression(shiftTemplatesQueryInput(),null,null))));
  phase='bounded-capacity-rollback';
  const capacityWrite=range=>`set local role service_role;do $fill$ begin ${range.map(n=>`perform ${expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(n),true)};`).join('\n')}end;$fill$;reset role;`;
  await native.querySteps([`begin;reset role;${plan.guard}`,capacityWrite(Array.from({length:40},(_,n)=>5000+n)),capacityWrite(Array.from({length:36},(_,n)=>5040+n)),
    `set local role service_role;do $capacity$ declare a jsonb;begin
      ${denied('attendance_template_limit',expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(5076),true))}
      perform ${expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(6001,{templateId:id(5000),expectedRevision:1,action:'archive',template:null}),true)};
      a:=${expression(shiftTemplatesQueryInput(),shiftTemplateNativeCommand(5076,{template:{name:'Full day boundary',segments:[{start:'08:00',end:'08:00',nextDay:true}]}}),true)};
      assert a->'receipt'->'item'->>'revision'='1','archive frees one active slot';end;$capacity$;reset role;
      do $count$ begin assert (select count(*) from public.merchant_attendance_shift_templates where merchant_id='${site}' and not archived)=100,'exact active capacity';
      assert ${plan.protectedFingerprint}=${quote(protectedBefore)},'capacity touched old business';end;$count$;rollback;`].map(scope.sql));
  assert.equal(data.fingerprint(),baseline,'shift_templates_capacity_not_rolled_back');phase='acl-and-immutability';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression()};raise exception 'shift_templates_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${templateTables.map(t=>`assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'shift_templates_direct_privilege_allowed';
    begin perform 1 from public.${t};raise exception 'shift_templates_private_select_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$tables$;`);
  exec(`begin;reset role;${plan.guard}do $immutable$ begin
    begin update public.merchant_attendance_shift_template_operations set recorded_at=recorded_at where merchant_id='${site}';raise exception 'shift_templates_receipt_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.merchant_attendance_shift_template_operations where merchant_id='${site}';raise exception 'shift_templates_receipt_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.merchant_attendance_shift_template_operations;raise exception 'shift_templates_receipt_truncate_allowed';exception when insufficient_privilege then null;end;
    end;$immutable$;rollback;`);
  assert.equal(data.fingerprint(),baseline,'shift_templates_checks_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'shift_templates_checks_touched_old_tables');
  for(const label of labels)native.pass(label);return {checks:labels.length,active:24,archived:1,receipts:27,scenarioChangesRolledBack:true,syntheticOnly:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceShiftTemplatesNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceShiftTemplatesNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  runAttendanceShiftTemplatesNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(shiftTemplatesNativeFailure(error)));process.exitCode=1;});
}
