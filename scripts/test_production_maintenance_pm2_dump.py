"""Synthetic fixed-file dump tests; no installed PM2, native app or live directory."""

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
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().with_name("production-maintenance-pm2-dump.py")
SPEC = importlib.util.spec_from_file_location("pm2_dump_under_test", str(SCRIPT))
dump = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dump)
control = dump._control
LINUX = sys.platform.startswith("linux") and hasattr(socket, "SO_PEERCRED")
if os.environ.get("FAOLLA_REQUIRE_LINUX_SOCKET_TESTS") == "1" and not LINUX:
    raise RuntimeError("required_linux_dump_tests_unavailable")


def record(name="faolla", identifier=0):
    env = {"name": name, "pm_id": identifier, "status": "online", "created_at": 1700000000000,
           "pm_uptime": 1700000000000, "restart_time": 0, "pm_cwd": "/srv/example",
           "pm_exec_path": "/srv/example/node_modules/next/dist/bin/next", "args": ["start", "-p", "3000"],
           "node_args": [], "exec_mode": "fork_mode", "exec_interpreter": "/usr/bin/node", "watch": False,
           "autorestart": True, "instances": 1, "prev_restart_delay": 0.0,
           "env": {"SYNTHETIC_PRIVATE_KEY": "synthetic-secret-retained-only-in-file"}, "nested": {"preserve": [1, "two", None]}}
    return {"pid": 1234 + identifier, "name": name, "pm_id": identifier, "pm2_env": env}


