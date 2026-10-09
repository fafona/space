import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-plan-posthoc-workflow-native.mjs',import.meta.url),'utf8');
test('205 workflow module import is inert; caller supplies explicit existing synthetic runtime',async()=>{
  const fixtureModule=await import('./merchant-attendance-plan-posthoc-workflow-native.mjs');assert.equal(typeof fixtureModule.runPlanPosthocWorkflowNative,'function');
  assert(source.includes('runPlanPosthocNative(args,async ctx=>'));assert(source.includes('fileURLToPath(import.meta.url)'));
  for(const forbidden of ['initdb','CREATE DATABASE','pg_dump','npm run build','supabase.co'])assert(!source.includes(forbidden));
});
test('owner controller uses both actual handlers and strict services, committed-response loss has GET-only settlement',()=>{
  for(const required of ['AttendancePlanPosthocClient','handlePlanPosthoc(request','handlePlanPosthocEvaluation(request','executePlanPosthoc(input,service)','executePlanPosthocEvaluation(input,evalService)',
    'Synthetic lost committed response','await client.recover()','await client.evaluate()','assert.equal(postCalls,1)','assert.equal(all(),committed)'])assert(source.includes(required));
});
test('current leave and replacement tests cannot rewrite original facts, total hours, fixed rules or prior sealed bytes',()=>{
  for(const required of ["action:'submit'","action:'approve'","action:'cancel'",'work_leave_overlap','checkPosthocChangedNative(',
    'artifact.report.totals,periodBefore.preview.artifact.report.totals','d.fingerprint(unchangedTables),protectedFacts','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256','definitions(),oldDefinitions'])assert(source.includes(required));
});
