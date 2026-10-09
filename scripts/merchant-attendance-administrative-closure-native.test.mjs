import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {administrativeClosureNativeArgs,administrativeClosureNativeManifest,administrativeClosureNativeMigration,
 administrativeClosureNativeNewTables} from './merchant-attendance-administrative-closure-native.mjs';
const source=readFileSync(new URL('./merchant-attendance-administrative-closure-native.mjs',import.meta.url),'utf8');
test('runner stays inert and accepts only the explicit existing local directory',()=>{
 const args=['--run-local','--directory',path.resolve('synthetic-owned-only')];assert.deepEqual(administrativeClosureNativeArgs(args),args);
 assert.notEqual(administrativeClosureNativeArgs(args),args);
 for(const bad of [[],['--run-local'],['--run-local','--directory','relative'],[...args,'--with-browser'],['--directory',args[2],'--run-local']])assert.throws(()=>administrativeClosureNativeArgs(bad));
 assert(source.includes("path.resolve(process.argv[1])===fileURLToPath(import.meta.url)"));
});
test('28-function manifest is exact and table additions are exactly the private pair',()=>{
 const migration=readFileSync(new URL('./supabase-migrations/'+administrativeClosureNativeMigration,import.meta.url),'utf8');
 const recipes=administrativeClosureNativeManifest(migration);assert.equal(recipes.length,28);
 assert(recipes.some(x=>x.name==='faolla_attendance_shift_check_v1'));assert(recipes.some(x=>x.name==='faolla_attendance_pd_shift_v1'));
 assert.equal(administrativeClosureNativeNewTables.length,2);assert.throws(()=>administrativeClosureNativeManifest(''));
 assert.throws(()=>administrativeClosureNativeManifest('$administrative_recipes$[]$administrative_recipes$'));
});
test('prerequisites install once and only195 reenters after its forward changes',()=>{
 assert(source.includes("['202610020110_merchant_attendance_self_history_identity.sql',operationalRulesNativeMigration,operationalSourceNativeMigration,operationalPunchNativeMigration,applicationWindowNativeMigration]"));
 assert(source.includes("actualPins.filter(p=>p.actual!==p.expected)"));
 assert(source.includes("'administrative_fixture_prerequisite_body_pins'"));
 assert.equal((source.match(/d\.exec\(body\)/g)??[]).length,2);
 assert(!source.includes('verifyApplicationWindowNative'));assert(!source.includes('verifyOperationalPunchNative'));
 assert(source.includes("{capacity:'reuse_previous'}"));
});
test('parent owns stop/cleanup while wrapper checks every old fact, exact OIDs and archive bytes',()=>{
 for(const piece of ["assert.deepEqual(assertLifecycleSandbox",'oldFacts','replacedOids',"to_jsonb(p)-array['prosrc','proargdefaults']",'pg_get_expr(proargdefaults,0)',"assert.equal(JSON.parse(originalMetadata).length,28)","assert.equal(tempCount,'0')",'finally{',"assert.equal(acceptance.rollbackRestored,true)",'periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207'])assert(source.includes(piece),piece);
 assert(!/initdb|pg_ctl|Stop-Process|DROP DATABASE|CREATE DATABASE/.test(source));
});

test('optional local extension follows all195 acceptance/baseline checks and retains default inert behavior',()=>{
 assert(source.includes('runAdministrativeClosureNative(args,after=null)'));
 assert(source.includes("assert(after===null||typeof after==='function','administrative_invalid_local_extension')"));
 assert(source.indexOf('const extension=after===null?null:await after(ctx)')>source.indexOf('assert.equal(acceptance.rollbackRestored,true)'));
 assert(source.indexOf('const extension=after===null?null:await after(ctx)')>source.indexOf('risk.oneSettingsLockRaceWitnessed,true'));
 assert(source.includes('coreRollbackRestored:true,riskMicroCommitsCleanupOwnedByParent:true'));
 assert(source.includes('...(extension===null?{}:{extension})'));
 assert(!source.includes('review-routing')&&!source.includes('legal-delivery'));
});
test('fixed195 capability arms before risk microcommits and seals after its guards, before any child extension',()=>{
 const arm=source.indexOf('ctx.posthocAdministrativeEvents.arm();'),risk=source.indexOf('const risk=await verifyAdministrativeClosureRiskNative(ctx);'),
  seal=source.indexOf('ctx.posthocAdministrativeEvents.seal();'),after=source.indexOf('const extension=after===null?null:await after(ctx)');
 assert(source.includes('administrative_parent_event_capability_required'));assert(arm>source.indexOf('assert.equal(acceptance.rollbackRestored,true)'));
 assert(arm<risk&&risk<seal&&seal<after);assert(seal>source.indexOf('risk.oneSettingsLockRaceWitnessed,true'));
 assert(source.slice(risk,seal).includes('assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata)'));
 assert.equal((source.match(/posthocAdministrativeEvents\.arm\(\)/g)||[]).length,1);
 assert.equal((source.match(/posthocAdministrativeEvents\.seal\(\)/g)||[]).length,1);
});
