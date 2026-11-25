// Separate owned Linux TEMP journal for 047 seals. Does not accept old seals,
// mutate the old journal, choose a production path or repair missing evidence.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {checkout047InstallationSealSummary} from './member-checkout-047-installation.mjs';
const prefix='faolla-checkout-047-installation-seals-';
const need=(value,code)=>{if(!value)throw Error('checkout_047_journal_'+code);};
export function checkout047SealFileName(digest){assert.match(digest,/^[a-f0-9]{64}$/);return digest+'.json';}
function identity(root){
 const base=fs.realpathSync(tmpdir()),stat=fs.lstatSync(root);
 need(path.isAbsolute(root)&&path.dirname(root)===base&&path.basename(root).startsWith(prefix),'root_scope');
 need(!stat.isSymbolicLink()&&stat.isDirectory()&&fs.realpathSync(root)===root,'root_type');
 need((stat.mode&0o077)===0&&stat.uid===process.getuid(),'root_privacy');return {dev:stat.dev,ino:stat.ino};
}
function syncDirectory(root){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function openCheckout047InstallationJournal(root){
 need(process.platform==='linux'&&typeof process.getuid==='function','platform_unsupported');const original=identity(root);syncDirectory(root);
 const check=()=>assert.deepEqual(identity(root),original,'checkout_047_journal_root_changed');
 const read=digest=>{
  check();const file=path.join(root,checkout047SealFileName(digest)),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.nlink===1&&stat.size>0&&stat.size<=65536,'file_type');
   need((stat.mode&0o077)===0&&stat.uid===process.getuid(),'file_privacy');const bytes=fs.readFileSync(fd);need(bytes.length===stat.size,'read_size');check();
   const after=fs.lstatSync(file);need(after.dev===stat.dev&&after.ino===stat.ino&&after.size===stat.size,'file_changed');
   const wire=new TextDecoder('utf-8',{fatal:true}).decode(bytes);need(JSON.parse(wire).sha256===digest,'file_digest');return wire;
  }finally{fs.closeSync(fd);}
 };
 const write=seal=>{
  const summary=checkout047InstallationSealSummary(seal);check();const fd=fs.openSync(path.join(root,checkout047SealFileName(summary.sha256)),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,seal.wire);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(root);need(read(summary.sha256)===seal.wire,'write_readback');return summary.sha256;
 };
 return Object.freeze({root,read,write});
}
export function createCheckout047InstallationJournal(){
 need(process.platform==='linux','platform_unsupported');const root=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),prefix));fs.chmodSync(root,0o700);
 syncDirectory(path.dirname(root));return openCheckout047InstallationJournal(root);
}
