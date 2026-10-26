// Independently encrypted ORIGINAL rows for the explicitly approved option-only
// repair. No application modules, database writes, cache synchronization,
// process changes, release-state changes, or automatic retries.
import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const SYSTEM='7612049595342295079',CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416';
const BASELINE='52f602c0734284d81a19f4cdf9cdbf3766aa1834',PREFIX='/var/lib/faolla-booking-rule-repair-';
const OWNER='__faolla_booking_persistence__';
const slugs=['__merchant_booking_records__:v1','__merchant_booking_rules__:v1','__merchant_booking_rules__:v1:backup','__merchant_booking_workbench__:v1'];
const expected={records:'ef9b4612b52701109f9bfee6bb2745b7b3452a8377e9639ccbee9b431f1f1ff4',
  rules:'5a8fe1e83b8da318980734438970c7f6f17853cca88a54799ae32c0daa537ed1',
  workbench:'bbf0ad8771faa742df3449e5028d989fb9c1a0be4f69c7546654e9e7d1b3f9b1'};
const need=(v,code)=>{if(!v)throw Error('booking_rule_backup_'+code);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function encryptBookingRuleOriginals(original,key){
  need(Buffer.isBuffer(original)&&original.length>0&&original.length<=8*1024**2&&Buffer.isBuffer(key)&&key.length===32,'encryption_input');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),payload=Buffer.concat([cipher.update(original),cipher.final()]);
  return Buffer.concat([Buffer.from('FAOLLA-BOOKING-ORIGINALS-1\n'),nonce,cipher.getAuthTag(),payload]);
}
export function decryptBookingRuleOriginals(archive,key){
  const magic=Buffer.from('FAOLLA-BOOKING-ORIGINALS-1\n');
  need(Buffer.isBuffer(key)&&key.length===32&&Buffer.isBuffer(archive)&&archive.length>magic.length+28&&
    archive.subarray(0,magic.length).equals(magic),'encrypted_format');
  const decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(magic.length,magic.length+12));
  decipher.setAuthTag(archive.subarray(magic.length+12,magic.length+28));
  return Buffer.concat([decipher.update(archive.subarray(magic.length+28)),decipher.final()]);
}
const QUERY=`begin isolation level repeatable read read only;set local statement_timeout='8s';set local lock_timeout='2s';
select jsonb_build_object('systemIdentifier',(select system_identifier::text from pg_control_system()),
 'databaseOid',(select oid::text from pg_database where datname=current_database()),'serverVersionNum',current_setting('server_version_num'),
 'databaseName',current_database(),'currentUser',current_user,
 'bookingRows',(select jsonb_agg(to_jsonb(p) order by slug,id) from public.pages p where slug in
 ('__merchant_booking_records__:v1','__merchant_booking_records__:v1:backup','__merchant_booking_rules__:v1','__merchant_booking_rules__:v1:backup','__merchant_booking_workbench__:v1','__merchant_booking_workbench__:v1:backup')),
 'publishedRows',(select jsonb_agg(to_jsonb(p) order by merchant_id,id) from public.pages p where
   merchant_id in (select jsonb_object_keys(blocks->'snapshots') from public.pages where merchant_id='${OWNER}' and slug='__merchant_booking_rules__:v1')
   and (slug is null or left(slug,2)<>'__')),
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations));
rollback;`;
export function validateBookingOriginalBackupDataset(dataset){
  need(dataset?.systemIdentifier===SYSTEM&&dataset.databaseOid==='5'&&dataset.serverVersionNum==='150008'&&
    dataset.databaseName==='postgres'&&dataset.currentUser==='supabase_admin','database_identity');
  need(Array.isArray(dataset.bookingRows)&&dataset.bookingRows.length===4&&dataset.bookingRows.every(r=>r.merchant_id===OWNER)&&
    isDeepStrictEqual(dataset.bookingRows.map(r=>r.slug).sort(),[...slugs].sort()),'saved_row_scope');
  const row=k=>dataset.bookingRows.find(r=>r.slug==='__merchant_booking_'+k+'__:v1');
  for(const key of ['records','rules','workbench'])need(hash(JSON.stringify(canonical(row(key).blocks)))===expected[key],'original_changed');
  need(row('records').blocks.records.length===17&&Array.isArray(dataset.publishedRows)&&dataset.publishedRows.length===3,'source_count');
  const sites=Object.keys(row('rules').blocks.snapshots).sort();
  need(sites.every(s=>/^\d{8}$/.test(s))&&isDeepStrictEqual(dataset.publishedRows.map(p=>p.merchant_id).sort(),sites)&&
    dataset.publishedRows.every(p=>Array.isArray(p.blocks)&&(p.slug===null||typeof p.slug==='string'&&!p.slug.startsWith('__'))),'published_source');
  need(Array.isArray(dataset.registry)&&dataset.registry.length===209&&dataset.registry.at(-1)?.version==='202610090210','registry');
  return true;
}
function privateParent(directory){
  for(let current=directory;;current=path.dirname(current)){
    const stat=fs.lstatSync(current);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===0&&!(stat.mode&0o022)&&fs.realpathSync(current)===current,'path_ownership');
    if(path.dirname(current)===current)break;
  }
}
function writeOnce(file,bytes){
  privateParent(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  const stat=fs.lstatSync(file);need(stat.isFile()&&stat.uid===0&&stat.nlink===1&&(stat.mode&0o777)===0o600&&
    fs.readFileSync(file).equals(Buffer.from(bytes)),'write_readback');
}
export function runBookingRuleOriginalBackup({sourceSha256}={}){
  need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{64}$/.test(sourceSha256??''),'invocation');
  privateParent('/var/lib');
  const activeFile='/var/lib/faolla-online-release/active.json',liveBefore=fs.readFileSync(activeFile),active=JSON.parse(liveBefore);
  need(active.target===BASELINE,'live_baseline');
  const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
  const run=(command,args,input)=>{
    const r=spawnSync(command,args,{input,encoding:'utf8',env,timeout:15000,maxBuffer:8*1024**2,windowsHide:true});
    need(r.status===0&&!r.error&&!r.signal,'readonly_command');return r.stdout.trim();
  };
  const inspect=JSON.parse(run('docker',['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',CONTAINER]));
  need(inspect.id===CONTAINER&&inspect.name==='/supabase-db'&&inspect.image==='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d'&&inspect.running===true&&
    inspect.mounts?.some(m=>m.Type==='bind'&&m.Source==='/opt/supabase/docker/volumes/db/data'&&m.RW===true),'container');
  const read=()=>run('docker',['exec','-i',CONTAINER,'sh','-lc',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1'],QUERY);
  const raw=read();validateBookingOriginalBackupDataset(JSON.parse(raw));
  const directory=fs.mkdtempSync(PREFIX);fs.chmodSync(directory,0o700);privateParent(directory);
  const key=randomBytes(32),original=Buffer.from(raw),archive=encryptBookingRuleOriginals(original,key);
  writeOnce(directory+'/originals.key',key);writeOnce(directory+'/originals.enc',archive);
  const restored=decryptBookingRuleOriginals(fs.readFileSync(directory+'/originals.enc'),fs.readFileSync(directory+'/originals.key'));
  need(restored.equals(original),'restore_mismatch');validateBookingOriginalBackupDataset(JSON.parse(restored.toString('utf8')));
  need(read()===raw&&fs.readFileSync(activeFile).equals(liveBefore),'source_changed_during_backup');
  const report={schemaVersion:1,kind:'booking-rule-originals-backup',directory,sourceSha256,completedAt:new Date().toISOString(),
    originalSha256:hash(original),archiveSha256:hash(archive),archiveBytes:archive.length,bookingRows:4,publishedRows:3,records:17,
    authenticatedDecryptionVerified:true,sourceUnchanged:true,databaseWrites:false,cacheWrites:false,processChanges:false};
  const text=JSON.stringify(report,null,2)+'\n';writeOnce(directory+'/verified.json',text);
  return {...report,sealSha256:hash(text)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    need(process.argv.length===2,'arguments');const sourceSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));
    console.log(JSON.stringify(runBookingRuleOriginalBackup({sourceSha256})));
  }catch(error){console.error(/^booking_rule_backup_[a-z_]+$/.test(error?.message??'')?error.message:'booking_rule_backup_unverified');process.exitCode=1;}
}
