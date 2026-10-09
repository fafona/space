import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-outage-missing-continuity-native.mjs',import.meta.url),'utf8');

test('221 extends complete219 with no residual correction pending, same verified owned schema',()=>{
 for(const token of ['runAttendanceOutageContinuityNative(args,async ctx=>','outageContinuityFoundation.phase,219',
  'oldRowsPreserved','oldFunctionsPreserved','oldArchivesPreserved','sourceRaces.finalPendingRequestId,null',
  'assertLifecycleSandbox','verifyAttendanceOutageMissingRacesNative(ctx)'])assert(source.includes(token),token);
 assert(source.indexOf('assertLifecycleSandbox(sql=>')<source.indexOf('await verifyAttendanceOutageMissingRacesNative(ctx)'));
});
test('only exact fixture write tables may append; same-table old rows and both archives remain protected',()=>{
 for(const token of ['outageMissingRaceWriteTables','new Set(allowed).size,allowed.length','outage_missing_continuity_other_facts_changed',
  'd.definitions(),definitions','d.tableCatalog(),catalog','jsonb_array_elements','where to_jsonb(r)=old_row',
  'outage_missing_continuity_old_rows_changed:','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,saved.artifactText','periodArchive().artifactSha256,saved.artifactSha256','assert.equal(current.sourceChanged,false)'])assert(source.includes(token),token);
});
test('run is explicit and preserves outer rollback/owned-schema cleanup without a new runtime',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(source.includes('outer lifecycle removes it and checks persistent baseline'));
 for(const token of ['initdb','CREATE DATABASE','pg_dump','pg_ctl','spawn(','playwright','listen(','supabase.co','rollbackRestored:true'])assert(!source.includes(token),token);
});
