// Pure import/source contracts; these tests never invoke a native fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceScheduleEvidenceNative} from './merchant-attendance-schedule-evidence-native.mjs';

const source=readFileSync(new URL('./merchant-attendance-schedule-evidence-native.mjs',import.meta.url),'utf8');
const browser=readFileSync(new URL('./merchant-attendance-sources-browser-check.mjs',import.meta.url),'utf8');

test('new checker is import-only and reuses an explicitly caller-owned fixture without startup setup or writes',()=>{
  assert.equal(typeof checkAttendanceScheduleEvidenceNative,'function');
  assert(source.includes('data.syntheticOnly,true'));assert(source.includes('data.sql,scope.sql'));
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|createServer|chromium|fetch\(|data\.exec\(|data\.probe\(|prepareSourcesNativeFixture|process\.argv/i);
  assert.equal((source.match(/data\.read\(/g)||[]).length,2);
  assert(source.includes('data.readCount()-beforeReads,2'));assert(source.includes('data.protectedFingerprint(),baseline'));
});

test('actual-source oracle preserves original/correction/missing/open semantics without inferred attendance or153binding',()=>{
  for(const text of ['original.records.length,3','selected.records.length,4',"corrected.operationId,id(8113)","missing.operationId,id(8204)",
    'missing.startEventId,null','open.endAt,null',"open.reasons.includes('open_record')",'result.formalReady,false','shiftRuleBindingsLoaded:false',
    'schedule_evidence_result_not_deeply_frozen','schedule_evidence_result_aliases_source'])assert(source.includes(text));
});

test('future oracle retains one cancelled plan and carry-in plus scoped clipped calendar and cancelled-leave annotations',()=>{
  for(const text of ['live.length,1','cancelled.length,1','carry.windowPartial,true',"carry.phase,'future'",'view.schedules.length,1',
    'calendar_scope_widened','calendar_intersection_not_query_bounded',"carry.leave[0].status,'cancelled'","view.schedules[0].relation,'no-time-candidate'"])assert(source.includes(text));
});

test('optional new browser assertions preserve old controls and network checks while checking child tabs and existing lifecycle clears',()=>{
  assert(browser.includes('verifyScheduleEvidence:false'));assert(browser.includes('options.verifyScheduleEvidence??false'));
  assert(browser.includes("!element.closest('[data-schedule-evidence]')"));assert(browser.includes('source_controls_outside_schedule_evidence'));
  assert(browser.includes('schedule_evidence_tab_made_request'));assert(browser.includes('left_schedule_evidence'));
  assert(browser.includes('assert.equal(serviceCalls,requests.length)'));assert(browser.includes('assert.equal(externalRequests,0)'));
  assert(browser.includes("request.method==='GET'&&request.status===200"));assert(browser.includes('storageCalls:0'));
});
