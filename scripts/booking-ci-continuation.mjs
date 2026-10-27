// Dispatch only between the sealed formal predecessor and independently
// validated CI successor. A revision alone never substitutes for its attester.
import {BOOKING_CI_BASE,BOOKING_CI_RECEIPT} from './booking-ci-continuation-policy.mjs';
import {BOOKING_FORMAL_RECEIPT} from './booking-formal-backup-policy.mjs';
import {assertBookingFormalToolSource,assertBookingFormalContinuation,assertBookingFormalRuntimeContinuation} from './booking-formal-backup-tool.mjs';
import {assertBookingCiToolSource,assertBookingCiContinuation,assertBookingCiRuntimeContinuation} from './booking-ci-continuation-tool.mjs';
export function assertBookingCurrentToolSource(revision){
 return revision===BOOKING_CI_BASE?assertBookingFormalToolSource(revision):assertBookingCiToolSource(revision);
}
export function assertBookingCurrentContinuation(input){
 return input.toolRevision===BOOKING_CI_BASE?assertBookingFormalContinuation(input):assertBookingCiContinuation(input);
}
export function assertBookingCurrentRuntimeContinuation(input){
 return input.toolRevision===BOOKING_CI_BASE?assertBookingFormalRuntimeContinuation(input):assertBookingCiRuntimeContinuation(input);
}
// Callers MUST attest source before reading this selected receipt. Unknown
// revisions are rejected by the successor attester, not admitted by this path.
export function bookingCurrentReceiptName(revision){
 return revision===BOOKING_CI_BASE?BOOKING_FORMAL_RECEIPT:BOOKING_CI_RECEIPT;
}
