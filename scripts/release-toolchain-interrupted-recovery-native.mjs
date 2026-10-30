import {acceptInterruptedPublicationRecoveryKernel} from './online-release-retention-writer.mjs';
import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
need(process.argv.length===2&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted','unsupported_runtime');
try{console.log(canonicalJson(await acceptInterruptedPublicationRecoveryKernel()));}catch(e){console.error(canonicalJson(publicFailure(e,{stage:'rehearsal'})));process.exitCode=1;}
