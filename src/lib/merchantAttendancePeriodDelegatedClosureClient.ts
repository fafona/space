import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { periodClosureSame } from "./merchantAttendancePeriodClosure";
import { PERIOD_DELEGATED_CLOSURE_API, PERIOD_DELEGATED_CLOSURE_ERRORS, parsePeriodDelegatedClosureQuery,
  parsePeriodDelegatedClosureBody, parsePeriodDelegatedClosureResponse, periodDelegatedClosureQueryString, periodDelegatedClosureFingerprintText,
  type PeriodDelegatedClosureQuery, type PeriodDelegatedClosureCommand, type PeriodDelegatedClosureResult,
  type PeriodDelegatedClosureSummary, type PeriodDelegatedClosureListItem } from "./merchantAttendancePeriodDelegatedClosure";

export type PeriodDelegatedClosureStorage = Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type PeriodDelegatedClosureScope = { siteId:string; actorEmployeeId:string; expectedAuthUserId:string; grantId:string; workerId:string;
  targetEmployeeId:string; targetAuthUserId:string; authorizedFromDate:string; authorizedThroughDate:string };
export type PeriodDelegatedClosureClientOptions = PeriodDelegatedClosureScope & { fromDate:string; throughDate:string; enabled:boolean;
  apiFetch:AttendanceApiFetch; storage:()=>PeriodDelegatedClosureStorage; isCurrentAuth?:()=>boolean; randomId?:()=>string; timeoutMs?:number };
export type PeriodDelegatedClosurePending = { format:1; scope:PeriodDelegatedClosureScope; query:PeriodDelegatedClosureQuery;
  command:PeriodDelegatedClosureCommand; commandFingerprint:string };
export type PeriodDelegatedClosureView = PeriodDelegatedClosureResult & {moduleEnabled:boolean};
export type PeriodDelegatedClosureClientState = Readonly<{phase:"idle"|"loading"|"ready"|"saving"|"unconfirmed"|"blocked";
  query:PeriodDelegatedClosureQuery|null; result:PeriodDelegatedClosureView|null; pending:PeriodDelegatedClosurePending|null; message:string}>;
type Lease={epoch:number;controller:AbortController;deadline:number};
type Navigation={periodId:string;fromDate:string;throughDate:string};
const scopeKeys=["siteId","actorEmployeeId","expectedAuthUserId","grantId","workerId","targetEmployeeId","targetAuthUserId","authorizedFromDate","authorizedThroughDate"] as const;
const hidden=()=>typeof document!=="undefined"&&document.hidden;
function freeze<T>(value:T):T {if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function date(value:unknown):string {if(typeof value!=="string"||!/^(?:20\d{2}|2100)-\d\d-\d\d$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))
  ||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw Error("invalid_scope");return value;}
function checkedScope(raw:unknown):PeriodDelegatedClosureScope {
  const v=captureBrowserExact(raw,scopeKeys);if(typeof v.siteId!=="string"||!/^\d{8}$/.test(v.siteId))throw Error("invalid_scope");
  const actorEmployeeId=captureBrowserUuid(v.actorEmployeeId),expectedAuthUserId=captureBrowserUuid(v.expectedAuthUserId),targetEmployeeId=captureBrowserUuid(v.targetEmployeeId),targetAuthUserId=captureBrowserUuid(v.targetAuthUserId);
  const authorizedFromDate=date(v.authorizedFromDate),authorizedThroughDate=date(v.authorizedThroughDate);
  if(actorEmployeeId===targetEmployeeId||expectedAuthUserId===targetAuthUserId||authorizedFromDate>authorizedThroughDate)throw Error("invalid_scope");
  return {siteId:v.siteId,actorEmployeeId,expectedAuthUserId,grantId:captureBrowserUuid(v.grantId),workerId:captureBrowserUuid(v.workerId),targetEmployeeId,targetAuthUserId,authorizedFromDate,authorizedThroughDate};
}
export function periodDelegatedClosurePendingKey(raw:PeriodDelegatedClosureScope):string {
  const s=checkedScope(raw);return `faolla:attendance:period-delegated-closure:v1:${s.siteId}:${s.actorEmployeeId}:${s.expectedAuthUserId}:${s.grantId}:${s.workerId}:${s.targetEmployeeId}:${s.targetAuthUserId}`;
}

/** Independent delegated workspace. It never exposes employee confirmation,
 * dispute, export, automatic refresh, or POST replay. Errors retain intent. */
