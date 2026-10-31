import * as fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
const SOURCES=['release-toolchain-worker-entry.mjs','booking-atomic-worker.mjs','release-toolchain-worker-release-contract.mjs','release-toolchain-worker-application-acceptance.mjs'];
export function assertWorkerEntryAcceptance(report,{revision,sourceHashes}){
 need(report?.kind==='real-pm2-esm-booking-worker-entry-acceptance'&&report.toolRevision===revision&&report.realPm2Version==='6.0.14'&&report.entryMode==='pm2'&&Number.isSafeInteger(report.openedGateCompletedCycles)&&report.openedGateCompletedCycles>=2,'evidence_invalid');
 for(const key of ['actualPm2Wrapper','argvUnchanged','closedGatePaused','closedAgainNoDispatch','syntheticTickOnly','missingDatabaseCredentialRefused','databaseClientConfigured','unrelatedSettingsNotImported'])need(report[key]===true,'evidence_invalid');
 const kernel=report.databaseContinuationKernel;need(kernel?.kind==='worker-database-continuation-kernel-verified'&&kernel.actualFlock===true&&kernel.productionTokensRejected===true&&kernel.originalOperationInodesRetained===true&&kernel.originalFailureBytesRetained===true&&kernel.unknownsNeverCompleted===true&&kernel.formalHostTouched===false&&kernel.publicationAuthority===false,'evidence_invalid');
 need(canonicalJson(kernel.cases)===canonicalJson([{outcome:'normal',completed:true,archived:true},{outcome:'unknown-before-archive',completed:false,archived:false},{outcome:'unknown-after-archive',completed:false,archived:true},{outcome:'wrong-completion',completed:false,archived:true}]),'evidence_invalid');
 need(report.applicationOrDatabaseLoaded===true&&report.formalDatabaseLoaded===false&&report.applicationSourceVerified===true,'evidence_invalid');
 const application=report.applicationProof;need(application?.kind==='actual-booking-application-synthetic-acceptance'&&application.actualApplicationInvoked===true&&application.zeroSiteDynamicImport===true&&application.multiSiteCompleted===true&&application.sharedAtomicContext===true&&application.syntheticCommits===2&&application.claimCalls>=2&&application.completedTicks>=2&&application.realNetwork===false&&application.formalDatabaseLoaded===false&&application.mailEnabled===false,'evidence_invalid');
 for(const key of ['formalHostTouched','publicationAuthority'])need(report[key]===false,'evidence_invalid');
 need(JSON.stringify(Object.keys(report.sourceHashes??{}).sort())===JSON.stringify([...SOURCES].sort())&&SOURCES.every(name=>report.sourceHashes[name]===sourceHashes[name]),'source_changed');return true;
}
// The original official artifact ZIP is copied using normally configured local
// GitHub access. The host independently checks its digest against GitHub's API;
// no client-provided green JSON is admission and no credentials are copied.
export async function verifyWorkerEntryCiArtifact({revision,review,file,source}){
 const run=review.runs.find(r=>r.workflow==='.github/workflows/release-toolchain.yml');need(run,'evidence_invalid');
 const response=await fetch('https://api.github.com/repos/fafona/space/actions/runs/'+run.runId+'/artifacts?per_page=100',{redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'Faolla-Worker-Release'},signal:AbortSignal.timeout(10000)});need(response.status===200,'evidence_invalid');
 const listing=await response.json();need(listing.total_count===listing.artifacts?.length,'evidence_invalid');const items=listing.artifacts.filter(v=>v.name==='release-toolchain-ingress-evidence'&&v.expired===false&&v.workflow_run?.head_sha===revision);need(items.length===1&&/^sha256:[a-f0-9]{64}$/.test(items[0].digest??''),'evidence_invalid');
 const st=ownedReleasePath(file,{privateMode:true});need(st.size>0&&st.size<=128*1024**2&&st.size===items[0].size_in_bytes,'evidence_invalid');const bytes=fs.readFileSync(file);need(sha256(bytes)===items[0].digest.slice(7),'evidence_invalid');
 const python=String.raw`import io,json,tarfile,zipfile,sys
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(134217729))) as z:
 names=[v for v in z.infolist() if v.filename.rsplit('/',1)[-1]=='release-toolchain-equivalence-evidence.tar']
 if len(names)!=1 or names[0].file_size>67108864: raise ValueError('artifact')
 with tarfile.open(fileobj=io.BytesIO(z.read(names[0]))) as tar:
  rows=[v for v in tar.getmembers() if v.name.endswith('/reports/booking-worker-esm-entry-verified.json')]
  if len(rows)!=1 or not rows[0].isfile() or rows[0].size>65536: raise ValueError('entry')
  root=rows[0].name.rsplit('/reports/',1)[0]
  cleanup=tar.getmember(root+'/reports/cleanup-verified.json')
  if not cleanup.isfile() or cleanup.size>65536: raise ValueError('cleanup')
  result={'entry':json.load(tar.extractfile(rows[0])),'cleanup':json.load(tar.extractfile(cleanup))}
  print(json.dumps(result,separators=(',',':')))
`;
 const runtime=captureTrustedPython();verifyTrustedPython(runtime);const result=spawnSync(runtime.target.path,['-I','-S','-B','-c',python],{input:bytes,encoding:'utf8',timeout:15000,maxBuffer:262144,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});verifyTrustedPython(runtime);need(result.status===0&&!result.signal&&!result.error&&result.stderr==='','evidence_invalid');const report=JSON.parse(result.stdout),sourceHashes=Object.fromEntries(SOURCES.map(name=>[name,sha256(fs.readFileSync(source+'/scripts/'+name))]));
 assertWorkerEntryAcceptance(report.entry,{revision,sourceHashes});need(report.cleanup.allOwnedProcessesStopped===true&&report.cleanup.formalHostTouched===false&&report.cleanup.passed===true,'evidence_invalid');
 const after=ownedReleasePath(file,{privateMode:true});need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>st[k]===after[k]),'owned_resource_changed');return{kind:'official-artifact-real-pm2-entry-verified',revision,runId:run.runId,artifactId:items[0].id,archiveSha256:sha256(bytes),entrySha256:sha256(JSON.stringify(report.entry)),report};
}
