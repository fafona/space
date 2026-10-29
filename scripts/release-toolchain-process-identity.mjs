// Process birth is PID + kernel start ticks, not a cached /proc directory
// inode. Preserve captureProcessFact's within-capture drift checks and compare
// every durable field, including the exact command, cwd and executable inode.
import {isDeepStrictEqual} from 'node:util';
import {assertSameLongLivedDaemon} from './release-toolchain-daemon-identity.mjs';
import {sha256,requireToolchain as need,exactKeys} from './release-toolchain-contracts.mjs';
const FIELDS=['pid','parentPid','startTicks','processIdentity','uid','cwd','cwdIdentity','executable','executableIdentity','commandLine','commandLineDigest'];
export function assertSameNodeProcess(actual,expected){
 for(const value of [actual,expected]){exactKeys(value,FIELDS);need(Array.isArray(value.commandLine)&&value.commandLine.length>0&&value.commandLine.every(v=>typeof v==='string'&&!v.includes('\0')),'owned_resource_changed');need(value.commandLineDigest===sha256(value.commandLine.join('\0')+'\0'),'owned_resource_changed');}
 need(isDeepStrictEqual(actual.commandLine,expected.commandLine),'owned_resource_changed');
 const{commandLine:a,...left}=actual,{commandLine:b,...right}=expected;void a;void b;
 return assertSameLongLivedDaemon(left,right);
}
// Only callers whose existing policy explicitly permits reparenting may use
// this. All other fields, birth, ownership and executable/cwd stay mandatory.
export function assertSameReparentableNodeProcess(expected,actual){
 need(Number.isSafeInteger(expected?.parentPid)&&expected.parentPid>=0&&Number.isSafeInteger(actual?.parentPid)&&actual.parentPid>=0,'owned_resource_changed');
 return assertSameNodeProcess(actual,{...expected,parentPid:actual.parentPid});
}
