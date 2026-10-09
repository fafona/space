//200 SOURCE-only, finite exact forward recipes. No process/database/network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const sha=s=>createHash('sha256').update(s).digest('hex');
const read=(root,name)=>readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8').replaceAll('\r\n','\n');
export const cycleExtract=(sql,name)=>{const b=sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\s*\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,'i'))?.[1];assert(b,'cycle_source_required:'+name);return b;};
export function cycleApply(body,changes,name){for(const {from,to,count=1}of changes){assert.equal(body.split(from).length-1,count,name+':exact replacement count');body=body.replaceAll(from,to);}return body;}
export function cycleForwardRecipes(root){
 const file183='202610080183_merchant_attendance_period_continuation.sql',file187='202610080187_merchant_attendance_period_delegated_closure.sql';
 const recipes=[];
 const add=(file,name,oldHash,core,changes)=>{const original=cycleExtract(read(root,file),name);assert.equal(sha(original),oldHash,name+':pinned predecessor');
  const modified=cycleApply(original,changes,name);const wrapper=core?`\nbegin\n return public.${core}(p_query,p_auth_user_id,p_command,p_artifact,p_allow_write,null);\nend;\n`:modified;
  recipes.push({file,name,types:'jsonb,uuid,jsonb,jsonb,boolean',oldHash,core,coreHash:core?sha(modified):null,newHash:sha(wrapper),changes,wrapper});};
 const gate=(intent,delegate)=>`      if is_new then perform public.faolla_attendance_cycle_gate_v1(site,wid,p_auth_user_id,access_name,${delegate?'gid':'null'},first_day,last_day,source_result,${intent});\n      elsif ${intent} is not null then raise exception 'attendance_operational_cycle_changed';end if;\n`;
 const sourceOwner='      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);';
 const sourceDelegate='      source_result:=public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid);';
 // The v1 source statement occurs in confirm/seal too: only the first send
 // occurrence is replaced using its following unique comment marker.
 const ownerMarker=sourceOwner+'\n      --179 also blocks relevant unresolved outage reviews before a fresh send.';
 const delegateMarker=sourceDelegate+'\n      --179 also blocks relevant unresolved outage reviews before a fresh send.';
 const entryMarker='      confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=site and period_id=pid;';
 add(file183,'faolla_attendance_period_closure_v1','641b80264cb76a9f839950e443a7c1d6f43a0bc4f235250bcee8b145e7c69395',null,[
  {from:ownerMarker,to:sourceOwner+'\n'+gate('null',false)+'      --179 also blocks relevant unresolved outage reviews before a fresh send.'}]);
 add(file183,'faolla_attendance_period_closure_v2','f1ba65e23279139e9c95cfc5d9acecf2eb330917d59f5e41b681cbb8b35a5807','faolla_attendance_cycle_core_owner_v2',[
  {from:ownerMarker,to:sourceOwner+'\n'+gate('p_intent',false)+'      --179 also blocks relevant unresolved outage reviews before a fresh send.'},
  {from:entryMarker,to:entryMarker+'\n    if is_new and action_name=\'send\' then perform public.faolla_attendance_cycle_link_v1(p_query,p_auth_user_id,p_command,p_intent);end if;'}]);
 add(file187,'faolla_attendance_period_delegated_closure_v1','3b758e5710ba7e432c15064c4da91a124b9ef55a23bd51bc674c72ec822886d0','faolla_attendance_cycle_core_delegate_v1',[
  {from:delegateMarker,to:sourceDelegate+'\n'+gate('p_intent',true)+'      --179 also blocks relevant unresolved outage reviews before a fresh send.'},
  {from:"    if receipt_value is null then raise exception 'attendance_period_delegation_invalid';end if;",to:"    if receipt_value is null then raise exception 'attendance_period_delegation_invalid';end if;\n    if is_new and action_name='send' then perform public.faolla_attendance_cycle_link_v1(p_query,p_auth_user_id,p_command,p_intent);end if;"}]);
 const file194='202610080194_merchant_attendance_application_window.sql',name='faolla_attendance_operational_consumer_activation_v1';
 const original=cycleExtract(read(root,file194),name);assert.equal(sha(original),'d4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d',name+':194 pin');
 const before=cycleApply(original,[{from:"kind<>'application_window' or not p_allow_activate or not s.enabled",to:"kind not in('application_window','review_routing') or not p_allow_activate or not s.enabled"},
  {from:"kind='application_window' and p_allow_activate and s.enabled",to:"kind in('application_window','review_routing') and p_allow_activate and s.enabled"}],name);
 assert.equal(sha(before),'3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144',name+':198 current pin');
 const changes=[{from:"kind not in('application_window','review_routing')",to:"kind not in('application_window','review_routing','timesheet_cycle')"},
  {from:"kind in('application_window','review_routing')",to:"kind in('application_window','review_routing','timesheet_cycle')"}];
 const after=cycleApply(before,changes,name);recipes.push({file:file194,name,types:'jsonb,uuid,jsonb,boolean',oldHash:sha(before),core:null,coreHash:null,newHash:sha(after),changes,wrapper:after});
 //195 legitimately forwards six of the seventeen dependencies verified by
 //184's private delegated collector. Keep that collector and every guard
 //unchanged; refresh only its six exact saved body pins, never old/new ORs.
 const delegatedFile='202610080184_merchant_attendance_period_delegated_source.sql',delegatedName='faolla_attendance_period_delegated_source_v1';
 const delegated=cycleExtract(read(root,delegatedFile),delegatedName);
 assert.equal(sha(delegated),'0108f90d9092d374ffd35265b0e82b88a6c24239cdd89a5eaf3dbb7586b97749',delegatedName+':184 pin');
 const pins=[
  ['faolla_attendance_shift_check_v1','54632325e0d569c9835dfadc628632115c2f13a86c0466e852906a3f426bcfb0','e08de457e5288513a0b53b8ed705fa4fe4369b0f5d81757c64dd93e935070956'],
  ['faolla_attendance_period_report_v2','9c98806622a8f997ced37f7e83aaf548bd3ca04524ce55775c2828ba3639f389','ca4922cc69e1549559852731a0a480453efc79ad357ce6263822c9d17fc30d0c'],
  ['faolla_attendance_period_closure_report_v1','7b5afdd059188deb1edd06668b308b4830b1937b4ca904f90e527535660001bf','a5bb3f899956b4180af063e2599772fd8841268e09a0ead7f896ccfb34a188e4'],
  ['faolla_attendance_period_source_v1','9bb7f3abfaf07c110b33286950d347bab5b94874a35a6d459aef409bf341d4ca','8dfbf0caff5c44a3c2af91b476d6eabcf66b12b1abd8543d658bf1b921d1d29e'],
  ['faolla_attendance_period_closure_source_base_v1','512322083cd3b668f41d44322dec10f65b322388c8c4a470f34c5c691ba9eeb1','36a8dc6972a19c674d03ac99563bc5d082cd83bfb14473c5ed6be8ce700f0d07'],
  ['faolla_attendance_period_closure_source_v1','a89321433586376f607a9277306803ff363f43d07b157a1bc40f7aaf08be0f24','f8e5831cc525021f0c26e833128bdcb2ec602bf7ad93289101440c3eb3061b3b'],
 ];
 const administrative=JSON.parse(read(root,'202610080195_merchant_attendance_administrative_closure.sql').match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 const profileChanges=pins.map(([name,from,to])=>{const saved=administrative.find(r=>r.name===name);assert(saved,name+':195 recipe required');assert.equal(saved.oldHash,from);assert.equal(saved.newHash,to);return {from,to,count:1};});
 const profile=cycleApply(delegated,profileChanges,delegatedName);
 recipes.push({file:delegatedFile,name:delegatedName,types:'text,uuid,uuid,uuid,uuid,date,date,uuid',oldHash:sha(delegated),core:null,coreHash:null,newHash:sha(profile),changes:profileChanges,wrapper:profile});
 assert.equal(recipes.length,5);return recipes;
}
export function cycleForwardSql(recipes){return `do $cycle_forward$
declare recipe jsonb;change_value jsonb;f regprocedure;source_value text;new_source text;ns text;owner_id oid;def text;before_fn pg_proc%rowtype;after_fn pg_proc%rowtype;
begin
 select n.nspname,c.relowner into ns,owner_id from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for recipe in select value from jsonb_array_elements($cycle_recipes$${JSON.stringify(recipes,null,2)}$cycle_recipes$::jsonb) loop
  recipe:=replace(recipe::text,ns||'.','pub'||'lic.')::jsonb;
  f:=to_regprocedure('public.'||(recipe->>'name')||'('||(recipe->>'types')||')');
  select * into before_fn from pg_proc where oid=f;
  select replace(replace(prosrc,E'\\r\\n',E'\\n'),ns||'.','pub'||'lic.') into source_value from pg_proc where oid=f;
  if encode(sha256(convert_to(source_value,'UTF8')),'hex')=recipe->>'newHash' then continue;end if;
  if encode(sha256(convert_to(source_value,'UTF8')),'hex') is distinct from recipe->>'oldHash' then raise exception 'merchant_attendance_cycle_installation_conflict';end if;
  new_source:=source_value;
  for change_value in select value from jsonb_array_elements(recipe->'changes') loop
   if (length(new_source)-length(replace(new_source,change_value->>'from','')))/length(change_value->>'from')<>coalesce((change_value->>'count')::integer,1) then raise exception 'merchant_attendance_cycle_installation_conflict';end if;
   new_source:=replace(new_source,change_value->>'from',change_value->>'to');
  end loop;
  if recipe->>'core' is not null then
   if encode(sha256(convert_to(new_source,'UTF8')),'hex') is distinct from recipe->>'coreHash' then raise exception 'merchant_attendance_cycle_installation_conflict';end if;
   execute format('create function %I.%I(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_artifact jsonb,p_allow_write boolean,p_intent jsonb) returns jsonb language plpgsql set search_path=pg_catalog as %L',ns,recipe->>'core',replace(new_source,'pub'||'lic.',ns||'.'));
   execute format('alter function %I.%I(jsonb,uuid,jsonb,jsonb,boolean,jsonb) owner to %I',ns,recipe->>'core',pg_get_userbyid(owner_id));
   new_source:=recipe->>'wrapper';
  end if;
  if encode(sha256(convert_to(new_source,'UTF8')),'hex') is distinct from recipe->>'newHash' then raise exception 'merchant_attendance_cycle_installation_conflict';end if;
  def:=pg_get_functiondef(f);
  execute replace(def,(select prosrc from pg_proc where oid=f),replace(new_source,'pub'||'lic.',ns||'.'));
  select * into after_fn from pg_proc where oid=to_regprocedure('public.'||(recipe->>'name')||'('||(recipe->>'types')||')');
  if after_fn.oid is distinct from before_fn.oid or row(after_fn.proowner,after_fn.proacl,after_fn.proargtypes,after_fn.proargnames,after_fn.proargmodes,after_fn.pronargdefaults,
   after_fn.proconfig,after_fn.prosecdef,after_fn.provolatile,after_fn.prolang,after_fn.prorettype,after_fn.proretset,after_fn.proisstrict,after_fn.proleakproof,after_fn.prokind,after_fn.proparallel)
   is distinct from row(before_fn.proowner,before_fn.proacl,before_fn.proargtypes,before_fn.proargnames,before_fn.proargmodes,before_fn.pronargdefaults,
   before_fn.proconfig,before_fn.prosecdef,before_fn.provolatile,before_fn.prolang,before_fn.prorettype,before_fn.proretset,before_fn.proisstrict,before_fn.proleakproof,before_fn.prokind,before_fn.proparallel)
   or pg_get_expr(after_fn.proargdefaults,0) is distinct from pg_get_expr(before_fn.proargdefaults,0) then raise exception 'merchant_attendance_cycle_installation_conflict:forward_metadata:%',recipe->>'name';end if;
 end loop;
end;
$cycle_forward$;`;}
