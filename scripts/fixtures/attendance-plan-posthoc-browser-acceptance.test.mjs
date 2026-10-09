import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./attendance-plan-posthoc-browser-acceptance.mjs',import.meta.url),'utf8');
test('208 actual browser driver is inert and only owns a new headless context',async()=>{
  assert.equal(typeof(await import('./attendance-plan-posthoc-browser-acceptance.mjs')).verifyPlanPosthocBrowserAcceptance,'function');
  assert(source.includes('chromium.launch({headless:true})'));assert(source.includes('serviceWorkers:\'block\''));
  for(const forbidden of ['connectOverCDP','launchPersistentContext','userDataDir','initdb'])assert(!source.includes(forbidden));
});
test('208 covers original number recovery from actual parents, explicit writes, and late response scope fences',()=>{
  for(const name of ['flag_off_parent_known_target_recovery','formal_current_after_adoption','self_saved_result_note_and_ack','message_read_separate','hidden_and_scope_late_responses'])assert(source.includes(name));
  assert(source.includes('port.requestFinish()'));assert(source.includes('await context?.close()'));assert(source.includes('await browser?.close()'));
});
