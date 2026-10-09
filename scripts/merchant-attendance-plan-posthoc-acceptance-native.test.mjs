import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./merchant-attendance-plan-posthoc-acceptance-native.mjs',import.meta.url),'utf8');
test('208 remains inert and delegates ownership/cleanup to the existing207 runtime',async()=>{
  assert.equal(typeof(await import('./merchant-attendance-plan-posthoc-acceptance-native.mjs')).runPlanPosthocAcceptanceNative,'function');
  assert(source.includes('return runPlanPosthocReviewNative(args,async ctx=>'));
  for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','npm run build','supabase.co'])assert(!source.includes(forbidden));
});
test('208 browser runs before competing writers and both require explicit opt-in',()=>{
  assert(source.indexOf('const browser=')<source.indexOf('const concurrency='));
  assert(source.includes("args.includes('--with-browser')"));assert(source.includes("args.includes('--with-concurrency')"));
  assert(source.includes('production:false,deployed:false,newCluster:false'));
});
test('209 full-leave browser is explicit opt-in within the same owned207 lifecycle',()=>{
  assert(source.includes("args.includes('--with-full-leave-browser')"));
  assert(source.includes('onFullLeavePrepared:fullLeaveBrowserCheck'));
  assert(source.includes('browserCheck||concurrencyCheck||fullLeaveBrowserCheck'));
});
