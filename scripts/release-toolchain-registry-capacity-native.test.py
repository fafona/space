"""Actual Linux Unix sockets and peer credentials; never a formal PM2 socket."""
import importlib.util
import os
import socket
import sys
import time
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(os.path.dirname(__file__), filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load('native_capacity', 'release-toolchain-registry-capacity.py')
fixture = load('native_original_fixture', 'test_production_maintenance_pm2_control.py')
available = sys.platform.startswith('linux') and hasattr(socket, 'SO_PEERCRED')
if os.environ.get('GITHUB_ACTIONS') == 'true' and not available:
    raise RuntimeError('required_registry_native_tests_unavailable')


@unittest.skipUnless(available, 'requires Linux SO_PEERCRED')
class NativeRegistryCapacity(unittest.TestCase):
    def observe(self, peer, expected=None, timeout=2):
        expected = expected or m._control._peer._read_daemon_identity(os.getpid())
        chain = m._control._peer._path_chain(peer.path, expected['uid'])
        deadline = time.monotonic() + timeout
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(timeout)
            connection.connect(peer.path)
            session = m.RegistryCapacitySession(connection, expected, peer.path, chain, deadline)
            self.assertEqual(session.call('getVersion', {}), '6.0.14')
            return m._control._filter_registry(session.call('getMonitorData', {}))

    def test_actual_peer_large_registry_complete_and_private_values_filtered(self):
        row = fixture.raw_entry()
        row['syntheticPadding'] = 'secret-never-output-' * 70000
        with fixture.FakePeer([{'args': ['6.0.14']}, {'args': [[row]]}]) as peer:
            actual = self.observe(peer)
        self.assertEqual(actual, m._control._filter_registry([fixture.raw_entry()]))
        self.assertEqual(peer.accepted, 1)
        self.assertEqual([r['method'] for r in peer.requests], ['getVersion', 'getMonitorData'])
        self.assertNotIn('secret', str(actual))

    def test_wrong_peer_sends_no_request(self):
        expected = m._control._peer._read_daemon_identity(os.getpid())
        expected['pid'] += 100000
        with fixture.FakePeer([]) as peer, self.assertRaises(Exception):
            self.observe(peer, expected)
        self.assertEqual(peer.requests, [])

    def test_socket_replacement_and_deadline_fail_without_reconnect(self):
        for kwargs, responses in [({'replace_path': True}, [{'args': ['6.0.14']}]),
                                  ({}, [{'args': ['6.0.14']}, 'timeout'])]:
            with fixture.FakePeer(responses, **kwargs) as peer, self.assertRaises(Exception):
                self.observe(peer, timeout=0.15)
            self.assertLessEqual(peer.accepted, 1)

    def test_excessive_rows_and_frame_refused(self):
        for value in [[{}] * 129, [{'padding': 'x' * (4 * 1024 * 1024)}]]:
            with fixture.FakePeer([{'args': ['6.0.14']}, {'args': [value]}]) as peer, self.assertRaises(Exception):
                self.observe(peer)
            self.assertEqual(peer.accepted, 1)


if __name__ == '__main__':
    unittest.main()
