// Actual connect-only read of the full registry. Unlike `pm2 jlist`, this
// cannot boot/reconnect a missing daemon. Raw environment values NEVER leave
// the caller's private memory or appear in failure messages/CLI diagnostics.
import * as fs from 'node:fs';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {BOOKING_HANDOFF_PM2_PROVENANCE as FRAMEWORK,BOOKING_HANDOFF_LEGACY_DIRECTORY as LEGACY} from './booking-handoff-policy.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
import {sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'owned_resource_changed');
const SOURCES=Object.freeze({'production-maintenance-pm2-control.py':'94da8cfb9d2a9b944946d6da431c79a5d44c695b2fe6d427d3e25f0fdbbc98c5','production-maintenance-pm2-connection.py':'2ac9a51736605bfe3715060d25ed38e408771faaca4e9ea4768dbfabab8cfa54'});
const metadata=s=>['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':');
function fact(pid){
 need(Number.isSafeInteger(pid)&&pid>0,'evidence_invalid');const root='/proc/'+pid,s=fs.readFileSync(root+'/stat','utf8'),end=s.lastIndexOf(')'),f=s.slice(end+2).trim().split(/\s+/);
 need(end>0&&/^[0-9]+$/.test(f[19]??'')&&f[0]!=='Z'&&fs.lstatSync(root).uid===0,'owned_resource_changed');
 return{pid,uid:0,startTicks:f[19],parentPid:Number(f[1]),cwd:fs.realpathSync(root+'/cwd'),executable:fs.realpathSync(root+'/exe'),commandSha256:sha256(fs.readFileSync(root+'/cmdline')),environmentSha256:sha256(fs.readFileSync(root+'/environ'))};
}
function peer(pid){const p=fact(pid);return{pid,uid:0,startTicks:p.startTicks,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:p.executable,executableIdentity:metadata(fs.statSync('/proc/'+pid+'/exe',{bigint:true}))};}
function sourceProof(directory){const result={};for(const [name,digest]of Object.entries(SOURCES)){const file=directory+'/'+name;ownedReleasePath(file);const before=metadata(fs.lstatSync(file,{bigint:true}));need(sha256(fs.readFileSync(file))===digest,'source_changed');same(metadata(fs.lstatSync(file,{bigint:true})),before);result[name]=before;}return result;}
const bridge=String.raw`import importlib.util,json,os,socket,sys,time
v=json.loads(sys.stdin.buffer.read(65537))
if type(v) is not dict or set(v)!={'socket','daemon'} or os.getuid()!=0: raise RuntimeError('read_only_registry_request')
s=importlib.util.spec_from_file_location('fixed_read_only_pm2',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
d=m._peer._validate_expected(v['daemon']);p=v['socket'];chain=m._peer._path_chain(p,0)
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
 deadline=time.monotonic()+10;c.settimeout(10);c.connect(p);session=m._Session(c,d,p,chain,deadline)
 if session.call('getVersion',{})!='6.0.14': raise RuntimeError('read_only_registry_version')
 rows=session.call('getMonitorData',{});session.verify()
 if type(rows) is not list or not 1<=len(rows)<=128: raise RuntimeError('read_only_registry_shape')
 print(json.dumps({'version':1,'pm2Version':'6.0.14','peerVerified':True,'registry':rows},separators=(',',':'),allow_nan=False))
`;
function collect({home,source}){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.version===FRAMEWORK.nodeVersion,'unsupported_runtime');ownedReleasePath(home,{directory:true});ownedReleasePath(home+'/pm2.pid');
 const pidSize=fs.lstatSync(home+'/pm2.pid').size;need(pidSize>0&&pidSize<=32,'evidence_invalid');
 const pidText=fs.readFileSync(home+'/pm2.pid','utf8');need(/^[1-9][0-9]{0,9}\n?$/.test(pidText),'evidence_invalid');const pid=Number(pidText.trim()),daemon=fact(pid),expected=peer(pid);
 need(daemon.executable==='/usr/bin/node'&&fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon ('+home+')','owned_resource_changed');
 const code=sourceProof(source),python=captureTrustedPython();verifyTrustedPython(python);
 const r=spawnSync(python.target.path,['-I','-S','-B','-c',bridge,source+'/production-maintenance-pm2-control.py'],{input:JSON.stringify({socket:home+'/rpc.sock',daemon:expected}),encoding:'utf8',timeout:15000,killSignal:'SIGKILL',maxBuffer:4*1024**2,cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},windowsHide:true});
 verifyTrustedPython(python);same(sourceProof(source),code);same(fact(pid),daemon);same(peer(pid),expected);same(fs.readFileSync(home+'/pm2.pid','utf8'),pidText);
 // Do not include stdout/stderr in an exception: the full registry contains
 // credentials. A refused read has no side effects and no fallback CLI path.
 need(r.status===0&&!r.error&&!r.signal&&r.stderr===''&&Buffer.byteLength(r.stdout)<=4*1024**2,'pm2_read_only_observation_unconfirmed');
 let result;try{result=JSON.parse(r.stdout);}catch{need(false,'pm2_read_only_observation_unconfirmed');}
 need(result?.version===1&&result.pm2Version==='6.0.14'&&result.peerVerified===true&&Array.isArray(result.registry)&&result.registry.length>0&&result.registry.length<=128&&Object.keys(result).sort().join(',')==='peerVerified,pm2Version,registry,version','evidence_invalid');
 const normalized=result.registry.map(normalizeRetirementProcess);need(new Set(normalized.map(p=>p.name)).size===normalized.length&&new Set(normalized.map(p=>p.pmId)).size===normalized.length,'evidence_invalid');
 return{rows:result.registry,daemonPeer:expected,daemon};
}
const rawEnvironment=pid=>{const value={};for(const row of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const at=row.indexOf('=');need(at>0&&!Object.hasOwn(value,row.slice(0,at)),'evidence_invalid');value[row.slice(0,at)]=row.slice(at+1);}return value;};
export function collectActiveBookingLegacyHost(){
 const snapshot=collectFormalBookingPm2Registry(),raw=snapshot.rows,processes=raw.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId),target=raw.find(p=>p.name==='merchant-space');
 need(target?.pid===P.legacyPid&&target.pm_id===0&&target.pm2_env.pm_cwd===LEGACY&&target.pm2_env.status==='online','evidence_invalid');
 const legacy=normalizeRetirementProcess(target),identity=fact(target.pid);need(identity.parentPid===snapshot.daemon.pid&&identity.cwd===LEGACY&&identity.executable==='/usr/bin/node','owned_resource_changed');
 const sources={};for(const [file,pin]of Object.entries(FRAMEWORK.frameworkSources)){const location='/usr/lib/node_modules/pm2/'+file;ownedReleasePath(location);sources[file]=sha256(fs.readFileSync(location));need(sources[file]===pin,'source_changed');}
 const e=target.pm2_env,result={legacy,raw:rawEnvironment(target.pid),configured:structuredClone(e.env),pmUptime:e.pm_uptime,pmDerived:{exitCode:e.exit_code??null,nodeVersion:e.node_version??null,version:e.version??null,previousRestartDelay:e.prev_restart_delay??null,unstableRestarts:e.unstable_restarts??null},framework:{nodeVersion:process.version,managerVersion:'6.0.14',frameworkSources:sources},processes,identityProofs:processes.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)})),daemonPeer:snapshot.daemonPeer,processPeer:peer(target.pid),rpcExpected:bookingLegacyRpcExpected(target)};
 same(fact(snapshot.daemon.pid),snapshot.daemon);same(peer(snapshot.daemon.pid),snapshot.daemonPeer);return result;
}
// Raw rows may contain credentials. Only internal root-owned release operations
// may consume this result, and they must never log/serialize it publicly.
export const collectFormalBookingPm2Registry=()=>collect({home:'/root/.pm2',source:'/var/lib/faolla-online-code/'+P.toolRevision+'/scripts'});
export function collectOwnedCiPm2Registry(root){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(f=>fs.existsSync(f))&&typeof root==='string'&&/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(root),'ci_only');
 ownedReleasePath(root,{directory:true,privateMode:true});const source=path.dirname(fileURLToPath(import.meta.url));need(/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts$/.test(source),'ci_only');return collect({home:root+'/pm2',source});
}
