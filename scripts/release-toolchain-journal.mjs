// Append-only evidence journal. An unknown mutating attempt is NEVER replayed.
// Journal verification is not production authority or an ownership bypass.
import * as fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TOOLCHAIN_STAGES,TOOLCHAIN_CODES,canonicalJson,exactKeys,fingerprint,assertFingerprint,compareFingerprint,publicFailure,requireToolchain as need,sha256} from './release-toolchain-contracts.mjs';
function writeOnce(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,canonicalJson(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);
 try{if(process.platform!=='win32')fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function privateDirectory(directory){const st=fs.lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink()&&fs.realpathSync(directory)===directory&&
 (process.platform==='win32'||st.uid===process.getuid()&&(st.mode&0o077)===0),'journal_invalid');return st;}
function read(file){const st=fs.lstatSync(file);need(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size>0&&st.size<=256*1024&&
 (process.platform==='win32'||st.uid===process.getuid()&&(st.mode&0o077)===0),'journal_invalid');return fs.readFileSync(file,'utf8');}
export function createToolchainRun(parent,binding){
 assertFingerprint(binding,'evidence');const root=fs.realpathSync(parent),directory=fs.mkdtempSync(path.join(root,'faolla-release-run-'));fs.chmodSync(directory,0o700);
 writeOnce(path.join(directory,'run.json'),{schemaVersion:1,kind:'release-toolchain-evidence-run',id:randomUUID(),binding,publicationAuthority:false});return directory;
}
export function inspectToolchainRun(directory){
 const root=path.resolve(directory);privateDirectory(root);const header=JSON.parse(read(path.join(root,'run.json')));
 exactKeys(header,['schemaVersion','kind','id','binding','publicationAuthority']);need(header.schemaVersion===1&&header.kind==='release-toolchain-evidence-run'&&header.publicationAuthority===false&&/^[a-f0-9-]{36}$/.test(header.id),'journal_invalid');assertFingerprint(header.binding,'evidence');
 const names=fs.readdirSync(root).filter(n=>n!=='run.json'&&n!=='.writer-lock');need(names.every(n=>/^[0-9]{6}\.json$/.test(n)),'journal_invalid');names.sort();
 let previous=sha256(canonicalJson(header)),stageIndex=0,pending=null,terminal=false;const events=[];
 for(const [i,name]of names.entries()){
  need(name===String(i+1).padStart(6,'0')+'.json','journal_invalid');const raw=read(path.join(root,name)),event=JSON.parse(raw);
  exactKeys(event,['schemaVersion','sequence','previous','stage','state','evidence','error','digest']);
  const {digest,...body}=event;need(raw===canonicalJson(event)+'\n'&&digest===sha256(canonicalJson(body))&&event.sequence===i+1&&event.previous===previous&&event.schemaVersion===1&&
   !terminal&&event.stage===TOOLCHAIN_STAGES[stageIndex]&&['started','verified','unknown'].includes(event.state),'journal_invalid');
  if(event.state==='started'){need(pending===null&&event.error===null,'journal_invalid');assertFingerprint(event.evidence,'evidence');pending=event.stage;}
  else if(event.state==='verified'){need(pending===event.stage&&event.error===null,'journal_invalid');assertFingerprint(event.evidence,'evidence');pending=null;stageIndex++;}
  else{need(pending===event.stage&&event.evidence===null&&event.error?.kind==='release-toolchain-failure'&&event.error.stage===event.stage,'journal_invalid');
   exactKeys(event.error,['schemaVersion','kind','stage','code','detailsRedacted']);need(event.error.schemaVersion===1&&event.error.detailsRedacted===true&&TOOLCHAIN_CODES.includes(event.error.code),'journal_invalid');terminal=true;}
  previous=digest;events.push(event);
 }
 return {header,events,head:previous,nextStage:TOOLCHAIN_STAGES[stageIndex]??null,status:pending?'unknown':stageIndex===TOOLCHAIN_STAGES.length?'complete':'ready',pending};
}
function append(directory,event,expectedHead){
 const root=path.resolve(directory);privateDirectory(root);const lock=path.join(root,'.writer-lock');
 try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')need(false,'journal_busy');throw e;}
 const owner=fs.lstatSync(lock);
 try{const run=inspectToolchainRun(root);need(run.head===expectedHead,'journal_invalid');const body={schemaVersion:1,sequence:run.events.length+1,previous:run.head,...event};
  writeOnce(path.join(root,String(body.sequence).padStart(6,'0')+'.json'),{...body,digest:sha256(canonicalJson(body))});
 }finally{const actual=fs.lstatSync(lock);need(actual.ino===owner.ino&&actual.dev===owner.dev&&fs.readdirSync(lock).length===0,'journal_invalid');fs.rmdirSync(lock);}
}
export async function executeJournaledStage(directory,stage,{binding,observe,execute,verify}){
 const initial=inspectToolchainRun(directory);compareFingerprint(initial.header.binding,binding,'evidence');
 need(initial.status==='ready','attempt_unknown');need(initial.nextStage===stage,'attempt_replay_forbidden');
 const before=await observe();assertFingerprint(before,'evidence');
 append(directory,{stage,state:'started',evidence:before,error:null},initial.head);
 let value,proof;try{value=await execute();proof=await verify(value);assertFingerprint(proof,'evidence');
 }catch(error){const run=inspectToolchainRun(directory);append(directory,{stage,state:'unknown',evidence:null,error:publicFailure(error,{stage})},run.head);throw error;}
 append(directory,{stage,state:'verified',evidence:proof,error:null},inspectToolchainRun(directory).head);return value;
}
export const toolchainRunBinding=plan=>fingerprint('evidence',plan,'canonical-json-v1');
