import {sheetWire,timesheetQuery,timesheetId as id} from "./attendance-timesheet-model";
import {scopedSheetWire} from "./attendance-scoped-timesheet-model";
import type {TimesheetExportCommand,TimesheetExportQuery,TimesheetExportReceipt} from "../../src/lib/merchantAttendanceTimesheetExport";
export function timesheetExportCommand(access:TimesheetExportQuery["access"]="owner"):TimesheetExportCommand{
  return {siteId:timesheetQuery.siteId,operationId:id(800),query:{access,workerId:access==="self"?null:timesheetQuery.workerId,
    locationId:access==="manager"?id(5):null,expectedWorkerId:access==="self"?timesheetQuery.workerId:null,
    fromDate:timesheetQuery.fromDate,throughDate:timesheetQuery.throughDate,expectedTimeZone:"Europe/Madrid",expectedScopeRevision:access==="manager"?1:null}};
}
export function timesheetExportWire(c=timesheetExportCommand()){
  const q=c.query,report=q.access==="owner"?sheetWire():scopedSheetWire(q.access);
  const receipt:TimesheetExportReceipt={operationId:c.operationId,siteId:c.siteId,access:q.access,workerId:(q.workerId??q.expectedWorkerId)!,locationId:q.locationId,
    fromDate:q.fromDate,throughDate:q.throughDate,timeZone:q.expectedTimeZone,scopeRevision:q.expectedScopeRevision,asOf:report.asOf,recordedAt:report.asOf,
    sourceSha256:"a".repeat(64),sourceBytes:2048,sessionCount:report.items.length,schemaVersion:1,status:"source_read",downloadConfirmed:false};
  return {receipt,replayed:false,report};
}
