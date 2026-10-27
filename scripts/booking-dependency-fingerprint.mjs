// Same mode-aware serialization as the original booking stage, with bounded,
// no-follow streaming and before/after identity witnesses. No alternate target.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineToolOwnedPath} from './prepare-online-release-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A} from './booking-handoff-policy.mjs';
import {BOOKING_BUILT_SMOKE_PINS} from './booking-built-smoke-repair-policy.mjs';
export const BOOKING_DEPENDENCY_MODE_SHA256='f12f24a40f70ac0f5c55821268303873826ece213856cb0b8e84f871cd58428e';
const need=(v,c)=>{if(!v)throw Error('booking_dependency_'+c);};
const identity=s=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]);
const same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
export function bookingModeAwareDependencies(root){
 assertOnlineToolOwnedPath(root);const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let files=0,total=0;
 function walk(directory,relative=''){
  const before=fs.lstatSync(directory),names=fs.readdirSync(directory).sort();
  need(before.uid===0&&before.isDirectory()&&!before.isSymbolicLink()&&!(before.mode&0o022),'directory');
  for(const name of names){const file=path.join(directory,name),key=relative?relative+'/'+name:name,s=fs.lstatSync(file);need(s.uid===0,'owner');
   if(s.isSymbolicLink()){
    const target=fs.readlinkSync(file),resolved=fs.realpathSync(file);need(resolved.startsWith(root+'/'),'link');
    digest.update(JSON.stringify([key,'link',target]));same(identity(fs.lstatSync(file)),identity(s));
    need(fs.readlinkSync(file)===target&&fs.realpathSync(file)===resolved,'changed');need(++files<200000,'size');
   }else{
    need(!(s.mode&0o022),'mode');
    if(s.isDirectory()){digest.update(JSON.stringify([key,'directory',s.mode&0o777]));walk(file,key);}
    else{
     need(s.isFile()&&s.size>=0&&s.size<=256*1024**2&&++files<200000,'type');total+=s.size;need(total<3*1024**3,'size');
     const h=createHash('sha256'),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let count=0;
     try{same(identity(fs.fstatSync(fd)),identity(s));for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;need(count<=s.size,'changed');h.update(buffer.subarray(0,n));}
      need(count===s.size,'changed');same(identity(fs.fstatSync(fd)),identity(s));same(identity(fs.lstatSync(file)),identity(s));
     }finally{fs.closeSync(fd);}
     digest.update(JSON.stringify([key,'file',s.mode&0o777,h.digest('hex')]));
    }
   }
  }
  same(fs.readdirSync(directory).sort(),names);same(identity(fs.lstatSync(directory)),identity(before));
 }
 walk(root);return digest.digest('hex');
}
export function assertBookingDependencyBinding({target,savedDigest,modeAwareDigest,streamedTree}){
 need([A,C].includes(target),'target');const pin=BOOKING_BUILT_SMOKE_PINS.pair.find(p=>p.target===target);
 need(modeAwareDigest===BOOKING_DEPENDENCY_MODE_SHA256,'mode_digest');
 need(isDeepStrictEqual(streamedTree,pin.dependencies),'sealed_tree');
 // The primary stage stores the mode-aware digest; rollback-built stores the
 // independent streamed-tree digest. Never accept either digest as the other.
 need(savedDigest===(target===C?modeAwareDigest:streamedTree.sha256),'saved_digest');return true;
}
