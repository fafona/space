import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {cleanupAccountSuspensionBrowser} from './attendance-account-suspension-browser.mjs';
const source=readFileSync(new URL('./attendance-account-suspension-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-account-suspension-browser.tsx',import.meta.url),'utf8');
test('imports are inert and actual Manager supplies actual Admin child',()=>{
  assert.match(entry,/import Manager/);assert.match(entry,/<Manager /);assert.match(entry,/registerViewChangeGuard: register/);
  assert.match(source,/export async function runAccountSuspensionBrowserAcceptance/);assert(!source.includes('process.argv'));assert(!source.includes('spawn('));assert(!source.includes('writeFile'));
  assert.match(source,/write:false/);assert.match(source,/width:390/);assert.match(source,/assert.equal\(u.origin,origin/);
});
test('both unknown writes wait only for actual matched original GET recovery',()=>{
  assert.match(source,/mode:'recover-status'/);assert.match(source,/mode:'recover'/);
  assert.match(source,/assert.equal\(patches\(\).length,beforeRecovery\)/);assert.match(source,/assert.equal\(posts\(\).length,beforeRead\)/);
  assert.match(source,/Promise.all\(\[page.waitForResponse/);assert.match(source,/await response.finished\(\)/);
  assert(!source.includes('waitForTimeout'));assert.match(source,/drop=null;assert.equal\(response.status,200\)/);
});
test('cleanup uses checked object arrays and preserves the primary failure',async()=>{
  await assert.rejects(cleanupAccountSuspensionBrowser([['wrong',()=>{}]]),/cleanup_shape/);
  let calls=0;await cleanupAccountSuspensionBrowser([{name:'pure',run:()=>{calls++;}}]);assert.equal(calls,1);
  const primary=Error('primary');await assert.rejects(cleanupAccountSuspensionBrowser([{name:'bad',run:()=>{throw Error('cleanup');}}],primary),e=>e instanceof AggregateError&&e.cause===primary&&e.errors[0]===primary);
  assert.match(source,/{name:'account suspension esbuild service',run:\(\)=>stop\(\)}/);
});
