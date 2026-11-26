// Historical c4 source evidence only, never current-runtime acceptance.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const digest='a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2';
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const files=['scripts/member-checkout-group-runtime-host.mjs','scripts/member-checkout-group-runtime-supervisor.mjs','scripts/fixtures/member-checkout-group-runtime-worker.mjs',
  'scripts/member-checkout-group-next-acceptance.mjs','scripts/member-checkout-group-next.test.mjs','scripts/fixtures/member-checkout-rollback-local-server.mjs'];

export function verifyArchivedGroupNextRevision(wire){
  assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)>0&&Buffer.byteLength(wire)<131072);
  const a=JSON.parse(wire);assert.deepEqual(Object.keys(a).sort(),['commit','revision','sources','version']);assert.equal(a.version,1);
  assert.equal(a.commit,'c4fcd8a1bc367b60a49b6d67d7a1f7a09af1f4da');assert.deepEqual(Object.keys(a.revision).sort(),['material','sha256']);
  assert.equal(a.revision.sha256,digest);assert.equal(sha(canonical(a.revision.material)),digest);
  assert.deepEqual(a.sources.map(s=>s.file),files);assert.deepEqual(a.revision.material.sources.map(s=>s.file),files);
  for(let i=0;i<files.length;i++){const s=a.sources[i];assert.deepEqual(Object.keys(s).sort(),['body','file']);assert.equal(typeof s.body,'string');assert.equal(s.body.includes('\r'),false);assert.equal(sha(s.body),a.revision.material.sources[i].sha256);}
  return freeze(a.revision);
}

export async function loadArchivedGroupNextRevision(){
  const file=fileURLToPath(new URL('./fixtures/member-checkout-group-next-c4-source.json',import.meta.url));
  assert.equal(await realpath(file),file);
  return verifyArchivedGroupNextRevision(await readFile(file,'utf8'));
}
