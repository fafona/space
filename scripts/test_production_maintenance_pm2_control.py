"""Isolated protocol/fake-peer tests. Never connects to a real PM2 socket."""

import copy
import hashlib
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


SCRIPT = Path(__file__).resolve().with_name("production-maintenance-pm2-control.py")
SPEC = importlib.util.spec_from_file_location("pm2_control_under_test", str(SCRIPT))
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)
LINUX_SOCKET = sys.platform.startswith("linux") and hasattr(socket, "SO_PEERCRED")
if os.environ.get("FAOLLA_REQUIRE_LINUX_SOCKET_TESTS") == "1" and not LINUX_SOCKET:
    raise RuntimeError("required_linux_peer_tests_unavailable")

NONCE = "12345678-1234-4123-8123-123456789abc"
REQUEST_ID = "a" * 32 + ":0"
RELEASE = "/srv/faolla.releases/" + "a" * 12 + "-20260910000000"
DAEMON = {"pid": 321, "uid": 1000, "startTicks": "123", "bootId": "12345678-1234-1234-1234-123456789abc",
          "executable": "/usr/bin/node", "executableIdentity": "1:2:3:4:5:1:1000:33261"}


def environment(paused="1"):
    return {"SUPABASE_INTERNAL_URL": "http://127.0.0.1:8000", "NEXT_PUBLIC_SUPABASE_URL": "https://database.example.invalid",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": "synthetic-secret-must-not-return", "MERCHANT_STAFF_BUSINESS_RBAC_MODE": "enforce",
            "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS": "", "FAOLLA_CANONICAL_PORTAL_ORIGIN": "https://portal.example.invalid",
            "FAOLLA_BACKGROUND_JOBS_PAUSED": paused, "PORT": "3000", "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED": "false",
            "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED": "false"}


def launch(role="candidate-web", daemon=DAEMON):
    values = environment("1" if role == "candidate-web" else "0")
    return {"role": role, "appName": "faolla", "appPort": 3000, "release": RELEASE,
            "node": daemon["executable"], "nonce": NONCE,
            "envDigest": hashlib.sha256(control._json(values)).hexdigest(), "env": values}


def raw_entry(pid=432, status="online", config=None):
    config = config or control._prepare_config(launch(), "/srv/private/rpc.sock", DAEMON)
    env = dict(copy.deepcopy(config), **config["env"])
    env.update({"pm_id": 0, "status": status, "created_at": 1700000000000, "pm_uptime": 1700000000000,
                "restart_time": 0, "PRIVATE_TOKEN": "synthetic-raw-env-secret"})
    return {"pid": pid, "name": env["name"], "pm_id": 0, "pm2_env": env,
            "monit": {"cpu": 3, "memory": 123}, "unexpected": "synthetic-other-secret"}


def stop_request(action="stop"):
    return {"action": action, "expected": control._filter_entry(raw_entry()),
            "expectedProcess": dict(DAEMON, pid=432, startTicks="456")}


def frame(value, request_id=REQUEST_ID):
    parts = [b"j:" + json.dumps(value, separators=(",", ":")).encode("utf-8"), b"s:" + request_id.encode("ascii")]
    return b"\x12" + b"".join(struct.pack("!I", len(part)) + part for part in parts)


class MemoryConnection:
    """One socket substitute; used only by pure, platform-independent tests."""
    def __init__(self, responses):
        self.responses, self.requests, self.buffer = list(responses), [], b""
        self.connections = 0
    def __enter__(self):
        return self
    def __exit__(self, *_):
        pass
    def connect(self, _path):
        self.connections += 1
    def settimeout(self, _timeout):
        pass
    def sendall(self, data):
        parts = control._parts(data)
        request = json.loads(parts[0][2:].decode("utf-8"))
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        if callable(response):
            response = response(request)
        self.buffer = b"" if response is None else frame(response, parts[1][2:].decode("ascii"))
    def recv(self, maximum):
        chunk, self.buffer = self.buffer[:maximum], self.buffer[maximum:]
        return chunk


def execute_memory(responses, request=None, expected=DAEMON):
    connection = MemoryConnection(responses)
    patches = [mock.patch.object(control.sys, "platform", "linux"),
               mock.patch.object(control.socket, "SO_PEERCRED", 17, create=True),
               mock.patch.object(control.socket, "AF_UNIX", 1, create=True),
               mock.patch.object(control.socket, "socket", return_value=connection),
               mock.patch.object(control._peer, "_path_chain", return_value=("synthetic",)),
               mock.patch.object(control._peer, "_verify_peer"),
               mock.patch.object(control._peer, "_reject_unsolicited"),
               mock.patch.object(control, "_check_target_process")]
    for patch in patches:
        patch.start()
    try:
        if request is None:
            result = control.inspect_pm2_registry("/srv/private/rpc.sock", expected)
        else:
            result = control.control_pm2_process("/srv/private/rpc.sock", expected, request)
        return result, connection
    except Exception as error:
        error.test_connection = connection
        raise
    finally:
        for patch in reversed(patches):
            patch.stop()


