// One existing, fixed data link. Source-code paths and generic legacy readers
// still reject links; no arbitrary realpath, owner or permission override exists.
import * as fs from 'node:fs';
import {BOOKING_HANDOFF_LEGACY_DIRECTORY as LEGACY} from './booking-handoff-policy.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {canonicalJson,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
export const BOOKING_SHARED_RUNTIME='/www/wwwroot/merchant-space.shared/.runtime';
const LINK=LEGACY+'/.runtime',FILES=Object.freeze(['merchant-bookings.json','merchant-booking-rules.json','merchant-booking-workbench.json']);
const fact=s=>Object.fromEntries(['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
export function assertBookingRuntimeLinkFacts(v){
 need(v?.logical===LINK&&v.target===BOOKING_SHARED_RUNTIME&&v.resolved===BOOKING_SHARED_RUNTIME,'owned_resource_changed');
 need(v.link?.uid===0&&v.link.nlink===1&&v.link.symbolic===true,'owned_resource_changed');
 for(const k of ['parent','targetDirectory'])need(v[k]?.uid===0&&v[k].directory===true&&v[k].symbolic===false&&(v[k].mode&0o022)===0,'owned_resource_changed');
 return true;
}
// Read-only sequencing seam. Production constructs both observations and the
// strict resolved-file reader itself; these values never issue a capability.
export function observeBookingRuntimeCache(name,operations){
 need(FILES.includes(name),'invalid_path');const before=operations.capture();assertBookingRuntimeLinkFacts(before);
 const text=operations.readResolved(name);need(typeof text==='string','invalid_contract');
 const after=operations.capture();assertBookingRuntimeLinkFacts(after);need(canonicalJson(before)===canonicalJson(after),'owned_resource_changed');return text;
}
function capture(){
 const parent=ownedReleasePath(LEGACY,{directory:true}),target=ownedReleasePath(BOOKING_SHARED_RUNTIME,{directory:true}),link=fs.lstatSync(LINK);
 return {logical:LINK,target:fs.readlinkSync(LINK),resolved:fs.realpathSync(LINK),link:{...fact(link),symbolic:link.isSymbolicLink()},
  parent:{...fact(parent),directory:parent.isDirectory(),symbolic:parent.isSymbolicLink()},targetDirectory:{...fact(target),directory:target.isDirectory(),symbolic:target.isSymbolicLink()}};
}
export function readReviewedBookingRuntimeCache(name,toolRevision){
 need(reviewedBookingExecution(toolRevision),'source_changed');
 const text=observeBookingRuntimeCache(name,{capture,readResolved:file=>bookingHostRead(BOOKING_SHARED_RUNTIME+'/'+file,{privateMode:false})});
 need(reviewedBookingExecution(toolRevision),'source_changed');return text;
}
