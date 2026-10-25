import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RECORDS_UI_RELEASE_LANE as lane,RECORDS_UI_RELEASE_BASELINE as baseline,RECORDS_UI_APPLICATION_FILES as app,
 RECORDS_UI_TOOL_FILES as tools,RECORDS_UI_FOCUSED_TESTS,assertRecordsUiReleaseScope,assertRecordsUiReleaseClosure,buildRecordsUiReleaseCandidate} from './attendance-records-ui-release-policy.mjs';
import {assertGoogleTransitionReleaseScope} from './google-oauth-transition-release-policy.mjs';
import {onlinePublicationLane} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations} from './online-traffic-release-policy.mjs';
import {ATTENDANCE_BUILD_LIMITS} from './attendance-online-build.mjs';
const files=[...app,...tools],readBlob=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('approved six-file presentation repair has an independent exact lane, with every database path forbidden',()=>{
 assert.equal(app.length,6);assert.equal(new Set(files).size,files.length);
 assert.equal(onlinePublicationLane(files),lane);assert.equal(onlineReleaseLane(files),lane);assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');
 for(const fn of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>fn(lane),/records_ui_release_database_forbidden/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,[]),/database_forbidden/);
 assert.throws(()=>assertGoogleTransitionReleaseScope(files),/scope_rejected/);
});
test('application bytes, fixed baseline and complete tool closure cannot be broadened',()=>{
 assert.match(assertRecordsUiReleaseClosure({baseline,files,readBlob}),/^[a-f0-9]{64}$/);
 for(const f of app)assert.throws(()=>assertRecordsUiReleaseClosure({baseline,files,readBlob:x=>readBlob(x)+(x===f?'\n//unreviewed':'')}),/content_rejected/);
 for(const f of tools)assert.throws(()=>assertRecordsUiReleaseClosure({baseline,files:files.filter(x=>x!==f),readBlob}),/closure_missing/);
 for(const f of ['src/app/api/bookings/route.ts','package.json','package-lock.json','.env.local','src/lib/merchantAttendanceManagementClient.ts','src/components/enterprise/MerchantAttendanceScopePanel.tsx','scripts/online-release-artifact-cleanup.mjs','.github/workflows/ci.yml'])assert.throws(()=>assertRecordsUiReleaseScope([...files,f]),/scope_rejected/);
 assert.throws(()=>assertRecordsUiReleaseClosure({baseline:'a'.repeat(40),files,readBlob}),/baseline_invalid/);
});
test('shared mechanics preserve original sandbox budgets and strict lane admission',()=>{
 assert.throws(()=>buildRecordsUiReleaseCandidate({lane:'google-oauth-transition-code-only',baseline}),/build_scope_invalid/);
 assert.equal(ATTENDANCE_BUILD_LIMITS.memoryBytes,4*1024**3);assert.equal(ATTENDANCE_BUILD_LIMITS.heapMiB,3072);
 assert.equal(ATTENDANCE_BUILD_LIMITS.minimumAvailableBytes,6*1024**3);
 for(const f of ['src/lib/merchantAttendanceRecordsUi.test.tsx','src/lib/merchantAttendanceScopeNavigation.test.tsx','src/app/login/googleOAuthTransition.test.ts','scripts/google-transition-unbuilt-close.test.mjs','scripts/online-release-retention-writer.test.mjs'])assert.ok(RECORDS_UI_FOCUSED_TESTS.includes(f));
});
test('actual controller selects new closure/tests/build but retains environment, smoke and convergence without another stop',()=>{
 const s=readBlob('scripts/online-traffic-release.mjs');
 for(const x of ['(s.lane===GOOGLE_TRANSITION_RELEASE_LANE||s.lane===RECORDS_UI_RELEASE_LANE)',
  '(lane===GOOGLE_TRANSITION_RELEASE_LANE||lane===RECORDS_UI_RELEASE_LANE))assertAttendanceBuildAdmission',
  'releaseLane===RECORDS_UI_RELEASE_LANE?assertRecordsUiReleaseClosure:assertGoogleTransitionReleaseClosure',
  'googleTransitionClosure(s.target,s.baseline,s.lane)','lane===RECORDS_UI_RELEASE_LANE?buildRecordsUiReleaseCandidate:buildGoogleTransitionReleaseCandidate',
  'lane===RECORDS_UI_RELEASE_LANE?RECORDS_UI_FOCUSED_TESTS:GOOGLE_TRANSITION_FOCUSED_TESTS','assertGoogleTransitionFirstPaint(transitionHtml)','verifyGoogleTransitionRelease(s,true,p)'])assert.ok(s.includes(x),x);
 const retention=s.slice(s.indexOf(' if((s.lane===GOOGLE_TRANSITION_RELEASE_LANE'),s.indexOf(' if(s.lane===SCOPE_NAV_RELEASE_LANE'));
 assert.match(retention,/victimTarget:null/);assert.doesNotMatch(retention,/kind:'retire'|reclaimPublicationArtifacts|completePublicationRetention/);
});
