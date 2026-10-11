import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  CONTACT_WECHAT_STAGED_REPAIR as p,
  CONTACT_WECHAT_STAGED_REPAIR_FILES as allowed,
  CONTACT_WECHAT_STAGED_REPAIR_PRESERVED as preserved,
  CONTACT_WECHAT_STAGED_REPAIR_PATHS as paths,
  assertContactWechatStagedRepairReceipt,
} from './contact-wechat-staged-tool-repair-policy.mjs';

export function contactWechatStagedRepairReceiptFixture() {
  return {
    schemaVersion: 1, kind: 'contact-wechat-staged-tool-repair', target: p.target,
    baseline: p.baseline, toolRevision: 'f'.repeat(40), originalStateSha256: p.stateSha256,
    originalBuildProofSha256: p.buildProofSha256, sourceInputsSha256: p.sourceInputsSha256,
    builtOutputSha256: p.builtOutputSha256, preservedFiles: {...preserved},
    activeSha256: p.activeSha256, maintenanceSha256: p.maintenanceSha256,
    markerSha256: p.markerSha256, retentionHeadSha256: p.retentionHeadSha256,
    dependencySha256: p.dependencySha256, changedToolFiles: [...allowed],
    approvedNoRebuild: true, preparedAt: '2026-10-11T12:00:00.000Z',
  };
}

test('repair is fixed to the observed never-cut contact candidate, not the attendance repair', () => {
  assert.equal(p.target, '9a877c86de64b094aa9268d9c03fb0ccec57b926');
  assert.equal(p.baseline, 'a535a308e21f121e7cf410a6f7d84c974eb370a6');
  assert.equal(p.operation, '/var/lib/faolla-online-release/9a877c86de64b094aa9268d9c03fb0ccec57b926');
  assert.equal(p.directory, '/www/wwwroot/merchant-space.web-releases/9a877c86de64-online');
  assert.equal(p.name, 'merchant-space-online-9a877c86de64');
  assert.equal(p.port, 3104);
  assert.equal(p.receiptName, 'contact-wechat-staged-tool-repair.json');
  assert.equal(p.originalStateCopyName, 'contact-wechat-staged-original-state.json');
  assert.equal(p.candidatePid, 531923);
  assert.equal(p.candidateProcessSha256, '6653ae6c9b560bfb1ec1d2dabf6ee0c05d18f40319c01916fdd310f863c2e2f5');
  assert.equal(p.candidateProcessEnvironmentSha256, '1b9ac09da027ba907d98af4c1f82aec0a6454027d1024d252bb1c7c47ba8a101');
  assert.equal(p.candidateProcessCommandSha256, '27b1c4018acc951f78bba448089ba571e34d9730f9040f2c951666092a3243c0');
  assert.equal(p.candidateProcessExecutable, '/usr/bin/node');
  assert.equal(p.sourceInputsSha256, '14073da5d843cc33006079ff3b38e401c8ee72988fd429b399e36e945d597739');
  assert.equal(p.builtOutputSha256, 'd475c2782d282d9a857f7f661536afcf453e7aef2820262ea29a6b8682e1c97c');
  assert.equal(p.dependencySha256, 'cb0428251f3bfe2c700eedd3242d3506e0bdd556511852f9810e7dd62e9b63fe');
  assert.equal(p.activeSha256, 'c848d358369cfee8963d1f034ca87eb1c8b82df586789b18603802bdbd68a142');
  assert.equal(p.maintenanceSha256, '1443543536254a8b9edf318ef5382789cf1df62f4e8dfe72c60a1d003a60b673');
  assert.equal(p.markerSha256, '487d4192e05edbabac37d7e560e1cb29d07e4fc3455d034402d6f7939a8a6468');
  assert.equal(p.retentionHeadSha256, '7407f4e12fdc4106de16d5e63214a3a1cab778461d449aeeac2c3528d31b7402');
});

test('source closure admits only four approved implementation/test pairs plus two corresponding integration tests', () => {
  assert.deepEqual(allowed, [
    'scripts/contact-wechat-staged-tool-repair-policy.mjs',
    'scripts/contact-wechat-staged-tool-repair-policy.test.mjs',
    'scripts/contact-wechat-staged-tool-repair.mjs',
    'scripts/contact-wechat-staged-tool-repair.test.mjs',
    'scripts/online-traffic-release.mjs',
    'scripts/online-traffic-release.test.mjs',
    'scripts/prepare-online-release-tool.mjs',
    'scripts/prepare-online-release-tool.test.mjs',
    'scripts/attendance-staged-tool-repair.test.mjs',
    'scripts/contact-wechat-release-policy.test.mjs',
  ]);
  assert.equal(new Set(allowed).size, 10);
  for (const value of [p, allowed, preserved, paths]) assert.ok(Object.isFrozen(value));
});

