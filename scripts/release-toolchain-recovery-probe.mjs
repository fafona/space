// Shared real HTTP recovery proof. Read-only requests may be retried within a
// fixed budget; mutations are never retried here. Callers supply and recheck
// their actual ownership context. This function issues no publication authority.
const need=(v,c)=>{if(!v)throw Error('booking_recovery_probe_'+c);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function proveRecoveryTargets({origins,target,operationId,verify,deadlineAtMs,now=Date.now,fetchImpl=fetch,pause=wait}){
 need(Array.isArray(origins)&&origins.length>0&&origins.length<=2&&new Set(origins).size===origins.length&&origins.every(s=>{try{const u=new URL(s);return u.origin===s&&!u.username&&!u.password&&['https:','http:'].includes(u.protocol);}catch{return false;}}),'origins');
 need(/^[a-f0-9]{40}$/.test(target)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)&&typeof verify==='function','context');
 const started=now();need(Number.isSafeInteger(started)&&Number.isSafeInteger(deadlineAtMs)&&deadlineAtMs>started&&deadlineAtMs-started<=30000,'budget');
 const one=async origin=>{
  for(let attempt=1;attempt<=6;attempt++){
   await verify();const remaining=deadlineAtMs-now();need(remaining>0,'deadline');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(5000,remaining));let confirmed=false;
   try{
    const response=await fetchImpl(origin+'/api/app-web-version?bookingRecovery='+operationId,{cache:'no-store',redirect:'manual',signal:controller.signal});
    if(response.status===200){
     // A JSON body can stall after successful headers or grow without bound.
     const reader=response.body?.getReader();if(reader){let length=0,text='';const decoder=new TextDecoder();try{for(;;){const {value,done}=await reader.read();if(done){text+=decoder.decode();break;}length+=value.byteLength;need(length<=4096,'body_limit');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
      const value=JSON.parse(text);confirmed=value?.ok===true&&value.buildId===target;
     }
    }else await response.body?.cancel();
   }catch{/* Only bounded read-only requests are eligible for another attempt. */}
   finally{clearTimeout(timer);}
   await verify();need(now()<deadlineAtMs,'deadline');
   if(confirmed)return{origin,status:200,buildId:target,attempts:attempt};
   if(attempt<6)await pause(Math.min(100,Math.max(0,deadlineAtMs-now())));
  }
  need(false,'target_unconfirmed');
 };
 // Wait for all siblings even if one refuses. No probe continues after this
 // function reports a failure and the caller begins its next recovery step.
 const results=await Promise.allSettled(origins.map(one));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 await verify();need(now()<deadlineAtMs,'deadline');return results.map(r=>r.value);
}
