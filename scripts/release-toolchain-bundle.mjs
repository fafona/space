// Dependency-free bundle verification, shared by workstation and isolated host.
import * as fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {canonicalJson,exactKeys,fingerprint,compareFingerprint,safeRelativePath,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const BUNDLE_MANIFEST='toolchain-bundle.json';
export function validateBundleManifest(v){
 exactKeys(v,['schemaVersion','kind','toolRevision','entrypoints','files','fingerprint']);
 need(v.schemaVersion===1&&v.kind==='release-toolchain-bundle'&&/^[a-f0-9]{40}$/.test(v.toolRevision??''),'invalid_bundle');
 need(Array.isArray(v.entrypoints)&&v.entrypoints.length>0&&new Set(v.entrypoints).size===v.entrypoints.length&&Array.isArray(v.files)&&v.files.length>0&&v.files.length<=1000,'invalid_bundle');
 const names=new Set(),folded=new Set();for(const f of v.files){exactKeys(f,['path','role','bytes','sha256']);safeRelativePath(f.path);
  need(f.path!==BUNDLE_MANIFEST&&!names.has(f.path)&&!folded.has(f.path.toLowerCase())&&['code','resource'].includes(f.role)&&
   Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=4*1024**2&&/^[a-f0-9]{64}$/.test(f.sha256??''),'invalid_bundle');
  names.add(f.path);folded.add(f.path.toLowerCase());
 }
 need(isSorted(v.files.map(f=>f.path))&&isSorted(v.entrypoints),'invalid_bundle');
 for(const e of v.entrypoints){safeRelativePath(e);need(v.files.some(f=>f.path===e&&f.role==='code'),'invalid_bundle');}
 const {fingerprint:pin,...body}=v;compareFingerprint(pin,fingerprint('tool-bundle',body,'canonical-json-v1'),'tool-bundle');return v;
}
const isSorted=names=>names.every((name,i)=>i===0||names[i-1]<name);
export function bundleManifest({toolRevision,entrypoints,files}){
 const body={schemaVersion:1,kind:'release-toolchain-bundle',toolRevision,entrypoints:[...entrypoints].sort(),files:[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
 const value={...body,fingerprint:fingerprint('tool-bundle',body,'canonical-json-v1')};validateBundleManifest(value);return value;
}
function regular(file,root){
 const stat=fs.lstatSync(file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&fs.realpathSync(file)===file&&
 stat.size<=4*1024**2&&(process.platform==='win32'||stat.uid===process.getuid()&&(stat.mode&0o022)===0),'bundle_bytes_changed');
 need(file.startsWith(root+path.sep),'invalid_path');return stat;
}
export function verifyToolchainBundle(directory){
 const root=path.resolve(directory),top=fs.lstatSync(root);need(top.isDirectory()&&!top.isSymbolicLink()&&fs.realpathSync(root)===root&&
 (process.platform==='win32'||top.uid===process.getuid()&&(top.mode&0o077)===0),'invalid_bundle');
 regular(path.join(root,BUNDLE_MANIFEST),root);
 const manifest=validateBundleManifest(JSON.parse(fs.readFileSync(path.join(root,BUNDLE_MANIFEST),'utf8'))),expected=new Set([BUNDLE_MANIFEST,...manifest.files.map(f=>f.path)]),actual=[];
 function walk(current,prefix=''){for(const e of fs.readdirSync(current,{withFileTypes:true})){
  const name=prefix+e.name;need(!e.isSymbolicLink(),'bundle_bytes_changed');
  if(e.isDirectory()){need([...expected].some(f=>f.startsWith(name+'/')),'bundle_extra_file');walk(path.join(current,e.name),name+'/');}
  else{need(e.isFile()&&expected.has(name),'bundle_extra_file');actual.push(name);}
 }}walk(root);need(actual.length===expected.size,'bundle_missing_file');
 for(const f of manifest.files){const file=path.join(root,...f.path.split('/')),stat=regular(file,root),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const id=s=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]),before=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);need(isDeepStrictEqual(id(before),id(stat))&&isDeepStrictEqual(id(after),id(before))&&isDeepStrictEqual(id(fs.lstatSync(file)),id(before))&&
   stat.size===f.bytes&&bytes.length===f.bytes&&sha256(bytes)===f.sha256,'bundle_bytes_changed');}finally{fs.closeSync(fd);}
 }
 return {schemaVersion:1,kind:'verified-toolchain-bundle',toolRevision:manifest.toolRevision,fingerprint:manifest.fingerprint,files:manifest.files.length,publicationAuthority:false};
}
export function writeNewBundle(directory,{manifest,readBlob}){
 validateBundleManifest(manifest);const root=path.resolve(directory);need(!fs.existsSync(root),'invalid_bundle');fs.mkdirSync(root,{mode:0o700});
 for(const f of manifest.files){const target=path.join(root,...f.path.split('/')),bytes=readBlob(f.path);need(Buffer.isBuffer(bytes)&&bytes.length===f.bytes&&sha256(bytes)===f.sha256,'bundle_bytes_changed');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 fs.writeFileSync(path.join(root,BUNDLE_MANIFEST),canonicalJson(manifest)+'\n',{flag:'wx',mode:0o600});return verifyToolchainBundle(root);
}
