// Synthetic metadata only. Native-file tests do not claim a real PG connection
// or complete 38-step installation merely because this model is branded.
import {createHash} from 'node:crypto';
import {createOwnedProductionSourceInputs,bundle,inventory,excluded} from './member-checkout-production-source-draft-fixture.mjs';
import {createCheckoutProductionSourceDraft} from '../member-checkout-production-source-draft.mjs';
import {observeCheckout047Installation} from '../member-checkout-047-installation.mjs';
import {checkoutFullRegistryOwnedReceipts} from '../member-checkout-full-registry-result.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function ownedFullRegistryEvidenceFixture(){
 const input=await createOwnedProductionSourceInputs(),sourceDraft=await createCheckoutProductionSourceDraft(input),before=input.observation.seal;
 const afterRaw=structuredClone(before.data);afterRaw.core.context={...afterRaw.core.context,readOnly:false,backendPid:101};
 afterRaw.core.schemas.push({name:'owned_test_new_schema',owner:'owned_admin'});
 const observe=raw=>observeCheckout047Installation(async()=>({rows:[{metadata:raw}]}),bundle),after=await observe(afterRaw);
 const currentRaw=(prepared,committed=true,pid=102)=>{
  const raw=structuredClone(committed?afterRaw:before.data);raw.core.context={...raw.core.context,readOnly:true,backendPid:pid};
  if(committed)raw.core.registry={count:216,entries:[...raw.core.registry.entries,...checkoutFullRegistryOwnedReceipts(prepared).map(({version,name})=>({version,nameSha256:sha(name)}))].sort((a,b)=>a.version.localeCompare(b.version))};
  return raw;
 };
 const originalRegistry=inventory.entries.filter(v=>v.file!==excluded).map(v=>({version:v.version,name:v.file.match(/\/[0-9]+_(.+)\.sql$/)[1]}));
 return {input,sourceDraft,bundle,before,after,currentRaw,observe,originalRegistry};
}
