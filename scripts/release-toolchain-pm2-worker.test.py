import copy
import importlib.util
import os
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("toolchain_worker_test", os.path.join(os.path.dirname(__file__), "release-toolchain-pm2-worker.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
revision = "b" * 40


def target():
    return {"name": m._transport._NAME, "pid": 12345, "pm_id": 27, "pm2_env": {
        "status": "online", "pm_cwd": m._transport._DIRECTORY,
        "pm_exec_path": "/var/lib/faolla-online-code/" + "a" * 40 + "/scripts/booking-atomic-worker.mjs",
        "exec_interpreter": "/usr/bin/node", "exec_mode": "fork_mode", "args": [], "node_args": [],
        "restart_time": 1, "watch": False, "cron_restart": None, "autorestart": True,
        "FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "env": {
            "FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "MERCHANT_BOOKING_STORAGE_MODE": "atomic-v2",
            "MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED": "1", "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED": "0",
            "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED": "0"}}}


class Session:
    expected = {"pid": 99}

    def __init__(self, rows=None):
        self.rows = [target()] if rows is None else rows
        self.calls = []

    def call(self, method, argument, mutation=False):
        self.calls.append((method, copy.deepcopy(argument), mutation))
        if method == "getVersion":
            return "6.0.14"
        if method == "getMonitorData":
            return self.rows
        return {}

    def verify(self):
        pass


class Tests(unittest.TestCase):
    def test_actual_snapshot_is_not_projected_onto_a_historical_pid(self):
        self.assertEqual(m.snapshot(target())["pid"], 12345)
        for key, value in [("name", "merchant-space"), ("pm_id", 0), ("pid", 0)]:
            row = target()
            row[key] = value
            with self.assertRaises(ValueError):
                m.snapshot(row)

    def test_nonprivate_configuration_and_mail_fail_closed(self):
        for key, value in [("pm_cwd", "/production"), ("status", "stopped"), ("restart_time", 0), ("args", ["extra"]), ("watch", True), ("cron_restart", "* * * * *"), ("pm_exec_path", "/arbitrary")]:
            row = target()
            row["pm2_env"][key] = value
            with self.assertRaises(ValueError):
                m.snapshot(row)
        for key in ["RESEND_API_KEY", "BOOKING_CONFIRMATION_EMAIL_FROM"]:
            row = target()
            row["pm2_env"]["env"][key] = "forbidden"
            with self.assertRaises(ValueError):
                m.snapshot(row)

    def test_only_one_exact_source_rpc_follows_peer_and_attempt_verification(self):
        session = Session()
        with patch.object(m._control, "_check_target_process") as peer, patch.object(m, "verify_attempt") as attempt:
            result = m.perform(session, m.snapshot(target()), {"pid": 12345}, revision, "c" * 64)
        self.assertTrue(result["acknowledged"])
        self.assertEqual([v[0] for v in session.calls], ["getVersion", "getMonitorData", "restartProcessId"])
        self.assertEqual(session.calls[-1], ("restartProcessId", {"id": 27, "env": {"current_conf": {"pm_exec_path": "/var/lib/faolla-online-code/" + revision + "/scripts/booking-atomic-worker.mjs"}}}, True))
        peer.assert_called_once()
        attempt.assert_called_once()

    def test_duplicate_aliases_drift_or_unsealed_attempt_prevent_mutation(self):
        for rows in [[], [target(), target()], [{**target(), "pid": 54321}]]:
            session = Session(rows)
            with patch.object(m._control, "_check_target_process"), patch.object(m, "verify_attempt"), self.assertRaises(ValueError):
                m.perform(session, m.snapshot(target()), {"pid": 12345}, revision, "c" * 64)
            self.assertFalse(any(c[2] for c in session.calls))
        session = Session()
        with patch.object(m._control, "_check_target_process"), patch.object(m, "verify_attempt", side_effect=ValueError()), self.assertRaises(ValueError):
            m.perform(session, m.snapshot(target()), {"pid": 12345}, revision, "c" * 64)
        self.assertFalse(any(c[2] for c in session.calls))

    def test_gate_and_untrusted_revision_fail_before_any_control_connection(self):
        for bad in [None, "x", "../other", "b" * 40 + "\n"]:
            with self.assertRaises(ValueError):
                m.verify_attempt(bad, {}, "c" * 64)
        with patch.object(m.os.path, "lexists", return_value=True), self.assertRaises(ValueError):
            m.verify_attempt(revision, {}, "c" * 64)


if __name__ == "__main__":
    unittest.main()
