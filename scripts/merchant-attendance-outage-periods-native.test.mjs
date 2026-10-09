import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-periods-native.mjs',import.meta.url),'utf8');
test('215 opts into the same fully rolled back214 context and only179',()=>{
 for(const token of ['runAttendanceOutageReviewsNative(args,async ctx=>','outageReviewsFoundation.rollbackRestored,true',
  "outagePeriodsNativeMigration='202610070179_merchant_attendance_outage_periods.sql'",'assertLifecycleSandbox','assert.deepEqual(owned,d.owned)'])assert(source.includes(token),token);
 for(const token of ['initdb','CREATE DATABASE','pg_dump','spawn(','playwright','listen(','npm run build','supabase.co'])assert(!source.includes(token),token);
});
test('exactly three approved function signatures are excluded from old-definition hash',()=>{
 const approved=source.match(/outagePeriodsChangedFunctions=Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1];assert(approved);
 assert.deepEqual([...approved.matchAll(/'([^']+)'/g)].map(m=>m[1]),[
  'faolla_attendance_period_closure_source_base_v1(jsonb,uuid)','faolla_attendance_period_closure_source_v1(jsonb,uuid)',
  'faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)']);
 for(const token of ["'public.${sig}'::regprocedure::oid",'oid<>all(array[${replacements}])','outage_period_changed_unapproved_function',
  'pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef'])assert(source.includes(token),token);
});
test('installation and absent declarations preserve actual old canonical material and archives',()=>{
 assert(source.indexOf('const legacySources=')<source.indexOf('install();'));
 for(const token of ["['owner','self']",'current.sourceText,previous.sourceText','current.sourceFingerprint,previous.sourceFingerprint',
  'current.sourceVersion,previous.sourceVersion','current.blockers,previous.blockers','outage_period_fixture_did_not_rollback',
  'periodArchive().artifactText,sealedArchive.artifactText','periodArchive().artifactSha256,sealedArchive.artifactSha256',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'assert.equal(unchanged.sourceChanged,false)'])assert(source.includes(token),token);
});
test('entry remains inert, retains nonzero failure and claims no browser or new environment',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 assert(source.includes('browser:false,productionAccess:false,newCluster:false,deployed:false'));
});
test('217 optional extension runs only after complete215 rollback and seal verification',()=>{
 assert(source.includes('runAttendanceOutagePeriodsNative(args,after=null)'));
 assert(source.includes("after===null||typeof after==='function'"));
 assert(source.includes('if(after!==null)return {...result,extension:await after({...ctx,outagePeriodsFoundation:result})}'));
 assert(source.indexOf('outage_period_fixture_did_not_rollback')<source.indexOf('await after('));
 assert(source.indexOf('assert.equal(unchanged.sourceChanged,false)')<source.indexOf('await after('));
});
