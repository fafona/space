// Explicitly approved, data-only repair: fill absent option arrays from the
// matching published block. Never publish as a merchant or refresh timestamps
// in the business snapshot. SQL construction only; the host must independently
// verify the encrypted original backup and ingress/drain evidence.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {guardedProductionBookingActivationSql,isolatedBookingActivationAcceptanceSql} from './booking-handoff-activation.mjs';
import {BOOKING_PROTECTED_SLUGS} from './booking-publication-database.mjs';

const RULES='__merchant_booking_rules__:v1',TENANT='__faolla_booking_persistence__';
const PRODUCTION_SYSTEM='7612049595342295079';
const OPTIONS=Object.freeze(['storeOptions','itemOptions','titleOptions']);
const APPROVED_SITES=Object.freeze([
  'fa95b43be4cf8bb030d85e663324ecc5247c2af6272672bfd4bbc1020b40582b',
  '50f16d5b9b76d75c11c9d08515457a6a57d91152094617dfaccc5889478572fc',
].sort());
export const BOOKING_RULE_REPAIR_ORIGINAL_SHA256='5a8fe1e83b8da318980734438970c7f6f17853cca88a54799ae32c0daa537ed1';
const hex=/^[a-f0-9]{64}(?![\s\S])/,uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error('booking_rule_repair_'+code);};
const need=(v,code)=>{if(!v)fail(code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const canonical=v=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const json=v=>JSON.stringify(canonical(v));
const hash=v=>createHash('sha256').update(v).digest('hex');
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const exact=(v,keys,code)=>{need(object(v),code);equal(Object.keys(v).sort(),[...keys].sort(),code);};
const binding=e=>json([e?.viewport,e?.blockId]);
function entries(snapshot){
  need(object(snapshot)&&/^\d{8}$/.test(snapshot.siteId??'')&&typeof snapshot.publishedAt==='string'&&
    Number.isFinite(Date.parse(snapshot.publishedAt))&&Array.isArray(snapshot.entries),'snapshot');
  const result=new Map();
  for(const entry of snapshot.entries){
    need(object(entry)&&['desktop','mobile'].includes(entry.viewport)&&typeof entry.blockId==='string'&&
      entry.blockId.trim()===entry.blockId&&entry.blockId.length>0&&!result.has(binding(entry)),'entry_binding');
    result.set(binding(entry),entry);
  }
  return result;
}
function validOptions(value){
  return Array.isArray(value)&&value.length>0&&value.length<=100&&new Set(value).size===value.length&&
    value.every(v=>typeof v==='string'&&v.length>0&&v.length<=1000&&v.trim()===v);
}

/** Generic pure planner. Production SQL below separately binds the exact user-
 * approved original store, sites and 9 entries. The supplied builder must be
 * loaded from independently verified application source, never a server module. */
export function planBookingRuleOptionRepair({rulesRow,publishedRows,buildSnapshot}){
  need(object(rulesRow)&&uuid.test(rulesRow.id??'')&&rulesRow.slug===RULES&&rulesRow.merchant_id===TENANT&&
    hex.test(rulesRow.rowSha256??'')&&object(rulesRow.blocks)&&rulesRow.blocks.version===1&&
    object(rulesRow.blocks.snapshots)&&Array.isArray(publishedRows)&&typeof buildSnapshot==='function','input');
  const original=structuredClone(rulesRow.blocks),next=structuredClone(original),repairs=[],sources=[];
  for(const [siteId,snapshot]of Object.entries(original.snapshots)){
    need(snapshot?.siteId===siteId,'snapshot_site');const stored=entries(snapshot);
    const pages=publishedRows.filter(p=>p.merchant_id===siteId);
    need(pages.length===1,'published_page_ambiguous');const page=pages[0];
    need(uuid.test(page.id??'')&&hex.test(page.rowSha256??'')&&Array.isArray(page.blocks)&&
      (page.slug===null||typeof page.slug==='string'&&!page.slug.startsWith('__')),'published_page');
    const expected=buildSnapshot(siteId,structuredClone(page.blocks),snapshot.publishedAt);
    need(expected?.siteId===siteId&&expected.publishedAt===snapshot.publishedAt,'builder_identity');
    const authoritative=entries(expected);equal([...stored.keys()].sort(),[...authoritative.keys()].sort(),'published_bindings_changed');
    let changed=false;
    for(const [key,entry]of stored){
      const published=authoritative.get(key),result=structuredClone(entry),fields=[];
      for(const option of OPTIONS){
        if(Object.hasOwn(entry,option)){
          need(Array.isArray(entry[option]),'malformed_existing_option');
          continue; // Existing values, including an intentionally empty array, are never overwritten.
        }
        if(!Object.hasOwn(published,option))continue;
        need(validOptions(published[option]),'published_options');
        result[option]=structuredClone(published[option]);fields.push(option);
      }
      equal(result,published,'unapproved_semantic_difference');
      if(fields.length){
        const index=snapshot.entries.findIndex(e=>binding(e)===key);
        next.snapshots[siteId].entries[index]=result;
        repairs.push({siteId,viewport:entry.viewport,blockId:entry.blockId,index,fields});changed=true;
      }
    }
    // This also rejects ignored top-level snapshot changes and unknown fields.
    equal(next.snapshots[siteId],expected,'unapproved_snapshot_difference');
    if(changed)sources.push({id:page.id,merchantId:siteId,rowSha256:page.rowSha256});
  }
  need(repairs.length>0,'nothing_to_repair');
  const plan={schemaVersion:1,kind:'booking-rule-missing-options',rowId:rulesRow.id,rowSha256:rulesRow.rowSha256,
    original,next,originalSha256:hash(json(original)),nextSha256:hash(json(next)),sources,repairs};
  return Object.freeze({...plan,planSha256:hash(json(plan))});
}

function validatePlan(plan,{production}){
  exact(plan,['schemaVersion','kind','rowId','rowSha256','original','next','originalSha256','nextSha256',
    'sources','repairs','planSha256'],'plan_shape');
  need(plan.schemaVersion===1&&plan.kind==='booking-rule-missing-options'&&uuid.test(plan.rowId)&&hex.test(plan.rowSha256)&&
    hex.test(plan.planSha256)&&hash(json(plan.original))===plan.originalSha256&&hash(json(plan.next))===plan.nextSha256,'plan_digest');
  const {planSha256,...unsigned}=plan;need(hash(json(unsigned))===planSha256,'plan_digest');
  need(object(plan.original?.snapshots)&&object(plan.next?.snapshots)&&Array.isArray(plan.sources)&&
    Array.isArray(plan.repairs)&&plan.repairs.length>0,'plan_payload');
  const reconstructed=structuredClone(plan.original),seen=new Set(),changedSites=new Set();
  for(const repair of plan.repairs){
    exact(repair,['siteId','viewport','blockId','index','fields'],'repair_shape');
    need(/^\d{8}$/.test(repair.siteId??'')&&['desktop','mobile'].includes(repair.viewport)&&
      Number.isSafeInteger(repair.index)&&repair.index>=0&&Array.isArray(repair.fields)&&repair.fields.length>0&&
      new Set(repair.fields).size===repair.fields.length&&repair.fields.every(k=>OPTIONS.includes(k)),'repair');
    const before=reconstructed.snapshots[repair.siteId]?.entries?.[repair.index],
      after=plan.next.snapshots[repair.siteId]?.entries?.[repair.index],key=json([repair.siteId,repair.viewport,repair.blockId]);
    need(object(before)&&object(after)&&before.viewport===repair.viewport&&before.blockId===repair.blockId&&!seen.has(key),'repair_binding');
    seen.add(key);changedSites.add(repair.siteId);
    for(const field of repair.fields){
      need(!Object.hasOwn(before,field)&&validOptions(after[field]),'repair_would_overwrite');
      before[field]=structuredClone(after[field]);
    }
  }
  equal(reconstructed,plan.next,'unapproved_mutation');
  need(plan.sources.length===changedSites.size&&new Set(plan.sources.map(s=>s.id)).size===plan.sources.length,'source_count');
  for(const source of plan.sources){
    exact(source,['id','merchantId','rowSha256'],'source_shape');
    need(uuid.test(source.id)&&source.id!==plan.rowId&&hex.test(source.rowSha256)&&changedSites.has(source.merchantId),'source');
  }
  equal(plan.sources.map(s=>s.merchantId).sort(),[...changedSites].sort(),'source_sites');
  if(production){
    need(plan.originalSha256===BOOKING_RULE_REPAIR_ORIGINAL_SHA256&&plan.repairs.length===9,'approved_scope');
    need(plan.rowId==='40662361-e851-4455-ac2f-567ac03a021f'&&
      plan.rowSha256==='e2ace75b4a6fd169733991927906addce596f24dc41de7eca5c2196de974f5e1','approved_row');
    equal([...changedSites].map(hash).sort(),APPROVED_SITES,'approved_sites');
    equal([...changedSites].map(s=>plan.repairs.filter(r=>r.siteId===s).length).sort(),[3,6],'approved_entry_counts');
    for(const repair of plan.repairs){
      equal(repair.fields,[...OPTIONS],'approved_fields');
      const entry=plan.next.snapshots[repair.siteId].entries[repair.index];
      equal(OPTIONS.map(k=>entry[k].length),[3,5,2],'approved_options');
    }
  }
  return true;
}
const protectedRows=`select to_jsonb(p) as value from public.pages p where slug in
 (${BOOKING_PROTECTED_SLUGS.map(literal).join(',')})`;
const fingerprint=`(select encode(sha256(convert_to(count(*)::text||':'||coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') from
 (select encode(sha256(convert_to(value::text,'UTF8')),'hex') h from (${protectedRows}) rows) saved)`;

function repairBody(plan,backupSealSha256){
  const sourceConditions=plan.sources.map(s=>`(id=${literal(s.id)}::uuid and merchant_id=${literal(s.merchantId)} and
   (slug is null or left(slug,2)<>'__') and encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')=${literal(s.rowSha256)})`).join(' or ');
  const sourceCounts=plan.sources.map(s=>`(select count(*) from public.pages where merchant_id=${literal(s.merchantId)}
    and (slug is null or left(slug,2)<>'__'))<>1`).join(' or ');
  return `-- Encrypted-original backup verification seal: ${backupSealSha256}
lock table public.pages,public.faolla_schema_migrations,public.faolla_booking_atomic_control,
 public.faolla_booking_atomic_commands,public.faolla_booking_mail_jobs in share row exclusive mode;
create temporary table faolla_booking_rule_repair_before on commit drop as ${protectedRows};
create temporary table faolla_booking_rule_repair_result(value jsonb) on commit drop;
do $booking_rule_options_repair$
declare v_original jsonb;v_next jsonb;v_count integer;v_after jsonb;
begin
 if current_user<>'supabase_admin' or pg_is_in_recovery() then raise exception 'booking_rule_repair_role';end if;
 if ${fingerprint} is distinct from current_setting('faolla.booking_handoff_expected',true)::jsonb->>'savedBookingRowsSha256'
  then raise exception 'booking_rule_repair_saved_rows_changed';end if;
 if (select count(*) from public.pages p where ${sourceConditions})<>${plan.sources.length}
  then raise exception 'booking_rule_repair_published_source_changed';end if;
 if ${sourceCounts} then raise exception 'booking_rule_repair_published_source_ambiguous';end if;
 if (select count(*) from public.pages where slug='${RULES}')<>1 then raise exception 'booking_rule_repair_primary_ambiguous';end if;
 select to_jsonb(p) into strict v_original from public.pages p where id='${plan.rowId}'::uuid
  and merchant_id='${TENANT}' and slug='${RULES}'
  and encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')='${plan.rowSha256}';
 if v_original->'blocks' is distinct from ${literal(json(plan.original))}::jsonb then raise exception 'booking_rule_repair_original_changed';end if;
 v_next:=${literal(json(plan.next))}::jsonb;
 update public.pages set blocks=v_next where id='${plan.rowId}'::uuid;
 get diagnostics v_count=row_count;
 select to_jsonb(p) into strict v_after from public.pages p where id='${plan.rowId}'::uuid;
 if v_count<>1 or v_after is distinct from jsonb_set(jsonb_set(v_original,'{blocks}',v_next),'{updated_at}',to_jsonb(transaction_timestamp()))
  then raise exception 'booking_rule_repair_other_fields_changed';end if;
 if exists((select value from pg_temp.faolla_booking_rule_repair_before where value->>'id'<>'${plan.rowId}')
   except (${protectedRows} and id<>'${plan.rowId}'::uuid)) or
  exists((${protectedRows} and id<>'${plan.rowId}'::uuid)
   except (select value from pg_temp.faolla_booking_rule_repair_before where value->>'id'<>'${plan.rowId}'))
  then raise exception 'booking_rule_repair_other_saved_rows_changed';end if;
 insert into pg_temp.faolla_booking_rule_repair_result(value) values(jsonb_build_object(
  'schemaVersion',1,'kind','booking-rule-missing-options','planSha256','${plan.planSha256}','backupSealSha256','${backupSealSha256}',
  'rowId','${plan.rowId}','beforeRowSha256','${plan.rowSha256}',
  'originalRulesSha256','${plan.originalSha256}','nextRulesSha256','${plan.nextSha256}',
  'siteCount',${plan.sources.length},'entryCount',${plan.repairs.length},'fieldCount',${plan.repairs.reduce((n,r)=>n+r.fields.length,0)},
  'afterRowSha256',encode(sha256(convert_to(v_after::text,'UTF8')),'hex'),
  'beforeSavedRowsSha256',current_setting('faolla.booking_handoff_expected',true)::jsonb->>'savedBookingRowsSha256',
  'afterSavedRowsSha256',${fingerprint},'updatedAt',transaction_timestamp()));
 -- Rebase ONLY the digest after the independently checked, explicitly approved
 -- repair. The original activation body still proves its own unchanged-data
 -- transition. No legacy writer can cross the shared transaction's active flip.
 perform set_config('faolla.booking_handoff_expected',jsonb_set(current_setting('faolla.booking_handoff_expected',true)::jsonb,
  '{savedBookingRowsSha256}',to_jsonb(${fingerprint}))::text,true);
end;$booking_rule_options_repair$;
`;
}
function compose(activationSql,plan,backupSealSha256){
  need(hex.test(backupSealSha256??''),'verified_backup_seal');
  const marker='lock table public.pages,public.faolla_schema_migrations,public.faolla_booking_atomic_control,',index=activationSql.indexOf(marker);
  need(index>0&&activationSql.indexOf(marker,index+1)===-1,'activation_contract_changed');
  need(activationSql.endsWith('\ncommit;'),'activation_contract_changed');
  return activationSql.slice(0,index)+repairBody(plan,backupSealSha256)+activationSql.slice(index,-'\ncommit;'.length)+
    '\nselect value as repair from pg_temp.faolla_booking_rule_repair_result;\ncommit;';
}
export function guardedProductionBookingRepairActivationSql({before,plan,backupSealSha256}){
  validatePlan(plan,{production:true});
  return compose(guardedProductionBookingActivationSql(before),plan,backupSealSha256);
}
/** Exact same repair BODY. The isolated activation wrapper itself rejects the
 * real production system identifier, independent of caller-provided identity. */
export function isolatedBookingRepairActivationAcceptanceSql({before,databaseName,plan,backupSealSha256}){
  need(before?.systemIdentifier!==PRODUCTION_SYSTEM,'isolated_identity');validatePlan(plan,{production:false});
  return compose(isolatedBookingActivationAcceptanceSql({before,databaseName}),plan,backupSealSha256);
}
