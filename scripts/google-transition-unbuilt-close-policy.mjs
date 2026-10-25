import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const target='8fabf8078a15115ad7765ae7dc60ae63adc74f98',operation='/var/lib/faolla-online-release/'+target;
const directory='/www/wwwroot/merchant-space.web-releases/8fabf8078a15-online';
export const GOOGLE_UNBUILT_CLOSURE=Object.freeze({target,operation,directory,
 baseline:'dd85d9fb1d5f571b6951fdc4891066f0ba88ceef',name:'merchant-space-online-8fabf8078a15',port:3106,
 stateSha256:'9722dc9f3c9afd44194aed46bc9910b4d85e9a7d3ba7d3c36925e2c8a63c7b84',
 stageLog:'/var/log/faolla-google-oauth-transition-publication/'+target+'-stage.log',
 proxyFiles:Object.freeze(['e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf','no_store_entries_www.faolla.com.conf','faolla_contact_card_release.conf'])});
export const GOOGLE_UNBUILT_ABSENT_PATHS=Object.freeze([directory+'/.next',directory+'/.next/BUILD_ID',
 ...['attendance-build-proof.json','build-home','build-cache','build-tmp','attendance-database-progress.json','attendance-database-ready.json',
 'attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
 'migration-preview.json','migration-report.json'].map(f=>operation+'/'+f)]);
export const GOOGLE_UNBUILT_PRESERVED_FILES=Object.freeze({'runtime.json':operation+'/runtime.json','.env.local':directory+'/.env.local',
 'stage.log':GOOGLE_UNBUILT_CLOSURE.stageLog,...Object.fromEntries(GOOGLE_UNBUILT_CLOSURE.proxyFiles.flatMap(f=>['before','after'].map(k=>[k+'-'+f,operation+'/'+k+'-'+f])))});
