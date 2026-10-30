// Read-only continuity proof, NOT a content digest or a release capability.
// A caller must bracket an independent complete byte attestation with this
// witness before reusing that attestation in the SAME in-process operation.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const fail = (reason = 'invalid_specification', file = '') => {
  const error = Error('release_static_attestation_changed');
  error.continuityReason = reason;
  error.resourceSha256 = createHash('sha256').update(file).digest('hex');
  throw error;
};
const stamp = value => ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .map(key => value[key].toString()).join(':');
// Unrelated children may be added above an attested root. That cannot replace
// our path components; check their inode/type/ownership, not sibling counts.
const ancestorStamp = value => ['dev', 'ino', 'uid', 'gid', 'mode'].map(key => value[key].toString()).join(':');
export function captureFileContinuity({files = [], trees = []}) {
  const rows = new Map(), ancestors = new Map();
  const record = (file, value, extra = null, directoryEntries = null, excluded = []) => {
    const row = {stamp: stamp(value), extra, ...(directoryEntries === null ? {} : {directoryEntries, excluded})};
    if (rows.has(file) && JSON.stringify(rows.get(file)) !== JSON.stringify(row)) fail('capture_changed', file);
    rows.set(file, row);
    if (rows.size > 200000) fail();
  };
  const ancestry = file => {
    for (let parent = path.dirname(file); ; parent = path.dirname(parent)) {
      const value = fs.lstatSync(parent, {bigint: true});
      if (!value.isDirectory() || value.isSymbolicLink()) fail('ancestor_type', parent);
      const fact = ancestorStamp(value);
      if (ancestors.has(parent) && ancestors.get(parent) !== fact) fail();
      ancestors.set(parent, fact);
      if (path.dirname(parent) === parent) break;
    }
  };
  for (const file of files) {
    if (path.resolve(file) !== file) fail();
    ancestry(file);
    const value = fs.lstatSync(file, {bigint: true});
    if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n) fail('tracked_file_type', file);
    record(file, value);
  }
  for (const {root, exclude = [], allowInternalLinks = false} of trees) {
    if (path.resolve(root) !== root || exclude.some(key => key.includes('/') || !key || ['.', '..'].includes(key))) fail();
    ancestry(root);
    const walk = (directory, prefix = '') => {
      const before = fs.lstatSync(directory, {bigint: true});
      if (!before.isDirectory() || before.isSymbolicLink()) fail('tree_directory_type', directory);
      const names = fs.readdirSync(directory).sort();
      // Directory timestamp granularity is filesystem-dependent. Check actual
      // names too, so a rapid add/remove cannot hide inside one timestamp tick.
      record(directory, before, null, names.filter(name => prefix || !exclude.includes(name)), prefix ? [] : exclude);
      for (const name of names) {
        if (!prefix && exclude.includes(name)) continue;
        const file = path.join(directory, name), value = fs.lstatSync(file, {bigint: true});
        if (value.isSymbolicLink()) {
          const target = fs.readlinkSync(file), resolved = fs.realpathSync(file);
          if (!allowInternalLinks || !resolved.startsWith(root + path.sep)) fail('tree_link', file);
          record(file, value, {target, resolved});
        } else if (value.isDirectory()) walk(file, prefix + name + '/');
        // The original dependency/build verifier allows hardlinks. Their
        // link count and ctime remain pinned; a write through ANY link drifts.
        else if (value.isFile()) record(file, value);
        else fail('tree_file_type', file);
      }
      if (stamp(fs.lstatSync(directory, {bigint: true})) !== stamp(before) ||
          JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(names)) fail('tree_capture_changed', directory);
    };
    walk(root);
  }
  function assertUnchanged() {
    for (const [file, expected] of ancestors) {
      const value = fs.lstatSync(file, {bigint: true});
      if (!value.isDirectory() || value.isSymbolicLink() || ancestorStamp(value) !== expected) fail('ancestor_changed', file);
    }
    for (const [file, expected] of rows) {
      const value = fs.lstatSync(file, {bigint: true});
      if (stamp(value) !== expected.stamp) fail('metadata_changed', file);
      if (expected.directoryEntries && JSON.stringify(fs.readdirSync(file).sort().filter(name => !expected.excluded.includes(name))) !==
          JSON.stringify(expected.directoryEntries)) fail('directory_entries_changed', file);
      if (expected.extra && (fs.readlinkSync(file) !== expected.extra.target ||
          fs.realpathSync(file) !== expected.extra.resolved)) fail('link_changed', file);
    }
    return true;
  }
  assertUnchanged();
  return Object.freeze({assertUnchanged, files: rows.size});
}
