// Only exact intents already saved in this tab; no directory, source or POST.
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { AttendancePeriodDelegationClient } from "./merchantAttendancePeriodDelegationClient";
import { AttendancePeriodDelegatedClosureClient, type PeriodDelegatedClosureScope } from "./merchantAttendancePeriodDelegatedClosureClient";
import { PERIOD_DELEGATION_API, parsePeriodDelegationBody, parsePeriodDelegationHttpQuery } from "./merchantAttendancePeriodDelegation";
import { PERIOD_DELEGATED_CLOSURE_API, parsePeriodDelegatedClosureBody, parsePeriodDelegatedClosureHttpQuery } from "./merchantAttendancePeriodDelegatedClosure";
import { periodClosureSame } from "./merchantAttendancePeriodClosure";
import type { AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export type KnownPeriodRecovery = Readonly<{kind:"period-delegation"|"period-closure";storageKey:string;siteId:string;
  authUserId:string;operationId:string;commandFingerprint:string}>;
export type PeriodRecoveryReceipt = Readonly<{operationId:string;action:"grant"|"revoke"|"send"|"respond"|"seal"|"reopen";
  actorId:string;grantId:string;grantRevision:number;periodId:string|null;periodRevision:number|null;recordedAt:string}>;
export const PERIOD_RECOVERY_PREFIX=/^faolla:attendance:period-(delegation|delegated-closure):v1:/;
const keys=["siteId","actorEmployeeId","expectedAuthUserId","grantId","workerId","targetEmployeeId","targetAuthUserId","authorizedFromDate","authorizedThroughDate"];
type ScopeGuard=()=>void;

function localIntent(key:string,raw:string,auth:string,storage:()=>Pick<Storage,"getItem"|"setItem"|"removeItem">,apiFetch:AttendanceApiFetch,isCurrentAuth:()=>boolean){
  if(!PERIOD_RECOVERY_PREFIX.test(key)||key.length>400||new TextEncoder().encode(raw).length>8192)throw Error("invalid_recovery_record");
  const closure=key.startsWith("faolla:attendance:period-delegated-closure:v1:"),value=parseCaptureBrowserJson(raw);
  if(closure){
    const p=captureBrowserExact(value,["format","scope","query","command","commandFingerprint"]),s=captureBrowserExact(p.scope,keys);
    if(captureBrowserUuid(s.expectedAuthUserId)!==auth)return null;
    const {query}=parsePeriodDelegatedClosureBody({query:p.query,command:p.command});
    // Constructor + initialize revalidate the exact full scope, query and SHA.
    const client=new AttendancePeriodDelegatedClosureClient({...s as PeriodDelegatedClosureScope,fromDate:query.fromDate,throughDate:query.throughDate,
      enabled:false,storage,apiFetch,isCurrentAuth});
    if(client.storageKey!==key)throw Error("invalid_recovery_key");
    return {kind:"period-closure" as const,client,siteId:query.siteId,recoverQuery:{...query,mode:"recover",operationId:captureBrowserExact(p.command,["action","operationId","periodId","expectedRevision","expectedVersion","expectedFingerprint","reason"]).operationId,version:null,cursor:null}};
  }
  const p=captureBrowserExact(value,["version","anchorId","actorId","employeeId","query","command","commandFingerprint"]);
  if(captureBrowserUuid(p.actorId)!==auth)return null;
  const {query,command}=parsePeriodDelegationBody({query:p.query,command:p.command});
  const client=new AttendancePeriodDelegationClient({siteId:query.siteId,access:query.access,actorId:captureBrowserUuid(p.anchorId),expectedAuthUserId:auth,
    enabled:false,recoveryOnly:true,storage,apiFetch,isCurrentAuth});
  if(client.storageKey!==key)throw Error("invalid_recovery_key");
  return {kind:"period-delegation" as const,client,siteId:query.siteId,recoverQuery:{...query,mode:"recover",catalog:null,grantId:null,afterId:null,operationId:command.operationId}};
}
function lease(isCurrentAuth:()=>boolean,signal?:AbortSignal){
  const controller=new AbortController(),deadline=performance.now()+12000,abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,12000);
  const current=()=>!controller.signal.aborted&&performance.now()<deadline&&isCurrentAuth()&&!(typeof document!=="undefined"&&document.hidden);
  const guard=()=>{if(!current())throw Error("recovery_scope_changed");};
  return {signal:controller.signal,current,guard,close:()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);abort();}};
}
function description(kind:KnownPeriodRecovery["kind"],key:string,siteId:string,auth:string,client:AttendancePeriodDelegationClient|AttendancePeriodDelegatedClosureClient):KnownPeriodRecovery{
  const p=client.getSnapshot().pending;if(!p)throw Error("invalid_recovery_record");
  return Object.freeze({kind,storageKey:key,siteId,authUserId:auth,operationId:p.command.operationId,commandFingerprint:p.commandFingerprint});
}
async function parseLocal(key:string,raw:string,auth:string,guard:ScopeGuard,current:()=>boolean,signal:AbortSignal){
  guard();const intent=localIntent(key,raw,auth,()=>({getItem:k=>{guard();if(k!==key)throw Error("recovery_key_changed");return raw;},
    setItem:()=>{throw Error("recovery_is_read_only");},removeItem:()=>{throw Error("recovery_is_read_only");}}),async()=>{throw Error("recovery_is_local_only");},current);
  if(!intent)return null;const stop=()=>intent.client.pause();signal.addEventListener("abort",stop,{once:true});
  try{guard();await intent.client.initialize();guard();return description(intent.kind,key,intent.siteId,auth,intent.client);}
  finally{signal.removeEventListener("abort",stop);intent.client.pause();}
}
export async function listKnownPeriodRecoveries(storage:DelegationRecoveryStorage,authenticatedUserId:string,isCurrentAuth:()=>boolean,signal?:AbortSignal){
  const l=lease(isCurrentAuth,signal);try{l.guard();const auth=captureBrowserUuid(authenticatedUserId),count=storage.length;l.guard();
    if(!Number.isSafeInteger(count)||count<0||count>2048)throw Error("recovery_storage_limit");
    const selected:string[]=[];for(let n=0;n<count;n++){l.guard();const key=storage.key(n);l.guard();if(key&&PERIOD_RECOVERY_PREFIX.test(key))selected.push(key);}
    if(selected.length>64||new Set(selected).size!==selected.length)throw Error("recovery_storage_limit");
    const entries:KnownPeriodRecovery[]=[];let invalid=false;
    for(const key of selected){l.guard();try{const raw=storage.getItem(key);l.guard();if(raw===null)continue;
      const entry=await parseLocal(key,raw,auth,l.guard,l.current,l.signal);l.guard();const now=storage.getItem(key);l.guard();
      if(now!==raw){invalid=true;continue;}if(entry)entries.push(entry);
    }catch{l.guard();invalid=true;}}
    l.guard();return Object.freeze({entries:Object.freeze(entries),invalid});
  }finally{l.close();}
}
export async function recoverKnownPeriod(entry:KnownPeriodRecovery,options:AccountStatusRecoveryOptions):Promise<PeriodRecoveryReceipt|null>{
  const l=lease(options.isCurrentAuth,options.signal);let client:AttendancePeriodDelegationClient|AttendancePeriodDelegatedClosureClient|undefined;
  const stop=()=>client?.pause();l.signal.addEventListener("abort",stop,{once:true});
  try{l.guard();const auth=captureBrowserUuid(options.authenticatedUserId);if(entry.authUserId!==auth)throw Error("recovery_scope_changed");
    const original=options.storage.getItem(entry.storageKey);l.guard();if(original===null)throw Error("recovery_record_changed");
    const locked={getItem:(key:string)=>{l.guard();if(key!==entry.storageKey)throw Error("recovery_key_changed");const value=options.storage.getItem(key);l.guard();return value;},
      setItem:()=>{throw Error("recovery_is_read_only");},removeItem:(key:string)=>{l.guard();if(key!==entry.storageKey)throw Error("recovery_key_changed");
        const raw=options.storage.getItem(key);l.guard();if(raw!==original)throw Error("recovery_record_changed");options.storage.removeItem(key);l.guard();}};
    const intent:ReturnType<typeof localIntent>=localIntent(entry.storageKey,original,auth,()=>locked,async(path,init)=>{
      l.guard();const endpoint=entry.kind==="period-closure"?PERIOD_DELEGATED_CLOSURE_API:PERIOD_DELEGATION_API;
      if(init?.method!=="GET"||init.body!=null||!path.startsWith(endpoint+"?"))throw Error("recovery_is_read_only");
      const q=entry.kind==="period-closure"?parsePeriodDelegatedClosureHttpQuery("https://recovery.invalid"+path):parsePeriodDelegationHttpQuery("https://recovery.invalid"+path);
      if(!intent||!periodClosureSame(q,intent.recoverQuery))throw Error("recovery_query_changed");
      return options.apiFetch(path,init);
    },l.current);
    if(!intent)throw Error("recovery_scope_changed");client=intent.client;await client.initialize();l.guard();
    if(!periodClosureSame(description(intent.kind,entry.storageKey,intent.siteId,auth,client),entry))throw Error("recovery_record_changed");
    await client.recover();l.guard();const state=client.getSnapshot(),result=state.result,r=result&&"receipt" in result?result.receipt:null;
    if(state.pending||!r)return null;
    if(r.actorId!==auth||r.operationId!==entry.operationId||r.commandFingerprint!==entry.commandFingerprint)throw Error("recovery_receipt_changed");
    return Object.freeze({operationId:r.operationId,action:r.action,actorId:r.actorId,grantId:r.grantId,grantRevision:r.grantRevision,periodId:r.periodId,periodRevision:r.periodRevision,recordedAt:r.recordedAt});
  }finally{l.signal.removeEventListener("abort",stop);client?.pause();l.close();}
}
