// Entry detection is not execution authority. The worker still verifies its
// immutable source, saved runtime, committed gate and actual process cohort.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
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
// CI component topology only, not a formal-host exception. The original
// three-process observer stays unchanged; adding an ESM probe must preserve
// every original full stable row and permit precisely this fourth child.
export function assertOwnedWorkerEntryCohort(before,after,{name,script,cwd,pmId}){
 const need=v=>{if(!v)throw Error('owned_worker_entry_cohort_unconfirmed');};
 need(Array.isArray(before)&&before.length===3&&Array.isArray(after)&&after.length===4&&new Set(after.map(v=>v.name)).size===4&&new Set(after.map(v=>v.pm_id)).size===4);
 for(const row of before)need(isDeepStrictEqual(after.find(v=>v.name===row.name),row));
 const row=after.find(v=>v.name===name),e=row?.pm2_env;need(row&&row.pm_id===pmId&&Number.isSafeInteger(row.pid)&&row.pid>0&&e?.status==='online'&&e.pm_exec_path===script&&e.pm_cwd===cwd&&e.exec_interpreter==='/usr/bin/node'&&e.exec_mode==='fork_mode'&&e.autorestart===false&&e.watch===false&&e.restart_time===0);
 need(isDeepStrictEqual(e.args??[],[])&&isDeepStrictEqual(e.node_args??[],[]));return row;
}
