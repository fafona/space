// The unchanged JS transport validates peer/process/schema/dump receipts. Only
// the new read-only Python session admits the reviewed 4 MiB registry frame.
import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectPm2Registry,capturePm2DumpTarget,persistPm2Dump,verifyPm2Dump} from './production-maintenance-pm2-adapter.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
const helpers=['release-toolchain-registry-capacity-dump.py','release-toolchain-registry-capacity.py','release-toolchain-resurrection-pm2.py','production-maintenance-pm2-control.py','production-maintenance-pm2-connection.py','production-maintenance-pm2-dump.py'];
const helper=fileURLToPath(new URL('./'+helpers[0],import.meta.url));
const need=v=>{if(!v)throw Error('registry_capacity_adapter_unverified');};
const fingerprint=()=>JSON.stringify(helpers.map(n=>{const p=fileURLToPath(new URL('./'+n,import.meta.url));ownedReleasePath(p);const s=fs.lstatSync(p);return[n,s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeMs,s.ctimeMs,createHash('sha256').update(fs.readFileSync(p)).digest('hex')];}));
const bridge=String.raw`import importlib.util,json,sys
try:
 raw=sys.stdin.buffer.read(524289)
 if len(raw)>524288: raise ValueError()
 value=json.loads(raw)
 if type(value) is not dict or set(value)!={'socketPath','daemon','request'}: raise ValueError()
 spec=importlib.util.spec_from_file_location('bounded_registry_dump',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 request=value['request']
 if request is None: result=m.run(value['socketPath'],value['daemon'],'inspect')
 elif type(request) is dict and set(request)=={'action','registry','proof'}: result=m.run(value['socketPath'],value['daemon'],request['action'],request['registry'],request['proof'])
 else: raise ValueError()
 print(json.dumps(result,separators=(',',':')))
except BaseException:
 sys.stderr.write('registry_capacity_adapter_unverified\n');sys.exit(1)
`;
function actualIo(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.version==='v20.20.1'&&process.argv[1]&&process.argv[1]!=='-'&&/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts\/release-toolchain-registry-capacity-adapter\.mjs$/.test(fileURLToPath(import.meta.url)));
 const invoke=(python,payload)=>{const before=fingerprint();const result=spawnSync(python.target.path,['-I','-S','-B','-c',bridge,helper],{input:JSON.stringify(payload),encoding:'utf8',timeout:20000,killSignal:'SIGKILL',maxBuffer:524288,shell:false,windowsHide:true,cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});need(fingerprint()===before);return result;};
 return{invoke:(p,v)=>{need(v.request===null);return invoke(p,v);},invokeDump:(p,v)=>{need(['capture','persist','verify'].includes(v.request?.action));return invoke(p,v);}};
}
export function inspectCapacityPm2Registry(daemon,bootId){need(arguments.length===2);return inspectPm2Registry(daemon,bootId,actualIo());}
export function captureCapacityPm2DumpTarget(daemon,bootId){need(arguments.length===2);return capturePm2DumpTarget(daemon,bootId,actualIo());}
export function persistCapacityPm2Dump(daemon,bootId,registry,proof){need(arguments.length===4);return persistPm2Dump(daemon,bootId,registry,proof,actualIo());}
export function verifyCapacityPm2Dump(daemon,bootId,registry,receipt){need(arguments.length===4);return verifyPm2Dump(daemon,bootId,registry,receipt,actualIo());}
