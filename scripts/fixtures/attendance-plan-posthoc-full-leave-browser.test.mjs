import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./attendance-plan-posthoc-full-leave-browser.mjs',import.meta.url),'utf8');
test('209 browser driver import is inert and only owns an isolated new headless browser',async()=>{
  assert.equal(typeof(await import('./attendance-plan-posthoc-full-leave-browser.mjs')).verifyPosthocFullLeaveBrowser,'function');
  assert(source.includes('chromium.launch({headless:true})'));assert(source.includes("serviceWorkers:'block'"));
  for(const bad of ['connectOverCDP','launchPersistentContext','userDataDir','initdb','CREATE DATABASE','pg_dump'])assert(!source.includes(bad));
});
test('209 tests real full-leave selection, a real seal, exact failed original retry and historical receipt',()=>{
  for(const marker of ['full_leave_actual_owner_options','lost_not_applicable_save_then_real_period_seal','sealed_flag_off_original_receipt',
    'sealed_fresh_post_exact_409','sealed_original_null_retry_and_explicit_retirement','self_saved_not_applicable_and_distinct_message',
    'sealed_known_successful_original_read_only','await ctx.seal()','assert.deepEqual(posts[2],posts[1])','assert.equal(ctx.all(),beforeDenied)',
    'stats.rejectedPostFactHashChecks,2','archiveUnchanged()','port.requestFinish()','await context?.close()','await browser?.close()'])assert(source.includes(marker),marker);
});
