"""Isolated protocol/Unix fake-peer tests. Never imports or starts PM2."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("production-maintenance-pm2-connection.py")
SPEC = importlib.util.spec_from_file_location("pm2_connection", str(SCRIPT))
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)
LINUX_SOCKET = sys.platform.startswith("linux") and hasattr(socket, "SO_PEERCRED") and hasattr(socket, "AF_UNIX")
REQUEST_ID = "a" * 32 + ":0"


def frame(body, request_id=REQUEST_ID):
    parts = [b"j:" + body, b"s:" + request_id.encode("ascii")]
    return b"\x12" + b"".join(struct.pack("!I", len(part)) + part for part in parts)


def reply(version="6.0.14", request_id=REQUEST_ID):
    return frame(json.dumps({"args": [version]}, separators=(",", ":")).encode("utf-8"), request_id)


def expected_fixture():
    return {"pid": 123, "uid": 0, "startTicks": "456", "bootId": "12345678-1234-1234-1234-123456789abc",
            "executable": "/usr/bin/node", "executableIdentity": "1:2:3:4:5:1:0:33261"}


class ProtocolTests(unittest.TestCase):
    def test_linux_requirement_is_not_silently_skipped(self):
        if os.environ.get("FAOLLA_REQUIRE_LINUX_SOCKET_TESTS") == "1":
            self.assertTrue(LINUX_SOCKET, "required_linux_peercred_unavailable")

    def test_fixed_get_version_amp_request(self):
        parts = probe._parts(probe._encode_get_version(REQUEST_ID))
        self.assertEqual(parts[0], b'j:{"type":"call","method":"getVersion","args":[{}]}')
        self.assertEqual(parts[1], b"s:" + REQUEST_ID.encode("ascii"))
        self.assertEqual(probe._encode_get_version(REQUEST_ID)[0], 0x12)
        for bad in ("", "restartProcessId", REQUEST_ID + "\n", None):
            with self.assertRaises(probe.PM2ConnectionError):
                probe._encode_get_version(bad)

    def test_semver_is_strict_but_not_a_version_allowlist(self):
        for good in ("0.0.0", "6.0.14", "9.123.0-alpha.1+build.001"):
            self.assertEqual(probe._decode_version(reply(good), REQUEST_ID), good)
        for bad in ("v6.0.14", "06.0.14", "6.0", "6.0.14\n", "6.0.14-01", "6.0.14+", None, 6, {}, "s" * 129):
            with self.assertRaises(probe.PM2ConnectionError):
                probe._decode_version(reply(bad), REQUEST_ID)

    def test_complete_frame_and_id_are_required(self):
        valid = reply()
        for size in range(len(valid)):
            self.assertIsNone(probe._parts(valid[:size]))
        for bad in (b"\x11", b"\x22", b"\x12" + struct.pack("!I", 8193), valid + valid, valid + b"\0"):
            with self.assertRaises(probe.PM2ConnectionError):
                probe._parts(bad)
        with self.assertRaises(probe.PM2ConnectionError):
            probe._decode_version(reply(request_id="b" * 32 + ":0"), REQUEST_ID)

    def test_errors_unknown_shape_and_duplicate_json_are_never_disclosed(self):
        for body in (b'{"error":"must-not-disclose","stack":"secret"}', b'{"args":[]}',
                     b'{"args":["6.0.14",{}]}', b'{"args":["6.0.14"],"extra":"secret"}',
                     b'{"args":["6.0.14"],"args":["6.0.14"]}', b'{"args":[NaN]}',
                     b'{"args":["\xff"]}', b'[]', b'not-json'):
            with self.assertRaises(probe.PM2ConnectionError) as failure:
                probe._decode_version(frame(body), REQUEST_ID)
            self.assertEqual(str(failure.exception), "pm2_connection_protocol_invalid")

    def test_expected_identity_has_no_optional_or_coerced_fields(self):
        valid = expected_fixture()
        self.assertEqual(probe._validate_expected(valid), valid)
        for patch in ({"pid": True}, {"uid": "0"}, {"startTicks": "0456"}, {"bootId": "wrong"},
                      {"executable": "/a/../node"}, {"executableIdentity": "1:2"}, {"extra": "secret"}):
            with self.assertRaises(probe.PM2ConnectionError):
                probe._validate_expected(dict(valid, **patch))
        for key in valid:
            missing = dict(valid)
            del missing[key]
            with self.assertRaises(probe.PM2ConnectionError):
                probe._validate_expected(missing)

    def test_peer_pid_and_uid_rejected_before_proc_read(self):
        connection = mock.Mock()
        for credentials in ((124, 0, 0), (123, 1, 0)):
            connection.getsockopt.return_value = struct.pack("=iII", *credentials)
            with mock.patch.object(probe.socket, "SO_PEERCRED", 17, create=True), \
                    mock.patch.object(probe, "_read_daemon_identity") as identity:
                with self.assertRaises(probe.PM2ConnectionError):
                    probe._verify_peer(connection, expected_fixture())
                identity.assert_not_called()

    def test_import_does_not_connect_or_read_files(self):
        other = importlib.util.module_from_spec(SPEC)
        source = SCRIPT.read_text(encoding="utf-8")
        with mock.patch.object(socket, "socket") as connect, mock.patch("builtins.open") as opened:
            exec(compile(source, str(SCRIPT), "exec"), other.__dict__)
        connect.assert_not_called()
        opened.assert_not_called()


class FakePeer:
    """One temporary Unix server; no subprocess, reconnect or external socket."""
    def __init__(self, response=None, fragment=False, timeout=False, replace_path=False):
        self.response = response or (lambda request_id: reply(request_id=request_id))
        self.fragment = fragment
        self.timeout = timeout
        self.replace_path = replace_path
        self.requests = []
        self.accepted = 0
        self.errors = []
        self.stop = threading.Event()

    def __enter__(self):
        # Production path trust is not relaxed for /tmp. Use our verified repo tree.
        self.directory = tempfile.TemporaryDirectory(prefix="pm2-fake-", dir=str(SCRIPT.parent.resolve()))
        os.chmod(self.directory.name, 0o700)
        self.path = os.path.join(self.directory.name, "rpc.sock")
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(self.path)
        self.listener.listen(1)
        self.listener.settimeout(0.5)
        self.thread = threading.Thread(target=self.serve)
        self.thread.start()
        return self

    def serve(self):
        replacement = None
        try:
            with self.listener.accept()[0] as connection:
                self.accepted += 1
                connection.settimeout(0.5)
                data = b""
                while probe._parts(data) is None:
                    chunk = connection.recv(8192)
                    if not chunk:
                        return
                    data += chunk
                parts = probe._parts(data)
                self.requests.append(json.loads(parts[0][2:].decode("utf-8")))
                request_id = parts[1][2:].decode("ascii")
                if self.timeout:
                    self.stop.wait(1)
                    return
                if self.replace_path:
                    os.unlink(self.path)
                    replacement = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    replacement.bind(self.path)
                output = self.response(request_id)
                if output is None:
                    return
                if self.fragment:
                    for byte in output:
                        connection.sendall(bytes([byte]))
                else:
                    connection.sendall(output)
                # Keep the peer open until the one-shot client closes it.
                while not self.stop.is_set():
                    try:
                        extra = connection.recv(8192)
                        if not extra:
                            break
                        self.errors.append("unexpected_second_request")
                    except socket.timeout:
                        break
        except (OSError, probe.PM2ConnectionError):
            # Deliberate peer rejection/timeout closes the one connection.
            pass
        finally:
            if replacement is not None:
                replacement.close()

    def __exit__(self, *_):
        self.stop.set()
        self.listener.close()
        self.thread.join(2)
        if self.thread.is_alive():
            raise AssertionError("fake_peer_thread_not_stopped")
        self.directory.cleanup()
        if self.errors:
            raise AssertionError("unexpected_second_request")


@unittest.skipUnless(LINUX_SOCKET, "Linux SO_PEERCRED required")
class UnixConnectionTests(unittest.TestCase):
    def expected(self):
        return probe._read_daemon_identity(os.getpid())

    def test_authenticated_single_socket_version_only(self):
        with FakePeer(fragment=True) as peer:
            result = probe.inspect_pm2_connection(peer.path, self.expected())
        self.assertEqual(result, {"version": 1, "pm2Version": "6.0.14", "peerVerified": True})
        self.assertEqual(peer.accepted, 1)
        self.assertEqual(peer.requests, [{"type": "call", "method": "getVersion", "args": [{}]}])

    def test_wrong_peer_pid_sends_no_request(self):
        with FakePeer() as peer:
            wrong = dict(self.expected(), pid=os.getpid() + 100000)
            with self.assertRaises(probe.PM2ConnectionError):
                probe.inspect_pm2_connection(peer.path, wrong)
        self.assertEqual(peer.accepted, 1)
        self.assertEqual(peer.requests, [])

    def test_wrong_frozen_proc_identity_sends_no_request(self):
        for patch in ({"startTicks": "1"}, {"bootId": "00000000-0000-0000-0000-000000000000"},
                      {"executable": "/not-the-executable"}, {"executableIdentity": "0:0:0:0:0:0:0:0"}):
            with self.subTest(field=next(iter(patch))), FakePeer() as peer:
                with self.assertRaises(probe.PM2ConnectionError):
                    probe.inspect_pm2_connection(peer.path, dict(self.expected(), **patch))
            self.assertEqual(peer.requests, [])

    def test_post_response_proc_change_rejects_without_replay(self):
        expected = self.expected()
        with FakePeer() as peer, mock.patch.object(probe, "_read_daemon_identity", side_effect=[
                expected, dict(expected, startTicks="1")]):
            with self.assertRaises(probe.PM2ConnectionError):
                probe.inspect_pm2_connection(peer.path, expected)
        self.assertEqual(len(peer.requests), 1)

    def test_socket_replaced_on_same_connection_is_rejected(self):
        with FakePeer(replace_path=True) as peer:
            with self.assertRaises(probe.PM2ConnectionError):
                probe.inspect_pm2_connection(peer.path, self.expected())
        self.assertEqual(len(peer.requests), 1)

    def test_symlink_and_untrusted_directory_do_not_connect(self):
        with FakePeer() as peer:
            alias = os.path.join(peer.directory.name, "alias.sock")
            os.symlink(peer.path, alias)
            with self.assertRaises(probe.PM2ConnectionError):
                probe.inspect_pm2_connection(alias, self.expected())
            os.chmod(peer.directory.name, 0o777)
            try:
                with self.assertRaises(probe.PM2ConnectionError):
                    probe.inspect_pm2_connection(peer.path, self.expected())
            finally:
                os.chmod(peer.directory.name, 0o700)
        self.assertEqual(peer.accepted, 0)

    def test_eof_bad_id_malformed_and_extra_frames_fail_without_replay(self):
        responses = [lambda _id: None, lambda _id: reply(request_id=REQUEST_ID),
                     lambda _id: b"\x22", lambda _id: b"\x12" + struct.pack("!I", 8193),
                     lambda _id: frame(b'{"error":"must-never-disclose-secret"}', _id),
                     lambda _id: reply(request_id=_id) + reply(request_id=_id)]
        for index, response in enumerate(responses):
            with self.subTest(case=index), FakePeer(response=response) as peer:
                with self.assertRaises(probe.PM2ConnectionError) as failure:
                    probe.inspect_pm2_connection(peer.path, self.expected())
                self.assertNotIn("secret", str(failure.exception))
            self.assertEqual(len(peer.requests), 1)
            self.assertEqual(peer.accepted, 1)

    def test_total_deadline_closes_socket_and_does_not_retry(self):
        with FakePeer(timeout=True) as peer:
            started = time.monotonic()
            with self.assertRaises(probe.PM2ConnectionError) as failure:
                probe.inspect_pm2_connection(peer.path, self.expected(), timeout_ms=50)
            self.assertEqual(str(failure.exception), "pm2_connection_timeout")
            self.assertLess(time.monotonic() - started, 1)
        self.assertEqual(len(peer.requests), 1)
        self.assertEqual(peer.accepted, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
