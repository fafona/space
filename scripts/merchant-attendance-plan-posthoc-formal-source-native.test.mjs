import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-plan-posthoc-formal-source-native.mjs',import.meta.url),'utf8');
test('206 native source module is inert and reuses the explicit owned runtime',async()=>{
  const fixtureModule=await import('./merchant-attendance-plan-posthoc-formal-source-native.mjs');assert.equal(typeof fixtureModule.runPlanPosthocFormalSourceNative,'function');
  assert(source.includes('runPlanPosthocNative(args,async ctx=>'));
  for(const denied of ['initdb','CREATE DATABASE','pg_dump','npm run build','supabase.co'])assert(!source.includes(denied));
});
test('206 SQL cross-check includes old no-ledger exact bytes, all geometry fields, actual write/read locks and current heads',()=>{
  for(const required of ['createPlanPosthocFormalCases','expectedDerived5','legacyPair[0].sourceText,legacyPair[1].sourceText','lifecycleRace(',
    'assert(race.witnessed)','afterRace.source.evaluation.posthoc.current.operationId',"action:'submit'","action:'approve'","action:'cancel'",'checkPosthocChangedNative('])assert(source.includes(required));
});
test('206 seal simulation remains explicit and rolled back; archive bytes, old definitions, totals and real write gates preserved',()=>{
  for(const required of ['SYNTHETIC closure projection','rollback;','assert.equal(all(),beforeSeal)','freshApply,freshRevoke',
    'sealedFormal.fingerprint,first.fingerprint','definitions(),oldDefinitions','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
    'artifact.report.totals,periodBefore.preview.artifact.report.totals','formalDecisionWriter:false','actualNewSeal:false'])assert(source.includes(required));
});
