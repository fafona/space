import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const read = name => fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8');

test('actual observation selector dependency cannot wait on its executing top-level-await CLI', t => {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'faolla-selector-boundary-'));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    assert.equal(path.dirname(root), parent);
    assert.match(path.basename(root), /^faolla-selector-boundary-[A-Za-z0-9]+$/);
    fs.rmSync(root, {recursive: true});
  });
  const original = read('release-toolchain-active-generation-closed-incident.mjs');
  const match = /const\{hasRecoveredPublicationDisposition\}=await import\('\.\/([^']+)'\)/.exec(original);
  assert.ok(match, 'bind the actual observation module dependency, not a second independent selector');
  const leaf = 'release-toolchain-recovered-publication-selector.mjs';
  const body = read(leaf)
    .replace("import {INTERRUPTED_RECOVERY as H} from './release-toolchain-interrupted-recovery-contract.mjs';", 'const H=' + JSON.stringify({root: root + '/old'}) + ';')
    .replace("import {RECOVERED_PUBLICATION as R} from './release-toolchain-recovered-publication-contract.mjs';", 'const R=' + JSON.stringify({root: root + '/closed'}) + ';');
  fs.writeFileSync(path.join(root, leaf), body);
  // Only dependency wiring is synthetic. The leaf's actual filesystem predicate
  // and the observation's actual import target execute unchanged in a real child.
  const run = dependency => {
    fs.writeFileSync(path.join(root, 'observer.mjs'), `export async function observe(){const {hasRecoveredPublicationDisposition}=await import('./${dependency}');return hasRecoveredPublicationDisposition();}\n`);
    fs.writeFileSync(path.join(root, 'release-toolchain-recovered-publication-entry.mjs'), "import {observe} from './observer.mjs';export function hasRecoveredPublicationDisposition(){return true;}const selected=await observe();console.log(JSON.stringify({selected,fixtureOnly:true,publicationAuthority:false}));\n");
    const result = spawnSync(process.execPath, [path.join(root, 'release-toolchain-recovered-publication-entry.mjs')], {encoding: 'utf8', timeout: 5000, windowsHide: true});
    assert.equal(result.error, undefined);assert.equal(result.signal, null);
    return result;
  };
  const prior = run('release-toolchain-recovered-publication-entry.mjs');
  assert.equal(prior.status, 13, 'real Node proves the previous unsettled top-level-await cycle');
  assert.equal(prior.stdout, '');
  const verify = expected => {
    const current = run(match[1]);
    assert.equal(current.status, 0, 'the actual dependency must complete, not exit with unsettled await');
    assert.deepEqual(JSON.parse(current.stdout), {selected: expected, fixtureOnly: true, publicationAuthority: false});
  };
  verify(false);
  fs.mkdirSync(root + '/old/recovery', {recursive: true});
  fs.writeFileSync(root + '/old/recovery/completed.json', '{}\n');
  verify(true);
  fs.unlinkSync(root + '/old/recovery/completed.json');
  fs.mkdirSync(root + '/closed');
  verify(true);
});

test('selector is a read-only leaf and cannot import the CLI, host controller or qualification', () => {
  const source = read('release-toolchain-recovered-publication-selector.mjs');
  const dependencies = [...source.matchAll(/from '([^']+)'/g)].map(value => value[1]);
  assert.deepEqual(dependencies, ['node:fs', './release-toolchain-interrupted-recovery-contract.mjs', './release-toolchain-recovered-publication-contract.mjs']);
  assert.equal(source.includes('await '), false);
  for (const token of ['writeFile', 'mkdir', 'rename', 'unlink', 'withReviewed', 'qualification', '-entry.mjs']) assert.equal(source.includes(token), false, token);
});

test('existing canonical callers receive the exact same leaf function through the CLI export', async () => {
  const leaf = await import('./release-toolchain-recovered-publication-selector.mjs');
  const entry = await import('./release-toolchain-recovered-publication-entry.mjs');
  assert.equal(entry.hasRecoveredPublicationDisposition, leaf.hasRecoveredPublicationDisposition);
});
