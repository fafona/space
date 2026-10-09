import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-subject-native.mjs',import.meta.url),'utf8');
test('217 opts into fully checked215 context and only installs180, never bootstraps another cluster',()=>{
 for(const token of ['runAttendanceOutagePeriodsNative(args,async ctx=>','outagePeriodsFoundation.phase,215','outagePeriodsFoundation.rollbackRestored,true',
  "outageSubjectNativeMigration='202610070180_merchant_attendance_outage_subject.sql'",'assertLifecycleSandbox','assert.deepEqual(owned,d.owned)'])assert(source.includes(token),token);
 for(const token of ['initdb','CREATE DATABASE','pg_dump','spawn(','playwright','listen(','supabase.co'])assert(!source.includes(token),token);
});
test('install and reentry preserve all old function definitions, facts, catalog and both real archives',()=>{
 for(const token of ['pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef','oldFunctions(),oldHash','d.fingerprint(oldNames),facts',
  'd.fingerprint(),installed','d.definitions(),defs','d.tableCatalog(),catalog','archive().artifactText,oldArchive.artifactText',
  'archive().artifactSha256,oldArchive.artifactSha256','periodArchive().artifactText,saved.artifactText','periodArchive().artifactSha256,saved.artifactSha256',
  'unchanged.sourceChanged,false','verifyAttendanceOutageSubjectNative(ctx)'])assert(source.includes(token),token);
 assert(!source.includes('oid<>all('));
});
test('import is inert and underlying215 runner owns stop/restore; failures remain nonzero',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(source.includes('browser:false,productionAccess:false,newCluster:false,deployed:false'));
});
test('218 optional extension starts only after all217 rollback and sealed-source checks',()=>{
 assert(source.includes('runAttendanceOutageSubjectNative(args,after=null)'));
 assert(source.includes("after===null||typeof after==='function'"));
 assert(source.includes('if(after!==null)return {...result,extension:await after({...ctx,outageSubjectFoundation:result})}'));
 assert(source.indexOf('assert.equal(unchanged.sourceChanged,false)')<source.indexOf('await after('));
 assert(source.indexOf('assert.equal(d.fingerprint(),installed);assert.equal(d.fingerprint(oldNames),facts)')<source.indexOf('await after('));
});
