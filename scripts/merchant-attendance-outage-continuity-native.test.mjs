import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-outage-continuity-native.mjs',import.meta.url),'utf8');

test('219 extends checked218 context and fully restores history and authorization before source races',()=>{
 for(const s of ['runAttendanceOutageBoundariesNative(args,async ctx=>','outageBoundariesFoundation.phase,218',
  'outageBoundariesFoundation.oldRowsPreserved,true','outageBoundariesFoundation.oldFunctionsPreserved,true',
  'outageBoundariesFoundation.oldArchivesPreserved,true','assertLifecycleSandbox','outage_history_did_not_rollback',
  'outage_authorization_did_not_rollback','verifyAttendanceOutageSourceRacesNative(ctx)'])assert(source.includes(s),s);
 assert(source.indexOf('outage_history_did_not_rollback')<source.indexOf('const authorization=await'));
 assert(source.indexOf('outage_authorization_did_not_rollback')<source.indexOf('const sourceRaces=await'));
});

test('only explicit outage/correction append tables may grow; existing rows and archives remain guarded',()=>{
 for(const s of ['merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings',
  'd.fingerprint(protectedNames),protectedBefore','d.definitions(),defs','d.tableCatalog(),catalog','outage_continuity_old_rows_changed:','where to_jsonb(r)=old_row',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256','periodArchive().artifactText,saved.artifactText',
  'periodArchive().artifactSha256,saved.artifactSha256','assert.equal(unchanged.sourceChanged,false)'])assert(source.includes(s),s);
 assert(!source.includes('merchant_attendance_events\''));assert(!source.includes('merchant_attendance_correction_effects\''));
});

test('no implicit start; original lifecycle retains environment ownership and cleanup',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));assert(source.includes('process.exitCode=1'));
 for(const s of ['initdb','CREATE DATABASE','pg_dump','pg_ctl','spawn(','playwright','listen(','supabase.co','rollbackRestored:true'])assert(!source.includes(s),s);
 assert(source.includes('outer lifecycle removes it and checks persistent baseline'));
});

test('later acceptance reuses the checked owned context only after complete219 preservation checks',()=>{
 assert(source.includes('runAttendanceOutageContinuityNative(args,after=null)'));
 assert(source.includes("assert(after===null||typeof after==='function','outage_continuity_owned_extension_invalid')"));
 const hook='if(after!==null)return {...result,extension:await after({...ctx,outageContinuityFoundation:result})}';
 assert(source.includes(hook));
 assert(source.indexOf('assert.equal(unchanged.sourceChanged,false)')<source.indexOf(hook));
 assert(source.indexOf('outage_continuity_old_rows_changed:')<source.indexOf(hook));
 assert(source.includes('return result;'));
});
