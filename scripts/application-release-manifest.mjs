// Read-only manifest planner. Review and save stdout in the manifest path, then
// commit it normally. Its own Git blob is excluded to avoid self-reference.
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {parseSourceTree,sourceGit} from './release-toolchain-source.mjs';
import {createApplicationReleaseManifest,assertApplicationReleasePackage} from './application-release-policy.mjs';
export function planApplicationReleaseManifest({directory,baseline,target,purpose,focusedTests}){
 if(!/^[a-f0-9]{40}$/.test(baseline??'')||!(target==='HEAD'||/^[a-f0-9]{40}$/.test(target??'')))throw Error('application_manifest_revision');
 const resolved=sourceGit(directory,['rev-parse',target+'^{commit}']).toString().trim();
 if(!/^[a-f0-9]{40}$/.test(resolved))throw Error('application_manifest_revision');
 sourceGit(directory,['merge-base','--is-ancestor',baseline,resolved]);
 const rows=revision=>parseSourceTree(sourceGit(directory,['ls-tree','-r','-z',revision]));
 assertApplicationReleasePackage(JSON.parse(sourceGit(directory,['show',baseline+':package.json'])),JSON.parse(sourceGit(directory,['show',resolved+':package.json'])));
 return createApplicationReleaseManifest({baseline,baselineRows:rows(baseline),targetRows:rows(resolved),purpose,focusedTests});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [baseline,target,purpose,...focusedTests]=process.argv.slice(2);
 try{console.log(JSON.stringify(planApplicationReleaseManifest({directory:fileURLToPath(new URL('..',import.meta.url)),baseline,target,purpose,focusedTests}),null,2));}
 catch(error){console.error(/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'application_manifest_refused');process.exitCode=1;}
}
