// Separate LOCAL compatibility revision. Never refresh the frozen 37-source
// manifest, connect, install, reserve a migration or claim production readiness.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadInstallationPlan,splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {compileProtocolSources} from './member-checkout-compatibility-check.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const legacyFile='scripts/supabase-migrations/202609080047_redemption_checkout_context.sql';
const legacySha256='683ad34e3df55ccb088d5f8b78eceea1c7e905db341f3e5d6ff16bc978e9485e';
const adapterFile='scripts/fixtures/member-checkout-047-adapter.sql';
const adapterSha256='8408d46f2c84816bd9a7123a7f3d2bb4d12272130e8a3b128fd5565a79ba909c';
const changes=[
 ['database/proposals/20261122_member_checkout_bundle.sql','faolla_checkout_design.commit_bundle','v_redemption','payment'],
 ['database/proposals/20261122_member_checkout_cancellation.sql','faolla_checkout_design.cancel_bundle','v_mutation','return'],
 ['database/proposals/20261123_member_checkout_cart_submission.sql','public.faolla_member_checkout_cart_commit_v1','mutation','payment'],
 ['database/proposals/20261123_member_checkout_cart_cancellation.sql','public.faolla_member_checkout_cart_cancel_v1','mutation','return'],
];

export function renderCheckout047Replacement(file,source){
 const spec=changes.find(row=>row[0]===file);assert.ok(spec,'checkout_047_patch_source_forbidden');
 const [,name,variable,phase]=spec;
 const parts=splitInstallationSql(source),matches=parts.filter(part=>new RegExp('^CREATE\\s+FUNCTION\\s+'+name.replaceAll('.','\\.')+'\\s*\\(','i').test(part.command));
 assert.equal(matches.length,1,'checkout_047_function_boundary_changed');
 const before=matches[0].sql,call=`public.faolla_commit_redemption_v1(p_site_id,${variable})`;
 assert.equal(before.split(call).length,2,'checkout_047_call_boundary_changed');
 const sql=before.replace(/CREATE\s+FUNCTION/i,'CREATE OR REPLACE FUNCTION').replace(call,
  `faolla_checkout_design.commit_redemption_047(p_site_id,p_operation_key,p_principal_key,'${phase}',${variable})`);
 assert.equal(splitInstallationSql(sql).length,1);
 const metadata=compileProtocolSources([{file,text:sql}]);assert.equal(metadata.functions.length,1);
 return {file,function:name,phase,beforeSha256:sha(before),sha256:sha(sql),sql,metadata:metadata.functions[0]};
}
async function exactLocal(relative){
 const url=new URL('../'+relative,import.meta.url),resolved=fileURLToPath(url);
 assert.equal(await realpath(resolved),resolved,'checkout_047_source_link_refused');
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(url)).replace(/\r\n/g,'\n');
}
export async function loadCheckout047Revision(){
 const plan=await loadInstallationPlan();
 assert.equal(plan.digest,'4d8e71922c8c65b5bea46077240d9f52acdc4671fb5921a241a8dd67cada261d','checkout_047_old_plan_changed');
 const legacy=await exactLocal(legacyFile);assert.equal(sha(legacy),legacySha256,'checkout_047_legacy_source_changed');
 const adapter=await exactLocal(adapterFile),patches=[];assert.equal(sha(adapter),adapterSha256,'checkout_047_adapter_source_changed');
 for(const [file] of changes){
  const pin=plan.steps.find(value=>value.file===file);assert.ok(pin);
  const source=await exactLocal(file);assert.equal(sha(source),pin.sha256);
  patches.push(renderCheckout047Replacement(file,source));
 }
 const wrapper=splitInstallationSql(legacy).filter(part=>/^create or replace function public\.faolla_commit_redemption_v1\s*\(/i.test(part.command));
 assert.equal(wrapper.length,1);
 const oldWrapper=compileProtocolSources([{file:legacyFile,text:wrapper[0].sql}]).functions[0];
 const adapterMetadata=compileProtocolSources([{file:'database/proposals/ci_only_047_adapter.sql',text:adapter}]);
 assert.equal(adapterMetadata.functions.length,2);assert.equal(adapterMetadata.tables.length,1);assert.equal(adapterMetadata.triggers.length,2);
 const material={version:1,scope:'owned-local-047-compatibility-revision-only',frozenPlanSha256:plan.digest,
  legacy:{file:legacyFile,sha256:legacySha256},adapter:{file:adapterFile,sha256:sha(adapter)},
  replacements:patches.map(({file,function:name,phase,beforeSha256,sha256})=>({file,function:name,phase,beforeSha256,sha256})),
  productionAuthorized:false,deploymentReady:false};
 return freeze({material,sha256:sha(JSON.stringify(material)),legacySql:legacy,adapterSql:adapter,patches,oldWrapper,adapterMetadata});
}
