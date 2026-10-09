import type {AttendanceTimesheetQuery} from "../../src/lib/merchantAttendanceTimesheet";
import type {AttendanceSessionEvent} from "../../src/lib/merchantAttendanceSession";
import type {CorrectionProposal} from "../../src/lib/merchantAttendanceCorrection";
export const timesheetId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const timesheetQuery:AttendanceTimesheetQuery={siteId:"99990009",workerId:timesheetId(4),fromDate:"2026-09-01",throughDate:"2026-09-30"};
export const timesheetOwner=timesheetId(1);
export const sheetEvent=(n:number,action:AttendanceSessionEvent["action"],occurredAt:string,paid=false):AttendanceSessionEvent=>({id:timesheetId(100+n),locationId:timesheetId(5),sequence:n,
  action,occurredAt,timeZone:"Europe/Madrid",breakPaid:action==="break_start"?paid:null,source:"web"});
export function sheetEffect(proposal:CorrectionProposal,lastEventId=timesheetId(102)){
  const micros=(v:string)=>BigInt(Date.parse(v.slice(0,23)+"Z"))*BigInt(1000)+BigInt(v.slice(23,26));
  const elapsedUs=Number(micros(proposal.endAt)-micros(proposal.startAt));
  const breakUs=proposal.breaks.reduce((sum,b)=>sum+Number(micros(b.endAt)-micros(b.startAt)),0);
  const paidBreakUs=proposal.breaks.filter(b=>b.paid).reduce((sum,b)=>sum+Number(micros(b.endAt)-micros(b.startAt)),0);
  return {requestId:timesheetId(30),operationId:timesheetId(40),revision:1,policyRevision:1,recordedAt:"2026-09-25T20:00:00.000000Z",action:"approve",originalLastEventId:lastEventId,
    timeZone:"Europe/Madrid",calculationVersion:"declaration-v1",proposal,elapsedUs,breakUs,paidBreakUs,workedUs:elapsedUs-breakUs};
}
export function sheetWire(){
  return {...timesheetQuery,employeeId:timesheetId(2),workerName:"Synthetic worker",workerNo:"SHEET",timeZone:"Europe/Madrid",
    fromAt:"2026-08-31T22:00:00.000000Z",toAt:"2026-09-30T22:00:00.000000Z",asOf:"2026-09-30T12:00:00.000000Z",complete:true,sourceVersion:"raw-and-approved-v1",
    items:[{startEventId:timesheetId(101),events:[sheetEvent(1,"clock_in","2026-09-05T08:00:00.000000Z"),sheetEvent(2,"clock_out","2026-09-05T16:00:00.000000Z")],effect:null as ReturnType<typeof sheetEffect>|null}]};
}
// Synthetic FIRST approvals only. Later versions must supply their real lineage.
export function firstApprovalSourceV2<T extends {sourceVersion:string;items:{effect:{requestId:string;operationId:string;revision:number;recordedAt:string}|null}[]}>(value:T):T{
  const wire=structuredClone(value);wire.sourceVersion="raw-and-approved-v2";
  for(const row of wire.items)if(row.effect){
    if(row.effect.revision!==1)throw Error("synthetic_first_approval_only");
    Object.assign(row.effect,{lineage:{rootRequestId:row.effect.requestId,rootOperationId:row.effect.operationId,rootRecordedAt:row.effect.recordedAt,previousOperationId:null}});
  }
  return wire;
}
