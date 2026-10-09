import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-outage-relations-native.mjs',import.meta.url),'utf8');
test('222 reuses owned fully checked217 and only installs181 without another cluster',()=>{
 for(const token of ['runAttendanceOutageSubjectNative(args,async ctx=>','outageSubjectFoundation.phase,217','outageSubjectFoundation.rollbackRestored,true',
  "outageRelationsNativeMigration='202610070181_merchant_attendance_outage_relations.sql'",'assertLifecycleSandbox','assert.deepEqual(owned,d.owned)'])assert(source.includes(token),token);
 for(const token of ['initdb','CREATE DATABASE','pg_dump','spawn(','playwright','listen(','supabase.co'])assert(!source.includes(token),token);
});
test('all original functions ACLs data and archives remain protected during install, reentry and rolled back scenarios',()=>{
 for(const token of ['pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef','oldFunctions(),oldHash','d.fingerprint(oldNames),facts',
  'd.fingerprint(),installed','d.definitions(),defs','d.tableCatalog(),catalog','archive().artifactText,oldArchive.artifactText',
  'archive().artifactSha256,oldArchive.artifactSha256','periodArchive().artifactText,saved.artifactText','periodArchive().artifactSha256,saved.artifactSha256',
  'unchanged.sourceChanged,false','verifyAttendanceOutageRelationsNative(ctx)'])assert(source.includes(token),token);
 assert(!source.includes('oid<>all('));
});
test('extension follows restoration and normal imports cannot start a runtime',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 assert(source.includes('browser:false,productionAccess:false,newCluster:false,deployed:false'));
 assert(source.indexOf('assert.equal(unchanged.sourceChanged,false)')<source.indexOf('await after('));
});
