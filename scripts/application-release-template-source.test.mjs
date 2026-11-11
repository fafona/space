// Exercise the exact production source-only CLI from a clean real Git worktree,
// without production files, credentials, database connections or mutable mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sourceGit} from './release-toolchain-source.mjs';
test('exact source-only migration entry accepts the reviewed manifest in a clean detached checkout',{timeout:120000},()=>{
 assert.equal(fs.existsSync('/var/lib/faolla-online-release/active.json'),false,'never create a test worktree on a formal host');
 const root=fileURLToPath(new URL('../',import.meta.url)),revision=sourceGit(root,['rev-parse','HEAD']).toString().trim();
 const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'faolla-template-source-')),checkout=path.join(evidence,'source');
 let passed=false,created=false;
 try{
  sourceGit(root,['worktree','add','--detach','--no-checkout',checkout,revision]);created=true;
  sourceGit(checkout,['-c','index.sparse=false','sparse-checkout','set','--no-cone','--stdin'],'/*\n!/public/downloads/\n');
  sourceGit(checkout,['config','--worktree','core.sparseCheckoutCone','false']);sourceGit(checkout,['config','--worktree','index.sparse','false']);
  sourceGit(checkout,['read-tree','-mu','HEAD']);
  const r=spawnSync(process.execPath,[path.join(checkout,'scripts/application-release-template-migrate.mjs'),'source'],{
   cwd:checkout,encoding:'utf8',windowsHide:true,timeout:30000,
   env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,TEMP:process.env.TEMP,TMP:process.env.TMP}
  });
  assert.ifError(r.error);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{sourceVerified:true,target:revision,version:'202611100214'});passed=true;
 }finally{
  if(passed&&created){
   assert.equal(fs.realpathSync(checkout),checkout);assert.equal(path.relative(evidence,checkout),'source');
   assert.equal(sourceGit(checkout,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'');
   // Git refuses removal of dirty/untracked worktrees. Never force or recurse
   // over a computed parent; preserve failed fixtures for diagnosis.
   sourceGit(root,['worktree','remove','--',checkout]);fs.rmdirSync(evidence);
  }
 }
});