class ProtocolTests(unittest.TestCase):
    def test_fixed_protocol_only_and_numeric_ids(self):
        for method, argument in (("getVersion", {}), ("getMonitorData", {}), ("stopProcessId", 7), ("deleteProcessId", 7)):
            body = json.loads(control._parts(control._encode(method, argument, REQUEST_ID))[0][2:].decode("utf-8"))
            self.assertEqual(body, {"type": "call", "method": method, "args": [argument]})
        for method, argument in (("save", {}), ("restartProcessId", {}), ("methods", {}), ("stopProcessId", "7"),
                                 ("deleteProcessId", True), ("getMonitorData", {"env": "secret"})):
            with self.subTest(method=method, argument=argument), self.assertRaises(control.PM2ControlError):
                control._encode(method, argument, REQUEST_ID)

    def test_decoder_rejects_rpc_error_duplicate_keys_ids_extra_frames_and_oversize(self):
        good = frame({"args": [[]]})
        invalid = [frame({"error": "secret", "stack": "secret"}), frame({"args": [[], []]}),
                   frame({"args": [[]]}, "b" * 32 + ":0"), good + good, b"\x12" + struct.pack("!I", control.MAX_FRAME_BYTES + 1)]
        parts = [b'j:{"args":[[]],"args":[[]]}', b"s:" + REQUEST_ID.encode("ascii")]
        invalid.append(b"\x12" + b"".join(struct.pack("!I", len(part)) + part for part in parts))
        for item in invalid:
            with self.subTest(frame_size=len(item)), self.assertRaises(control.PM2ControlError) as failure:
                control._decode(item, REQUEST_ID)
            self.assertNotIn("secret", str(failure.exception))

    def test_filtered_registry_has_no_environment_or_raw_ack_data(self):
        result, connection = execute_memory([{"args": ["6.0.14"]}, {"args": [[raw_entry()]]}])
        text = json.dumps(result)
        self.assertNotIn("secret", text)
        self.assertNotIn("PRIVATE_TOKEN", text)
        self.assertNotIn("NEXT_PUBLIC_SUPABASE", text)
        self.assertEqual(result["registry"][0]["pm2_env"]["nonce"], NONCE)
        self.assertEqual(result["registry"][0]["pm2_env"]["envDigest"], launch()["envDigest"])
        self.assertNotIn("acknowledged", result)
        self.assertEqual(connection.connections, 1)
        self.assertEqual([item["method"] for item in connection.requests], ["getVersion", "getMonitorData"])

    def test_version_pin_precedes_monitor(self):
        for version in ("6.0.13", "6.0.14+unreviewed", "7.0.0", None):
            with self.subTest(version=version), self.assertRaises(control.PM2ControlError) as failure:
                execute_memory([{"args": [version]}])
            self.assertEqual(str(failure.exception), "pm2_control_version_unsupported")
            self.assertEqual(len(failure.exception.test_connection.requests), 1)

    def test_all_launch_roles_construct_fixed_real_prepare_config(self):
        for role in ("candidate-web", "final-web", "final-worker"):
            item = launch(role)
            config = control._prepare_config(item, "/srv/private/rpc.sock", DAEMON)
            self.assertEqual(config["env"]["FAOLLA_MAINTENANCE_LAUNCH_NONCE"], NONCE)
            self.assertEqual(config["env"]["NODE_ENV"], "production")
            self.assertEqual(config["env"]["PATH"], "/usr/bin:/bin")
            self.assertEqual(config["autostart"], True)
            self.assertEqual(config["autorestart"], role != "candidate-web")
            self.assertEqual(config["watch"], False)
            self.assertIsNone(config["cron_restart"])
            self.assertEqual(config["wait_ready"], role == "final-worker")
            self.assertNotIn("instances", config)
            self.assertNotIn("pm_id", config)
            self.assertNotIn("status", config)
            if role == "final-worker":
                self.assertEqual(config["args"], [RELEASE + "/scripts/run-merchant-enterprise-automation-worker.ts"])
                self.assertEqual(config["kill_timeout"], 30000)
                self.assertEqual(config["listen_timeout"], 20000)
            else:
                self.assertEqual(config["args"], ["start", "-p", "3000"])

    def test_prepare_rejects_unknown_fields_env_config_and_wrong_digest_before_connect(self):
        changes = [{"role": "arbitrary"}, {"args": ["--eval", "secret"]}, {"node": "/bin/sh"},
                   {"nonce": "not-a-nonce"}, {"release": "/srv/current"}, {"appName": "../unsafe"},
                   {"envDigest": "0" * 64}, {"appPort": True}]
        for change in changes:
            with self.subTest(change=next(iter(change))), self.assertRaises(control.PM2ControlError):
                control._validate_request({"action": "prepare", "launch": dict(launch(), **change)}, "/srv/private/rpc.sock", DAEMON)
        for key, value in (("NODE_OPTIONS", "--eval secret"), ("PORT", "3001"), ("FAOLLA_BACKGROUND_JOBS_PAUSED", "0")):
            item = launch()
            item["env"][key] = value
            item["envDigest"] = hashlib.sha256(control._json(item["env"])).hexdigest()
            with self.subTest(env_key=key), self.assertRaises(control.PM2ControlError):
                control._prepare_config(item, "/srv/private/rpc.sock", DAEMON)

    def test_input_subclass_and_oversize_rejected_without_user_methods(self):
        class Untrusted(dict):
            def __iter__(self):
                raise AssertionError("must not run")
        for item in (Untrusted(), {"x": "x" * (control.MAX_REQUEST_BYTES + 1)}, {"action": 3.14}):
            with self.assertRaises(control.PM2ControlError):
                control._capture_request(item)

    def test_watch_cron_duplicate_id_and_mutated_expected_rejected(self):
        for key, value in (("watch", True), ("watch", ["/tmp"]), ("cron_restart", "* * * * *"), ("autorestart", "true")):
            item = raw_entry()
            item["pm2_env"][key] = value
            with self.subTest(key=key), self.assertRaises(control.PM2ControlError):
                control._filter_registry([item])
        with self.assertRaises(control.PM2ControlError):
            control._filter_registry([raw_entry(), raw_entry()])
        request = stop_request()
        request["expected"]["pm2_env"]["arbitrary"] = "secret"
        with self.assertRaises(control.PM2ControlError):
            control._validate_request(request, "/srv/private/rpc.sock", DAEMON)

    def test_stop_and_delete_one_mutation_and_exact_fresh_registry(self):
        for action in ("stop", "delete"):
            stopped = raw_entry(pid=0, status="stopped")
            responses = [{"args": ["6.0.14"]}, {"args": [[raw_entry()]]}, {"args": [stopped]},
                         {"args": [[stopped] if action == "stop" else []]}]
            result, connection = execute_memory(responses, stop_request(action))
            self.assertTrue(result["acknowledged"])
            self.assertEqual([item["method"] for item in connection.requests],
                             ["getVersion", "getMonitorData", "stopProcessId" if action == "stop" else "deleteProcessId", "getMonitorData"])
            self.assertEqual(connection.requests[2]["args"], [0])
            self.assertNotIn("secret", json.dumps(result))

    def test_stale_metadata_and_replaced_instance_never_sends_mutation(self):
        for key, value in (("restart_time", 1), ("created_at", 1700000000001), ("pm_uptime", 1700000000001)):
            observed = raw_entry()
            observed["pm2_env"][key] = value
            with self.subTest(key=key), self.assertRaises(control.PM2ControlError) as failure:
                execute_memory([{"args": ["6.0.14"]}, {"args": [[observed]]}], stop_request())
            self.assertEqual(str(failure.exception), "pm2_control_precondition_failed")
            self.assertEqual(len(failure.exception.test_connection.requests), 2)

    def test_mutation_send_failure_ack_loss_bad_ack_and_post_read_failure_all_unknown(self):
        variants = [OSError("secret"), None, {"error": "secret"}, {"args": [{"error": True, "message": "secret"}]},
                    {"args": [raw_entry(pid=432, status="errored")]}]
        for response in variants:
            with self.subTest(response_type=type(response).__name__), self.assertRaises(control.PM2ControlError) as failure:
                execute_memory([{"args": ["6.0.14"]}, {"args": [[raw_entry()]]}, response], stop_request())
            self.assertEqual(str(failure.exception), "pm2_control_outcome_unknown")
            self.assertEqual(len(failure.exception.test_connection.requests), 3)
            self.assertEqual(failure.exception.test_connection.connections, 1)
        with self.assertRaises(control.PM2ControlError) as failure:
            execute_memory([{"args": ["6.0.14"]}, {"args": [[raw_entry()]]},
                            {"args": [raw_entry(pid=0, status="stopped")]}, None], stop_request())
        self.assertEqual(str(failure.exception), "pm2_control_outcome_unknown")
        self.assertEqual(len(failure.exception.test_connection.requests), 4)

    def test_prepare_real_internal_cluster_ack_and_no_duplicate_name_or_nonce(self):
        item = raw_entry()
        ack = [{"process": {"pid": item["pid"]}, "pm2_env": item["pm2_env"], "raw": "secret"}]
        result, connection = execute_memory([{"args": ["6.0.14"]}, {"args": [[]]}, {"args": [ack]},
                                            {"args": [[item]]}], {"action": "prepare", "launch": launch()})
        self.assertEqual(connection.requests[2]["method"], "prepare")
        self.assertNotIn("secret", json.dumps(result))
        with self.assertRaises(control.PM2ControlError) as failure:
            execute_memory([{"args": ["6.0.14"]}, {"args": [[item]]}], {"action": "prepare", "launch": launch()})
        self.assertEqual(str(failure.exception), "pm2_control_precondition_failed")
        self.assertEqual(len(failure.exception.test_connection.requests), 2)

    def test_prepare_post_ack_restart_or_config_drift_is_unknown_not_confirmed(self):
        item = raw_entry()
        ack = [{"process": {"pid": item["pid"]}, "pm2_env": item["pm2_env"]}]
        for key, value in (("restart_time", 1), ("FAOLLA_MAINTENANCE_LAUNCH_NONCE", "12345678-1234-4123-8123-123456789abd"),
                           ("FAOLLA_BACKGROUND_JOBS_PAUSED", "0")):
            after = copy.deepcopy(item)
            after["pm2_env"][key] = value
            with self.subTest(key=key), self.assertRaises(control.PM2ControlError) as failure:
                execute_memory([{"args": ["6.0.14"]}, {"args": [[]]}, {"args": [ack]}, {"args": [[after]]}],
                               {"action": "prepare", "launch": launch()})
            self.assertEqual(str(failure.exception), "pm2_control_outcome_unknown")

    def test_target_proc_identity_and_parent_are_checked(self):
        target = stop_request()["expectedProcess"]
        stat = b"432 (synthetic) S " + str(DAEMON["pid"]).encode("ascii") + b" 0" * 17 + b" 456"
        with mock.patch.object(control._peer, "_read_daemon_identity", return_value=target), \
                mock.patch.object(control._peer, "_bounded_read", return_value=stat):
            control._check_target_process(target, DAEMON)
        with mock.patch.object(control._peer, "_read_daemon_identity", return_value=dict(target, startTicks="999")):
            with self.assertRaises(control.PM2ControlError):
                control._check_target_process(target, DAEMON)
        with mock.patch.object(control._peer, "_read_daemon_identity", return_value=target), \
                mock.patch.object(control._peer, "_bounded_read", return_value=stat.replace(b" S 321 ", b" S 999 ")):
            with self.assertRaises(control.PM2ControlError):
                control._check_target_process(target, DAEMON)

    def test_source_has_no_cli_subprocess_reconnect_or_dump_rpc(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("import subprocess", text)
        self.assertNotIn("os.system", text)
        self.assertNotIn("startProcessId", text)
        self.assertEqual(text.count("socket.socket("), 1)
        self.assertEqual(text.count(".connect(socket_path)"), 1)
        self.assertEqual(text.count(".sendall(frame)"), 1)


class FakePeer:
    """Temporary Linux server with real SO_PEERCRED; never speaks to PM2."""
    def __init__(self, responses, fragment=False, replace_path=False):
        self.responses, self.fragment, self.replace_path = list(responses), fragment, replace_path
        self.requests, self.accepted, self.errors = [], 0, []
        self.stop = threading.Event()
    def __enter__(self):
        self.directory = tempfile.TemporaryDirectory(prefix=".pm2-control-test-", dir=str(SCRIPT.parent))
        os.chmod(self.directory.name, 0o700)
        self.path = os.path.join(self.directory.name, "rpc.sock")
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.settimeout(0.4)
        self.listener.bind(self.path)
        self.listener.listen(1)
        self.thread = threading.Thread(target=self.serve)
        self.thread.start()
        return self
    def serve(self):
        replacement = None
        try:
            connection, _ = self.listener.accept()
            self.accepted += 1
            with connection:
                connection.settimeout(0.4)
                while not self.stop.is_set():
                    data = b""
                    while control._parts(data) is None:
                        chunk = connection.recv(65536)
                        if not chunk:
                            return
                        data += chunk
                    parts = control._parts(data)
                    self.requests.append(json.loads(parts[0][2:].decode("utf-8")))
                    request_id = parts[1][2:].decode("ascii")
                    if not self.responses:
                        self.errors.append("unexpected_request")
                        return
                    response = self.responses.pop(0)
                    if response is None:
                        return
                    if response == "timeout":
                        self.stop.wait(0.5)
                        return
                    if self.replace_path:
                        os.unlink(self.path)
                        replacement = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                        replacement.bind(self.path)
                        self.replace_path = False
                    output = frame(response, request_id)
                    if self.fragment:
                        for offset in range(0, len(output), 7):
                            connection.sendall(output[offset:offset + 7])
                    else:
                        connection.sendall(output)
        except (OSError, control.PM2ControlError):
            pass
        finally:
            if replacement is not None:
                replacement.close()
    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(2)
        self.listener.close()
        if self.thread.is_alive():
            raise AssertionError("fake_peer_thread_not_stopped")
        # Only this exact, standard-library-owned temporary directory is removed.
        self.directory.cleanup()
        if self.errors:
            raise AssertionError("unexpected_request")


@unittest.skipUnless(LINUX_SOCKET, "Linux SO_PEERCRED required")
class UnixConnectionTests(unittest.TestCase):
    def expected(self):
        return control._peer._read_daemon_identity(os.getpid())

    def test_real_peer_single_connection_version_then_monitor_fragmented(self):
        with FakePeer([{"args": ["6.0.14"]}, {"args": [[raw_entry()]]}], fragment=True) as peer:
            result = control.inspect_pm2_registry(peer.path, self.expected())
        self.assertEqual(peer.accepted, 1)
        self.assertEqual([item["method"] for item in peer.requests], ["getVersion", "getMonitorData"])
        self.assertNotIn("secret", json.dumps(result))

    def test_wrong_pid_or_uid_has_zero_request_bytes(self):
        for field in ("pid", "uid"):
            with self.subTest(field=field), FakePeer([]) as peer:
                expected = self.expected()
                expected[field] += 100000
                with self.assertRaises(control.PM2ControlError):
                    control.inspect_pm2_registry(peer.path, expected)
            self.assertEqual(peer.requests, [])

    def test_proc_or_socket_drift_prevents_further_requests(self):
        for change in ("startTicks", "bootId", "executableIdentity"):
            expected = self.expected()
            expected[change] = {"startTicks": "1", "bootId": "0" * 8 + "-0000-0000-0000-" + "0" * 12,
                                "executableIdentity": "0:0:0:0:0:0:0:0"}[change]
            with self.subTest(change=change), FakePeer([]) as peer, self.assertRaises(control.PM2ControlError):
                control.inspect_pm2_registry(peer.path, expected)
            self.assertEqual(peer.requests, [])
        with FakePeer([{"args": ["6.0.14"]}], replace_path=True) as peer, self.assertRaises(control.PM2ControlError):
            control.inspect_pm2_registry(peer.path, self.expected())
        self.assertEqual(len(peer.requests), 1)

    def test_bound_connection_mutation_ack_loss_is_unknown_without_replay(self):
        expected = self.expected()
        request = stop_request()
        request["expectedProcess"] = dict(expected, pid=expected["pid"] + 100000, startTicks="456")
        request["expected"]["pid"] = request["expectedProcess"]["pid"]
        observed = raw_entry(pid=request["expected"]["pid"])
        with FakePeer([{"args": ["6.0.14"]}, {"args": [[observed]]}, None]) as peer, \
                mock.patch.object(control, "_check_target_process"):
            with self.assertRaises(control.PM2ControlError) as failure:
                control.control_pm2_process(peer.path, expected, request)
        self.assertEqual(str(failure.exception), "pm2_control_outcome_unknown")
        self.assertEqual(peer.accepted, 1)
        self.assertEqual([item["method"] for item in peer.requests], ["getVersion", "getMonitorData", "stopProcessId"])

    def test_total_deadline_covers_incomplete_reply_and_never_reconnects(self):
        with FakePeer([{"args": ["6.0.14"]}, "timeout"]) as peer:
            started = time.monotonic()
            with self.assertRaises(control.PM2ControlError):
                control.inspect_pm2_registry(peer.path, self.expected(), timeout_ms=50)
            self.assertLess(time.monotonic() - started, 0.8)
        self.assertEqual(peer.accepted, 1)
        self.assertEqual(len(peer.requests), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
