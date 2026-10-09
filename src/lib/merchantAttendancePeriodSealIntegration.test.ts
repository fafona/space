import test from "node:test";
import assert from "node:assert/strict";
import { CORRECTION_ERRORS } from "./merchantAttendanceCorrection";
import { CORRECTION_DECISION_ERRORS } from "./merchantAttendanceCorrectionDecision";
import { CURRENT_CORRECTION_ERRORS } from "./merchantAttendanceCurrentCorrectionDecision";
import { ATTENDANCE_REVISION_ERRORS } from "./merchantAttendanceRevision";
import { REVISION_APPROVAL_ERRORS } from "./merchantAttendanceRevisionApproval";
import { REVISION_CYCLE_ERRORS } from "./merchantAttendanceRevisionCycleResponse";
import { MISSING_ERRORS, missingMessage } from "./merchantAttendanceMissing";
import { parsePeriodClosureResponse } from "./merchantAttendancePeriodClosure";
import { periodClosureUiHttp, periodClosureUiQuery, periodClosureUiEmployee, periodClosureUiId } from "../../scripts/fixtures/attendance-period-closure-ui-model";

test("every existing correction and missing mutation error contract keeps a seal refusal as409",()=>{
  const contracts:Readonly<Record<string,number>>[]=[CORRECTION_ERRORS,CORRECTION_DECISION_ERRORS,CURRENT_CORRECTION_ERRORS,ATTENDANCE_REVISION_ERRORS,REVISION_APPROVAL_ERRORS,REVISION_CYCLE_ERRORS,MISSING_ERRORS];
  for(const errors of contracts){
    assert.equal(errors.attendance_period_sealed,409);
    assert.equal(errors.attendance_access_denied,403);
  }
  assert.match(missingMessage("attendance_period_sealed"),/负责人.*理由.*重开/);
});
test("self preview binds report Auth to response actor even when caller only knows employee ID",()=>{
  const q=periodClosureUiQuery("preview","self"),body=periodClosureUiHttp(q);
  assert.doesNotThrow(()=>parsePeriodClosureResponse(body,q,{employeeId:periodClosureUiEmployee}));
  body.data.actorId=periodClosureUiId(987);
  assert.throws(()=>parsePeriodClosureResponse(body,q,{employeeId:periodClosureUiEmployee}));
});
