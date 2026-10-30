// Explicit read-only capture for policies which ALREADY permit reparenting.
// The general supervision collector stays strict. Only PPID may differ inside
// this capture; there is no retry, PID-only success, or discarded drift.
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const fields = ['pid', 'startTicks', 'processIdentity', 'uid', 'cwd', 'cwdIdentity',
  'executable', 'executableIdentity', 'commandLine', 'commandLineDigest'];
const identity = value => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'uid', 'mode']
  .map(key => value[key].toString(10)).join(':');
function failure(field) {
  const error = new Error('process_identity_drift');
  error.captureField = field;
  throw error;
}
export function assertReparentableCapturePair(first, second) {
  for (const value of [first, second]) {
    if (!value || !isDeepStrictEqual(Object.keys(value).sort(), [...fields, 'parentPid'].sort()) ||
        !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
        !Number.isSafeInteger(value.parentPid) || value.parentPid < 0) failure('shape');
  }
  for (const field of fields) if (!isDeepStrictEqual(first[field], second[field])) failure(field);
  return true;
}
export function reparentableCaptureFailureField(error) {
  return error?.message === 'process_identity_drift' && [...fields, 'shape'].includes(error.captureField)
    ? error.captureField : null;
}
function snapshot(pid) {
  const root = '/proc/' + pid, raw = fs.readFileSync(root + '/stat', 'utf8');
  const end = raw.lastIndexOf(')'), parts = end >= 0 ? raw.slice(end + 2).trim().split(/\s+/) : [];
  if (!raw.startsWith(pid + ' (') || parts[0] === 'Z' ||
      !/^[0-9]+$/.test(parts[1] ?? '') || !/^[1-9][0-9]*$/.test(parts[19] ?? '')) throw Error('invalid_proc_stat');
  const process = fs.statSync(root, {bigint: true}), cwd = fs.realpathSync(root + '/cwd');
  const cwdIdentity = identity(fs.statSync(root + '/cwd', {bigint: true}));
  const executable = fs.realpathSync(root + '/exe');
  const executableIdentity = identity(fs.statSync(root + '/exe', {bigint: true}));
  const bytes = fs.readFileSync(root + '/cmdline');
  if (bytes.length < 1 || bytes.length > 64 * 1024) throw Error('proc_file_size_invalid');
  const text = new TextDecoder('utf8', {fatal: true}).decode(bytes);
  if (!text.endsWith('\0') || /[\r\n]/.test(text)) throw Error('proc_records_invalid');
  const commandLine = text.slice(0, -1).split('\0');
  while (commandLine.at(-1) === '') commandLine.pop();
  if (!commandLine.length || commandLine.some(value => value === '')) throw Error('proc_records_invalid');
  return {pid, parentPid: Number(parts[1]), startTicks: parts[19], processIdentity: identity(process),
    uid: Number(process.uid), cwd, cwdIdentity, executable, executableIdentity, commandLine,
    commandLineDigest: createHash('sha256').update(bytes).digest('hex')};
}
export function captureReparentableProcessFact(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('invalid_pid');
  const first = snapshot(pid), second = snapshot(pid);
  assertReparentableCapturePair(first, second);
  return second;
}
