import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-outage-boundaries-native.mjs',import.meta.url),'utf8');
test('218 reuses checked217 owned context and requires capacity rollback before real races',()=>{
 for(const s of ['runAttendanceOutageSubjectNative(args,async ctx=>','outageSubjectFoundation.phase,217','outageSubjectFoundation.rollbackRestored,true',
  'assertLifecycleSandbox','outage_capacity_did_not_rollback','verifyAttendanceOutageReviewRacesNative','verifyAttendanceOutageSealRacesNative'])assert(source.includes(s),s);
 assert(source.indexOf('outage_capacity_did_not_rollback')<source.indexOf('const reviews=await'));
});
test('appended synthetic facts cannot change old rows, old definitions or saved archives',()=>{
 for(const s of ['d.fingerprint(protectedNames),protectedBefore','d.definitions(),defs','d.tableCatalog(),catalog','outage_boundary_old_rows_changed:',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256','periodArchive().artifactText,saved.artifactText',
  'periodArchive().artifactSha256,saved.artifactSha256','assert.equal(unchanged.sourceChanged,false)'])assert(source.includes(s),s);
});
test('entry is explicit and inert; outer tested lifecycle owns environment cleanup',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 for(const s of ['initdb','CREATE DATABASE','pg_dump','pg_ctl','spawn(','playwright','listen(','supabase.co','rollbackRestored:true'])assert(!source.includes(s),s);
 assert(source.includes('outer lifecycle removes it and checks persistent baseline'));
});

test('219 optional extension starts after all218 protected facts and sealed-source checks',()=>{
 assert(source.includes('runAttendanceOutageBoundariesNative(args,after=null)'));
 assert(source.includes("after===null||typeof after==='function'"));
 assert(source.includes('if(after!==null)return {...result,extension:await after({...ctx,outageBoundariesFoundation:result})}'));
 for(const guard of ['d.fingerprint(protectedNames),protectedBefore','outage_boundary_old_rows_changed:',
  'periodArchive().artifactSha256,saved.artifactSha256','assert.equal(unchanged.sourceChanged,false)']){
  assert(source.indexOf(guard)<source.indexOf('await after('),guard);
 }
});
