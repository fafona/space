import copy
import importlib.util
import json
import os
import struct
import unittest

spec = importlib.util.spec_from_file_location("ready_replace_tested", os.path.join(os.path.dirname(__file__), "booking-ready-pm2-replace.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
REVISION = "f" * 40


def target():
    return {"name": m._NAME, "pid": 830152, "pm_id": 27, "pm2_env": {
        "status": "online", "pm_cwd": m._DIRECTORY, "pm_exec_path": "/var/lib/faolla-online-code/" + m._BASE + "/scripts/booking-atomic-worker.mjs",
        "exec_interpreter": "/usr/bin/node", "exec_mode": "fork_mode", "args": [], "node_args": [], "watch": False,
        "cron_restart": None, "autorestart": True, "kill_timeout": None, "shutdown_with_message": False,
        "created_at": 100, "pm_uptime": 100, "restart_time": 0, "node_version": "20.20.1", "version": "16.3.4",
        "exit_code": None, "prev_restart_delay": None, "unstable_restarts": 0, "FAOLLA_BACKGROUND_JOBS_PAUSED": "0",
        "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "MERCHANT_BOOKING_STORAGE_MODE": "atomic-v2",
                "MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED": "1", "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED": "0",
                "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED": "0", "UNCHANGED": "synthetic-only"}}}


class Session:
    expected = {"pid": 99}

    def __init__(self, rows=None, version="6.0.14"):
        self.rows = [target()] if rows is None else rows
        self.version, self.calls, self.mutation_sent = version, [], False

    def call(self, method, argument, mutation=False):
        self.calls.append((method, copy.deepcopy(argument), mutation))
        if method == "getVersion":
            return self.version
        if method == "getMonitorData":
            return self.rows
        self.mutation_sent = mutation
        return {}

    def verify(self):
        pass


class Connection:
    def __init__(self, fail=False):
        self.frames, self.fail, self.response = [], fail, b""

    def sendall(self, frame):
        self.frames.append(frame)
        if self.fail:
            raise OSError("partial send")
        rid = m._control._parts(frame)[1]
        parts = [b'j:{"args":[{}]}', rid]
        self.response = b"\x12" + b"".join(struct.pack("!I", len(p)) + p for p in parts)

    def recv(self, _size):
        result, self.response = self.response, b""
        return result


class ReplaceTests(unittest.TestCase):
    def setUp(self):
        self.check, self.timeout = m._control._check_target_process, m._peer._timeout
        m._control._check_target_process = lambda *_args: None
        m._peer._timeout = lambda *_args: None

    def tearDown(self):
        m._control._check_target_process, m._peer._timeout = self.check, self.timeout

    def test_fixed_worker_not_web_legacy_or_independent(self):
        self.assertEqual(m.worker_snapshot(target()), target())
        for key, value in (("name", "merchant-space"), ("name", "merchant-space-enterprise-automation-worker"), ("pid", 1590531), ("pm_id", 0)):
            row = target()
            row[key] = value
            with self.assertRaises(m.BookingReplaceError):
                m.worker_snapshot(row)
        for key, value in (("pm_exec_path", "/other"), ("pm_cwd", "/other"), ("restart_time", 1), ("watch", True), ("args", ["start"]), ("FAOLLA_BACKGROUND_JOBS_PAUSED", "1")):
            row = target()
            row["pm2_env"][key] = value
            with self.assertRaises(m.BookingReplaceError):
                m.worker_snapshot(row)

    def test_no_mail_or_other_worker_flags(self):
        for key, value in (("RESEND_API_KEY", "forbidden"), ("BOOKING_CONFIRMATION_EMAIL_FROM", "forbidden"),
                           ("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "1"), ("MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED", "0")):
            row = target()
            row["pm2_env"]["env"][key] = value
            with self.assertRaises(m.BookingReplaceError):
                m.worker_snapshot(row)
        for key in ("args", "node_args"):
            row = target()
            del row["pm2_env"][key]
            self.assertEqual(m.worker_snapshot(row)["pm2_env"][key], [])
            row["pm2_env"][key] = None
            self.assertEqual(m.worker_snapshot(row)["pm2_env"][key], [])

    def test_only_script_change_no_caller_env_merge(self):
        self.assertEqual(m.replacement_argument(REVISION), {"id": 27, "env": {"current_conf": {
            "pm_exec_path": "/var/lib/faolla-online-code/" + REVISION + "/scripts/booking-atomic-worker.mjs"}}})
        for value in (m._BASE, "bad", "f" * 40 + "\n", None):
            with self.assertRaises(m.BookingReplaceError):
                m.replacement_argument(value)
        s = Session()
        result = m._perform(s, target(), {"pid": 830152}, REVISION)
        self.assertEqual(s.calls[-1], ("restartProcessId", m.replacement_argument(REVISION), True))
        self.assertNotIn("completed", result)

    def test_wrong_version_stale_config_ambiguous_target_never_mutates(self):
        changed = target()
        changed["pm2_env"]["env"]["UNCHANGED"] = "drift"
        for s in (Session(version="6.0.15"), Session(rows=[]), Session(rows=[target(), target()]), Session(rows=[changed])):
            with self.assertRaises(m.BookingReplaceError):
                m._perform(s, target(), {"pid": 830152}, REVISION)
            self.assertFalse(s.mutation_sent)

    def session(self, connection):
        s = m._Session(connection, {}, "unused", (), 1)
        s.worker_argument = m.replacement_argument(REVISION)
        s.verify = lambda: None
        return s

    def test_other_methods_and_fields_are_rejected(self):
        for method, argument, mutation in (("stopProcessId", 27, True), ("deleteProcessId", 27, True), ("prepare", {}, True),
                                           ("restartProcessId", {"id": 0, "env": {}}, True), ("restartProcessId", {"id": 27, "env": {"EXTRA": "x"}}, True),
                                           ("restartProcessId", m.replacement_argument(REVISION), False), ("getMonitorData", {"x": 1}, False)):
            c = Connection()
            with self.assertRaises(m.BookingReplaceError):
                self.session(c).call(method, argument, mutation)
            self.assertEqual(c.frames, [])

    def test_partial_send_is_marked_unknown_before_send_and_never_retried(self):
        for fail in (False, True):
            c = Connection(fail)
            s = self.session(c)
            if fail:
                with self.assertRaises(OSError):
                    s.call("restartProcessId", m.replacement_argument(REVISION), True)
            else:
                self.assertEqual(s.call("restartProcessId", m.replacement_argument(REVISION), True), {})
                self.assertEqual(json.loads(m._control._parts(c.frames[0])[0][2:])["args"], [m.replacement_argument(REVISION)])
            self.assertTrue(s.mutation_sent)
            with self.assertRaises(m.BookingReplaceError):
                s.call("restartProcessId", m.replacement_argument(REVISION), True)
            self.assertEqual(len(c.frames), 1)


if __name__ == "__main__":
    unittest.main()
