"""Transport regressions with synthetic bytes only; no formal-host access."""
import importlib.util
import json
import os
import struct
import unittest
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location('capacity', os.path.join(
    os.path.dirname(__file__), 'release-toolchain-registry-capacity.py'))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def response(value, request='a' * 32 + ':0'):
    parts = [b'j:' + json.dumps({'args': [value]}, separators=(',', ':')).encode(),
             b's:' + request.encode()]
    return b'\x12' + b''.join(struct.pack('!I', len(v)) + v for v in parts)


class Connection:
    def __init__(self, value):
        self.value, self.sent, self.receives = value, [], []

    def sendall(self, value):
        self.sent.append(value)

    def recv(self, maximum):
        self.receives.append(maximum)
        value, self.value = self.value[:maximum], self.value[maximum:]
        return value


class TestRegistryCapacity(unittest.TestCase):
    def run_session(self, body, method='getMonitorData', argument=None, mutation=False):
        connection = Connection(body)
        session = m.RegistryCapacitySession(connection, {}, '/', [], 1)
        with patch.object(session, 'verify') as verify, \
                patch.object(m._control._peer, '_timeout'), \
                patch.object(m.uuid, 'uuid4') as uuid:
            uuid.return_value.hex = 'a' * 32
            result = session.call(method, {} if argument is None else argument, mutation)
            self.assertEqual(verify.call_count, 2)
        return result, connection

    def test_old_limit_unchanged_new_read_accepts_large_complete_frame(self):
        value = [{'syntheticEnvironmentPadding': 'x' * (1100 * 1024)}]
        body = response(value)
        self.assertEqual(m._control.MAX_FRAME_BYTES, 1048576)
        with self.assertRaises(Exception):
            m._control._parts(body)
        actual, connection = self.run_session(body)
        self.assertEqual(actual, value)
        self.assertEqual(len(connection.sent), 1)
        self.assertTrue(all(0 < n <= 65536 for n in connection.receives))

    def test_hard_limit_rejects_header_before_large_allocation(self):
        body = b'\x12' + struct.pack('!I', m.MAX_REGISTRY_FRAME_BYTES) + b'j:'
        with self.assertRaises(Exception):
            self.run_session(body)

    def test_truncation_wrong_correlation_duplicate_keys_and_utf8_refused(self):
        duplicate = b'j:{"args":[],"args":[]}'
        tail = b's:' + ('a' * 32 + ':0').encode()
        duplicate_frame = b'\x12' + struct.pack('!I', len(duplicate)) + duplicate + struct.pack('!I', len(tail)) + tail
        for body in [response([])[:-1], response([], 'b' * 32 + ':0'), duplicate_frame,
                     response([]).replace(b'args', b'\xffrgs')]:
            with self.subTest(body=body[:20]), self.assertRaises(Exception):
                self.run_session(body)

    def test_no_mutation_alternate_request_or_unknown_rpc(self):
        for method, arg, mutation in [('stopProcessId', {}, False), ('prepare', {}, True),
                                      ('getMonitorData', {'filter': 'worker'}, False),
                                      ('getMonitorData', {}, True)]:
            with self.subTest(method=method), self.assertRaises(Exception):
                self.run_session(response([]), method, arg, mutation)

    def test_version_still_uses_original_small_bound(self):
        with self.assertRaises(Exception):
            self.run_session(response('x' * 9000), 'getVersion')

    def test_original_row_and_filtered_output_bounds_unchanged(self):
        self.assertEqual(m._control.MAX_REGISTRY_ENTRIES, 128)
        self.assertEqual(m._control.MAX_OUTPUT_BYTES, 524288)
        with self.assertRaises(Exception):
            m._control._filter_registry([{}] * 129)


class TestRecoveryWorkerScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('recovery_worker', os.path.join(
            os.path.dirname(__file__), 'release-toolchain-registry-recovery-pm2.py'))
        cls.worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.worker)

    def row(self):
        configured = {'FAOLLA_BACKGROUND_JOBS_PAUSED': '0', 'MERCHANT_BOOKING_STORAGE_MODE': 'atomic-v2',
                      'MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED': '1',
                      'MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED': '0',
                      'MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED': '0'}
        return {'name': self.worker._NAME, 'pid': 685108, 'pm_id': 24, 'pm2_env': {
            'status': 'online', 'restart_time': 1, 'pm_cwd': '/www/wwwroot/merchant-space.web-releases/f274ad615550-online',
            'pm_exec_path': '/var/lib/faolla-online-code/' + self.worker._OLD + '/scripts/booking-atomic-worker.mjs',
            'exec_interpreter': '/usr/bin/node', 'exec_mode': 'fork_mode', 'autorestart': True,
            'env': configured, 'FAOLLA_BACKGROUND_JOBS_PAUSED': '0'}}

    def test_only_fixed_observed_predecessor_and_closed_mail_configuration(self):
        self.assertEqual(self.worker.snapshot(self.row())['pm_id'], 24)
        for key, value in [('restart_time', 2), ('restart_time', True), ('pm_exec_path', '/foreign'),
                           ('watch', True), ('status', 'stopped'), ('exec_interpreter', 'node')]:
            row = self.row()
            row['pm2_env'][key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                self.worker.snapshot(row)
        for key, value in [('pid', 685109), ('pm_id', 27)]:
            row = self.row()
            row[key] = value
            with self.assertRaises(Exception):
                self.worker.snapshot(row)
        row = self.row()
        row['pm2_env']['env']['RESEND_API_KEY'] = 'synthetic'
        with self.assertRaises(Exception):
            self.worker.snapshot(row)

    def test_arbitrary_local_parent_cannot_acquire_restart_authority(self):
        with self.assertRaises(Exception):
            self.worker.witness({'revision': 'a' * 40})

    def test_capacity_worker_preserves_original_mutation_state_and_dispatch(self):
        connection = Connection(b'')
        session = self.worker.WorkerCapacitySession(connection, {}, '/', [], 1)
        base = self.worker._active._transport._Session
        with patch.object(base, 'call', return_value='original') as original:
            self.assertEqual(session.call('restartProcessId', {'exact': 'argument'}, True), 'original')
            original.assert_called_once_with('restartProcessId', {'exact': 'argument'}, True)
        self.assertFalse(session.mutation_sent)
        with patch.object(self.worker._capacity.RegistryCapacitySession, 'call', return_value=[]) as read:
            self.assertEqual(session.call('getMonitorData', {}), [])
            read.assert_called_once_with('getMonitorData', {}, False)
        self.assertFalse(session.mutation_sent)


if __name__ == '__main__':
    unittest.main()
