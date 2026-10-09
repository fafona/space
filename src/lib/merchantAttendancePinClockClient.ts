import type {AttendanceAction} from "./merchantAttendance";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import {TERMINAL_DEVICE_API,parseTerminalDevice,terminalObject} from "./merchantAttendanceTerminal";
import {terminalErrorStatuses} from "./merchantAttendanceTerminalClient";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendancePin,pinWorkerNo} from "./merchantAttendancePin";
import {PIN_CLOCK_API,PIN_CLOCK_ERRORS,parsePinClockRequest,parsePinClockResult,pinClockMessage,type PinClockResult,type PinClockRequest} from "./merchantAttendancePinClock";
type Store=Pick<Storage,"getItem"|"setItem"|"removeItem"|"key"|"length">;
type Device={siteId:string;terminalId:string;label:string};
export type PinClockPending={version:1;siteId:string;terminalId:string;workerNo:string;command:NonNullable<PinClockRequest["command"]>};
export type PinClockState={phase:"loading"|"entry"|"ready"|"saving"|"unconfirmed"|"confirmed"|"blocked";device:Device|null;result:PinClockResult|null;pending:PinClockPending|null;message:string};
const prefix="faolla:attendance:pin-clock:v1:";
export function pinClockPendingKey(d:Pick<Device,"siteId"|"terminalId">,no:string){return `${prefix}${attendanceSelfSite(d.siteId)}:${attendanceSelfUuid(d.terminalId)}:${encodeURIComponent(pinWorkerNo(no).toLowerCase())}`;}
export function parsePinClockPending(raw:string,d:Device,no:string):PinClockPending{
  if(raw.length>2048)throw Error("attendance_pending_invalid");const o=terminalObject(JSON.parse(raw),["version","siteId","terminalId","workerNo","command"]);
  if(o.version!==1||o.siteId!==d.siteId||o.terminalId!==d.terminalId||pinWorkerNo(o.workerNo).toLowerCase()!==no.toLowerCase())throw Error("attendance_pending_invalid");
  const command=parsePinClockRequest({command:o.command,operationId:null}).command;if(!command)throw Error("attendance_pending_invalid");
  return {version:1,siteId:d.siteId,terminalId:d.terminalId,workerNo:o.workerNo as string,command};
}
/** No employee login/token. PIN is memory-only, reused for ONE explicit action
 * within 30s, reverified on the server, then discarded. Never persisted/retried
 * automatically. Pending non-secret intent is scoped by device AND worker no. */
