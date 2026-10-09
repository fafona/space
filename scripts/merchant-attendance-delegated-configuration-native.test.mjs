// Pure options/SOURCE checks only; no PG, browser, Auth or business matrix.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {installAndVerifyDelegatedConfigurationNative} from './merchant-attendance-delegated-configuration-native.mjs';
const adapter=readFileSync(new URL('./merchant-attendance-delegated-configuration-native.mjs',import.meta.url),'utf8');

test('205 explicit install-only options are validated before reading the owned context',async()=>{
 let reads=0;const ctx={get d(){reads++;throw new Error('synthetic_context_read');}};
 for(const options of [{businessCases:'unknown'},{businessCases:false},{unexpected:true},null,[],false,1,'skip'])
  await assert.rejects(()=>installAndVerifyDelegatedConfigurationNative(ctx,options),/delegated_configuration_native_(?:options|business_cases)_invalid/);
 assert.equal(reads,0);
 for(const options of [{},{businessCases:'run'},{businessCases:'skip'}])
  await assert.rejects(()=>installAndVerifyDelegatedConfigurationNative(ctx,options),/synthetic_context_read/);
 await assert.rejects(()=>installAndVerifyDelegatedConfigurationNative(ctx),/synthetic_context_read/);assert.equal(reads,4);
});

test('205 skip does not import the business fixture or claim acceptance and keeps all installation and final guards',()=>{
 const entry=adapter.slice(adapter.indexOf('export async function installAndVerifyDelegatedConfigurationNative'));
 assert.match(entry,/businessCases='run'/);assert.match(entry,/let acceptance=null/);
 assert.match(entry,/try\{if\(businessCases==='run'\)acceptance=await\(await import\('\.\/fixtures\/attendance-delegated-configuration-native\.mjs'\)\)/);
 assert.equal((entry.match(/import\(/g)||[]).length,1);
 assert.match(entry,/if\(businessCases==='run'\)\{assert\.equal\(acceptance\.groups\.length,8\)/);
 assert.match(entry,/businessCasesExecuted:businessCases==='run'/);assert.match(entry,/rollbackRestored:businessCases==='run'\?true:null/);
 const branch=entry.indexOf("try{if(businessCases==='run')"),final=entry.slice(entry.indexOf(' finally{',branch),entry.indexOf("\n if(businessCases==='run'){",branch));
 for(const token of ['assertDelegatedConfigurationNativeDependencies','assertManagementAuditNativeOldState(before,installed',
  'delegated_configuration_no_new_relations','installed.tables,before.tables','installed.indexes,before.indexes',
  'delegated_configuration_reentry_exact_all_objects','pg_my_temp_schema()'])assert(entry.indexOf(token)<branch&&entry.indexOf(token)>=0,token);
 for(const token of ['d.fingerprint(),facts','d.definitions(),defs','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207'])assert(final.includes(token),token);
 assert.doesNotMatch(final,/businessCases|\breturn\b/);
});
