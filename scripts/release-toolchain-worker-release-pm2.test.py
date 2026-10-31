import copy
import hashlib
import importlib.util
import io
import json
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker_successor_test', os.path.join(os.path.dirname(__file__), 'release-toolchain-worker-release-pm2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def exercise(self, change=lambda value: None, fd_flags='FLOCK WRITE', entry='release-toolchain-worker-release-entry.mjs'):
        revision, old = 'a' * 40, 'b' * 40
        directory = '/var/lib/faolla-online-code/' + revision
        row = {'name': m._active._transport._NAME, 'pid': 4124781, 'pm_id': 27, 'pm2_env': {'status': 'online', 'pm_cwd': m._active._transport._DIRECTORY, 'pm_exec_path': '/var/lib/faolla-online-code/' + old + '/scripts/booking-atomic-worker.mjs', 'exec_interpreter': '/usr/bin/node', 'exec_mode': 'fork_mode', 'args': [], 'node_args': [], 'restart_time': 11, 'watch': False, 'cron_restart': None, 'autorestart': True, 'FAOLLA_BACKGROUND_JOBS_PAUSED': '0', 'env': {'FAOLLA_BACKGROUND_JOBS_PAUSED': '0', 'MERCHANT_BOOKING_STORAGE_MODE': 'atomic-v2', 'MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED': '1', 'MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED': '0', 'MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED': '0'}}}
        expected = m._active._worker.snapshot(row)
        gate = {'enabled': True, 'certificateSha256': 'c' * 64}
        gate_raw = (json.dumps(gate) + '\n').encode()
        argv = b'\0'.join([b'/usr/bin/node', (directory + '/scripts/' + entry).encode(), b'publish']) + b'\0'
        attempt = {'kind': 'booking-worker-source-restart-attempt', 'toolRevision': revision, 'workerRelease': {'window': {'startedAt': '2026-10-31T14:00:00.000Z', 'deadlineAt': '2026-10-31T14:10:00.000Z'}, 'mailEnabled': False, 'toolRevision': revision, 'gateSha256': hashlib.sha256(gate_raw).hexdigest(), 'publicationCertificateSha256': 'c' * 64, 'priorToolRevision': old, 'priorWorker': {'pid': row['pid'], 'restartCount': 11}}, 'before': {'rpcExpected': expected}, 'controller': {'pid': 4242, 'uid': 0, 'startTicks': '123', 'commandLineDigest': hashlib.sha256(argv).hexdigest()}}
        change(attempt)
        raw = (json.dumps(attempt) + '\n').encode()
        value = {'revision': revision, 'expected': expected, 'attemptSha256': hashlib.sha256(raw).hexdigest()}
        fields = ['S'] + ['0'] * 19
        fields[19] = '123'
        lock = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1, st_dev=1, st_ino=2)
        def opened(file, *args, **kwargs):
            if file == '/proc/4242/cmdline': return io.BytesIO(argv)
            if file == '/proc/4242/stat': return io.StringIO('4242 (node) ' + ' '.join(fields))
            if file == '/proc/self/fdinfo/3': return io.StringIO(fd_flags)
            raise AssertionError('unexpected_file')
        def realpath(file):
            if file == '/proc/4242/cwd': return directory
            if file == '/proc/4242/exe': return '/usr/bin/node'
            return file
        def read(file):
            return (gate_raw, gate) if file.endswith('/worker-enabled.json') else (raw, attempt)
        now = m._active._strict_instant('2026-10-31T14:01:00.000Z')
        with patch.object(m, '_SOURCE', directory + '/scripts'), patch.object(m.time, 'time', return_value=now), patch.object(m.os, 'getppid', return_value=4242), patch.object(m.os.path, 'realpath', side_effect=realpath), patch.object(m.os, 'fstat', return_value=lock), patch.object(m.os, 'lstat', return_value=lock), patch.object(m._active, '_read', side_effect=read), patch('builtins.open', side_effect=opened), patch.object(m._active, '_connect') as connect:
            result = m._witness(value)
            connect.assert_not_called()
            return result

    def test_real_parent_fd_gate_and_predecessor_are_all_required_before_transport(self):
        self.assertEqual(self.exercise()['kind'], 'booking-worker-source-restart-attempt')
        self.assertEqual(self.exercise(entry='application-release-worker-entry.mjs')['kind'], 'booking-worker-source-restart-attempt')
        with self.assertRaises(ValueError): self.exercise(entry='arbitrary-entry.mjs')

    def test_hash_consistent_foreign_contexts_do_not_grant_control(self):
        changes = [lambda a: a.update(kind='foreign'), lambda a: a['workerRelease'].update(mailEnabled=True), lambda a: a['workerRelease'].update(priorToolRevision='d' * 40), lambda a: a['workerRelease']['priorWorker'].update(pid=1), lambda a: a['workerRelease'].update(gateSha256='d' * 64), lambda a: a['controller'].update(startTicks='999'), lambda a: a['workerRelease']['window'].update(deadlineAt='2026-10-31T15:00:00.000Z')]
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError): self.exercise(change)

    def test_inherited_descriptor_without_actual_kernel_lock_is_refused(self):
        with self.assertRaises(ValueError): self.exercise(fd_flags='pos: 0')


if __name__ == '__main__':
    unittest.main()
