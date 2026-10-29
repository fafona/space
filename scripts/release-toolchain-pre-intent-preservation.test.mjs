import test from'node:test';import assert from'node:assert/strict';
import{executePreIntentPreservation}from'./release-toolchain-pre-intent-preservation.mjs';
const steps=['observeBefore','beginPreservation','sealIntent','preservePublication','observeAfter','complete'];
test('all pre-intent preservation boundaries retain fail-closed ordering; no read refusal starts evidence mutation',async()=>{
 for(const failure of [...steps,null]){
  const seen=[];let evidenceMayHaveChanged=false,checks=0;
  const operations={assertHeldAndNoIntent:()=>checks++};
  for(const name of steps)operations[name]=()=>{seen.push(name);if(name==='beginPreservation')evidenceMayHaveChanged=true;if(name===failure)throw Error('fixed-refusal');return'preserved';};
  if(failure)await assert.rejects(executePreIntentPreservation(operations),{message:'fixed-refusal'});else assert.equal(await executePreIntentPreservation(operations),'preserved');
  assert.deepEqual(seen,failure?steps.slice(0,steps.indexOf(failure)+1):steps);
  assert.equal(evidenceMayHaveChanged,failure!=='observeBefore');
  assert.equal(checks,failure?seen.length*2-1:steps.length*2);
 }
});
test('a held-context or no-intent refusal prevents every later operation',async()=>{
 for(let at=1;at<=steps.length*2;at++){
  let calls=0,acted=0;const operations={assertHeldAndNoIntent:()=>{if(++calls===at)throw Error('ownership-refused');}};
  for(const name of steps)operations[name]=()=>{acted++;};
  await assert.rejects(executePreIntentPreservation(operations),{message:'ownership-refused'});assert.equal(acted,Math.floor(at/2));
 }
});
