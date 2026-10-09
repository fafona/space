// SOURCE-only recipes. Reads reviewed local source; no database/process/network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const sha=s=>createHash('sha256').update(s).digest('hex');
const read=(root,name)=>readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8').replaceAll('\r\n','\n');
const extract=(sql,name)=>{const body=sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\s*\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,'i'))?.[1];assert(body,'independent_forward_source_required:'+name);return body;};
const change=(body,changes,name)=>{for(const c of changes){assert.equal(body.split(c.from).length-1,c.count,name+':exact replacement count');body=body.replaceAll(c.from,c.to);}return body;};
export function independentWorkerForwardRecipes(root){
 const sql193=read(root,'202610080193_merchant_attendance_operational_punch.sql'),sql195=read(root,'202610080195_merchant_attendance_administrative_closure.sql');
 const punch=JSON.parse(sql193.match(/\$punch_recipes\$([\s\S]*?)\$punch_recipes\$/)[1]);
 const administrative=JSON.parse(sql195.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 const cores=new Map();
 for(const r of punch){const original=extract(read(root,r.file),r.name);assert.equal(sha(original),r.originalHash,r.name+':193 original');
  const modified=change(original,r.changes,r.name);assert.equal(sha(modified),r.core?r.coreHash:r.wrapperHash,r.core??r.name);cores.set(r.core??r.name,{body:modified,types:r.core?r.types+',jsonb':r.types});}
 for(const r of administrative){if(!cores.has(r.name))continue;const before=cores.get(r.name);assert.equal(before.types,r.types,r.name+':195 exact signature');assert.equal(sha(before.body),r.oldHash,r.name+':195 original');
  const body=change(before.body,r.changes,r.name);assert.equal(sha(body),r.newHash,r.name+':195 final');cores.set(r.name,{...before,body});}
 const result=[];
 const add=(name,changes)=>{const c=cores.get(name);assert(c,name);const body=change(c.body,changes,name);result.push({name,types:c.types,oldHash:sha(c.body),newHash:sha(body),changes});};
 const one=(from,to)=>({from,to,count:1});
 add('faolla_attendance_operational_punch_core_self_v1',[one(
  'if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id then',
  'if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,v_last.id,v_last.sequence,p_command,p_operation_id) then')]);
 for(const name of ['faolla_attendance_operational_punch_core_pin_v1','faolla_attendance_pin_schedule_v1'])add(name,[one(
  'if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then',
  "if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id\n      and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site,w.id,w.employee_id,(select auth_user_id from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id),last_row.id,last_row.sequence,c,case when c is null then op else null end) then")]);
 add('faolla_attendance_operational_punch_core_onsite_v1',[one(
  'if last_row.id is not null and last_row.actor_employee_id is distinct from e.id\n    then',
  'if last_row.id is not null and last_row.actor_employee_id is distinct from e.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site,w.id,e.id,p_auth,last_row.id,last_row.sequence,p_command,p_operation)\n    then')]);
 add('faolla_attendance_operational_punch_core_location_v1',[one(
  'v_sequence:=coalesce(v_last.sequence,0);',
  "if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,v_last.id,v_last.sequence,p_command,p_operation_id) then raise exception 'attendance_access_denied';end if;\n  v_sequence:=coalesce(v_last.sequence,0);")]);
 add('faolla_attendance_operational_punch_core_location_v2',[
  one('null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null,p_intent)',
   "null,case when p_command->>'action'='clock_in' and public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,w.id,e.id,p_auth_user_id,(select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=w.id order by sequence desc limit 1),(select sequence from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=w.id order by sequence desc limit 1),p_command,null) then null else op end,null,p_allow_new_sessions,p_require_clock or p_command is not null,p_intent)"),
  one('if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id then',
   'if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,w.id,e.id,p_auth_user_id,last_fact.id,last_fact.sequence,p_command,p_operation_id) then')]);
 const headName='faolla_attendance_operating_head_v1',head=extract(sql195,headName),headChanges=[one(
  "if b is not null then v:=v||jsonb_build_object('administrativeBoundary',b);end if;return v;",
  "if b is not null then v:=v||jsonb_build_object('administrativeBoundary',b);end if;\n b:=public.faolla_attendance_independent_current_boundary_v1(p_site,p_worker);\n if b is not null then v:=v||jsonb_build_object('independentBindingBoundary',b);end if;return v;")];
 result.push({name:headName,types:'text,uuid',oldHash:sha(head),newHash:sha(change(head,headChanges,headName)),changes:headChanges});
 assert.equal(result.length,7);return result;
}
