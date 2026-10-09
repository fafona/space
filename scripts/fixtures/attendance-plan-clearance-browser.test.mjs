import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const runner=readFileSync(new URL('./attendance-plan-clearance-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-plan-clearance-browser.tsx',import.meta.url),'utf8');
test('clearance browser is inert and uses actual Admin/Self parents with explicit synthetic auth',()=>{
  assert.match(runner,/export async function runPlanClearanceBrowserAcceptance\(ctx\)/);
  const before=runner.slice(0,runner.indexOf('export async function runPlanClearanceBrowserAcceptance'));
  assert(!before.includes('await assets()'));assert(!before.includes('chromium.launch('));assert(!before.includes('createServer('));
  for(const component of ['MerchantAttendanceAdminPanel','MerchantAttendanceSelfPanel'])assert(entry.includes(component));
  assert.match(entry,/不是真实登录/);assert.match(runner,/ctx.handleException\(mapped,access,\{clearanceEnabled:serverClearance\}\)/);
});
test('all cleanup resources use named object steps and preserve the primary failure',()=>{
  assert.match(runner,/runAttendanceCleanupSteps\(\[/);assert(!runner.includes("runAttendanceCleanupSteps('"));
  for(const name of ['inflight','context','browser','HTTP listener','esbuild service'])assert(runner.includes(`name:'plan clearance ${name}',run:`));
  assert.match(runner,/AggregateError\(\[failure,error\]/);assert.match(runner,/server.closeAllConnections\?\.\(\)/);assert.match(runner,/run:\(\)=>stop\(\)/);
});
test('write loss, flag-off recovery and separate message read use response-driven bounded assertions',()=>{
  assert.match(runner,/page.waitForResponse/);assert.match(runner,/await response.finished\(\)/);assert.match(runner,/assert.equal\(payload.data.receipt.item.outcome,'cleared'\)/);
  assert.match(runner,/serverClearance=false;await page.reload\(\)/);assert.match(runner,/name:'原编号核对并重试'.*isDisabled\(\),true/);
  assert.match(runner,/mode:'recover'/);assert.match(runner,/mode:'ack'/);assert.match(runner,/body.command.action,'mark_read'/);
  assert.match(runner,/assert.equal\(posts\(\).length,3\)/);assert.match(runner,/requests.length<40&&own\(\).length<30/);
  assert.match(runner,/method==='GET'\)assert.equal\(await ctx.fingerprint\(\),before/);assert(!runner.includes('waitForTimeout'));
});
test('loopback-only assets, no disk bundles, 390px and late hidden reads remain explicit',()=>{
  assert.match(runner,/write:false/);assert.match(runner,/server.listen\(0,'127.0.0.1'/);assert.match(runner,/url.origin,origin/);
  assert.match(runner,/viewport:\{width:390,height:900\}/);assert.match(runner,/Content-Security-Policy/);assert.match(runner,/stage='hidden_late_read'/);
  assert.match(runner,/allowedKeys.includes\(item.key\)/);assert(!runner.includes('page.screenshot'));assert(!runner.includes('setInterval'));
});