test('all original state, build, environment and failed-attempt audit bytes are independently pinned', () => {
  assert.deepEqual(preserved, {
    'state.json': '6a4febe8ebbc297613d351cec219f940bf0beabbd8cc5da903da0bfca4b68bbd',
    'attendance-build-proof.json': 'c5a7512e8ce08bac9e5a4b76baa9f0c45d664bb302e9ad55cf482120cf4435c7',
    'BUILD_ID': '42bb0c417f2442bb9b9ed1155971fb0aaa59c8bd04a7e2c3b306b520a41398b1',
    'runtime.json': '9d88c6bb450e15cf7c4175673f763e748718a1ef15cea3c4024fb9c06ecbfa0a',
    'attendance-build.env': '3d6905a526813799544da690c2689deffb058dc98264724d761ffa00fee4ebdc',
    '.env.local': '7ea159892a0e3c153afc0d47a1a5c8877a3e7ddaff498b4988e3d95b61c02356',
    'package-lock.json': '34252b297a23562219d5b29ec773a761dda3c9fe88f18cb7c0bff122b773254c',
    'stage.log': '5f8ee2528229fe4474af924ee892c3acc3987bc1c5de1ec6d2ad06208699b9b4',
    'stage-result.json': '8fe070b02948118ca6e8f72531cb913b31f9987391f01c84289df0038846b587',
    'restored.json': 'da01745fdf5589f94c67fe31d162a2c3acea7da64c6c3a9337434962d8541ddf',
    'before.json': '7c55c5c32cdffabe2b9ef0543bcc1e5d339989f56d0590bf57f65c2071bfd8b3',
    'main-ci.json': 'bc91da294b92ffb8a578d0bbb48a13794f52b3f36dc81a86b79da7ac5e3097fa',
    'readiness-diagnostic.json': 'fe300ad8b91e887c91a17c66596b3b717705eea07f0bd629353b1c6c17bddb2c',
    'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': 'ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c',
    'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': 'c039dadbac1cfb9439203548f36fc7c235d0cc45d02881a6915b9885cca21188',
    'before-no_store_entries_www.faolla.com.conf': '2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52',
    'after-no_store_entries_www.faolla.com.conf': 'e8bc4dd372d0091b259b2142abbc19580f4b02950379d1970dfc8d6c8f2ad134',
    'before-faolla_contact_card_release.conf': '9da32c319f61ddfdc38f24cb908536f4b57cc8ad8d0d1c4d30122176378893c5',
    'after-faolla_contact_card_release.conf': 'd0f46a50aa8a67f141d4da08d327eca52500ada41cb262e8ec050144be5da415',
  });
  assert.equal(p.stateSha256, preserved['state.json']);
  assert.equal(p.buildProofSha256, preserved['attendance-build-proof.json']);
  assert.deepEqual(Object.keys(paths), Object.keys(preserved));
  const operation = '/var/lib/faolla-online-release/9a877c86de64b094aa9268d9c03fb0ccec57b926';
  const candidate = '/www/wwwroot/merchant-space.web-releases/9a877c86de64-online';
  const audit = '/var/lib/faolla-contact-publication/9a877c86de64b094aa9268d9c03fb0ccec57b926';
  for (const [name, actual] of Object.entries(paths)) {
    const expected = name === 'BUILD_ID' ? `${candidate}/.next/BUILD_ID`
      : ['.env.local', 'package-lock.json'].includes(name) ? `${candidate}/${name}`
      : ['stage.log', 'stage-result.json', 'restored.json', 'before.json', 'main-ci.json', 'readiness-diagnostic.json'].includes(name)
        ? `${audit}/${name}` : `${operation}/${name}`;
    assert.equal(actual, expected);
    assert.match(preserved[name], /^[a-f0-9]{64}$/);
  }
});

test('incident closure format excludes only exact tool paths without pinning future HEAD application inputs', () => {
  // The operational runner verifies the actual incident ancestor trees. A
  // permanent CI test must not compare a future application HEAD with 9a877.
  const row = (name, oid) => `100644 blob ${oid.repeat(40)}\t${name}`;
  const app = row('src/app/card/[card]/route.ts', 'a');
  const dependency = row('package-lock.json', 'b');
  const original = [app, dependency, ...allowed.slice(4).map(name => row(name, 'c'))].join('\0') + '\0';
  const repaired = [app, dependency, ...allowed.map(name => row(name, 'd'))].join('\0') + '\0';
  const inputs = inventory => inventory.split('\0').filter(Boolean)
    .filter(entry => !allowed.includes(entry.slice(entry.indexOf('\t') + 1))).join('\0');
  const digest = inventory => createHash('sha256').update(inputs(inventory)).digest('hex');
  assert.equal(inputs(original), `${app}\0${dependency}`);
  assert.equal(digest(repaired), digest(original));
  for (const extra of [row('src/app/card/[card]/route.ts', 'e'), row('package-lock.json', 'e'),
    row('scripts/supabase-migrations/051.sql', 'e'), row('scripts/attendance-staged-tool-repair.mjs', 'e'),
    row('docs/contact-wechat-staged-tool-repair.md', 'e')]) {
    assert.notEqual(digest(`${repaired}${extra}\0`), digest(original));
  }
});

