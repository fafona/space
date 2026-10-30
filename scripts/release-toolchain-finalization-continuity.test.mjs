import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureFileContinuity} from './release-toolchain-file-continuity.mjs';
import {assertReparentableCapturePair, reparentableCaptureFailureField, captureReparentableProcessFact} from './release-toolchain-process-reparent-capture.mjs';
import {currentRetainedApplicationAttestation, withRetainedApplicationAttestation} from './release-toolchain-application-attestation.mjs';
import {ACTIVE_PUBLICATION_STEPS, executeActiveBookingPublication} from './release-toolchain-active-generation-contract.mjs';

const fact = () => ({pid: 123, parentPid: 45, startTicks: '678', processIdentity: 'same', uid: 0,
  cwd: '/owned', cwdIdentity: 'cwd', executable: '/usr/bin/node', executableIdentity: 'exe',
  commandLine: ['/usr/bin/node', '/owned/controller.mjs'], commandLineDigest: 'a'.repeat(64)});
test('only PPID may change inside an explicitly reparentable capture; every other field still fails closed', () => {
  assert.equal(assertReparentableCapturePair(fact(), {...fact(), parentPid: 1}), true);
  for (const field of Object.keys(fact()).filter(key => key !== 'parentPid')) {
    const next = {...fact(), [field]: field === 'commandLine' ? ['/foreign'] : 'foreign'};
    assert.throws(() => assertReparentableCapturePair(fact(), next), error => {
      assert.equal(error.message, 'process_identity_drift');
      assert.ok([field, 'shape'].includes(reparentableCaptureFailureField(error)));
      return true;
    });
  }
  assert.throws(() => assertReparentableCapturePair(fact(), {...fact(), parentPid: -1}));
  assert.equal(reparentableCaptureFailureField(Error('unrelated')), null);
  assert.equal(reparentableCaptureFailureField(Object.assign(Error('process_identity_drift'), {captureField: '/sensitive'})), null);
});
test('invalid PIDs are rejected before touching procfs', () => {
  for (const value of [0, -1, 1.5, '123', NaN, Infinity]) assert.throws(() => captureReparentableProcessFact(value), /invalid_pid/);
});
for (const mode of ['strict', 'reparentable', 'command-change']) test('actual Linux parent exit inside one ' + mode + ' capture', {
  skip: process.platform !== 'linux', timeout: 12000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-reparent-native-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./test-support/release-toolchain-reparent-child.mjs', import.meta.url)), 'parent', mode],
      {cwd: root, env: {PATH: process.env.PATH}, encoding: 'utf8', timeout: 10000, maxBuffer: 32768});
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, mode); assert.equal(report.sameBirth, true); assert.equal(report.reads, 2);
    assert.equal(report.actualParentChanged, true); assert.equal(report.rejected, mode !== 'reparentable');
    assert.equal(report.formalHostTouched, false);
  } finally { fs.rmSync(root, {recursive: true}); }
});
test('no serialized object or caller callback can populate the fixed application attestation', async () => {
  assert.equal(currentRetainedApplicationAttestation({application: {verified: true}}), null);
  if (process.platform !== 'linux' || process.getuid?.() !== 0) await assert.rejects(withRetainedApplicationAttestation(() => assert.fail()));
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-continuity-test-'));
  fs.mkdirSync(path.join(root, 'tree'));
  fs.writeFileSync(path.join(root, 'tree', 'a'), 'aaa');
  const pin = () => captureFileContinuity({trees: [{root: path.join(root, 'tree')} ]});
  return {root, tree: path.join(root, 'tree'), file: path.join(root, 'tree', 'a'), pin};
}
test('continuity accepts unchanged bytes; caller result is not a content attestation', () => {
  const f = fixture();
  try { const witness = f.pin(); assert.equal(witness.assertUnchanged(), true); assert.equal(witness.files, 2); assert.equal(witness.verified, undefined); }
  finally { fs.rmSync(f.root, {recursive: true}); }
});
test('actual directory names detect additions even when the filesystem reports the exact old timestamps', () => {
  const moduleUrl = new URL('./release-toolchain-file-continuity.mjs', import.meta.url).href;
  const code = `import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {syncBuiltinESMExports} from 'node:module';
    const {captureFileContinuity}=await import(${JSON.stringify(moduleUrl)});
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-coarse-clock-')),tree=path.join(root,'tree');fs.mkdirSync(tree);fs.writeFileSync(path.join(tree,'a'),'a');
    const original=fs.lstatSync,oldBig=original(tree,{bigint:true}),oldNumber=original(tree);
    fs.lstatSync=function(file,options){return file===tree?(options?.bigint?oldBig:oldNumber):original(file,options);};syncBuiltinESMExports();
    try{const witness=captureFileContinuity({trees:[{root:tree}]});fs.writeFileSync(path.join(tree,'new'),'b');assert.throws(()=>witness.assertUnchanged(),error=>error.continuityReason==='directory_entries_changed');}
    finally{fs.lstatSync=original;syncBuiltinESMExports();fs.rmSync(root,{recursive:true});}
    process.stdout.write('coarse-clock-addition-rejected');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {encoding:'utf8', timeout:10000, maxBuffer:32768});
  assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.stdout,'coarse-clock-addition-rejected');
});
for (const [name, change] of [
  ['same-size rewrite with restored mtime', f => {const old = fs.statSync(f.file); fs.writeFileSync(f.file, 'bbb'); fs.utimesSync(f.file, old.atime, old.mtime);} ],
  ['new file', f => fs.writeFileSync(path.join(f.tree, 'new'), 'x')],
  ['deleted file', f => fs.unlinkSync(f.file)],
  ['replacement inode', f => {fs.renameSync(f.file, path.join(f.root, 'old')); fs.writeFileSync(f.file, 'aaa');}],
  ['directory replacement', f => {fs.renameSync(f.tree, path.join(f.root, 'old')); fs.mkdirSync(f.tree); fs.writeFileSync(f.file, 'aaa');}],
]) test('continuity refuses ' + name, () => {
  const f = fixture();
  try { const witness = f.pin(); change(f); assert.throws(() => witness.assertUnchanged()); }
  finally { fs.rmSync(f.root, {recursive: true}); }
});
test('only explicitly excluded runtime cache contents may change', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.tree, 'cache')); fs.writeFileSync(path.join(f.tree, 'cache', 'a'), 'old');
    const witness = captureFileContinuity({trees: [{root: f.tree, exclude: ['cache']}]});
    fs.writeFileSync(path.join(f.tree, 'cache', 'a'), 'new');
    assert.equal(witness.assertUnchanged(), true);
    // This case tests exclusion boundaries, not filesystem clock resolution.
    // Same-size/mtime-restored rewrites retain their separate test above.
    fs.writeFileSync(f.file, 'changed-outside-excluded-cache'); assert.throws(() => witness.assertUnchanged());
  } finally { fs.rmSync(f.root, {recursive: true}); }
});
test('symlinks cannot escape an attested dependency root or be retargeted', {skip: process.platform === 'win32'}, () => {
  const f = fixture();
  try {
    const link = path.join(f.tree, 'link'); fs.symlinkSync('a', link);
    assert.throws(() => f.pin());
    const witness = captureFileContinuity({trees: [{root: f.tree, allowInternalLinks: true}]});
    assert.equal(witness.assertUnchanged(), true); fs.unlinkSync(link); fs.symlinkSync('../old', link);
    assert.throws(() => witness.assertUnchanged());
    assert.throws(() => captureFileContinuity({trees: [{root: f.tree, allowInternalLinks: true}]}));
  } finally { fs.rmSync(f.root, {recursive: true}); }
});
test('originally allowed dependency hardlinks stay pinned, including writes through another link', () => {
  const f = fixture();
  try {
    const other = path.join(f.root, 'other-link'); fs.linkSync(f.file, other);
    const witness = f.pin(); assert.equal(witness.assertUnchanged(), true);
    fs.writeFileSync(other, 'bbb'); assert.throws(() => witness.assertUnchanged());
  } finally { fs.rmSync(f.root, {recursive: true}); }
});
test('tracked files retain single-link policy and ancestors cannot be redirected', {skip: process.platform === 'win32'}, () => {
  const f = fixture();
  try {
    const witness = captureFileContinuity({files: [f.file]});
    fs.renameSync(f.tree, path.join(f.root, 'moved')); fs.symlinkSync('moved', f.tree, 'dir');
    assert.throws(() => witness.assertUnchanged());
    assert.throws(() => captureFileContinuity({files: [f.file]}));
  } finally { fs.rmSync(f.root, {recursive: true}); }
});
test('the fixed witness follows the original candidate-owned historical rollback-state path', () => {
  const source = fs.readFileSync(new URL('./release-toolchain-application-attestation.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("candidateOperation + '/' + STATES.rollback.file"));
  assert.equal(source.includes("operation + '/' + STATES.rollback.file"), false);
});
test('production wiring retains original independent collectors and strict defaults', () => {
  const read = file => fs.readFileSync(new URL('./' + file, import.meta.url), 'utf8');
  assert.ok(read('check-production-runtime-supervision.mjs').includes('first.parentPid !== second.parentPid'));
  for (const token of ['snapshot(pid), second = snapshot(pid)', 'assertReparentableCapturePair(first, second)']) assert.ok(read('release-toolchain-process-reparent-capture.mjs').includes(token));
  const attestation = read('release-toolchain-application-attestation.mjs');
  for (const token of ['observeBookingReadyApplication()', 'continuity.assertUnchanged()', 'issued.has(context)', 'context.closed = true', "['status', '--porcelain=v1', '--untracked-files=all']"]) assert.ok(attestation.includes(token), token);
  assert.ok(read('release-toolchain-origin-recovery-closure.mjs').includes('reviewedBookingExecution(toolRevision)?.tool??inspectPinnedExecutionSource'));
  assert.ok(read('release-toolchain-active-generation-publication.mjs').includes('withRetainedApplicationAttestation(()=>publishAttestedClosedActiveBooking'));
});
test('every real publication stage has bounded fixed-name start/end timing without changing sequencing or hiding errors', async () => {
  const events = [], operations = {assertHeld() {}, stageTiming(event) {events.push(event);}};
  for (const name of ACTIVE_PUBLICATION_STEPS) operations[name] = async () => name;
  assert.equal(await executeActiveBookingPublication(operations), ACTIVE_PUBLICATION_STEPS.at(-1));
  assert.deepEqual(events.map(({stage, phase}) => [stage, phase]), ACTIVE_PUBLICATION_STEPS.flatMap(stage => [[stage, 'started'], [stage, 'completed']]));
  for (const event of events) assert.ok(Number.isSafeInteger(event.elapsedMs) && event.elapsedMs >= 0);
  events.length = 0; const error = Error('original-uncertainty');
  operations.certificate = () => {throw error;};
  await assert.rejects(executeActiveBookingPublication(operations), value => value === error);
  assert.deepEqual(events.at(-1), {stage: 'certificate', phase: 'started', elapsedMs: 0});
});
