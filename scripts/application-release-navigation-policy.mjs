// One explicitly approved retained-build continuation. No generic rolled-back
// publication admission is changed by this fixed scope.
import {isDeepStrictEqual} from 'node:util';
import {assertUnchangedApplicationSource} from './release-toolchain-source.mjs';
export const NAVIGATION_TARGET='3bbbe054fab2e6a1634599a90d4fbaa94edec946';
export const NAVIGATION_BASELINE='ca92851ff2dba44dd1ad71fa3cd3ec66e0becf5f';
export const NAVIGATION_PINS=Object.freeze({"target":"3bbbe054fab2e6a1634599a90d4fbaa94edec946","baseline":"ca92851ff2dba44dd1ad71fa3cd3ec66e0becf5f","owner":{"file":"/var/lib/faolla-application-operations/3bbbe054fab2e6a1634599a90d4fbaa94edec946/64b17607-e65f-4729-80c0-077b02580a4b.owner.json","sha256":"38d1aab4217ea3e409069a0523fa81a0e2303322ed79787f7106998360749dde","metadata":{"dev":"64769","ino":"2656637","mode":"33152","uid":"0","nlink":"1","size":"926","mtimeNs":"1794742030900050182","ctimeNs":"1794742030900050182","birthtimeNs":"1794742030900050182"},"id":"64b17607-e65f-4729-80c0-077b02580a4b","controller":{"commandSha256":"79cd5b6f70b129947049e6a5692be4f060c9b8a2e7ec59d1553fc7dc13eba89a","cwd":"/var/lib/faolla-online-code/3bbbe054fab2e6a1634599a90d4fbaa94edec946","environmentSha256":"ca2e0325062cd6bef791629d5dae6994e945d9783acbd4f159648fa2fa68bf65","executable":"/usr/bin/node","parentPid":264981,"pid":264996,"startTicks":"47416086","uid":0},"operation":{"dev":64769,"ino":2662401,"mode":16832,"uid":0},"operationBirth":{"changedNs":"1794742030897050152","createdNs":"1794742030897050152"},"deploy":{"dev":64769,"ino":814869,"mode":33152,"uid":0},"action":"recover"},"operation":{"path":"/var/lib/faolla-maintenance/merchant-space/operation.lock","metadata":{"dev":"64769","ino":"2662401","mode":"16832","uid":"0","nlink":"2","size":"4096","mtimeNs":"1794742030897050152","ctimeNs":"1794742030897050152","birthtimeNs":"1794742030897050152"}},"preserved":{"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/state.json":{"sha256":"8f7a67275bd41ba5cc74ec495327130e0e63ad6eeb6042e0578d963db3a94c63","metadata":{"dev":"64769","ino":"972512","mode":"33152","uid":"0","nlink":"1","size":"37411","mtimeNs":"1794741784017579779","ctimeNs":"1794741784017579779","birthtimeNs":"1794741784017579779"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/runtime.json":{"sha256":"7b596db26117e82362b08cc2c40ce47a33f0561a8ea6d5b5a7543a89ea478c2d","metadata":{"dev":"64769","ino":"972467","mode":"33152","uid":"0","nlink":"1","size":"15506","mtimeNs":"1794740943595170179","ctimeNs":"1794740943595170179","birthtimeNs":"1794740943595170179"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/attendance-build-proof.json":{"sha256":"ce28ab25c3c5528e7335d6b5b3ae2dc453c233c4a9b0b0027efcb416b188d9a7","metadata":{"dev":"64769","ino":"972501","mode":"33152","uid":"0","nlink":"1","size":"317","mtimeNs":"1794741312947869231","ctimeNs":"1794741312947869231","birthtimeNs":"1794741312947869231"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf":{"sha256":"cfee2a86ff0b9d73b2f19e37607d4c4d877f6d87529a657d240754589c79f59d","metadata":{"dev":"64769","ino":"972191","mode":"33152","uid":"0","nlink":"1","size":"686","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938349117640"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf":{"sha256":"1ac93af0e65c0e32f178328e4258c64decd98942ef57929dfcb1b0f9e344f784","metadata":{"dev":"64769","ino":"972192","mode":"33152","uid":"0","nlink":"1","size":"686","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938350117650"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/before-no_store_entries_www.faolla.com.conf":{"sha256":"3fdc070ff0770d955bc07d4d28b5df7d94ba773676c24492efcd235b106024f9","metadata":{"dev":"64769","ino":"972193","mode":"33152","uid":"0","nlink":"1","size":"3932","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938350117650"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/after-no_store_entries_www.faolla.com.conf":{"sha256":"be998eb2357c21e1499aa0b67ae181ebe35fd0735606e23ba2d3c56ddf5cd41a","metadata":{"dev":"64769","ino":"972195","mode":"33152","uid":"0","nlink":"1","size":"3932","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938350117650"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/before-faolla_contact_card_release.conf":{"sha256":"d7fcd0d38116a4f3e5c3f14ad70b617e66a2ccdcdad81f15623806453e5ead62","metadata":{"dev":"64769","ino":"972462","mode":"33152","uid":"0","nlink":"1","size":"1466","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938350117650"}},"/var/lib/faolla-online-release/3bbbe054fab2e6a1634599a90d4fbaa94edec946/after-faolla_contact_card_release.conf":{"sha256":"2b6a85eaf05152662618f28fdf50ad862ea957d577dc8518545d662a6fde7392","metadata":{"dev":"64769","ino":"972464","mode":"33152","uid":"0","nlink":"1","size":"1466","mtimeNs":"1794740938350117650","ctimeNs":"1794740938350117650","birthtimeNs":"1794740938350117650"}}},"active":{"sha256":"fa239aa50b55a56fb9498c3769113d43381c43e1e2ee275570d5563de9f51203","metadata":{"dev":"64769","ino":"559561","mode":"33152","uid":"0","nlink":"1","size":"184","mtimeNs":"1794741784017579779","ctimeNs":"1794741784017579779","birthtimeNs":"1794741784017579779"}},"head":{"sha256":"63c179eead4296e4a67bf5bdf5cb58c4d2dba47b58039ffd8f0cc1c61ae0fce4","metadata":{"dev":"64769","ino":"395214","mode":"33152","uid":"0","nlink":"1","size":"139","mtimeNs":"1794741514370884027","ctimeNs":"1794741514372884047","birthtimeNs":"1794741514370884027"}},"dump":{"sha256":"80e80425e4e4f9a0bfdc834f24989cadf316111a1be2638c3f9053447829683a","metadata":{"dev":"64769","ino":"668966","mode":"33152","uid":"0","nlink":"1","size":"978156","mtimeNs":"1794741365294393479","ctimeNs":"1794741365294393479","birthtimeNs":"1794287115727760168"}},"build":{"files":2092,"sha256":"efd61efba677017c63cf20952cb57981082e5e84168074f1d5de224c8c83f2cd"},"applicationEnvironment":{"sha256":"187bc6573ce704d42f3c5d5bd6b1a5f81505b39b9b77cb83b19c2880c6e8cae4","metadata":{"dev":"64769","ino":"4377332","mode":"33152","uid":"0","nlink":"1","size":"15530","mtimeNs":"1794740943595170179","ctimeNs":"1794740943595170179","birthtimeNs":"1794740943595170179"}},"candidate":{"name":"merchant-space-online-3bbbe054fab2","directory":"/www/wwwroot/merchant-space.web-releases/3bbbe054fab2-online","port":3107},"at":"2026-11-15T12:39:07.304Z"});
export const NAVIGATION_CONTINUATION_FILES=Object.freeze([
 'scripts/application-release-history-observation.mjs','scripts/application-release-history-observation.test.mjs',
 'scripts/application-release-cli-lifetime.mjs','scripts/application-release-cli-lifetime.test.mjs',
 'scripts/application-release-navigation-policy.mjs','scripts/application-release-navigation-policy.test.mjs',
 'scripts/application-release-navigation-source.mjs','scripts/application-release-navigation-install.mjs',
 'scripts/application-release-navigation-continuation.mjs','scripts/application-release-navigation-continuation.test.mjs',
 'scripts/application-release-navigation-native.mjs',
 'scripts/application-release-authority.mjs','scripts/application-release-audit.mjs',
 'scripts/application-release-publish.mjs','scripts/online-traffic-release.mjs','scripts/online-release-retention-writer.mjs',
 'docs/ordinary-application-release.md'
]);
const need=(v,c)=>{if(!v)throw Error('navigation_continuation_'+c);};
export function assertNavigationContinuationDelta(applicationRows,toolRows){
 const old=new Map(applicationRows.map(x=>[x.file,x])),next=new Map(toolRows.map(x=>[x.file,x]));
 const changed=[...new Set([...old.keys(),...next.keys()])].filter(f=>!isDeepStrictEqual(old.get(f),next.get(f))).sort();
 need(isDeepStrictEqual(changed,[...NAVIGATION_CONTINUATION_FILES].sort()),'exact_tool_scope');
 for(const file of changed)need(next.get(file)?.mode==='100644'&&(!old.has(file)||old.get(file).mode==='100644'),'tool_file_mode');
 return assertUnchangedApplicationSource(NAVIGATION_TARGET,applicationRows,toolRows);
}
export function assertNavigationContinuationInvocation({argv,directory,platform,uid,executable}){
 const tool=directory.split('/').at(-1);
 need(platform==='linux'&&uid===0&&executable==='/usr/bin/node'&&/^[a-f0-9]{40}$/.test(tool)&&tool!==NAVIGATION_TARGET&&
  directory==='/var/lib/faolla-online-code/'+tool&&Array.isArray(argv)&&argv.length===3&&argv[0]==='/usr/bin/node'&&
  argv[1]===directory+'/scripts/application-release-navigation-continuation.mjs'&&['start','run','recover','audit'].includes(argv[2]),'invocation');
 return{toolRevision:tool,target:NAVIGATION_TARGET,baseline:NAVIGATION_BASELINE,action:argv[2]};
}
export function navigationContinuationPhase(state,active){
 need(state?.target===NAVIGATION_TARGET&&state.baseline===NAVIGATION_BASELINE&&state.lane==='reviewed-application-code-only-v1'&&
  [NAVIGATION_TARGET,NAVIGATION_BASELINE].includes(active?.target),'state_identity');
 if(state.status==='rolled-back'&&active.target===NAVIGATION_BASELINE)return'restored';
 if(state.status==='activating')return'partial';
 if(state.status==='active'&&active.target===NAVIGATION_TARGET)return state.applicationCompletion?.status==='completed'?'completed':'active';
 throw Error('navigation_continuation_unknown_phase');
}
export function assertNavigationOperationOwner(owner,{toolRevision,operation,operationBirth,deploy}){
 need(owner&&isDeepStrictEqual(Object.keys(owner).sort(),['kind','target','toolRevision','id','controller','operation','operationBirth','deploy','at'].sort())&&
  owner.kind==='navigation-continuation-operation-owner'&&owner.target===NAVIGATION_TARGET&&owner.toolRevision===toolRevision&&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.id??'')&&Number.isFinite(Date.parse(owner.at)),'owner_shape');
 const c=owner.controller;
 need(c&&isDeepStrictEqual(Object.keys(c).sort(),['pid','uid','parentPid','startTicks','executable','cwd','commandSha256','environmentSha256'].sort())&&
  Number.isSafeInteger(c.pid)&&c.pid>0&&Number.isSafeInteger(c.parentPid)&&c.parentPid>0&&c.uid===0&&/^[1-9]\d*$/.test(c.startTicks??'')&&
  c.cwd==='/var/lib/faolla-online-code/'+toolRevision&&c.executable==='/usr/bin/node'&&/^[a-f0-9]{64}$/.test(c.commandSha256??'')&&/^[a-f0-9]{64}$/.test(c.environmentSha256??''),'owner_controller');
 need(isDeepStrictEqual(owner.operation,operation)&&isDeepStrictEqual(owner.operationBirth,operationBirth)&&isDeepStrictEqual(owner.deploy,deploy),'owner_identity');return true;
}
export async function executeNavigationScopeClosure(operations,work){
 const value=await work();await operations.verify();
 const target=value?.actualTarget,proof=target===NAVIGATION_TARGET?value.proof:value.publicProof;
 const publicProof=target===NAVIGATION_TARGET?proof?.publicProof:proof;
 need([NAVIGATION_TARGET,NAVIGATION_BASELINE].includes(target)&&Array.isArray(publicProof)&&publicProof.length===2&&
  ['https://faolla.com','https://launch.faolla.com'].every(origin=>publicProof.filter(p=>p.origin===origin&&p.status===200&&p.buildId===target).length===1),'closure_public_proof');
 if(target===NAVIGATION_TARGET)need(proof.kind==='ordinary-application-release-readonly-verified'&&proof.target===target&&proof.baseline===NAVIGATION_BASELINE&&
  /^[a-f0-9]{64}$/.test(proof.certificateSha256??'')&&proof.workerPid>0&&proof.mailEnabled===false&&proof.businessDataWrittenByAudit===false&&proof.savedProcessConfigurationVerified===true,'closure_completion');
 else need(value.restored===true,'closure_restoration');
 await operations.seal(value);await operations.verify();await operations.archive();return value;
}
