import {sheetWire,timesheetQuery,timesheetId as id} from "./attendance-timesheet-model";
import type {AttendanceScopedTimesheetQuery} from "../../src/lib/merchantAttendanceScopedTimesheet";
export const scopedViewer=id(2);
export const scopedManager=id(90);
export const scopedSelfQuery:AttendanceScopedTimesheetQuery={siteId:timesheetQuery.siteId,access:"self",fromDate:timesheetQuery.fromDate,throughDate:timesheetQuery.throughDate,expectedWorkerId:null};
export const scopedManagerQuery:AttendanceScopedTimesheetQuery={siteId:timesheetQuery.siteId,access:"manager",workerId:timesheetQuery.workerId,locationId:id(5),fromDate:timesheetQuery.fromDate,throughDate:timesheetQuery.throughDate};
export function scopedSheetWire(access:"self"|"manager"="self"){
  const wire=sheetWire();
  return {...wire,access,viewerEmployeeId:access==="self"?scopedViewer:scopedManager,scopeRevision:access==="self"?null:1,
    locationId:access==="self"?null:id(5),coverage:"authorized-complete-sessions-v1",accessValidUntil:null as string|null,
    items:wire.items.map(i=>({...i,events:i.events.map(e=>({...e,actorEmployeeId:scopedViewer as string|null})),effect:i.effect?{...i.effect,employeeId:scopedViewer}:null}))};
}
