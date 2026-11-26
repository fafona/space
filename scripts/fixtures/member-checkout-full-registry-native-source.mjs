// Native catalog is supplied by the owned PG connection. Gateway and historical
// acceptance references remain SYNTHETIC; this never creates production authority.
import assert from 'node:assert/strict';
import {createOwnedProductionSourceInputs} from './member-checkout-production-source-draft-fixture.mjs';
import {createCheckoutProductionSourceDraft} from '../member-checkout-production-source-draft.mjs';

export async function nativeFullRegistrySource(metadata){
 const input=await createOwnedProductionSourceInputs(value=>{
  for(const key of Object.keys(value))delete value[key];
  Object.assign(value,structuredClone(metadata));
 });
 const sourceDraft=await createCheckoutProductionSourceDraft(input);
 assert.equal(input.references.kind,'owned-synthetic-evidence');
 assert.equal(sourceDraft.material.evidence.referenceKind,'owned-synthetic-evidence');
 assert.ok(Object.values(sourceDraft.material.authority).every(v=>v===false));
 return {sourceDraft,bundle:input.bundle,before:input.observation.seal};
}
