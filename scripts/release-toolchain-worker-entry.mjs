// Entry detection is not execution authority. The worker still verifies its
// immutable source, saved runtime, committed gate and actual process cohort.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function bookingWorkerEntryMode(metaUrl,{argv=process.argv,env=process.env,connected=process.connected,send=process.send}={}){
 if(!Array.isArray(argv)||argv.length!==2||typeof argv[1]!=='string')return null;
 const file=fileURLToPath(metaUrl);
 if(pathToFileURL(file).href!==metaUrl)return null;
 if(pathToFileURL(path.resolve(argv[1])).href===metaUrl)return 'direct';
 // PM2's actual ESM fork container imports the file without replacing argv[1].
 // A normal import, a bare pm_exec_path variable or an unrelated IPC child is
 // not an entrypoint. There is no alternate root, command or gate flag.
 if(connected===true&&typeof send==='function'&&env.pm_exec_path===file&&
   path.basename(argv[1])==='ProcessContainerFork.js'&&path.basename(path.dirname(argv[1]))==='lib'&&
   path.basename(path.dirname(path.dirname(argv[1])))==='pm2')return 'pm2';
 return null;
}
