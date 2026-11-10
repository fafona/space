// Separate real-I/O representation adapter. The shared JS exchange still owns
// every daemon/boot/proc/peer/source/schema/receipt check, without modification.
import * as fs from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectPm2Registry,capturePm2DumpTarget,persistPm2Dump,verifyPm2Dump} from './production-maintenance-pm2-adapter.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
const helper=fileURLToPath(new URL('./release-toolchain-resurrection-pm2.py',import.meta.url));
const need=v=>{if(!v)throw Error('pm2_resurrection_adapter_unverified');};
const fingerprint=()=>{ownedReleasePath(helper);const s=fs.lstatSync(helper);return[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs,createHash('sha256').update(fs.readFileSync(helper)).digest('hex')].join(':');};
const bridge=String.raw`import importlib.util,json,sys
try:
 raw=sys.stdin.buffer.read(524289)
 if len(raw)>524288: raise ValueError()
 value=json.loads(raw)
 if type(value) is not dict or set(value)!={'socketPath','daemon','request'}: raise ValueError()
 spec=importlib.util.spec_from_file_location('resurrection',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 request=value['request']
 if request is None: result=m.run(value['socketPath'],value['daemon'],'inspect')
 elif type(request) is dict and set(request)=={'action','registry','proof'}: result=m.run(value['socketPath'],value['daemon'],request['action'],request['registry'],request['proof'])
 else: raise ValueError()
 print(json.dumps(result,separators=(',',':')))
except BaseException:
 sys.stderr.write('pm2_resurrection_unverified\n');sys.exit(1)
`;
function actualIo(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.version==='v20.20.1'&&process.argv[1]&&process.argv[1]!=='-'&&/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts\/release-toolchain-resurrection-pm2-adapter\.mjs$/.test(fileURLToPath(import.meta.url)));
 const invoke=(python,payload)=>{const before=fingerprint();const result=spawnSync(python.target.path,['-I','-S','-B','-c',bridge,helper],{input:JSON.stringify(payload),encoding:'utf8',timeout:20000,killSignal:'SIGKILL',maxBuffer:524288,shell:false,windowsHide:true,cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});need(fingerprint()===before);return result;};
 return{invoke:(python,payload)=>{need(payload.request===null);return invoke(python,payload);},invokeDump:(python,payload)=>{need(['capture','persist','verify'].includes(payload.request?.action));return invoke(python,payload);}};
}
export function inspectResurrectedPm2Registry(daemon,bootId){need(arguments.length===2);return inspectPm2Registry(daemon,bootId,actualIo());}
export function captureResurrectedPm2DumpTarget(daemon,bootId){need(arguments.length===2);return capturePm2DumpTarget(daemon,bootId,actualIo());}
export function persistResurrectedPm2Dump(daemon,bootId,registry,proof){need(arguments.length===4);return persistPm2Dump(daemon,bootId,registry,proof,actualIo());}
export function verifyResurrectedPm2Dump(daemon,bootId,registry,receipt){need(arguments.length===4);return verifyPm2Dump(daemon,bootId,registry,receipt,actualIo());}
