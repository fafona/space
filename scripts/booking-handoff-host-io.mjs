// Fixed-host IO shared only by the approved booking controller. No alternate
// host, database, process name, source revision or unheld lock is accepted.
import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {assertOnlineToolOwnedPath,verifyOnlineReleaseTool,createOnlineReleaseToolPlan,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';

export const BOOKING_HOST_RELEASE='/var/lib/faolla-online-release';
export const BOOKING_HOST_CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
export const bookingHostNeed=(value,code)=>{if(!value)throw Error('booking_host_'+code);};
export const bookingHostEqual=(a,b,code)=>bookingHostNeed(isDeepStrictEqual(a,b),code);
export const bookingHostHash=value=>createHash('sha256').update(value).digest('hex');
const identity=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
export const bookingHostEnvironment=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
export function bookingHostRun(bin,args,options={}){
 const result=spawnSync(bin,args,{encoding:'utf8',env:bookingHostEnvironment(),timeout:10000,maxBuffer:32*1024**2,windowsHide:true,...options});
 bookingHostNeed(result.status===0&&!result.error&&!result.signal,'command_unconfirmed');return result.stdout;
}
export function bookingHostRead(file,{privateMode=true,binary=false}={}){
 assertOnlineToolOwnedPath(file,'file');const stat=fs.lstatSync(file);
 bookingHostNeed(stat.size>0&&stat.size<=32*1024**2&&(!privateMode||(stat.mode&0o777)===0o600),'file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{bookingHostEqual(identity(fs.fstatSync(fd)),identity(stat),'file_replaced');const value=fs.readFileSync(fd);
  bookingHostEqual(identity(fs.fstatSync(fd)),identity(stat),'file_changed');bookingHostEqual(identity(fs.lstatSync(file)),identity(stat),'file_replaced');
  bookingHostNeed(value.length===stat.size,'file_changed');return binary?value:value.toString('utf8');
 }finally{fs.closeSync(fd);}
}
export function bookingHostSync(directory){assertOnlineToolOwnedPath(directory);const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function bookingHostWriteOnce(file,text){
 assertOnlineToolOwnedPath(path.dirname(file));bookingHostNeed((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_parent');
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}bookingHostSync(path.dirname(file));bookingHostEqual(bookingHostRead(file),text,'write_readback');
}
export function bookingHostReplace(file,before,after,suffix){
 bookingHostNeed(/^[a-z0-9-]+$/.test(suffix),'temporary_suffix');bookingHostEqual(bookingHostRead(file,{privateMode:false}),before,'replacement_before');
 const temporary=file+'.booking-'+suffix+'.tmp';
 // Configuration parents need not be private. The new file itself always is.
 assertOnlineToolOwnedPath(path.dirname(file));const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,after);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}bookingHostSync(path.dirname(file));
 bookingHostEqual(bookingHostRead(file,{privateMode:false}),before,'replacement_race');fs.renameSync(temporary,file);bookingHostSync(path.dirname(file));bookingHostEqual(bookingHostRead(file),after,'replacement_readback');
}
export function assertBookingHostInvocation({lock,toolRevision}){
 bookingHostNeed(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
 bookingHostNeed(/^[a-f0-9]{40}$/.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
 const tool=verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
 const files=runOnlineToolGit('/www/wwwroot/merchant-space',['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
 const toolClosureSha256=assertBookingHandoffToolClosure({baseline:CANDIDATE,files,readBlob:f=>runOnlineToolGit('/www/wwwroot/merchant-space',['show',toolRevision+':'+f])});
 return {tool,toolClosureSha256};
}
export function bookingHostSql(sql,{timeout=15000}={}){
 const container=JSON.parse(bookingHostRun('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',BOOKING_HOST_CONTAINER]));
 bookingHostNeed(container.id===BOOKING_HOST_CONTAINER&&container.name==='/supabase-db'&&container.running===true&&
  container.image==='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d'&&
  container.mounts?.some(m=>m.Type==='bind'&&m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'database_container');
 return bookingHostRun('docker',['exec','-i',BOOKING_HOST_CONTAINER,'sh','-lc',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],{input:sql,timeout}).trim();
}