export class AttendancePinClockClient{
  private state:PinClockState={phase:"loading",device:null,result:null,pending:null,message:"正在核对门店终端…"};
  private listeners=new Set<()=>void>();private generation=0;private controller:AbortController|null=null;
  private secret="";private timer:ReturnType<typeof setTimeout>|null=null;private disposed=false;
  constructor(private readonly options:{apiFetch:AttendanceApiFetch;storage:()=>Store;randomId?:()=>string;secretMs?:number;resultMs?:number}){}
  getSnapshot=()=>this.state;subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
  private set(p:Partial<PinClockState>){if(this.disposed)return;this.state={...this.state,...p};for(const f of this.listeners)f();}
  private forget(){this.secret="";if(this.timer)clearTimeout(this.timer);this.timer=null;}
  clear=()=>{this.generation++;this.controller?.abort();this.controller=null;this.forget();this.set({phase:"entry",result:null,pending:null,message:"请输入工号和 PIN；如有未确认操作，将先核对原结果。"});};
  dispose=()=>{this.clear();this.disposed=true;};
  private current(g:number){return !this.disposed&&g===this.generation;}
  private keepSecret(value:string){this.forget();this.secret=value;this.timer=setTimeout(()=>this.clear(),Math.min(this.options.secretMs??30000,30000));}
  initialize=async()=>{
    this.disposed=false;this.clear();const g=++this.generation,c=new AbortController();this.controller=c;this.set({phase:"loading",device:null,message:"正在核对门店终端…"});
    try{
      const b=await attendanceManagementRequest(this.options.apiFetch,TERMINAL_DEVICE_API,{}, {signal:c.signal,errorStatuses:terminalErrorStatuses,maxBytes:8192});
      if(!this.current(g))return;const {ok,paired,moduleEnabled,...raw}=b;
      if(ok!==true||paired!==true||typeof moduleEnabled!=="boolean")throw Error("attendance_terminal_denied");
      const d=parseTerminalDevice(raw,{siteId:attendanceSelfSite(raw.siteId),terminalId:attendanceSelfUuid((raw.terminal as {id?:unknown})?.id)});
      if(d.terminal.state!=="active")throw Error("attendance_terminal_denied");
      this.set({phase:"entry",device:{siteId:d.siteId,terminalId:d.terminal.id,label:d.terminal.label},message:"终端已配对。请输入本人工号和 PIN。"});
    }catch(e){if(this.current(g))this.set({phase:"blocked",device:null,message:pinClockMessage(e)});}
    finally{if(this.current(g))this.controller=null;}
  };
  private pending(d:Device,no:string){const raw=this.options.storage().getItem(pinClockPendingKey(d,no));return raw===null?null:parsePinClockPending(raw,d,no);}
  private persist(p:PinClockPending){
    const d=this.state.device!;if(this.pending(d,p.workerNo))throw Error("attendance_pending_changed");
    const store=this.options.storage();let count=0;
    for(let n=0;n<store.length;n++)if(store.key(n)?.startsWith(prefix))count++;
    if(count>=32)throw Error("attendance_pending_limit");
    const key=pinClockPendingKey(d,p.workerNo),raw=JSON.stringify(p);store.setItem(key,raw);if(store.getItem(key)!==raw)throw Error("attendance_pending_write_failed");
  }
  private clearPending(p:PinClockPending){
    const store=this.options.storage(),key=pinClockPendingKey(p,p.workerNo),raw=store.getItem(key);
    const expected=parsePinClockPending(JSON.stringify(p),{...p,label:""},p.workerNo);
    if(raw===null||JSON.stringify(parsePinClockPending(raw,{...p,label:""},p.workerNo))!==JSON.stringify(expected))throw Error("attendance_pending_changed");
    store.removeItem(key);if(store.getItem(key)!==null)throw Error("attendance_pending_clear_failed");
  }
  private async request(d:Device,no:string,pin:string,r:PinClockRequest,signal:AbortSignal){
    const b=await attendanceManagementRequest(this.options.apiFetch,PIN_CLOCK_API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({workerNo:no,pin,...r})},{signal,errorStatuses:PIN_CLOCK_ERRORS,maxBytes:16384});
    const {ok,moduleEnabled,...raw}=b;if(ok!==true||typeof moduleEnabled!=="boolean")throw Error("invalid_response");
    const result=parsePinClockResult(raw,{...d,workerNo:no,...r});if(!moduleEnabled&&result.canStart)throw Error("invalid_response");return result;
  }
  private reconcile(r:PinClockResult,p:PinClockPending|null){
    if(!p)return null;
    if(p.command.expectedWorkerId!==r.workerId||p.command.expectedEmployeeId!==r.employeeId)throw Error("attendance_worker_changed");
    if(r.receipt){
      if(r.receipt.operationId!==p.command.operationId||r.receipt.action!==p.command.action||r.receipt.locationId!==p.command.locationId||r.receipt.sequence!==p.command.expectedSequence+1)throw Error("attendance_operation_conflict");
      this.clearPending(p);return null;
    }
    if(r.state.sequence>p.command.expectedSequence){this.clearPending(p);return null;}
    if(r.state.sequence!==p.command.expectedSequence)throw Error("attendance_operation_conflict");return p;
  }
  read=async(no:string,pin:string)=>{
    if(this.controller||!this.state.device)return;
    const d=this.state.device;let p:PinClockPending|null;
    try{no=pinWorkerNo(no.trim());attendancePin(pin);p=this.pending(d,no);}catch{this.forget();this.set({phase:"blocked",result:null,pending:null,message:"工号／PIN 或待确认存储不可用，尚未发送请求。请保留原标签页并检查输入及浏览器会话存储。"});return;}
    this.forget();const g=++this.generation,c=new AbortController();this.controller=c;this.set({phase:"loading",result:null,pending:p,message:p?"正在验证 PIN 并只读核对原操作…":"正在验证 PIN 并读取当前状态…"});
    try{
      const r=await this.request(d,no,pin,{command:null,operationId:p?.command.operationId??null},c.signal);if(!this.current(g))return;
      const pending=this.reconcile(r,p);this.keepSecret(pin);
      this.set({phase:pending?"unconfirmed":"ready",result:r,pending,message:pending?"原操作尚未查到，不能认为未提交。可在 30 秒内明确原编号重试，或稍后重新核对。":p?(r.receipt?"原打卡已确认，未重复提交。下方为当前状态。":"状态已更新，原操作已无法按旧顺序提交。请核对下方当前状态。 "):"已验证本人，请在 30 秒内选择并确认一个动作。"});
    }catch(e){if(this.current(g))this.set({phase:"blocked",result:null,message:pinClockMessage(e)});}
    finally{pin="";if(this.current(g))this.controller=null;}
  };
  punch=async(action:AttendanceAction|null)=>{
    if(this.controller||!this.secret||!this.state.device||!this.state.result||!["ready","unconfirmed"].includes(this.state.phase))return;
    const d=this.state.device,r=this.state.result;let p=this.state.pending;
    try{
      if(p){if(action!==null)throw Error("attendance_operation_conflict");const stored=this.pending(d,p.workerNo);if(JSON.stringify(stored)!==JSON.stringify(parsePinClockPending(JSON.stringify(p),d,p.workerNo)))throw Error("attendance_pending_changed");}
      else{
        const allowed=r.state.status==="off"?["clock_in"]:r.state.status==="break"?["break_end"]:["break_start","clock_out"];
        if(!action||!allowed.includes(action)||(["clock_in","break_start"].includes(action)?!r.canStart:!r.canFinish))return;
        p={version:1,siteId:d.siteId,terminalId:d.terminalId,workerNo:r.workerNo,command:{expectedWorkerId:r.workerId,expectedEmployeeId:r.employeeId,locationId:r.locationId!,operationId:(this.options.randomId??(()=>crypto.randomUUID()))(),action,expectedSequence:r.state.sequence}};this.persist(p);
      }
    }catch{this.forget();this.set({phase:"blocked",result:null,message:"待确认存储不可用或已变化，未发送打卡。请保留原页面并重新核对。"});return;}
    let secret=this.secret;this.forget();const g=++this.generation,c=new AbortController();this.controller=c;this.set({phase:"saving",result:null,pending:p,message:"正在提交明确动作；请等待服务器收据…"});
    try{
      const result=await this.request(d,p.workerNo,secret,{command:p.command,operationId:null},c.signal);if(!this.current(g))return;
      if(!result.receipt)throw Error("receipt_missing");this.reconcile(result,p);
      this.set({phase:"confirmed",result,pending:null,message:`打卡已确认：${{clock_in:"上班",break_start:"开始休息",break_end:"结束休息",clock_out:"下班"}[result.receipt.action]}。不会自动继续下一动作。`});
      this.timer=setTimeout(()=>this.clear(),Math.min(this.options.resultMs??15000,15000));
    }catch(e){if(this.current(g))this.set({phase:"unconfirmed",result:null,pending:p,message:pinClockMessage(e)+" 请重新输入本人工号和 PIN，只读核对原操作；不要当作打卡成功。"});}
    finally{secret="";if(this.current(g))this.controller=null;}
  };
}
