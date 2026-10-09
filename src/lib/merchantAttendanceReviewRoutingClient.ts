// A durable full-intent slot is retired only by the exact original actor receipt.
// Initializing is local; every read and the single POST require explicit intent.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { REVIEW_ROUTING_API, REVIEW_ROUTING_ERRORS, REVIEW_ROUTING_RESPONSE_LIMIT, parseReviewRoutingBody, parseReviewRoutingQuery, parseReviewRoutingJson, parseReviewRoutingResponse, reviewRoutingCommandFingerprint, reviewRoutingReceiptMatches, reviewRoutingQueryString, type ReviewRoutingQuery, type ReviewRoutingCommand, type ReviewRoutingResult, type ReviewRoutingFamily, type ReviewRoutingRequest } from "./merchantAttendanceReviewRouting";
export type ReviewRoutingStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type ReviewRoutingPending=Readonly<{protocol:"attendance-review-routing-pending-v1";version:1;actorId:string;query:Extract<ReviewRoutingQuery,{mode:"detail"|"self"}>;command:ReviewRoutingCommand;commandFingerprint:string}>;
export type ReviewRoutingClientOptions={siteId:string;authUserId:string;enabled:boolean;apiFetch:AttendanceApiFetch;storage:()=>ReviewRoutingStorage;isCurrentAuth:()=>boolean;timeoutMs?:number;randomId?:()=>string};
export type ReviewRoutingClientState=Readonly<{phase:"idle"|"loading"|"ready"|"saving"|"unconfirmed"|"blocked";query:ReviewRoutingQuery|null;result:ReviewRoutingResult|null;pending:ReviewRoutingPending|null;message:string}>;
type Lease={generation:number;controller:AbortController;deadline:number;timer:ReturnType<typeof setTimeout>;interrupted:Promise<never>};
class StorageFailure extends Error{}
const hidden=()=>typeof document!=="undefined"&&document.hidden;
export function reviewRoutingPendingKey(siteId:string,authUserId:string):string{
  parseReviewRoutingQuery({siteId,mode:"recover",family:"correction",operationId:authUserId});return `faolla:attendance:review-routing:v1:${siteId}:${authUserId}`;
}
export async function parseReviewRoutingPending(raw:string,expected:{siteId:string;authUserId:string}):Promise<ReviewRoutingPending>{
  reviewRoutingPendingKey(expected.siteId,expected.authUserId);const p=captureBrowserExact(parseReviewRoutingJson(raw,"request"),["protocol","version","actorId","query","command","commandFingerprint"]);
  const {query,command}=parseReviewRoutingBody({query:p.query,command:p.command});
  if(p.protocol!=="attendance-review-routing-pending-v1"||p.version!==1||p.actorId!==expected.authUserId||query.siteId!==expected.siteId)throw new StorageFailure("pending_identity");
  const commandFingerprint=await reviewRoutingCommandFingerprint(query,expected.authUserId,command);if(p.commandFingerprint!==commandFingerprint)throw new StorageFailure("pending_hash");
  return freeze({protocol:"attendance-review-routing-pending-v1",version:1,actorId:expected.authUserId,query,command,commandFingerprint});
}
export class AttendanceReviewRoutingClient{
  readonly storageKey:string;private readonly o:ReviewRoutingClientOptions;
  private state:ReviewRoutingClientState=freeze({phase:"idle",query:null,result:null,pending:null,message:"请明确读取办理责任。"});private pending:ReviewRoutingPending|null=null;private raw:string|null=null;
  private loaded=false;private disposed=false;private generation=0;private controller:AbortController|null=null;private listeners=new Set<()=>void>();private selectedGrant:string|null=null;private grantRequest:string|null=null;
  constructor(options:ReviewRoutingClientOptions){this.storageKey=reviewRoutingPendingKey(options.siteId,options.authUserId);
    if(typeof options.enabled!=="boolean"||typeof options.apiFetch!=="function"||typeof options.storage!=="function"||typeof options.isCurrentAuth!=="function"||options.randomId!==undefined&&typeof options.randomId!=="function"||options.timeoutMs!==undefined&&(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>12000))throw Error("attendance_invalid_request");this.o=Object.freeze({...options});}
  getSnapshot=()=>this.state;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private emit(value:Partial<ReviewRoutingClientState>){const next=this.state=freeze({...this.state,...value,pending:this.pending});for(const listener of [...this.listeners]){if(next!==this.state)break;try{listener();}catch{/* observers do not authorize transport */}}}
  private current(){try{return !this.disposed&&this.o.isCurrentAuth();}catch{return false;}}
  pause=()=>{const generation=++this.generation,controller=this.controller;this.controller=null;this.selectedGrant=null;this.grantRequest=null;controller?.abort();if(generation===this.generation)this.emit({query:null,result:null,phase:this.pending?"unconfirmed":"idle",message:"资料已隐藏；待确认原编号保留。"});};
  dispose=()=>{this.pause();this.disposed=true;this.listeners.clear();};
  hasLeaveRisk=()=>{if(!this.current()||this.controller||this.pending)return true;try{const s=this.o.storage();if(!this.current())return true;return s.getItem(this.storageKey)!==null;}catch{return true;}};
  private begin(local=false):Lease|null{if(!this.current()||this.controller)return null;if(!local&&hidden()){this.pause();return null;}const controller=new AbortController(),limit=this.o.timeoutMs??12000;
    const interrupted=new Promise<never>((_,reject)=>controller.signal.addEventListener("abort",()=>reject(Error("aborted_or_timeout")),{once:true}));void interrupted.catch(()=>{});const l={generation:++this.generation,controller,deadline:performance.now()+limit,timer:setTimeout(()=>controller.abort(),limit),interrupted};this.controller=controller;return l;}
  private guard(l:Lease,local=false){if(l.generation===this.generation&&(!this.current()||!local&&hidden()))this.pause();if(!this.current()||l.generation!==this.generation||this.controller!==l.controller||l.controller.signal.aborted||performance.now()>=l.deadline)throw Error("stale_scope");}
  private async wait<T>(l:Lease,promise:Promise<T>,local=false){const value=await Promise.race([promise,l.interrupted]);this.guard(l,local);return value;}
  private release(l:Lease){clearTimeout(l.timer);if(l.generation===this.generation&&this.controller===l.controller)this.controller=null;}
  private stored(l:Lease,local=false){this.guard(l,local);const storage=this.o.storage();this.guard(l,local);const raw=storage.getItem(this.storageKey);this.guard(l,local);return{storage,raw};}
  private verify(l:Lease,local=false){const saved=this.stored(l,local);if(saved.raw!==this.raw)throw new StorageFailure("pending_changed");return saved.storage;}
  private fail(l:Lease,error:unknown,local=false){if(l.generation!==this.generation)return;if(!this.current()||!local&&hidden()){this.pause();return;}this.emit({query:null,result:null,phase:this.pending?"unconfirmed":"blocked",message:error instanceof StorageFailure?"原编号存储已变化或不可用，请保留并核验。":this.pending?"结果尚未核实；保留原编号，仅可明确读取原号回执。":"暂时无法核实资料，请重新明确读取。"});}
  initialize=async()=>{const l=this.begin(true);if(!l)return;try{const{raw}=this.stored(l,true);if(this.pending&&raw!==this.raw)throw new StorageFailure("pending_changed");const pending=raw===null?null:await this.wait(l,parseReviewRoutingPending(raw,this.o),true);if(this.stored(l,true).raw!==raw)throw new StorageFailure("pending_changed");this.raw=raw;this.pending=pending;this.loaded=true;this.selectedGrant=null;this.grantRequest=null;this.emit({query:null,result:null,phase:pending?"unconfirmed":"idle",message:pending?"发现待确认原编号，请明确核验。":"请明确读取列表或某一申请的办理责任。"});}catch(e){this.loaded=false;this.fail(l,e,true);}finally{this.release(l);}};
  private async transport(l:Lease,query:ReviewRoutingQuery,command:ReviewRoutingCommand|null){
    this.guard(l);const response=await this.wait(l,this.o.apiFetch(REVIEW_ROUTING_API+(command?"":`?${reviewRoutingQueryString(query)}`),{method:command?"POST":"GET",signal:l.controller.signal,cache:"no-store",redirect:"error",headers:{Accept:"application/json",...(command?{"Content-Type":"application/json"}:{})},...(command?{body:JSON.stringify({query,command})}:{})}).then(r=>{try{this.guard(l);}catch(e){void r.body?.cancel().catch(()=>{});throw e;}return r;}));
    if(response.redirected||response.ok&&response.status!==200||response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"){void response.body?.cancel().catch(()=>{});throw Error("invalid_response");}
    const reader=response.body?.getReader();if(!reader)throw Error("missing_body");const cancel=()=>{void reader.cancel().catch(()=>{});};l.controller.signal.addEventListener("abort",cancel,{once:true});let text="",bytes=0;const decoder=new TextDecoder("utf-8",{fatal:true});
    try{while(true){const part=await this.wait(l,reader.read());if(part.done)break;bytes+=part.value.byteLength;if(bytes>(response.status===200?REVIEW_ROUTING_RESPONSE_LIMIT:4096))throw Error("response_too_large");text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{cancel();l.controller.signal.removeEventListener("abort",cancel);reader.releaseLock();}
    const parsed=await this.wait(l,parseReviewRoutingResponse(parseReviewRoutingJson(text),query,this.o.authUserId,command));if(parsed.ok?response.status!==200:REVIEW_ROUTING_ERRORS[parsed.error.code]!==response.status)throw Error("status_mismatch");if(!parsed.ok)throw Error(parsed.error.code);return parsed.data;
  }
  private clear(l:Lease){const s=this.verify(l);this.guard(l);s.removeItem(this.storageKey);this.guard(l);if(this.stored(l).raw!==null)throw new StorageFailure("pending_not_cleared");this.raw=null;this.pending=null;}
  load=async(raw:ReviewRoutingQuery)=>{const query=parseReviewRoutingQuery(raw);if(!this.loaded||this.pending||query.siteId!==this.o.siteId||query.mode==="recover")return;await this.get(query);};
  private async get(query:ReviewRoutingQuery){const l=this.begin();if(!l)return;try{this.verify(l);this.emit({query:null,result:null,phase:"loading",message:"正在明确读取办理责任…"});this.guard(l);const result=await this.transport(l,query,null);this.guard(l);this.verify(l);
    if(query.mode==="recover"&&this.pending&&result.receipt){if(!reviewRoutingReceiptMatches(result.receipt,this.pending.query,this.pending.command,this.o.authUserId,this.pending.commandFingerprint))throw Error("receipt_mismatch");this.clear(l);}
    if("requestId" in query&&this.grantRequest!==query.family+query.requestId){this.selectedGrant=null;this.grantRequest=null;}
    this.emit({query,result,phase:this.pending?"unconfirmed":"ready",message:this.pending?"查无回执不代表未写入；原编号继续保留。":result.data.kind==="receipt"?"原号回执已核实，请明确重读当前申请。":"已读取当前办理责任；审批仍以原申请权限为准。"});
  }catch(e){this.fail(l,e);}finally{this.release(l);}}
  list=()=>this.load({siteId:this.o.siteId,mode:"list",cursor:null});
  detail=(family:ReviewRoutingFamily,requestId:string)=>this.load({siteId:this.o.siteId,mode:"detail",family,requestId});
  history=(family:ReviewRoutingFamily,requestId:string)=>this.load({siteId:this.o.siteId,mode:"history",family,requestId,beforeRevision:null});
  grants=(family:ReviewRoutingFamily,requestId:string)=>this.load({siteId:this.o.siteId,mode:"grants",family,requestId,cursor:null});
  self=(family:ReviewRoutingFamily,requestId:string)=>this.load({siteId:this.o.siteId,mode:"self",family,requestId});
  selectGrant=(grantId:string)=>{const d=this.state.result?.data;if(this.state.phase!=="ready"||this.pending||d?.kind!=="grants"||!d.items.some(g=>g.grantId===grantId&&g.usable))return false;this.selectedGrant=grantId;this.grantRequest=d.request.family+d.request.requestId;return true;};
  nextPage=async()=>{const q=this.state.query,d=this.state.result?.data;if(q?.mode==="list"&&d?.kind==="list"&&d.nextCursor)await this.load({...q,cursor:d.nextCursor});else if(q?.mode==="grants"&&d?.kind==="grants"&&d.nextCursor)await this.load({...q,cursor:d.nextCursor});else if(q?.mode==="history"&&d?.kind==="history"&&d.nextBeforeRevision!==null)await this.load({...q,beforeRevision:d.nextBeforeRevision});};
  recover=async()=>{if(!this.loaded||!this.pending)return;await this.get({siteId:this.o.siteId,mode:"recover",family:this.pending.query.family,operationId:this.pending.command.operationId});};
  // The original host receives only a freshly verified exact request identity.
  freshOriginal=async(expected:ReviewRoutingRequest):Promise<ReviewRoutingRequest|null>=>{if(!this.current()||this.pending||this.controller||!this.loaded)return null;await this.detail(expected.family,expected.requestId);if(!this.current()||hidden()||this.pending)return null;const d=this.state.result?.data;return this.state.phase==="ready"&&d?.kind==="detail"&&JSON.stringify(d.request)===JSON.stringify(expected)?d.request:null;};
  submit=async(rawCommand:ReviewRoutingCommand)=>{
    const q=this.state.query,d=this.state.result?.data;if(!this.loaded||!this.o.enabled||this.pending||this.state.phase!=="ready"||q?.mode!=="detail"||d?.kind!=="detail")return;
    const {query,command}=parseReviewRoutingBody({query:q,command:rawCommand});
    if(command.expectedResponsibilityRevision!==(d.current?.revision??0)||command.expectedResponsibilityOperationId!==(d.current?.operationId??null)||command.expectedRequestRevision!==d.observation.requestRevision||command.expectedObservationFingerprint!==d.observation.observationFingerprint
      ||command.action==="register"&&(!d.canRegister||this.selectedGrant!==command.grantId||this.grantRequest!==d.request.family+d.request.requestId)||command.action==="take_over"&&!d.canTakeOver)return;
    const l=this.begin();if(!l)return;try{this.verify(l);this.emit({query:null,result:null,phase:"saving",message:"正在保存完整原意图，只提交一次…"});this.guard(l);const commandFingerprint=await this.wait(l,reviewRoutingCommandFingerprint(query,this.o.authUserId,command));
      const pending:ReviewRoutingPending=freeze({protocol:"attendance-review-routing-pending-v1",version:1,actorId:this.o.authUserId,query,command,commandFingerprint}),raw=JSON.stringify(pending);parseReviewRoutingJson(raw,"request");const s=this.verify(l);this.guard(l);s.setItem(this.storageKey,raw);this.guard(l);this.raw=raw;this.pending=pending;if(this.stored(l).raw!==raw)throw new StorageFailure("pending_not_saved");this.emit({message:"原意图已保存；断开后仅可明确核验原编号。"});this.guard(l);this.verify(l);
      const saved=await this.transport(l,query,command);this.guard(l);this.verify(l);if(saved.data.kind!=="receipt"||!saved.receipt||!reviewRoutingReceiptMatches(saved.receipt,query,command,this.o.authUserId,commandFingerprint))throw Error("receipt_mismatch");this.clear(l);this.selectedGrant=null;this.grantRequest=null;this.emit({query,result:saved,phase:"ready",message:command.action==="take_over"?"已由负责人协调，不等于可批准。请重新读取原申请。":"办理责任已登记；请按原权限打开申请。"});
    }catch(e){this.fail(l,e);}finally{this.release(l);}
  };
  act=(action:"register"|"take_over",reason:string)=>{const d=this.state.result?.data;if(d?.kind!=="detail"||action==="register"&&!this.selectedGrant)return Promise.resolve();return this.submit({action,operationId:(this.o.randomId??(()=>crypto.randomUUID()))(),expectedResponsibilityRevision:d.current?.revision??0,expectedResponsibilityOperationId:d.current?.operationId??null,expectedRequestRevision:d.observation.requestRevision,expectedObservationFingerprint:d.observation.observationFingerprint,grantId:action==="register"?this.selectedGrant:null,reason});};
}
