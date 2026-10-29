// This release still publishes the immutable booking build, NOT the separately
// deferred attendance fix present in the tool/CI checkout. The old general
// unchanged-application guard remains unchanged. Only this exact source delta
// can be kept out of this release, with both identities explicitly recorded.
import {assertUnchangedApplicationSource,sourceApplicationIdentity} from './release-toolchain-source.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
const APPLICATION='f274ad615550c83717aa7af2ad32339608e6f8aa';
export const DEFERRED_ATTENDANCE_SOURCE=Object.freeze({file:'src/lib/merchantAttendanceDelegatedGroups.server.ts',mode:'100644',
 original:'adecb9dfe54a849cdc6f55266550ee3d3e92305a',fixed:'85c8d9006038936007f320453b49b849728fe10a'});
export function assertRetainedBookingSource(applicationRevision,applicationRows,toolRows){
 need(applicationRevision===APPLICATION,'source_changed');
 const p=DEFERRED_ATTENDANCE_SOURCE,old=applicationRows.filter(row=>row.file===p.file),current=toolRows.filter(row=>row.file===p.file);
 need(old.length===1&&current.length===1&&old[0].mode===p.mode&&old[0].oid===p.original&&current[0].mode===p.mode&&current[0].oid===p.fixed,'source_changed');
 // Compare every other application input, including dependencies, SQL and any
 // unknown runtime scripts, through the original strict shared guard.
 const application=assertUnchangedApplicationSource(applicationRevision,applicationRows,toolRows.map(row=>row.file===p.file?old[0]:row));
 const toolSourceApplication=sourceApplicationIdentity(applicationRevision,toolRows);
 need(application.source.value!==toolSourceApplication.source.value&&application.dependencies.value===toolSourceApplication.dependencies.value&&application.migrations.value===toolSourceApplication.migrations.value,'source_changed');
 return {kind:'retained-booking-build-with-separately-deferred-attendance-source',application,toolSourceApplication,
  deferredApplicationChange:{...p,inPublishedBuild:false},applicationRebuilt:false,applicationRelabelled:false,attendanceFixPublished:false};
}
