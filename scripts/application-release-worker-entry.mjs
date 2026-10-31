// One source-only worker upgrade prepares the existing immutable booking
// application for certified web successors. It never activates a database,
// changes the worker gate, or publishes the website.
import {publishApplicationCompatibleBookingWorker,auditBookingWorkerSuccessor} from './release-toolchain-worker-release-host.mjs';
try {
  console.log(JSON.stringify(await publishApplicationCompatibleBookingWorker()));
  console.log(JSON.stringify(await auditBookingWorkerSuccessor()));
} catch (error) {
  console.error(JSON.stringify({kind:'application-worker-preparation-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'operation_unconfirmed',mailEnabled:false,automaticRetryAllowed:false}));
  process.exitCode=1;
}
