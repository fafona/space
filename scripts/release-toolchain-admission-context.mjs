// Lightweight capability boundary. No application, database, publisher or
// fixture import at module initialization (including on legacy pure imports).
import * as fs from 'node:fs';import {AsyncLocalStorage} from 'node:async_hooks';
import {canonicalJson,sha256,assertFreshEvidence,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
const context=new AsyncLocalStorage(),issued=new WeakSet(),same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
export function admissionFileFact(file){const s=ownedReleasePath(file,{privateMode:true});return ['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]);}
function fresh(c){need(issued.has(c)&&reviewedBookingExecution(c.toolRevision),'evidence_invalid');assertFreshEvidence(c.proof,{nowMs:Date.now(),maxAgeMs:600000});for(const [file,witness]of c.witnesses)same(admissionFileFact(file),witness);return c;}
export async function collectFreshBookingAdmission(options){
 const {collectBookingAdmissionFacts}=await import('./release-toolchain-booking-admission.mjs');
 const c=await collectBookingAdmissionFacts(options);issued.add(c);return c;
}
export function requireBookingAdmission(toolRevision){const c=fresh(context.getStore());need(c.toolRevision===toolRevision,'source_changed');return c.proof;}
export function withFreshBookingAdmission(handle,work){const c=fresh(handle);need(typeof work==='function','invalid_contract');return context.run(c,()=>work(c.proof));}
export async function retainedBookingMigrationBackup(request){
 const c=context.getStore();if(!c)return null;fresh(c);same(request,c.historical.request);
 for(const [file,digest]of [[request.createReport,c.historical.createReportSha256],[request.verifyReport,c.historical.verifyReportSha256]]){const before=admissionFileFact(file);need(sha256(fs.readFileSync(file))===digest,'evidence_invalid');same(admissionFileFact(file),before);}
 return c.historical.backup;
}
