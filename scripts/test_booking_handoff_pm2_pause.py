import copy
import importlib.util
import json
import os
import struct
import unittest

_spec = importlib.util.spec_from_file_location("booking_pause_tested", os.path.join(os.path.dirname(__file__), "booking-handoff-pm2-pause.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def target():
    return {"name": "merchant-space", "pid": 1590381, "pm_id": 0, "pm2_env": {
        "status": "online", "pm_cwd": m._DIRECTORY, "pm_exec_path": m._DIRECTORY + "/node_modules/next/dist/bin/next",
        "exec_interpreter": "/usr/bin/node", "exec_mode": "fork_mode", "args": ["start", "-p", "3000"], "node_args": [],
        "watch": False, "cron_restart": None, "autorestart": True, "kill_timeout": 10000, "shutdown_with_message": False,
        "created_at": 1790102269136, "pm_uptime": 1790102269136, "restart_time": 0, "node_version": "20.20.1", "version": "16.3.4",
        "exit_code": None, "prev_restart_delay": None, "unstable_restarts": 0, "FAOLLA_BACKGROUND_JOBS_PAUSED": "0",
        "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "UNCHANGED": "synthetic-test-only"}}}


class Session:
    expected = {"pid": 99}

    def __init__(self, rows=None, version="6.0.14", ack=None):
        self.rows, self.version, self.ack = [target()] if rows is None else rows, version, {} if ack is None else ack
        self.calls, self.mutation_sent = [], False

    def call(self, method, argument, mutation=False):
        self.calls.append((method, copy.deepcopy(argument), mutation))
        if method == "getVersion":
            return self.version
        if method == "getMonitorData":
            return self.rows
        self.mutation_sent = mutation
        return self.ack

    def verify(self):
        pass


class Connection:
    def __init__(self, fail=False):
        self.frames, self.fail, self.response = [], fail, b""

    def sendall(self, frame):
        self.frames.append(frame)
        if self.fail:
            raise OSError("partial send")
        parts = m._control._parts(frame)
        rid = parts[1]
        response = [b'j:{"args":[{}]}', rid]
        self.response = b"\x12" + b"".join(struct.pack("!I", len(p)) + p for p in response)

    def recv(self, _size):
        result, self.response = self.response, b""
        return result


class PauseTests(unittest.TestCase):
    def setUp(self):
        self.original_check = m._control._check_target_process
        self.original_timeout = m._peer._timeout
        m._control._check_target_process = lambda _target, _daemon: None
        m._peer._timeout = lambda _connection, _deadline: None

    def tearDown(self):
        m._control._check_target_process = self.original_check
        m._peer._timeout = self.original_timeout

    def test_fixed_target_projection(self):
        self.assertEqual(m.legacy_snapshot(target()), target())
        for key, value in (("pid", 1590531), ("pm_id", 1), ("name", "merchant-space-enterprise-automation-worker")):
            row = target()
            row[key] = value
            with self.assertRaises(m.BookingPauseError):
                m.legacy_snapshot(row)
        for key, value in (("pm_cwd", "/other"), ("args", ["start", "-p", "3103"]), ("FAOLLA_BACKGROUND_JOBS_PAUSED", "1"),
                           ("watch", True), ("autorestart", False), ("kill_timeout", 30000), ("exec_interpreter", "/other/node")):
            row = target()
            row["pm2_env"][key] = value
            with self.assertRaises(m.BookingPauseError):
                m.legacy_snapshot(row)

    def test_no_mail_or_implicit_config_changes(self):
        for key in ("RESEND_API_KEY", "BOOKING_CONFIRMATION_EMAIL_FROM"):
            row = target()
            row["pm2_env"]["env"][key] = "forbidden"
            with self.assertRaises(m.BookingPauseError):
                m.legacy_snapshot(row)

    def test_absent_shutdown_metadata_normalizes_idempotently_but_never_accepts_true(self):
        for value in ("absent", None, False):
            row = target()
            if value == "absent":
                del row["pm2_env"]["shutdown_with_message"]
            else:
                row["pm2_env"]["shutdown_with_message"] = value
            projected = m.legacy_snapshot(row)
            self.assertIs(projected["pm2_env"]["shutdown_with_message"], False)
            self.assertEqual(m.legacy_snapshot(projected), projected)
        for value in (True, "false", 0):
            row = target()
            row["pm2_env"]["shutdown_with_message"] = value
            with self.assertRaises(m.BookingPauseError):
                m.legacy_snapshot(row)

    def test_exact_one_delta_and_ack_is_not_a_completed_restart(self):
        s = Session()
        result = m._perform(s, target(), {"pid": 1590381})
        self.assertEqual(s.calls, [("getVersion", {}, False), ("getMonitorData", {}, False),
                                   ("restartProcessId", {"id": 0, "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "1"}}, True)])
        self.assertEqual(set(result), {"schemaVersion", "kind", "acknowledged", "pm2Version", "peerVerified"})
        self.assertNotIn("completed", result)

    def test_stale_or_ambiguous_target_and_wrong_version_never_send_restart(self):
        changed = target()
        changed["pm2_env"]["env"]["UNCHANGED"] = "changed"
        for s in (Session(version="6.0.15"), Session(rows=[]), Session(rows=[target(), target()]), Session(rows=[changed])):
            with self.assertRaises(m.BookingPauseError):
                m._perform(s, target(), {"pid": 1590381})
            self.assertFalse(s.mutation_sent)

    def test_actual_target_proc_check_precedes_mutation(self):
        def reject(*_args):
            raise OSError("identity changed")
        m._control._check_target_process = reject
        s = Session()
        with self.assertRaises(OSError):
            m._perform(s, target(), {"pid": 1590381})
        self.assertFalse(s.mutation_sent)

    def test_session_rejects_every_other_method_or_environment(self):
        for method, argument, mutation in (("stopProcessId", 0, True), ("deleteProcessId", 0, True), ("prepare", {}, True),
                                          ("restartProcessId", {"id": 1, "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "1"}}, True),
                                          ("restartProcessId", {"id": 0, "env": {"EXTRA": "x", "FAOLLA_BACKGROUND_JOBS_PAUSED": "1"}}, True),
                                          ("restartProcessId", m._ARGUMENT, False), ("getMonitorData", {"x": 1}, False)):
            c = Connection()
            s = m._Session(c, {}, "unused", (), 1)
            s.verify = lambda: None
            with self.assertRaises(m.BookingPauseError):
                s.call(method, argument, mutation)
            self.assertEqual(c.frames, [])

    def test_one_frame_is_fixed_and_a_second_restart_is_forbidden(self):
        c = Connection()
        s = m._Session(c, {}, "unused", (), 1)
        s.verify = lambda: None
        self.assertEqual(s.call("restartProcessId", m._ARGUMENT, True), {})
        body = json.loads(m._control._parts(c.frames[0])[0][2:])
        self.assertEqual(body, {"type": "call", "method": "restartProcessId", "args": [m._ARGUMENT]})
        with self.assertRaises(m.BookingPauseError):
            s.call("restartProcessId", m._ARGUMENT, True)
        self.assertEqual(len(c.frames), 1)

    def test_unknown_starts_before_partial_send_and_is_not_replayed(self):
        c = Connection(fail=True)
        s = m._Session(c, {}, "unused", (), 1)
        s.verify = lambda: None
        with self.assertRaises(OSError):
            s.call("restartProcessId", m._ARGUMENT, True)
        self.assertTrue(s.mutation_sent)
        with self.assertRaises(m.BookingPauseError):
            s.call("restartProcessId", m._ARGUMENT, True)
        self.assertEqual(len(c.frames), 1)


if __name__ == "__main__":
    unittest.main()
