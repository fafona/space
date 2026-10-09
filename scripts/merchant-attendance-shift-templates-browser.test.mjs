// Construction guards only; actual component/SQL checks are the opt-in runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-shift-templates-browser-check.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./fixtures/attendance-shift-templates-browser.tsx',import.meta.url),'utf8');
test('template browser fixture uses original schedule and allowlisted same-origin routes only',()=>{
  assert.match(entry,/import SchedulePanel/);assert.match(entry,/url.origin !== window.location.origin/);
  assert.match(entry,/url.pathname.endsWith\("\/admin"\) && method !== "GET"/);
  assert.doesNotMatch(entry,/localStorage|setInterval|\.env|supabase/);
  assert.match(source,/assert.equal\(url.origin,origin\)/);assert.match(source,/assert.equal\(request.method\(\),'GET'\)/);
});
test('template browser opt-in reuses owned cluster and cleans browser, routes and harness without extra artifacts',()=>{
  assert.match(source,/runAttendanceLabelsReuse\(process.argv.slice\(2\),native=>withAttendanceConcurrencySandbox/);
  assert.match(source,/path.resolve\(process.argv\[1\]\)===fileURLToPath\(import.meta.url\)/);
  for(const name of ['template-browser','template-routes','harness'])assert(source.includes(`name:'${name}'`));
  assert.match(source,/gates\)gate.release.resolve\(\)/);assert.match(source,/windowsHide:true/);
  assert.doesNotMatch(source,/initdb|create database|screenshot\(|recordVideo|writeFile|storageState/);
});
test('template browser covers old-form isolation, paused original receipt recovery and unchanged published facts',()=>{
  for(const value of ["phase='paused-receipt'",'event.defaultPrevented','button.form.checkValidity()',"moduleEnabled=false",'protectedBefore','afterPublish','templatePosts(),1','minutes:480','events:0'])assert(source.includes(value));
  assert.match(source,/assert.equal\(await bounded\(enter.promise\),true\)/);
  assert.match(source,/browserChecks:7/);assert.match(source,/realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false/);
});
