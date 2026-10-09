// Original-operation discovery only. No catalogs, request bodies, or POST retry.
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { AttendanceCorrectionDelegationClient, correctionDelegationPendingKey, parseCorrectionDelegationPending } from "./merchantAttendanceCorrectionDelegationClient";
import { CORRECTION_DELEGATION_API, parseCorrectionDelegationJson, parseCorrectionDelegationHttpQuery, correctionDelegationOperation, type CorrectionDelegationAccess } from "./merchantAttendanceCorrectionDelegation";
import { periodClosureSame } from "./merchantAttendancePeriodClosure";
import type { AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import type { DelegationRecoveryStorage, DelegationRecoveryReceipt } from "./merchantAttendanceDelegationRecovery";

export type KnownCorrectionDelegationRecovery = Readonly<{kind:"correction";storageKey:string;siteId:string;access:CorrectionDelegationAccess;
  anchorId:string;authUserId:string;operationId:string;commandFingerprint:string}>;
export const CORRECTION_RECOVERY_PREFIX=/^faolla:attendance:correction-delegation:v1:/;
function lease(currentAuth:()=>boolean,signal?:AbortSignal){
  const controller=new AbortController(),deadline=performance.now()+12000,abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,12000);
  const current=()=>!controller.signal.aborted&&performance.now()<deadline&&currentAuth()&&!(typeof document!=="undefined"&&document.hidden);
  const guard=()=>{if(!current())throw Error("recovery_scope_changed");};
  const wait=async<T,>(work:()=>Promise<T>):Promise<T>=>{guard();let stop!:()=>void;
    const ended=new Promise<never>((_,reject)=>{stop=()=>reject(Error("recovery_scope_changed"));controller.signal.addEventListener("abort",stop,{once:true});});
    try{guard();const result=await Promise.race([work(),ended]);guard();return result;}finally{controller.signal.removeEventListener("abort",stop);}};
  return {current,guard,wait,signal:controller.signal,close:()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);abort();}};
}
type Lease=ReturnType<typeof lease>;
async function local(key:string,raw:string,auth:string,l:Lease){
  l.guard();if(key.length>200)throw Error("invalid_recovery_key");
  const match=/^faolla:attendance:correction-delegation:v1:(\d{8}):(owner|delegate):([0-9a-f-]{36})$/.exec(key);
  if(!match)throw Error("invalid_recovery_key");
  const p=captureBrowserExact(parseCorrectionDelegationJson(raw,"request"),["version","anchorId","actorId","employeeId","query","command","commandFingerprint"]);
  if(captureBrowserUuid(p.actorId)!==auth)return null;
  const siteId=match[1],access=match[2] as CorrectionDelegationAccess,anchorId=captureBrowserUuid(match[3]);
  if(correctionDelegationPendingKey(siteId,access,anchorId)!==key)throw Error("invalid_recovery_key");
  const pending=await l.wait(()=>parseCorrectionDelegationPending(raw,{siteId,access,anchorId}));l.guard();
  if(pending.actorId!==auth)throw Error("recovery_scope_changed");
  const entry:KnownCorrectionDelegationRecovery=Object.freeze({kind:"correction",storageKey:key,siteId,access,anchorId,authUserId:auth,
    operationId:correctionDelegationOperation(pending.command),commandFingerprint:pending.commandFingerprint});
  return {entry,pending};
}
export async function listKnownCorrectionDelegationRecoveries(storage:DelegationRecoveryStorage,authenticatedUserId:string,isCurrentAuth:()=>boolean,signal?:AbortSignal){
  const l=lease(isCurrentAuth,signal);try{l.guard();const auth=captureBrowserUuid(authenticatedUserId),count=storage.length;l.guard();
    if(!Number.isSafeInteger(count)||count<0||count>2048)throw Error("recovery_storage_limit");
    const keys:string[]=[];for(let n=0;n<count;n++){l.guard();const key=storage.key(n);l.guard();if(key&&CORRECTION_RECOVERY_PREFIX.test(key))keys.push(key);}
    if(keys.length>64||new Set(keys).size!==keys.length)throw Error("recovery_storage_limit");
    const entries:KnownCorrectionDelegationRecovery[]=[];let invalid=false;
    for(const key of keys){try{l.guard();const raw=storage.getItem(key);l.guard();if(raw===null)continue;
      const parsed=await local(key,raw,auth,l);l.guard();const now=storage.getItem(key);l.guard();if(now!==raw){invalid=true;continue;}if(parsed)entries.push(parsed.entry);
    }catch{l.guard();invalid=true;}}
    l.guard();return Object.freeze({entries:Object.freeze(entries),invalid});
  }finally{l.close();}
}
export async function recoverKnownCorrectionDelegation(entry:KnownCorrectionDelegationRecovery,options:AccountStatusRecoveryOptions):Promise<DelegationRecoveryReceipt|null>{
  const l=lease(options.isCurrentAuth,options.signal);let client:AttendanceCorrectionDelegationClient|undefined;
  const stop=()=>client?.pause();l.signal.addEventListener("abort",stop,{once:true});
  try{l.guard();const auth=captureBrowserUuid(options.authenticatedUserId);if(entry.authUserId!==auth)throw Error("recovery_scope_changed");
    const original=options.storage.getItem(entry.storageKey);l.guard();if(original===null)throw Error("recovery_record_changed");
    const parsed=await local(entry.storageKey,original,auth,l);l.guard();if(!parsed||!periodClosureSame(parsed.entry,entry))throw Error("recovery_record_changed");
    const expected=entry.access==="owner"?{siteId:entry.siteId,access:entry.access,mode:"recover",catalog:null,afterId:null,grantId:null,operationId:entry.operationId}
      :{siteId:entry.siteId,access:entry.access,mode:"recover",grantId:null,requestId:null,operationId:entry.operationId,beforeAt:null,beforeId:null,afterId:null};
    const locked={getItem:(key:string)=>{l.guard();if(key!==entry.storageKey)throw Error("recovery_key_changed");const raw=options.storage.getItem(key);l.guard();return raw;},
      setItem:()=>{throw Error("recovery_is_read_only");},removeItem:(key:string)=>{l.guard();if(key!==entry.storageKey)throw Error("recovery_key_changed");
        const raw=options.storage.getItem(key);l.guard();if(raw!==original)throw Error("recovery_record_changed");options.storage.removeItem(key);l.guard();}};
    client=new AttendanceCorrectionDelegationClient({siteId:entry.siteId,access:entry.access,actorId:entry.anchorId,expectedAuthUserId:auth,enabled:false,
      isCurrentAuth:l.current,storage:()=>locked,apiFetch:async(path,init)=>{l.guard();
        if(init?.method!=="GET"||init.body!=null||!path.startsWith(CORRECTION_DELEGATION_API+"?"))throw Error("recovery_is_read_only");
        const q=parseCorrectionDelegationHttpQuery("https://recovery.invalid"+path);if(!periodClosureSame(q,expected))throw Error("recovery_query_changed");
        const response=await options.apiFetch(path,init);l.guard();return response;}});
    await l.wait(()=>client!.initialize());l.guard();if(!periodClosureSame(client.getSnapshot().pending,parsed.pending))throw Error("recovery_record_changed");
    await l.wait(()=>client!.recover());l.guard();const state=client.getSnapshot(),result=state.result,r=result?.receipt;
    if(state.pending||!r)return null;
    if(result.actorId!==auth||r.operationId!==entry.operationId||r.commandFingerprint!==entry.commandFingerprint)throw Error("recovery_receipt_changed");
    return Object.freeze({operationId:r.operationId,action:r.action,grantId:r.grantId,requestId:"requestId" in r?r.requestId:null,actorId:auth,recordedAt:r.recordedAt});
  }finally{l.signal.removeEventListener("abort",stop);client?.dispose();l.close();}
}
