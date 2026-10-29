// /proc/<pid> directory dentries can be reinstantiated while the same process
// remains alive. Their inode/timestamps are observations, not process births.
// captureProcessFact's original within-capture drift checks remain unchanged.
import {isDeepStrictEqual} from 'node:util';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
const FIELDS=['pid','parentPid','startTicks','processIdentity','uid','cwd','cwdIdentity','executable','executableIdentity','commandLineDigest'];
function procIdentity(value){
 need(typeof value==='string'&&/^[0-9]+(?::[0-9]+){7}$/.test(value),'owned_resource_changed');
 const [dev,ino,size,mtime,ctime,nlink,uid,mode]=value.split(':').map(BigInt);
 need(dev>0n&&ino>0n&&size===0n&&mtime>0n&&ctime>0n&&nlink>0n&&uid===0n&&(mode&0o170000n)===0o040000n&&(mode&0o022n)===0n,'owned_resource_changed');
 return{dev:dev.toString(),size:size.toString(),nlink:nlink.toString(),uid:uid.toString(),mode:mode.toString()};
}
export function assertSameLongLivedDaemon(actual,expected){
 for(const value of [actual,expected]){
  need(value&&typeof value==='object'&&!Array.isArray(value)&&isDeepStrictEqual(Object.keys(value).sort(),[...FIELDS].sort()),'owned_resource_changed');
  need(Number.isSafeInteger(value.pid)&&value.pid>0&&Number.isSafeInteger(value.parentPid)&&value.parentPid>=0&&/^[1-9][0-9]*$/.test(value.startTicks??'')&&value.uid===0&&value.executable==='/usr/bin/node'&&/^[a-f0-9]{64}$/.test(value.commandLineDigest??'')&&typeof value.cwd==='string'&&value.cwd.startsWith('/'),'owned_resource_changed');
 }
 const stable=value=>({...value,processIdentity:procIdentity(value.processIdentity)});
 need(isDeepStrictEqual(stable(actual),stable(expected)),'owned_resource_changed');return true;
}
