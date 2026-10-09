import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('coverage browser opt-in reuses actual parent, default handlers and service SQL without new mutations',()=>{
  const source=read('./merchant-attendance-notice-coverage-browser-check.mjs');
  assert.match(source,/prepareNoticeCoverageNativeFixture\(native,scope\)/);
  assert.match(source,/handleAttendanceNoticeCoverage\(input,\{enabled:\(\)=>true,entitlement\}\)/);
  assert.match(source,/handleAttendanceNotice\(input,\{enabled:\(\)=>true,accessEnabled:\(\)=>true,entitlement\}\)/);
  assert.match(source,/assert\.equal\(args\.p_command,null\)/);assert.match(source,/assert\.equal\(request\.method\(\),'GET'\)/);
  assert.match(source,/set local role service_role/);assert.match(source,/assert\.equal\(data\.fingerprint\(\),baseline\)/);
  assert.doesNotMatch(source,/\b(?:insert into|update|delete from)\s+public\./i);
});
test('coverage browser entry remains inert and closes identities/network and cleanup gates',()=>{
  const source=read('./merchant-attendance-notice-coverage-browser-check.mjs'),entry=read('./fixtures/attendance-notice-coverage-browser.tsx');
  assert.match(entry,/MerchantAttendanceLocationNoticePanel/);assert.doesNotMatch(entry,/geolocation|localStorage|setInterval|newPassword/);
  assert.match(source,/assert\.equal\(url\.origin,origin\)/);assert.match(source,/gates\.add\(gate\)/);
  assert.match(source,/for\(const gate of gates\)gate\.release\.resolve\(\)/);assert.match(source,/browser\?\.close\(\)/);
  assert.match(source,/assert\.equal\(count\(\),0\)/);assert.match(source,/assert\.equal\(count\(\),5\)/);
  assert.match(source,/locator\('dl dd'\)\.allTextContents\(\),\['57','51','6','1','50'\]/);
  assert.match(source,/reportBusinessWrites:0,fixtureDrafts:1,fixturePublications:1,fixtureAcknowledgements:1/);
  assert.match(source,/realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false/);
  assert.match(source,/path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
});
test('coverage harness entry is a closed explicit option and never changes other entries to enable coverage',()=>{
  const source=read('./attendance-self-browser-harness.mjs');
  assert.match(source,/withNoticeCoverage=process\.argv\.includes\('--notice-coverage'\)/);
  assert.match(source,/attendance_notice_coverage_conflicting_flags/);
  assert.match(source,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_NOTICE_COVERAGE_ENABLED'\]=withNoticeCoverage\?'"1"':'"0"'/);
  assert.match(source,/write: false/);assert.match(source,/server\.listen\(3131, "127\.0\.0\.1"/);
});
