// A non-serializable in-process capability. A JSON report cannot enable it.
import {AsyncLocalStorage} from 'node:async_hooks';import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {collectRemoteReleaseReview,assertReviewFresh,inspectPinnedExecutionSource,sourceGit,parseSourceTree,assertUnchangedApplicationSource,ownedReleasePath} from './release-toolchain-source.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {assertRetainedBookingSource} from './release-toolchain-retained-booking-source.mjs';
import {withPinnedFormalPm2Process} from './release-toolchain-proc-witness.mjs';
const active=new AsyncLocalStorage(),issued=new WeakSet();
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fact=s=>['dev','ino','uid','mode','size','mtimeMs','ctimeMs','nlink'].map(k=>s[k]);
function unchanged(c){for(const [file,expected]of c.witnesses){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&canonicalJson(fact(s))===expected,'source_changed');}}
export function reviewedBookingExecution(revision){
 const c=active.getStore();if(!c)return null;need(issued.has(c)&&c.profile==='booking-handoff'&&c.revision===revision,'source_changed');
 assertReviewFresh(c.review,revision);
 unchanged(c);
 return c.public;
}
export async function refreshReviewedBookingExecution(revision){
 const c=active.getStore();need(c&&issued.has(c)&&c.revision===revision,'source_changed');unchanged(c);
 c.review=await collectRemoteReleaseReview(revision);return reviewedBookingExecution(revision);
}
export function preparedBookingExecution(revision){
 const c=active.getStore();if(!c)return null;reviewedBookingExecution(c.revision);need(c.preparationRevision===revision,'source_changed');return c.public;
}
export async function withReviewedBookingExecution({applicationRevision,preparationRevision,verifyPreparation},work){
 return withExecution({applicationRevision,preparationRevision,verifyPreparation},work,false);
}
// Separate, fixed retained-build boundary. No option can relax the original entry.
export async function withReviewedRetainedBookingExecution({applicationRevision,preparationRevision,verifyPreparation},work){
 return withPinnedFormalPm2Process(()=>withExecution({applicationRevision,preparationRevision,verifyPreparation},work,true));
}
async function withExecution({applicationRevision,preparationRevision,verifyPreparation},work,retained){
 need(process.platform==='linux'&&process.getuid()===0&&typeof work==='function'&&typeof verifyPreparation==='function','unsupported_runtime');
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(directory);
 const review=await collectRemoteReleaseReview(revision),source=inspectPinnedExecutionSource({revision,directory});
 const applicationRows=parseSourceTree(sourceGit('/www/wwwroot/merchant-space',['ls-tree','-r','-z',applicationRevision]));
 const retainedApplicationBinding=retained?assertRetainedBookingSource(applicationRevision,applicationRows,source.rows,revision):null;
 const application=retainedApplicationBinding?.application??assertUnchangedApplicationSource(applicationRevision,applicationRows,source.rows),prepared=await verifyPreparation(preparationRevision,revision);
 const rows=new Map(applicationRows.map(v=>[v.file,v.oid])),changed=source.rows.filter(v=>rows.get(v.file)!==v.oid);
 const toolClosureSha256=sha256(canonicalJson(changed)),witnesses=new Map();
 for(const row of source.rows){if(row.file.startsWith('public/downloads/'))continue;const file=directory+'/'+row.file;witnesses.set(file,canonicalJson(fact(fs.lstatSync(file))));
  for(let parent=path.dirname(file);parent.startsWith(directory);parent=path.dirname(parent))if(!witnesses.has(parent))witnesses.set(parent,canonicalJson(fact(fs.lstatSync(parent))));
 }
 ownedReleasePath(directory,{directory:true});
 const value=freeze({revision,preparationRevision,application,prepared,...(retainedApplicationBinding?{retainedApplicationBinding}:{}),
  sourceInputsSha256:application.source.value,toolClosureSha256,
  tool:Object.freeze({version:1,target:revision,directory,sourceFiles:source.sourceFiles,excludedFiles:source.rows.length-source.sourceFiles,inventorySha256:source.inventorySha256,verified:true})});
 const context={profile:'booking-handoff',revision,preparationRevision,review,witnesses,public:value};issued.add(context);
 return active.run(context,()=>work(value));
}