test('the complete typed receipt is accepted without mutation and exact ten paths may be reordered', () => {
  const receipt = contactWechatStagedRepairReceiptFixture(), before = structuredClone(receipt);
  assert.equal(assertContactWechatStagedRepairReceipt(receipt, {target: p.target, toolRevision: receipt.toolRevision}), receipt);
  assert.deepEqual(receipt, before);
  receipt.changedToolFiles.reverse();
  assert.equal(assertContactWechatStagedRepairReceipt(receipt), receipt);
});

test('every receipt key and every observed pin is mandatory; unknown fields are rejected', () => {
  const complete = contactWechatStagedRepairReceiptFixture();
  assert.equal(Object.keys(complete).length, 18);
  for (const key of Object.keys(complete)) {
    const receipt = contactWechatStagedRepairReceiptFixture(); delete receipt[key];
    assert.throws(() => assertContactWechatStagedRepairReceipt(receipt), /contact_wechat_staged_repair_receipt_invalid/);
  }
  for (const key of Object.keys(preserved)) {
    for (const action of ['delete', 'alter']) {
      const receipt = contactWechatStagedRepairReceiptFixture();
      if (action === 'delete') delete receipt.preservedFiles[key];
      else receipt.preservedFiles[key] = '0'.repeat(64);
      assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
    }
  }
  for (const change of [
    {schemaVersion: 2}, {schemaVersion: '1'}, {kind: 'attendance-staged-tool-repair'},
    {target: p.baseline}, {baseline: p.target}, {toolRevision: p.target}, {toolRevision: p.baseline},
    {toolRevision: 'f'.repeat(39)}, {toolRevision: 'F'.repeat(40)}, {toolRevision: 7},
    {approvedNoRebuild: false}, {approvedNoRebuild: 'true'}, {unknown: true},
    {preparedAt: '2026-02-30T12:00:00.000Z'}, {preparedAt: '2026-10-11T12:00:00Z'},
    {preparedAt: '2026-10-11T14:00:00.000+02:00'}, {preparedAt: ''}, {preparedAt: null},
    ...['originalStateSha256', 'originalBuildProofSha256', 'sourceInputsSha256', 'builtOutputSha256',
      'dependencySha256', 'activeSha256', 'maintenanceSha256', 'markerSha256', 'retentionHeadSha256']
      .map(key => ({[key]: '0'.repeat(64)})),
  ]) assert.throws(() => assertContactWechatStagedRepairReceipt({...contactWechatStagedRepairReceiptFixture(), ...change}));
  assert.throws(() => assertContactWechatStagedRepairReceipt({...complete, preservedFiles: {...preserved, unknown: '0'.repeat(64)}}));
});

test('repair admits no partial pair, duplicate path, unrelated app, SQL, dependency or historic repair path', () => {
  for (const file of allowed) {
    const receipt = contactWechatStagedRepairReceiptFixture();
    receipt.changedToolFiles = receipt.changedToolFiles.filter(path => path !== file);
    assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
  }
  for (const extra of ['src/app/card/[card]/route.ts', 'src/lib/merchantBusinessCardWebsiteRoute.test.ts',
    'package-lock.json', 'package.json', 'scripts/supabase-migrations/051.sql',
    'scripts/attendance-staged-tool-repair.mjs', 'scripts/contact-wechat-online-build.mjs',
    'docs/contact-wechat-staged-tool-repair.md', ...allowed.slice(0, 1)]) {
    const receipt = contactWechatStagedRepairReceiptFixture(); receipt.changedToolFiles.push(extra);
    assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
    receipt.changedToolFiles = [extra, ...allowed.slice(1)];
    if (extra !== allowed[0]) assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
  }
});

test('caller expectations cannot broaden or relabel the repair', () => {
  for (const options of [{target: p.baseline}, {target: ''}, {target: null},
    {toolRevision: 'a'.repeat(40)}, {toolRevision: ''}, {toolRevision: null}]) {
    assert.throws(() => assertContactWechatStagedRepairReceipt(contactWechatStagedRepairReceiptFixture(), options));
  }
});

test('non-record, inherited, accessor, symbolic and extra hidden receipt keys are rejected', () => {
  for (const receipt of [null, [], new Date(), Object.create(contactWechatStagedRepairReceiptFixture())])
    assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
  const accessor = contactWechatStagedRepairReceiptFixture();
  Object.defineProperty(accessor, 'kind', {get() { throw Error('must_not_execute'); }});
  assert.throws(() => assertContactWechatStagedRepairReceipt(accessor), /contact_wechat_staged_repair_receipt_invalid/);
  for (const key of [Symbol('hidden'), 'hidden']) {
    const receipt = contactWechatStagedRepairReceiptFixture();
    Object.defineProperty(receipt, key, {value: true});
    assert.throws(() => assertContactWechatStagedRepairReceipt(receipt));
  }
  const receipt = contactWechatStagedRepairReceiptFixture();
  Object.defineProperty(receipt.preservedFiles, 'stage.log', {get() { throw Error('must_not_execute'); }});
  assert.throws(() => assertContactWechatStagedRepairReceipt(receipt), /contact_wechat_staged_repair_receipt_invalid/);
});
