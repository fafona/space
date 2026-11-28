// Generate only a new hosted TEMP npm lock from the reviewed 14-package patch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.GITHUB_REF,'refs/heads/acceptance/member-checkout-pg-app-20261128');
const bytes=fs.readFileSync(new URL('./fixtures/member-checkout-pg-dependencies.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
assert.equal(createHash('sha256').update(bytes).digest('hex'),'e67b3b0ce9024b311f258eef7c2e0ba442892ec8e4a269db4fcc630da65a3304');
const patch=JSON.parse(bytes),root=path.join(process.env.RUNNER_TEMP,'faolla-pg-app-tools','pg-client');fs.mkdirSync(root,{mode:0o700});
const pkg={name:'owned-checkout-pg-driver',version:'0.0.0',private:true,dependencies:{pg:patch.pg}};
for(const [name,value]of Object.entries({'package.json':pkg,'package-lock.json':{name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':pkg,...patch.packages}}}))
 fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
