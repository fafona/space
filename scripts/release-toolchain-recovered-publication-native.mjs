import{acceptRecoveredPublicationDispositionKernel}from'./online-release-retention-writer.mjs';
import{runRecoveredPublicationPythonWorkerContract}from'./release-toolchain-python-runtime.mjs';
import{bookingHostWriteOnce}from'./booking-handoff-host-io.mjs';
import{canonicalJson,publicFailure,requireToolchain as need}from'./release-toolchain-contracts.mjs';
need(process.argv.length===2&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted','unsupported_runtime');
try{const result=await acceptRecoveredPublicationDispositionKernel();bookingHostWriteOnce(result.root+'/python-runtime.json',canonicalJson(runRecoveredPublicationPythonWorkerContract())+'\n');console.log(canonicalJson(result));}catch(error){console.error(canonicalJson(publicFailure(error,{stage:'rehearsal'})));process.exitCode=1;}
