import {parseCurrentCorrectionDecision} from "./merchantAttendanceCurrentCorrectionDecision";
import type {CorrectionDecisionQuery} from "./merchantAttendanceCorrectionDecision";

// HTTP returns normalized decisionEffect, not SQL's historical `effective` key.
// Validate the envelope separately before translating that one documented name.
export function parseCurrentCorrectionResponse(raw:unknown,q:CorrectionDecisionQuery){
  const fail=():never=>{throw Error("attendance_invalid_response");};
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();const v=raw as Record<string,unknown>;
  if(v.ok!==true||typeof v.moduleEnabled!=="boolean"||v.writeEnabled!==v.moduleEnabled||!Object.hasOwn(v,"decisionEffect")||Object.hasOwn(v,"effective"))return fail();
  const {ok,moduleEnabled,decisionEffect,...result}=v;void ok;
  return {...parseCurrentCorrectionDecision({...result,effective:decisionEffect},q),moduleEnabled};
}
