import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const runner=readFileSync(new URL('./attendance-outage-workspace-browser.mjs',import.meta.url),'utf8');
const harness=readFileSync(new URL('./attendance-outage-workspace-browser.tsx',import.meta.url),'utf8');
const root=fileURLToPath(new URL('../../',import.meta.url));
test('import is inert and exposes only an explicit synthetic acceptance entrypoint',()=>{
  const out=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`const f=await import('./scripts/fixtures/attendance-outage-workspace-browser.mjs');if(typeof f.runOutageWorkspaceBrowserAcceptance!=='function')throw Error('missing export');console.log('inert-import-ok');`],{cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(out.trim(),'inert-import-ok');assert(runner.includes('import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href'));
});
test('actual launcher bundle is in memory with existing dependencies and browser-only imports',()=>{
  assert(harness.includes('MerchantAttendanceOutageLauncher'));assert(runner.includes('write:false'));assert(runner.includes("chromium.launch({headless:true})"));
  assert(runner.includes("/node:crypto|\\.server\\.ts$/"));assert(!/npm (?:install|ci|run build)|pnpm|node_modules.*(?:copy|cp)|initdb|pg_ctl|psql|supabase.*rpc/.test(runner));
});
test('network, API volume, per-response waits and whole run are bounded',()=>{
  for(const guard of ["server.listen(0,'127.0.0.1'","assert.equal(url.origin,origin","requests.length<40","length<8","Buffer.byteLength(raw,'utf8')<=32768","page.setDefaultTimeout(12000)","},180000)","serviceWorkers:'block'"])assert(runner.includes(guard),guard);
});
test('synthetic requests and responses use production pure parsers and exact original command hashes',()=>{
  for(const call of ['parseOutageHttpBody(kind,body,actor)','parseOutageHttpQuery(kind,url)','parseOutageHttpResponse(kind,wire,q,actor,c)','parseOutageSubjectResponse(wire,q,actor)','outageCommandFingerprintText(q,c)','outageLinksCommandFingerprintText(q,c)','outageReviewCommandFingerprintText(q,c)'])assert(runner.includes(call),call);
  assert(runner.includes("mode:'recover',readAt:instant()"));assert(runner.includes("assert.equal(requests.filter(r=>r.method==='POST').length,posts)"));
});
test('all owned resources close even on a failure, without erasing arbitrary user storage',()=>{
  const cleanup=runner.slice(runner.indexOf('finally{\n    clearTimeout(deadline)'));
  for(const text of ['releaseHeld?.()','context?.close()','browser?.close()','Promise.allSettled([...inflight])','server.close(','server.closeAllConnections()','run:()=>stop()','AggregateError','server.listening,false','browser.isConnected(),false'])assert(cleanup.includes(text),text);
  assert(!/localStorage\.clear|sessionStorage\.clear/.test(runner));assert(runner.includes("sessionStorage.getItem('qa-unrelated')"));assert(runner.includes("localStorage.getItem('qa-unrelated')"));
});
test('report separates real UI from synthetic API/Auth and covers exact eight groups without claiming SQL',()=>{
  for(const group of ['owner_launcher_explicit_create','self_prepare_snapshot_and_declare','explicit_links_preview_apply_and_propose','self_exact_version_confirm','owner_explicit_resolve_then_read','lost_post_flagoff_reload_original_get_hash','child_dirty_parent_leave_guard_and_390px','auth_switch_and_hide_late_get_no_body'])assert(runner.includes(group),group);
  for(const disclosure of ['syntheticApi:true','actualAuthentication:false','database:false','production:false','network:\'127.0.0.1 only\''])assert(runner.includes(disclosure),disclosure);
  assert(harness.includes('flushSync(() => setConfig'));assert(runner.includes("await dialog().waitFor({state:'detached'})"));assert(runner.includes('mobileDocument.scrollWidth<=mobileDocument.innerWidth'));assert(runner.includes('mobilePanel.scrollWidth<=mobilePanel.clientWidth'));
});
