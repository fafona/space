// Pure, pinned CI installation plan. No connection, CLI, production installer,
// registered migration, credential handling or automatic activation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadCompatibilityBaseline,compileProtocolSources} from './member-checkout-compatibility-check.mjs';
import {runtimeContract,renderRuntimePrototype,runtimeFixture} from './member-checkout-runtime-contract.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

// Split only TOP-LEVEL statements. Function/DO dollar bodies, quoted strings,
// identifiers and nested comments are opaque; their BEGIN/END are not commits.
// Deliberately fail on unterminated input, rather than guessing a boundary.
export function splitInstallationSql(source) {
  assert.equal(typeof source,'string');const parts=[];let start=0,i=0,clean='';
  const quoted=(quote,escaped)=>{
    const from=i++;let closed=false;
    while(i<source.length){if(escaped&&source[i]==='\\'){i+=2;continue;}
      if(source[i]===quote){if(source[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}
    assert.ok(closed,'installation_unterminated_quote');clean+=source.slice(from,i);
  };
  while(i<source.length){
    if(source.startsWith('--',i)){const end=source.indexOf('\n',i+2);i=end===-1?source.length:end;clean+=' ';continue;}
    if(source.startsWith('/*',i)){i+=2;let depth=1;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}assert.equal(depth,0,'installation_unterminated_comment');clean+=' ';continue;}
    if(source[i]==="'"||source[i]==='"'){quoted(source[i],source[i]==="'"&&/[eE]/.test(source[i-1]||'')&&!/[a-zA-Z0-9_]/.test(source[i-2]||''));continue;}
    const dollar=source[i]==='$'?source.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0]:null;
    if(dollar){const end=source.indexOf(dollar,i+dollar.length);assert.notEqual(end,-1,'installation_unterminated_dollar');clean+=source.slice(i,end+dollar.length);i=end+dollar.length;continue;}
    if(source[i]===';'){if(clean.trim())parts.push({sql:source.slice(start,i+1),command:clean.trim()});start=++i;clean='';continue;}
    clean+=source[i++];
  }
  assert.equal(clean.trim(),'','installation_statement_not_terminated');return parts;
}
export function installationBody(source) {
  const statements=splitInstallationSql(source);
  assert.equal(statements[0]?.command.toUpperCase(),'BEGIN','installation_outer_begin_required');
  assert.equal(statements.at(-1)?.command.toUpperCase(),'COMMIT','installation_outer_commit_required');
  for(const part of statements.slice(1,-1))assert.doesNotMatch(part.command,/^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|ROLLBACK|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|SET\s+(?:LOCAL\s+|SESSION\s+)?TRANSACTION)\b/i,'installation_transaction_escape');
  return statements.slice(1,-1).map(v=>v.sql).join('');
}
export async function loadInstallationPlan() {
  const baseline=await loadCompatibilityBaseline();assert.deepEqual(baseline.issues,[]);
  const originals=[],steps=[];
  for(const pin of baseline.manifest.sources){
    const source=(await readFile(pin.file,'utf8')).replace(/\r\n/g,'\n');assert.equal(sha(source),pin.sha256);
    if(pin.file.startsWith('database/proposals/'))steps.push({...pin,body:installationBody(source)});
    else originals.push({...pin,source});
  }
  assert.equal(originals.length,5);assert.equal(steps.length,32);
  const contract=await runtimeContract(),runtime=renderRuntimePrototype(contract);
  assert.equal((await readFile(runtimeFixture,'utf8')).replace(/\r\n/g,'\n'),runtime);
  steps.push({file:runtimeFixture,sha256:sha(runtime),body:installationBody(runtime)});
  const expectedRuntime=compileProtocolSources([{file:'database/proposals/ci_runtime.sql',text:runtime}]);
  const expected={...baseline.expected,functions:[...baseline.expected.functions,...expectedRuntime.functions]};
  const material={version:1,scope:'owned-ci-atomic-installation-only',application:baseline.application,sources:steps.map(({file,sha256,body})=>({file,sha256,bodySha256:sha(body)}))};
  return {digest:sha(JSON.stringify(material)),material,originals,steps,expected,prerequisites:compileProtocolSources(originals.map(v=>({file:v.file,text:v.source}))),
    registry:originals.map(v=>{const name=v.file.split('/').at(-1);return{version:name.split('_')[0],name:name.slice(name.indexOf('_')+1,-4)};}).sort((a,b)=>a.version.localeCompare(b.version))};
}
