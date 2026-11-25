// Exclusive, private TEMP result journal. No production path, connector, mutable
// replacement or automatic repair. Missing/corrupt prepared evidence fails closed.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {installationSealSummary} from './member-checkout-installation-seal.mjs';

const prefix='faolla-checkout-installation-seals-';
const need=(value,code)=>{if(!value)throw Error('installation_journal_'+code);};
export function installationSealFileName(digest) {assert.match(digest,/^[a-f0-9]{64}$/);return digest+'.json';}
function rootIdentity(root) {
  const base=fs.realpathSync(tmpdir()),stat=fs.lstatSync(root);
  need(path.isAbsolute(root)&&path.dirname(root)===base&&path.basename(root).startsWith(prefix),'root_scope');
  need(!stat.isSymbolicLink()&&stat.isDirectory()&&fs.realpathSync(root)===root,'root_type');
  need((stat.mode&0o077)===0&&stat.uid===process.getuid(),'root_privacy');
  return {dev:stat.dev,ino:stat.ino};
}
function syncDirectory(root) {
  const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function openInstallationSealJournal(root) {
  // Windows cannot supply the Unix owner/mode/directory-fsync proof used here.
  // Refuse rather than labelling its filesystem as an equivalent durable journal.
  need(process.platform==='linux'&&typeof process.getuid==='function','platform_unsupported');
  const identity=rootIdentity(root);syncDirectory(root);
  const check=()=>assert.deepEqual(rootIdentity(root),identity,'installation_journal_root_changed');
  const read=digest=>{
    check();const file=path.join(root,installationSealFileName(digest));
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.nlink===1&&stat.size>0&&stat.size<=65536,'file_type');
      need((stat.mode&0o077)===0&&stat.uid===process.getuid(),'file_privacy');
      const bytes=fs.readFileSync(fd);need(bytes.length===stat.size,'read_size');check();
      const after=fs.lstatSync(file);need(after.dev===stat.dev&&after.ino===stat.ino&&after.size===stat.size,'file_changed');
      const wire=new TextDecoder('utf-8',{fatal:true}).decode(bytes);need(JSON.parse(wire).sha256===digest,'file_digest');return wire;
    }finally{fs.closeSync(fd);}
  };
  const write=seal=>{
    const summary=installationSealSummary(seal);check();const file=path.join(root,installationSealFileName(summary.sha256));
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,seal.wire);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    syncDirectory(root);need(read(summary.sha256)===seal.wire,'write_readback');
    return summary.sha256;
  };
  return Object.freeze({root,read,write});
}
export function createInstallationSealJournal() {
  need(process.platform==='linux','platform_unsupported');
  const root=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),prefix));fs.chmodSync(root,0o700);
  syncDirectory(path.dirname(root));return openInstallationSealJournal(root);
}
