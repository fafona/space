// Pure construction guards. Real browser acceptance is a separately opted-in run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-schedule-overview-browser-check.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-schedule-overview-browser.tsx',import.meta.url),'utf8');
test('overview fixture embeds actual admin UI and allows only two same-origin GET routes',()=>{
  assert.match(fixture,/import AdminPanel/);assert.match(fixture,/url.origin !== location.origin/);assert.match(fixture,/init\?\.method \?\? "GET"\) !== "GET"/);
  assert.match(fixture,/synthetic_schedule_read_only/);assert.doesNotMatch(fixture,/localStorage|sessionStorage|setInterval|\.env/);
});
test('overview browser uses original099 cancellation to check old and fresh revision against independent rows',()=>{
  assert.match(source,/data.cancel\(target.id\)/);assert.match(source,/data.rows\(\)/);assert.match(source,/revision:first.revision/);
  assert.match(source,/second.items.find\(row=>row.id===target.id\).cancelled,false/);
  assert.match(source,/refreshed.revision>first.revision/);assert.match(source,/data.fingerprint\(\),baseline/);
});
test('overview runner is opt-in, locally bounded, cleans children and does not create retained artifacts',()=>{
  assert.match(source,/runAttendanceLabelsReuse\(process.argv.slice\(2\),native=>withAttendanceConcurrencySandbox/);
  assert.match(source,/path.resolve\(process.argv\[1\]\)===fileURLToPath\(import.meta.url\)/);
  assert.match(source,/assert.equal\(url.origin,origin\)/);assert.match(source,/assert.equal\(request.method\(\),'GET'\)/);
  for(const value of ["name:'overview-browser'","name:'overview-routes'","name:'harness'",'gates)gate.release.resolve()', 'windowsHide:true','realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false'])assert(source.includes(value));
  assert.doesNotMatch(source,/initdb|create database|screenshot\(|recordVideo|writeFile|storageState/);
});