export const GOOGLE_UNBUILT_FILE_PINS=Object.freeze({
 'runtime.json':'802c41dbca6ba0174b679434401a3436067f60cfa4e48fb7cf708507e789a2a2',
 '.env.local':'a26e567ab08734fd9fb19bc397d37ef733db1ecd9284da656e2717ceb27dcb86',
 'stage.log':'0cf8d795a19ca19a4bae88c5d1e847230f4b0f2648aabf84384fbb60d747bb33',
 'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf':'474c2eef77404ebf7905c8563e5a0e015f4525420c4ce925b2478a196a560608',
 'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf':'cfee2a86ff0b9d73b2f19e37607d4c4d877f6d87529a657d240754589c79f59d',
 'before-no_store_entries_www.faolla.com.conf':'3a274b28d47d3be7e7963611b638a1d94a75dc9d351277941739291061972db2',
 'after-no_store_entries_www.faolla.com.conf':'3fdc070ff0770d955bc07d4d28b5df7d94ba773676c24492efcd235b106024f9',
 'before-faolla_contact_card_release.conf':'e114f1a94bcb2a620d3e213dfe1dbcab825c596a544eb0b56f5409e7b1de1976',
 'after-faolla_contact_card_release.conf':'4ec20d108ba8d60e3090f03c657cab10798774b92ccc49497e9d03fb405132ed'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Error('google_unbuilt_closure_invalid');};
const need=value=>{if(!value)fail();};
const equal=(a,b)=>isDeepStrictEqual(a,b);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function originalState(stateText){
 const p=GOOGLE_UNBUILT_CLOSURE;need(typeof stateText==='string'&&hash(stateText)===p.stateSha256);
 const s=JSON.parse(stateText);need(s.target===p.target&&s.baseline===p.baseline&&s.status==='preparing'&&s.lane==='google-oauth-transition-code-only'&&s.name===p.name&&s.directory===p.directory&&s.port===p.port);
 for(const key of ['googleTransitionBuildProofSha256','activatedAt','databaseReadyAt','termination'])need(!Object.hasOwn(s,key));
 return s;
}
export function createGoogleUnbuiltClosureReceipt({stateText,evidence,toolRevision,terminatedAt}){
 const s=originalState(stateText),p=GOOGLE_UNBUILT_CLOSURE,e=evidence;
 need(e&&equal(Object.keys(e).sort(),['schemaVersion','target','baseline','operation','observedAt','stateSha256','sourceHead','sourceClean','absentPaths','buildUnit','activeText','processes','baseDirectory','maintenanceText','markerSha256','proxyHashes','retentionHeadSha256','preservedFiles','processReferencesAbsent','pm2DumpReferencesAbsent','portVacant','dependenciesSha256','diagnosticTests','diagnosticPasses','diagnosticFailures','diagnosticSkipped','diagnosticCancelled','buildAttemptOccurred','databaseExecutionTracesAbsent'].sort()));
 need(e.schemaVersion===1&&e.target===p.target&&e.baseline===p.baseline&&e.operation===p.operation&&e.stateSha256===p.stateSha256&&e.sourceHead===p.target&&e.sourceClean===true&&timestamp(e.observedAt)&&Date.parse(e.observedAt)>=Date.parse(s.startedAt));
 need(equal(e.absentPaths,GOOGLE_UNBUILT_ABSENT_PATHS)&&equal(e.buildUnit,{name:'faolla-attendance-build-'+p.target+'.service',loadState:'not-found',journalEmpty:true}));
 need(e.processReferencesAbsent===true&&e.pm2DumpReferencesAbsent===true&&e.portVacant===true&&e.databaseExecutionTracesAbsent===true&&e.buildAttemptOccurred===false);
 need(e.diagnosticTests===526&&e.diagnosticPasses===526&&e.diagnosticFailures===0&&e.diagnosticSkipped===0&&e.diagnosticCancelled===0);
 need(equal(e.preservedFiles,GOOGLE_UNBUILT_FILE_PINS)&&equal(e.processes,s.processes)&&equal(JSON.parse(e.activeText),s.previousActive)&&JSON.parse(e.activeText).target===p.baseline&&e.baseDirectory===s.baseDirectory);
 need(hash(e.maintenanceText)===s.maintenanceHash&&JSON.parse(e.maintenanceText).phase==='ended'&&e.markerSha256===s.markerHash&&e.retentionHeadSha256===s.retentionHeadSha256&&e.dependenciesSha256===s.googleTransitionDependenciesSha256);
 need(equal(Object.keys(e.proxyHashes).sort(),[...p.proxyFiles].sort()));
 for(const f of p.proxyFiles)need(e.proxyHashes[f]===s.configs[f].oldHash&&e.preservedFiles['before-'+f]===s.configs[f].oldHash&&e.preservedFiles['after-'+f]===s.configs[f].newHash);
 need(typeof toolRevision==='string'&&/^[a-f0-9]{40}$/.test(toolRevision)&&timestamp(terminatedAt)&&Date.parse(terminatedAt)>=Date.parse(e.observedAt)&&Date.parse(terminatedAt)-Date.parse(e.observedAt)<=300000);
 return {schemaVersion:1,kind:'google-transition-resource-rejection-termination',target:p.target,baseline:p.baseline,operation:p.operation,
  originalStateText:stateText,originalStateSha256:p.stateSha256,evidence:JSON.parse(JSON.stringify(e)),evidenceSha256:hash(JSON.stringify(e)),toolRevision,terminatedAt};
}
export function assertGoogleUnbuiltClosureReceipt({stateText,receipt,preservedFiles,absentPaths}){
 need(receipt&&receipt.originalStateText===stateText);
 const expected=createGoogleUnbuiltClosureReceipt({stateText,evidence:receipt.evidence,toolRevision:receipt.toolRevision,terminatedAt:receipt.terminatedAt});
 need(equal(receipt,expected)&&equal(preservedFiles,receipt.evidence.preservedFiles)&&equal(absentPaths,GOOGLE_UNBUILT_ABSENT_PATHS));
}
