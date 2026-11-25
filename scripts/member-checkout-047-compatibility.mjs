// Independent source-derived metadata for the exact, UNINSTALLED 047 revision.
// No connector, caller-supplied expectation, baseline refresh or authority.
import assert from 'node:assert/strict';
import {compileProtocolSources,inspectCompatibilityCatalog,readCompatibilityCatalog} from './member-checkout-compatibility-check.mjs';
import {loadInstallationPlan,splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {loadCheckout047Revision} from './member-checkout-047-revision.mjs';
const brands=new WeakSet();
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

// Only these exact pinned 047 declarations need DEFAULT NULL or a public
// composite argument. Do not broaden the old general source compiler.
export function compile047LegacyFunctions(source){
 const statements=splitInstallationSql(source).filter(part=>/^create or replace function public\./i.test(part.command));
 assert.equal(statements.length,11,'checkout_047_legacy_function_count_changed');
 const functions=[];
 for(const part of statements){
  const header=part.sql.match(/create or replace function public\.(\w+)\s*\(([^)]*)\)\s*(returns\b)/i);assert.ok(header);
  let defaults=0;const composite=[];
  const argumentsText=header[2].split(',').map((raw,index)=>{
   const arg=raw.trim().match(/^(\w+)\s+(text|jsonb|boolean|public\.faolla_redemption_checkouts)(\s+default\s+null)?$/i);assert.ok(arg,'checkout_047_legacy_argument_changed');
   if(arg[3]){assert.equal(arg[2].toLowerCase(),'text');assert.equal(index,header[2].split(',').length-1);defaults++;}
   if(arg[2].toLowerCase()==='public.faolla_redemption_checkouts'){composite.push(index);return arg[1]+' text';}
   return arg[1]+' '+arg[2];
  }).join(',');
  const normalized=part.sql.replace(header[0],header[0].replace(header[2],argumentsText));
  const parsed=compileProtocolSources([{file:'scripts/supabase-migrations/202609080047_redemption_checkout_context.sql',text:normalized}]).functions;
  assert.equal(parsed.length,1);const fn=parsed[0];
  for(const index of composite)fn.types[index]='faolla_redemption_checkouts';
  fn.signature=`${fn.namespace}.${fn.name}(${fn.types.join(',')})`;functions.push({...fn,defaults});
 }
 assert.equal(functions.filter(fn=>fn.defaults===1).length,2);
 assert.equal(functions.filter(fn=>fn.types.includes('faolla_redemption_checkouts')).length,1);
 return functions;
}
export async function loadCheckout047Compatibility(){
 const plan=await loadInstallationPlan(),revision=await loadCheckout047Revision(),legacy=compile047LegacyFunctions(revision.legacySql);
 const functions=new Map(plan.expected.functions.map(fn=>[fn.signature,fn]));
 const previous=functions.get('public.faolla_commit_redemption_v1(text,jsonb)');assert.ok(previous);
 functions.set('public.faolla_commit_redemption_internal_v1(text,jsonb)',{...previous,name:'faolla_commit_redemption_internal_v1',signature:'public.faolla_commit_redemption_internal_v1(text,jsonb)',defaults:0});
 for(const fn of legacy)functions.set(fn.signature,fn);
 for(const patch of revision.patches)functions.set(patch.metadata.signature,patch.metadata);
 for(const fn of revision.adapterMetadata.functions){assert.ok(!functions.has(fn.signature));functions.set(fn.signature,fn);}
 const value=freeze({revision,legacy,expected:{functions:[...functions.values()],tables:[...plan.expected.tables,...revision.adapterMetadata.tables],
  triggers:[...plan.expected.triggers,...revision.adapterMetadata.triggers]},productionAuthorized:false,deploymentReady:false});
 brands.add(value);return value;
}
export async function readCheckout047Compatibility(query,contract){
 assert.ok(brands.has(contract),'checkout_047_expectation_unverified');
 const catalog=await readCompatibilityCatalog(query),signatures=[...contract.legacy.map(fn=>fn.signature),'public.faolla_commit_redemption_internal_v1(text,jsonb)'];
 const rows=await query(`SELECT p.oid::regprocedure::text signature,p.pronargdefaults::integer defaults,
  has_function_privilege('faolla_checkout_executor',p.oid,'EXECUTE') AS "executorExecute",
  has_function_privilege('faolla_checkout_runtime',p.oid,'EXECUTE') AS "runtimeExecute"
  FROM pg_catalog.pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY p.oid`,[signatures]);
 assert.ok(Array.isArray(rows.rows)&&rows.rows.length===12,'checkout_047_legacy_details_invalid');
 return {catalog,legacyDetails:rows.rows};
}
export function inspectCheckout047Compatibility(contract,catalog,legacyDetails){
 assert.ok(brands.has(contract),'checkout_047_expectation_unverified');
 const result=inspectCompatibilityCatalog(contract.expected,catalog);
 const issues=[...result.issues],exposed=new Set(['faolla_commit_redemption_v1','faolla_stage_redemption_checkout_v1','faolla_get_redemption_checkout_v1',
  'faolla_cancel_redemption_checkout_v1','faolla_ack_redemption_checkout_v1','faolla_commit_redemption_v2']);
 for(const expected of [...contract.legacy,{signature:'public.faolla_commit_redemption_internal_v1(text,jsonb)',name:'faolla_commit_redemption_internal_v1',defaults:0}]){
  const actual=catalog.functions.find(fn=>fn.namespace==='public'&&`public.${fn.name}(${fn.types.join(',')})`===expected.signature);
  const detail=legacyDetails?.filter(row=>'public.'+row.signature.replace(/^public\./,'')===expected.signature);
  if(!actual||actual.publicExecute!==false||JSON.stringify(actual.executors)!==JSON.stringify(exposed.has(expected.name)?['service_role']:[])
   ||actual.securityDefiner&&actual.ownerBypassesRls!==true)issues.push('legacy_047_boundary_changed:'+expected.signature);
  if(detail?.length!==1||detail[0].defaults!==expected.defaults||detail[0].runtimeExecute!==false
   ||detail[0].executorExecute!==(expected.name==='faolla_commit_redemption_v1'))issues.push('legacy_047_invocation_changed:'+expected.signature);
 }
 return {...result,issues:[...new Set(issues)].sort(),protocolObjectsMatch:issues.length===0,scope:'independent-047-compatibility-not-installation-approval',revisionSha256:contract.revision.sha256,
  productionAuthorized:false,deploymentReady:false};
}
