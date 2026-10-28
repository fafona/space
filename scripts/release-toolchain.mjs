// Safe tools only. NO deploy/apply/merge/restart/delete/force/skip entrypoint.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {assessToolchainReadiness,localHostObservation} from './release-toolchain-doctor.mjs';
import {verifyToolchainBundle} from './release-toolchain-bundle.mjs';
import {inspectToolchainRun} from './release-toolchain-journal.mjs';
import {rehearseToolchainIngress} from './release-toolchain-rehearsal.mjs';
import {requireToolchain as need,publicFailure} from './release-toolchain-contracts.mjs';
export function parseToolchainArguments(args){
 if(args.length===1&&args[0]==='doctor')return {command:'host'};
 if(args.length===2&&['doctor','verify-bundle','journal'].includes(args[0]))return {command:args[0],file:args[1]};
 if(args.length===3&&args[0]==='rehearse'&&['1','2','3','4','5','6','7','8','9','10'].includes(args[2]))return {command:'rehearse',nginx:args[1],runs:Number(args[2])};
 need(false,'invalid_contract');
}
export async function toolchainMain(args,write=value=>console.log(JSON.stringify(value))){
 const parsed=parseToolchainArguments(args);
 if(parsed.command==='host'){write({schemaVersion:1,kind:'release-toolchain-host-observation',host:localHostObservation(),publicationAuthority:false,releaseEvidenceRequired:true});return 0;}
 if(parsed.command==='doctor'){const s=fs.lstatSync(parsed.file);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=2*1024**2,'evidence_invalid');
  const {expected,observed}=JSON.parse(fs.readFileSync(parsed.file,'utf8'));observed.host=localHostObservation();const report=assessToolchainReadiness(expected,observed);write(report);return report.ready?0:1;}
 if(parsed.command==='verify-bundle'){write(verifyToolchainBundle(parsed.file));return 0;}
 if(parsed.command==='journal'){const r=inspectToolchainRun(parsed.file);write({schemaVersion:1,kind:'release-toolchain-run-status',status:r.status,nextStage:r.nextStage,head:r.head,events:r.events.length,publicationAuthority:false});return r.status==='unknown'?1:0;}
 write(await rehearseToolchainIngress({...parsed,onEvent:write}));return 0;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)toolchainMain(process.argv.slice(2)).then(code=>{process.exitCode=code;},error=>{console.error(JSON.stringify(publicFailure(error,{stage:process.argv[2]==='rehearse'?'rehearsal':'environment'})));process.exitCode=1;});
export const TOOLCHAIN_CLI_SOURCE=fileURLToPath(import.meta.url);
