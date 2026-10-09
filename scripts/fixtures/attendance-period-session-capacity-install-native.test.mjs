// Pure/static fixture contracts; root alone runs the real owned PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodSessionCapacityInstallNative} from './attendance-period-session-capacity-install-native.mjs';
const text=readFileSync(new URL('./attendance-period-session-capacity-install-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('inert helper requires owned synthetic runtime and actual source projection',async()=>{
  assert.equal(typeof verifyPeriodSessionCapacityInstallNative,'function');
  await assert.rejects(verifyPeriodSessionCapacityInstallNative({d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'source?.ownerProjection?.artifact','source?.ownerRaw','digest(raw.sourceText),raw.sourceFingerprint',
    'artifact.source,raw.sourceCanonical',"'archive_install_exact152_required'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|disable trigger|session_replication_role|pg_sleep/i);
});
test('actual149 send uses zero CAS and trusted Node artifact, with only real existing permission',()=>{
  has('faolla_attendance_period_closure_v1(',"action:'send'",'expectedRevision:0,expectedVersion:0',
    'expectedFingerprint:artifact.sourceFingerprint',"call('owner','detail',command,artifact)",
    "'attendance.self.export'=any(r.permissions)","'archive_install_before_period_creation'");
  assert.doesNotMatch(text,/update public\.|insert into public\.|rpc:\s*async|create\s+temp/i);
});
test('single rollback installs real153 body between pre/post fixed exports without touching frozen helper',()=>{
  has('202610050153_merchant_attendance_period_session_capacity.sql','boundClockMigrationBody(native.root,migration)',
    "read('before153','owner')","mark('before_install',businessHash),prefix+body",
    "read('after153_owner','owner'),read('after153_self','self')",'steps.length<=10',
    "'set constraints all immediate;rollback;'",'outerRollbackTransactions:1');
  assert.doesNotMatch(text,/\bcommit;|statement_timeout|lock_timeout/);
});
test('business and artifact rows are checked across install and each export is independently readonly',()=>{
  has("names.filter(name=>name!=='faolla_schema_migrations')",
    "one('before_install').hash,one('after_install').hash","'archive_install_modified_saved_or_business_rows'",
    "mark('before_read')", "mark('after_read')", "'archive_export_wrote_rows'",
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog','d.exec(indexesSql),indexes');
});
test('full saved text hash metadata and artifact match before/after for owner and self',()=>{
  has('assert.equal(reply.artifactVersion,1)','assert.equal(reply.sourceChanged,null)',
    'digest(reply.artifactText),reply.artifactSha256',"Buffer.byteLength(reply.artifactText,'utf8'),reply.artifactBytes",
    'JSON.parse(reply.artifactText),reply.artifact','row.raw.artifactText,exports[0].raw.artifactText',
    'savedMetadata(row.raw),savedMetadata(exports[0].raw)','delete result.actorId;delete result.access;delete result.readAt;');
  assert.doesNotMatch(text,/delete result\.(?:artifact|period|history|operation|sourceChanged)/);
});