export class AttendancePeriodDelegatedClosureClient {
  readonly storageKey:string;private readonly o:PeriodDelegatedClosureClientOptions;private readonly scope:PeriodDelegatedClosureScope;
  private state:PeriodDelegatedClosureClientState=freeze({phase:"idle",query:null,result:null,pending:null,message:"请明确读取受托周期；不会自动提交。"});
  private epoch=0;private controller:AbortController|null=null;private initialized=false;private raw:string|null=null;
  private navigation:Navigation|null=null;private listeners=new Set<()=>void>();
  constructor(options:PeriodDelegatedClosureClientOptions){
    this.scope=freeze(checkedScope(Object.fromEntries(scopeKeys.map(k=>[k,options[k]]))));this.storageKey=periodDelegatedClosurePendingKey(this.scope);
    if(typeof options.enabled!=="boolean"||typeof options.apiFetch!=="function"||typeof options.storage!=="function"
      ||options.isCurrentAuth!==undefined&&typeof options.isCurrentAuth!=="function"||options.randomId!==undefined&&typeof options.randomId!=="function"
      ||options.timeoutMs!==undefined&&(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>12000))throw Error("invalid_options");
    this.o=Object.freeze({...options});this.query("list");
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<PeriodDelegatedClosureClientState>){const next=this.state=freeze({...this.state,...patch});for(const listener of [...this.listeners]){if(this.state!==next)break;try{listener();}catch{/* No observer can authorize writes. */}}}
  pause=()=>{const epoch=++this.epoch,old=this.controller;this.controller=null;this.initialized=false;this.navigation=null;old?.abort();
    if(epoch===this.epoch)this.publish({query:null,result:null,phase:this.state.pending?"unconfirmed":"idle",message:"资料已清除，原编号保留；重新核验后只读恢复。"});};
  invalidate=this.pause;
  hasLeaveRisk=()=>{if(this.controller||this.state.pending)return true;try{return this.o.storage().getItem(this.storageKey)!==null;}catch{return true;}};
  private begin():Lease|null {if(hidden()||this.o.isCurrentAuth?.()===false){this.pause();return null;}if(this.controller)return null;
    const l={epoch:++this.epoch,controller:new AbortController(),deadline:performance.now()+(this.o.timeoutMs??12000)};this.controller=l.controller;return l;}
  private guard(l:Lease){if(l.epoch===this.epoch&&(hidden()||this.o.isCurrentAuth?.()===false))this.pause();
    if(performance.now()>=l.deadline)l.controller.abort();if(l.epoch!==this.epoch||this.controller!==l.controller||l.controller.signal.aborted)throw Error("stale_scope");}
  private release(l:Lease){if(l.epoch===this.epoch&&this.controller===l.controller)this.controller=null;}
  private async bounded<T>(l:Lease,run:()=>Promise<T>):Promise<T>{this.guard(l);let reject!:(error:Error)=>void;
    const stopped=new Promise<never>((_,r)=>{reject=r;});const abort=()=>reject(Error("aborted_or_timeout"));
    const timer=setTimeout(()=>{l.controller.abort();abort();},Math.max(0,l.deadline-performance.now()));l.controller.signal.addEventListener("abort",abort,{once:true});
    try{const result=await Promise.race([Promise.resolve().then(()=>{this.guard(l);return run();}),stopped]);this.guard(l);return result;}
    finally{clearTimeout(timer);l.controller.signal.removeEventListener("abort",abort);}}
  private async fingerprint(q:PeriodDelegatedClosureQuery,c:PeriodDelegatedClosureCommand,l:Lease){
    return this.bounded(l,async()=>{const bytes=new TextEncoder().encode(periodDelegatedClosureFingerprintText(q,c));const hash=await crypto.subtle.digest("SHA-256",bytes);
      this.guard(l);if(hash.byteLength!==32)throw Error("invalid_digest");return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");});}
  private stored(l:Lease){this.guard(l);const storage=this.o.storage();this.guard(l);const raw=storage.getItem(this.storageKey);this.guard(l);return{storage,raw};}
  private verify(l:Lease){const v=this.stored(l);if(v.raw!==this.raw)throw Error("pending_changed");return v.storage;}
  private failed(l:Lease){if(l.epoch!==this.epoch)return;if(hidden()||this.o.isCurrentAuth?.()===false){this.pause();return;}this.navigation=null;
    this.publish({result:null,query:null,phase:this.state.pending?"unconfirmed":"blocked",message:this.state.pending
      ?"结果尚未核实；保留原编号，只能GET核对，不自动重发。查无回执不表示失败。":"无法核验受托范围或本地原号，资料已隐藏。"});}
  private boundQuery(q:PeriodDelegatedClosureQuery){const s=this.scope;
    if(q.siteId!==s.siteId||q.access!=="delegate"||q.grantId!==s.grantId||q.workerId!==s.workerId||q.fromDate<s.authorizedFromDate||q.throughDate>s.authorizedThroughDate)throw Error("scope_mismatch");return q;}
  private query(mode:PeriodDelegatedClosureQuery["mode"],periodId:string|null=null,version:number|null=null){
    const range=periodId!==null&&this.navigation?.periodId===periodId?this.navigation:this.o;
    return this.boundQuery(parsePeriodDelegatedClosureQuery({siteId:this.scope.siteId,access:"delegate",grantId:this.scope.grantId,workerId:this.scope.workerId,
      fromDate:range.fromDate,throughDate:range.throughDate,mode,periodId,operationId:null,version,cursor:null}));}
  initialize=async()=>{const l=this.begin();if(!l)return;try{const {raw}=this.stored(l);if(this.state.pending&&raw!==this.raw)throw Error("pending_changed");
    let pending:PeriodDelegatedClosurePending|null=null;
    if(raw!==null){if(new TextEncoder().encode(raw).length>8192)throw Error("pending_too_large");
      const v=captureBrowserExact(parseCaptureBrowserJson(raw),["format","scope","query","command","commandFingerprint"]),scope=checkedScope(v.scope);
      const {query,command}=parsePeriodDelegatedClosureBody({query:v.query,command:v.command});this.boundQuery(query);
      if(v.format!==1||!periodClosureSame(scope,this.scope))throw Error("pending_identity");const commandFingerprint=await this.fingerprint(query,command,l);
      if(v.commandFingerprint!==commandFingerprint)throw Error("pending_fingerprint");pending={format:1,scope,query,command,commandFingerprint};}
    if(this.stored(l).raw!==raw)throw Error("pending_changed");this.raw=raw;this.initialized=true;this.navigation=null;
    this.publish({pending,query:null,result:null,phase:pending?"unconfirmed":"idle",message:pending?"发现原编号，请明确只读核对；不自动重发。":"请明确读取当前受托范围。"});
  }catch{this.failed(l);}finally{this.release(l);}};
  private async transport(q:PeriodDelegatedClosureQuery,c:PeriodDelegatedClosureCommand|null,l:Lease){let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const cancel=()=>{void reader?.cancel().catch(()=>{});};l.controller.signal.addEventListener("abort",cancel,{once:true});
    try{return await this.bounded(l,async()=>{const response=await this.o.apiFetch(c?PERIOD_DELEGATED_CLOSURE_API:`${PERIOD_DELEGATED_CLOSURE_API}?${periodDelegatedClosureQueryString(q)}`,{
      method:c?"POST":"GET",headers:{Accept:"application/json",...(c?{"Content-Type":"application/json"}:{})},...(c?{body:JSON.stringify({query:q,command:c})}:{}),
      signal:l.controller.signal,cache:"no-store",redirect:"error"});
      try{this.guard(l);}catch(error){void response.body?.cancel().catch(()=>{});throw error;}
      if(response.redirected||response.ok&&response.status!==200||response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"){
        void response.body?.cancel().catch(()=>{});throw Error("invalid_response");}
      reader=response.body?.getReader();if(!reader)throw Error("empty_response");const decoder=new TextDecoder("utf-8",{fatal:true});let text="",bytes=0;
      try{while(true){const part=await reader.read();this.guard(l);if(part.done)break;bytes+=part.value.byteLength;if(bytes>(response.status===200?4194304:4096))throw Error("too_large");text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
      finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
      this.guard(l);const raw=parseCaptureBrowserJson(text);if(response.status!==200){const e=captureBrowserExact(raw,["ok","error"]);
        if(e.ok!==false||typeof e.error!=="string"||!Object.hasOwn(PERIOD_DELEGATED_CLOSURE_ERRORS,e.error)||PERIOD_DELEGATED_CLOSURE_ERRORS[e.error]!==response.status)throw Error("invalid_error");throw Error(e.error);}
      return raw;});}finally{l.controller.signal.removeEventListener("abort",cancel);}}
  private parse(raw:unknown,q:PeriodDelegatedClosureQuery,c:PeriodDelegatedClosureCommand|null):PeriodDelegatedClosureView{
    const s=this.scope,value=parsePeriodDelegatedClosureResponse(raw,q,{authUserId:s.expectedAuthUserId,employeeId:s.actorEmployeeId,targetEmployeeId:s.targetEmployeeId,targetAuthUserId:s.targetAuthUserId},c),r=value.data;
    const periods=r.kind==="list"?r.items:r.kind==="preview"?(r.preview.period?[r.preview.period]:[]):"period" in r?[r.period]:[];
    if(periods.some(p=>p.fromDate<s.authorizedFromDate||p.throughDate>s.authorizedThroughDate))throw Error("scope_mismatch");return{...r,moduleEnabled:value.moduleEnabled};}
  private clear(l:Lease){const storage=this.verify(l);this.guard(l);storage.removeItem(this.storageKey);this.guard(l);if(this.stored(l).raw!==null)throw Error("pending_changed");
    this.raw=null;this.publish({pending:null});this.guard(l);}
  private settle(r:PeriodDelegatedClosureView,l:Lease){const p=this.state.pending;if(!p||r.kind!=="receipt"||!r.receipt)return false;const receipt=r.receipt;
    if(receipt.actorId!==this.scope.expectedAuthUserId||receipt.operationId!==p.command.operationId||receipt.action!==p.command.action||receipt.grantId!==p.query.grantId
      ||receipt.grantRevision!==1||receipt.periodId!==p.command.periodId||receipt.periodRevision!==p.command.expectedRevision+1||receipt.commandFingerprint!==p.commandFingerprint)throw Error("receipt_mismatch");
    this.clear(l);this.navigation={periodId:p.command.periodId,fromDate:p.query.fromDate,throughDate:p.query.throughDate};return true;}
  private async get(q:PeriodDelegatedClosureQuery,navigate=false){const l=this.begin();if(!l)return;try{
    if(!this.initialized||q.mode!=="recover"&&(this.state.pending||!this.o.enabled))return;this.boundQuery(q);this.verify(l);
    this.publish({phase:"loading",query:null,result:null,message:"正在重新核验本页授权，不自动加载其他页…"});this.guard(l);
    const raw=await this.transport(q,null,l);this.guard(l);this.verify(l);const result=this.parse(raw,q,null);this.settle(result,l);this.guard(l);
    if(q.mode==="list")this.navigation=null;else if(navigate&&q.periodId)this.navigation={periodId:q.periodId,fromDate:q.fromDate,throughDate:q.throughDate};
    this.publish({result,query:q,phase:this.state.pending?"unconfirmed":"ready",message:this.state.pending?"尚无匹配回执，原编号保留。":result.kind==="receipt"
      ?"已核实最小回执；请明确重读当前周期，回执不恢复当前权限。":"已读取本页；任何新操作仍须明确提交并由服务器重新核权。"});
  }catch{this.failed(l);}finally{this.release(l);}}
  load=async()=>{await this.get(this.query("list"));};
  private known(id:string){return this.navigation?.periodId===id||this.state.result?.kind==="list"&&this.state.result.items.some(p=>p.periodId===id);}
  selectPeriod=async(item:PeriodDelegatedClosureListItem)=>{const r=this.state.result;if(this.controller||this.state.pending||this.state.phase!=="ready"||r?.kind!=="list"||!r.items.some(x=>periodClosureSame(x,item)))return;
    await this.get(this.boundQuery(parsePeriodDelegatedClosureQuery({...this.query("detail",item.periodId),fromDate:item.fromDate,throughDate:item.throughDate})),true);};
  preview=async(periodId:string|null=null)=>{if(periodId!==null&&!this.known(periodId))return;
    const item=this.state.result?.kind==="list"?this.state.result.items.find(x=>x.periodId===periodId):null;
    await this.get(item?this.boundQuery(parsePeriodDelegatedClosureQuery({...this.query("preview",periodId),fromDate:item.fromDate,throughDate:item.throughDate})):this.query("preview",periodId),periodId!==null);};
  detail=async(periodId:string,version:number|null=null)=>{if(!this.known(periodId))return;const item=this.state.result?.kind==="list"?this.state.result.items.find(x=>x.periodId===periodId):null;
    await this.get(item?this.boundQuery(parsePeriodDelegatedClosureQuery({...this.query("detail",periodId,version),fromDate:item.fromDate,throughDate:item.throughDate})):this.query("detail",periodId,version),true);};
  history=async(periodId:string)=>{if(this.navigation?.periodId===periodId)await this.get(this.query("history",periodId));};
  versions=async(periodId:string)=>{if(this.navigation?.periodId===periodId)await this.get(this.query("versions",periodId));};
  next=async()=>{const r=this.state.result,q=this.state.query;if(q&&r&&"nextCursor" in r&&r.nextCursor)await this.get(this.boundQuery(parsePeriodDelegatedClosureQuery({...q,cursor:r.nextCursor})));};
  recover=async()=>{const p=this.state.pending;if(p)await this.get(this.boundQuery(parsePeriodDelegatedClosureQuery({...p.query,mode:"recover",operationId:p.command.operationId,version:null,cursor:null})));};
  private async write(action:PeriodDelegatedClosureCommand["action"],reason:string){const r=this.state.result,viewed=this.state.query;
    if(!this.initialized||this.state.pending||this.state.phase!=="ready"||!r||!viewed||!this.o.enabled||!r.moduleEnabled||!r.usableActions.includes(action))return;
    const period:PeriodDelegatedClosureSummary|null=r.kind==="preview"?r.preview.period:r.kind==="detail"?r.period:null;
    const artifact=r.kind==="preview"?r.preview.artifact:r.kind==="detail"?r.artifact:null;
    if(action==="send"?r.kind!=="preview"||viewed.mode!=="preview"||r.preview.blockers.some(b=>b==="period_in_progress"||b==="unresolved_outage")||period?.sealed
      :r.kind!=="detail"||viewed.mode!=="detail"||viewed.version!==null||this.navigation?.periodId!==viewed.periodId||!period||r.artifactVersion!==period.currentVersion)return;
    if(action==="reopen"?!period?.sealed:period?.sealed)return;
    if(action==="seal"&&(r.kind!=="detail"||r.sourceChanged!==false||!artifact||!period||period.confirmedVersion!==period.currentVersion||period.unresolvedDispute))return;
    const l=this.begin();if(!l)return;try{this.verify(l);const id=()=>captureBrowserUuid((this.o.randomId??(()=>crypto.randomUUID()))());
      const operationId=id();this.guard(l);const periodId=period?.periodId??viewed.periodId??id();this.guard(l);
      const q=this.boundQuery(parsePeriodDelegatedClosureQuery({...viewed,mode:"detail",periodId,version:null,cursor:null,operationId:null}));
      const {command}=parsePeriodDelegatedClosureBody({query:q,command:{action,operationId,periodId,expectedRevision:period?.revision??0,expectedVersion:period?.currentVersion??0,
        expectedFingerprint:action==="send"||action==="seal"?artifact?.sourceFingerprint??null:null,reason:reason.trim()}});
      this.publish({phase:"saving",query:null,result:null,message:"正在固定本次意图；不会代员工确认。"});this.guard(l);
      const commandFingerprint=await this.fingerprint(q,command,l);this.guard(l);
      const pending:PeriodDelegatedClosurePending=freeze({format:1,scope:this.scope,query:q,command,commandFingerprint}),raw=JSON.stringify(pending);
      if(new TextEncoder().encode(raw).length>8192)throw Error("pending_too_large");const storage=this.verify(l);storage.setItem(this.storageKey,raw);this.guard(l);
      if(this.stored(l).raw!==raw)throw Error("pending_changed");this.raw=raw;this.publish({pending,message:"原号已保存，只提交一次；未知结果保留编号。"});this.guard(l);this.verify(l);
      const response=await this.transport(q,command,l);this.guard(l);this.verify(l);const result=this.parse(response,q,command);
      if(!this.settle(result,l))throw Error("receipt_missing");this.guard(l);
      this.publish({phase:"ready",result,query:q,message:"已核实本次回执；请明确重读当前周期，不能沿回执继续审批。"});
    }catch{this.failed(l);}finally{this.release(l);}}
  send=(reason:string="")=>this.write("send",reason);
  respond=(reason:string)=>this.write("respond",reason);
  seal=(reason:string)=>this.write("seal",reason);
  reopen=(reason:string)=>this.write("reopen",reason);
}
