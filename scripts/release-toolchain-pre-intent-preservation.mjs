// Sequencing only, not filesystem/lock/control authority. The production
// factory is private-scope bound; disposable tests use separate owned IO.
export async function executePreIntentPreservation(operations){
 for(const name of ['observeBefore','beginPreservation','sealIntent','preservePublication','observeAfter','complete']){
  await operations.assertHeldAndNoIntent();
  const result=await operations[name]();
  await operations.assertHeldAndNoIntent();
  if(name==='complete')return result;
 }
}