class PureTests(unittest.TestCase):
    def test_official_dump_transform_preserves_all_apps_and_nested_env_but_skips_modules(self):
        raw = [record(), record("other-app", 1), record("pm2-module", 2)]
        raw[2]["pm2_env"]["pmx_module"] = True
        original = copy.deepcopy(raw)
        content, count = dump._dump_content(raw)
        saved = json.loads(content.decode("utf-8"))
        self.assertEqual(count, 2)
        self.assertEqual([item["name"] for item in saved], ["faolla", "other-app"])
        self.assertEqual(saved[0]["env"], raw[0]["pm2_env"]["env"])
        self.assertEqual(saved[1]["nested"], raw[1]["pm2_env"]["nested"])
        for item in saved:
            for field in ("pm_id", "instances", "prev_restart_delay"):
                self.assertNotIn(field, item)
        self.assertEqual(raw, original)

    def test_empty_or_only_module_dump_never_overwrites_with_empty_list(self):
        only_module = record()
        only_module["pm2_env"]["pmx_module"] = {}
        for value in ([], [only_module]):
            with self.assertRaises(dump.PM2DumpError):
                dump._dump_content(value)
        self.assertTrue(dump._js_truthy([]))
        self.assertFalse(dump._js_truthy(""))

    def test_duplicate_or_unsupported_app_rejects_whole_dump_not_silent_filter(self):
        bad = record("other-app", 1)
        bad["pm2_env"]["watch"] = True
        for value in ([record(), record()], [record(), bad]):
            with self.assertRaises(control.PM2ControlError):
                dump._dump_content(value)

    def test_full_dump_comparison_rejects_changes_hidden_by_filtered_registry(self):
        raw = [record(), record("other-app", 1)]
        saved, count = dump._dump_content(raw)
        for field, value in (("env", {"SYNTHETIC_PRIVATE_KEY": "changed"}), ("kill_timeout", 12345), ("pmx_module", True)):
            changed = copy.deepcopy(raw)
            changed[0]["pm2_env"][field] = value
            self.assertEqual(control._filter_registry(changed), control._filter_registry(raw))
            with self.subTest(field=field), self.assertRaises(dump.PM2DumpError) as failure:
                dump._assert_dump_content(changed, saved, count)
            self.assertEqual(str(failure.exception), "pm2_dump_registry_changed")

    def test_only_four_top_level_fields_reset_by_pm2_execute_are_transient(self):
        fields = ("axm_actions", "axm_monitor", "axm_options", "axm_dynamic")
        self.assertEqual(dump._RESET_ON_EXECUTE, frozenset(fields))
        raw = [record()]
        for field in fields:
            raw[0]["pm2_env"][field] = {"synthetic_telemetry": "before"}
        saved, count = dump._dump_content(raw)
        for field in fields:
            changed = copy.deepcopy(raw)
            changed[0]["pm2_env"][field] = {"synthetic_telemetry": "after"}
            with self.subTest(field=field):
                dump._assert_dump_content(changed, saved, count)
                self.assertNotEqual(dump._dump_content(changed)[0], saved)
            changed = copy.deepcopy(raw)
            changed[0]["pm2_env"]["env"][field] = "different-launch-environment"
            with self.subTest(nested=field), self.assertRaises(dump.PM2DumpError):
                dump._assert_dump_content(changed, saved, count)
        for field in ("axm_unknown", "pmx", "node_version", "kill_timeout"):
            changed = copy.deepcopy(raw)
            changed[0]["pm2_env"][field] = "different"
            with self.subTest(other=field), self.assertRaises(dump.PM2DumpError):
                dump._assert_dump_content(changed, saved, count)

    def test_capture_proof_rejects_extra_fields_and_foreign_binding(self):
        daemon = {"pid": 1, "uid": 1, "startTicks": "1", "bootId": "00000000-0000-0000-0000-000000000000",
                  "executable": "/usr/bin/node", "executableIdentity": "1:2:3:4:5:1:1:33261"}
        proof = {"version": 1, "socketPath": "/private/rpc.sock", "daemon": daemon,
                 "chain": [["1", "2", "16832", "1", "1"], ["1", "3", "49600", "1", "1"]], "dump": None, "backup": None}
        self.assertEqual(dump._target(proof, proof["socketPath"], daemon), proof)
        for patch in ({"arbitrary": "secret"}, {"socketPath": "/other/rpc.sock"}, {"version": True}, {"dump": {"identity": "bad", "sha256": "0" * 64}}):
            with self.subTest(field=next(iter(patch))), self.assertRaises(dump.PM2DumpError):
                dump._target(dict(proof, **patch), proof["socketPath"], daemon)

    def test_no_cli_rpc_mutation_retry_or_raw_dump_in_receipt_contract(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("import subprocess", source)
        self.assertNotIn("os.system", source)
        self.assertNotIn('session.call("prepare"', source)
        self.assertNotIn('session.call("save"', source)
        self.assertNotIn('session.call("deleteProcessId"', source)
        self.assertEqual(source.count(".connect(path)"), 1)
        self.assertIn('os.O_EXCL | os.O_NOFOLLOW', source)
        self.assertIn('operation["replacementStarted"] = True', source)


class FakePeer:
    def __init__(self):
        self.raw = [record(), record("other-app", 1)]
        self.calls, self.accepted, self.errors = [], 0, []
        self.monitor_count, self.monitor_hook = 0, None
        self.stop = threading.Event()
    def __enter__(self):
        self.directory = tempfile.TemporaryDirectory(prefix=".pm2-dump-test-", dir=str(SCRIPT.parent))
        os.chmod(self.directory.name, 0o700)
        self.path = os.path.join(self.directory.name, "rpc.sock")
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.settimeout(0.2)
        self.listener.bind(self.path)
        self.listener.listen(4)
        self.thread = threading.Thread(target=self.serve)
        self.thread.start()
        self.daemon = dump._peer._read_daemon_identity(os.getpid())
        return self
    def serve(self):
        while not self.stop.is_set():
            try:
                connection, _ = self.listener.accept()
            except socket.timeout:
                continue
            self.accepted += 1
            with connection:
                connection.settimeout(0.5)
                while not self.stop.is_set():
                    try:
                        data = b""
                        while control._parts(data) is None:
                            chunk = connection.recv(65536)
                            if not chunk:
                                break
                            data += chunk
                        if not data:
                            break
                        parts = control._parts(data)
                        if parts is None:
                            break
                        request = json.loads(parts[0][2:].decode("utf-8"))
                        self.calls.append(request)
                        if request["args"] != [{}] or request["method"] not in ("getVersion", "getMonitorData"):
                            self.errors.append("forbidden_rpc")
                            break
                        if request["method"] == "getMonitorData":
                            self.monitor_count += 1
                            if self.monitor_hook is not None:
                                self.monitor_hook(self.monitor_count)
                        result = "6.0.14" if request["method"] == "getVersion" else self.raw
                        body = b"j:" + json.dumps({"args": [result]}, separators=(",", ":")).encode("utf-8")
                        response = [body, parts[1]]
                        connection.sendall(b"\x12" + b"".join(struct.pack("!I", len(part)) + part for part in response))
                    except (OSError, control.PM2ControlError):
                        break
    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(2)
        self.listener.close()
        if self.thread.is_alive():
            raise AssertionError("fake_peer_thread_not_stopped")
        self.directory.cleanup()
        if self.errors:
            raise AssertionError("forbidden_rpc")
    def file(self, name):
        return Path(self.directory.name, name)
    def write(self, name, content):
        self.file(name).write_bytes(content)
        os.chmod(str(self.file(name)), 0o600)
    def expected(self):
        return control._filter_registry(self.raw)
    def capture(self):
        return dump.capture_pm2_dump_target(self.path, self.daemon)
    def persist(self, target):
        return dump.persist_pm2_dump(self.path, self.daemon, self.expected(), target)


@unittest.skipUnless(LINUX, "Linux real dir_fd/files/peer credentials required")
class FilesystemTests(unittest.TestCase):
    def test_real_new_dump_and_exact_readonly_verify_keep_all_apps(self):
        with FakePeer() as peer:
            target = peer.capture()
            self.assertIsNone(target["dump"])
            self.assertIsNone(target["backup"])
            receipt = peer.persist(target)
            saved = peer.file("dump.pm2").read_bytes()
            self.assertEqual([item["name"] for item in json.loads(saved.decode("utf-8"))], ["faolla", "other-app"])
            self.assertEqual(receipt["target"]["dump"]["sha256"], hashlib.sha256(saved).hexdigest())
            self.assertEqual(peer.file("dump.pm2").stat().st_mode & 0o777, 0o600)
            self.assertNotIn("secret", json.dumps(receipt))
            self.assertIsNone(receipt["target"]["backup"])
            before = peer.file("dump.pm2").stat()
            self.assertTrue(dump.verify_pm2_dump(peer.path, peer.daemon, peer.expected(), receipt))
            self.assertEqual(before.st_ino, peer.file("dump.pm2").stat().st_ino)
            self.assertEqual(before.st_mtime_ns, peer.file("dump.pm2").stat().st_mtime_ns)
            self.assertEqual(peer.accepted, 3)
            self.assertEqual(set(item["method"] for item in peer.calls), {"getVersion", "getMonitorData"})

    def test_existing_primary_is_backed_up_exactly_before_main_replace(self):
        with FakePeer() as peer:
            old = b'[{"old":"synthetic-private-backup"}]'
            peer.write("dump.pm2", old)
            peer.write("dump.pm2.bak", b"previous backup")
            receipt = peer.persist(peer.capture())
            self.assertEqual(peer.file("dump.pm2.bak").read_bytes(), old)
            self.assertEqual(receipt["target"]["backup"]["sha256"], hashlib.sha256(old).hexdigest())
            self.assertTrue(dump.verify_pm2_dump(peer.path, peer.daemon, peer.expected(), receipt))
            self.assertEqual(set(os.listdir(peer.directory.name)), {"rpc.sock", "dump.pm2", "dump.pm2.bak"})

    def test_stale_file_or_registry_rejected_before_fixed_file_writes(self):
        with FakePeer() as peer:
            peer.write("dump.pm2", b"old")
            proof = peer.capture()
            peer.write("dump.pm2", b"changed")
            with self.assertRaises(dump.PM2DumpError) as failure:
                peer.persist(proof)
            self.assertEqual(str(failure.exception), "pm2_dump_target_changed")
            self.assertEqual(peer.file("dump.pm2").read_bytes(), b"changed")
            proof = peer.capture()
            expected = peer.expected()
            peer.raw[0]["pm2_env"]["restart_time"] = 1
            with self.assertRaises(dump.PM2DumpError) as failure:
                dump.persist_pm2_dump(peer.path, peer.daemon, expected, proof)
            self.assertEqual(str(failure.exception), "pm2_dump_registry_changed")
            self.assertFalse(peer.file("dump.pm2.bak").exists())

    def test_unsafe_symlink_hardlink_writable_and_fifo_never_read_as_dump(self):
        for kind in ("symlink", "hardlink", "writable", "fifo"):
            with self.subTest(kind=kind), FakePeer() as peer:
                peer.write("owned-source", b"synthetic-private")
                path = str(peer.file("dump.pm2"))
                if kind == "symlink":
                    os.symlink(str(peer.file("owned-source")), path)
                elif kind == "hardlink":
                    os.link(str(peer.file("owned-source")), path)
                elif kind == "fifo":
                    os.mkfifo(path, 0o600)
                else:
                    peer.write("dump.pm2", b"synthetic-private")
                    os.chmod(path, 0o666)
                with self.assertRaises(dump.PM2DumpError):
                    peer.capture()
                self.assertEqual(peer.file("owned-source").read_bytes(), b"synthetic-private")

    def test_replace_failure_after_backup_is_unknown_no_rollback_or_retry(self):
        with FakePeer() as peer:
            peer.write("dump.pm2", b"old-primary")
            peer.write("dump.pm2.bak", b"old-backup")
            proof = peer.capture()
            original = os.replace
            calls = []
            def replace(source, target, **kwargs):
                calls.append(target)
                if target == "dump.pm2":
                    raise OSError("synthetic-secret-error")
                return original(source, target, **kwargs)
            with mock.patch.object(dump.os, "replace", side_effect=replace), self.assertRaises(dump.PM2DumpError) as failure:
                peer.persist(proof)
            self.assertEqual(str(failure.exception), "pm2_dump_outcome_unknown")
            self.assertEqual(calls, ["dump.pm2.bak", "dump.pm2"])
            self.assertEqual(peer.file("dump.pm2").read_bytes(), b"old-primary")
            self.assertEqual(peer.file("dump.pm2.bak").read_bytes(), b"old-primary")
            self.assertEqual(set(os.listdir(peer.directory.name)), {"rpc.sock", "dump.pm2", "dump.pm2.bak"})

    def test_staging_fsync_failure_leaves_original_files_and_cleans_only_owned_temp(self):
        with FakePeer() as peer:
            peer.write("dump.pm2", b"old-primary")
            peer.write("dump.pm2.bak", b"old-backup")
            proof = peer.capture()
            with mock.patch.object(dump.os, "fsync", side_effect=OSError("synthetic-private")), \
                    self.assertRaises(dump.PM2DumpError) as failure:
                peer.persist(proof)
            self.assertEqual(str(failure.exception), "pm2_dump_unverified")
            self.assertEqual(peer.file("dump.pm2").read_bytes(), b"old-primary")
            self.assertEqual(peer.file("dump.pm2.bak").read_bytes(), b"old-backup")
            self.assertEqual(set(os.listdir(peer.directory.name)), {"rpc.sock", "dump.pm2", "dump.pm2.bak"})

    def test_saved_file_replaced_or_current_instance_changed_cannot_verify(self):
        with FakePeer() as peer:
            receipt = peer.persist(peer.capture())
            original = peer.file("dump.pm2").read_bytes()
            peer.write("replacement", original)
            os.replace(str(peer.file("replacement")), str(peer.file("dump.pm2")))
            with self.assertRaises(dump.PM2DumpError):
                dump.verify_pm2_dump(peer.path, peer.daemon, peer.expected(), receipt)
        with FakePeer() as peer:
            registry = peer.expected()
            receipt = peer.persist(peer.capture())
            peer.raw[0]["pid"] += 1
            with self.assertRaises(dump.PM2DumpError):
                dump.verify_pm2_dump(peer.path, peer.daemon, registry, receipt)

    def test_hidden_full_environment_change_during_save_is_unknown_and_after_save_cannot_verify(self):
        with FakePeer() as peer:
            proof = peer.capture()
            def change_last_monitor(count):
                if count == 3:
                    peer.raw[0]["pm2_env"]["env"]["SYNTHETIC_PRIVATE_KEY"] = "changed"
            peer.monitor_hook = change_last_monitor
            with self.assertRaises(dump.PM2DumpError) as failure:
                peer.persist(proof)
            self.assertEqual(str(failure.exception), "pm2_dump_outcome_unknown")
            self.assertTrue(peer.file("dump.pm2").exists())
        for field, value in (("env", {"SYNTHETIC_PRIVATE_KEY": "changed"}), ("kill_timeout", 20000), ("pmx_module", True)):
            with self.subTest(field=field), FakePeer() as peer:
                registry = peer.expected()
                receipt = peer.persist(peer.capture())
                peer.raw[0]["pm2_env"][field] = value
                self.assertEqual(peer.expected(), registry)
                with self.assertRaises(dump.PM2DumpError) as failure:
                    dump.verify_pm2_dump(peer.path, peer.daemon, registry, receipt)
                self.assertEqual(str(failure.exception), "pm2_dump_registry_changed")

    def test_live_telemetry_changes_allow_save_verify_but_disk_changes_still_reject(self):
        with FakePeer() as peer:
            def update_telemetry(count):
                for row in peer.raw:
                    for field in dump._RESET_ON_EXECUTE:
                        row["pm2_env"][field] = {"synthetic_counter": count}
            peer.monitor_hook = update_telemetry
            registry = peer.expected()
            receipt = peer.persist(peer.capture())
            saved = peer.file("dump.pm2").read_bytes()
            self.assertTrue(dump.verify_pm2_dump(peer.path, peer.daemon, registry, receipt))
            self.assertEqual(peer.file("dump.pm2").read_bytes(), saved)
            stored = json.loads(saved.decode("utf-8"))
            self.assertEqual(stored[0]["axm_monitor"], {"synthetic_counter": 1})
            stored[0]["axm_monitor"] = {"synthetic_counter": 999}
            peer.write("dump.pm2", json.dumps(stored).encode("utf-8"))
            with self.assertRaises(dump.PM2DumpError) as failure:
                dump.verify_pm2_dump(peer.path, peer.daemon, registry, receipt)
            self.assertEqual(str(failure.exception), "pm2_dump_target_changed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
