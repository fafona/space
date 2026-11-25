// Test-only process-death helper. No database, credentials, production roots or CLI.
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {openCheckoutEvidenceStorage} from './member-checkout-evidence-storage.mjs';
let used=false;
process.on('message',message=>{
 if(used)return;used=true;
 try{
  if(process.platform!=='linux'||!process.send||!message||!['begin','prepared','read'].includes(message.action))throw Error();
  const {roots}=message,parent=path.dirname(roots.dataRoot),temporary=fs.realpathSync(tmpdir());
  if(path.dirname(parent)!==temporary||!/^faolla-checkout-evidence-test-[A-Za-z0-9]+$/.test(path.basename(parent))||path.dirname(roots.locatorRoot)!==parent)throw Error();
  const store=openCheckoutEvidenceStorage(roots);let locatorWire=message.locatorWire;
  if(message.action==='read')locatorWire=store.locate(message.operationId,message.stage);
  if(message.action==='begin')locatorWire=store.begin(message.input);
  if(message.action==='prepared')locatorWire=store.append(locatorWire,'prepared',message.body);
  const {locator}=store.read(locatorWire);store.close();
  // The parent kills only this owned child after the fsync/readback boundary.
  process.send({ok:true,locatorWire,stage:locator.stage});
 }catch{process.send?.({ok:false});}
});
