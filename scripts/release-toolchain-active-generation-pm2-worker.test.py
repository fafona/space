import copy
import importlib.util
import os
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("active_worker_test", os.path.join(os.path.dirname(__file__), "release-toolchain-active-generation-pm2-worker.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def target():
    return {"name": m._transport._NAME, "pid": 12345, "pm_id": 27, "pm2_env": {"status": "online", "pm_cwd": m._transport._DIRECTORY, "pm_exec_path": "/var/lib/faolla-online-code/" + m._OLD + "/scripts/booking-atomic-worker.mjs", "exec_interpreter": "/usr/bin/node", "exec_mode": "fork_mode", "args": [], "node_args": [], "restart_time": 3, "watch": False, "cron_restart": None, "autorestart": True, "FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "0", "MERCHANT_BOOKING_STORAGE_MODE": "atomic-v2", "MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED": "1", "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED": "0", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED": "0"}}}


class Session:
    expected = {"pid": 99}

    def __init__(self, rows=None, ack=None):
        self.rows = [target()] if rows is None else rows
        self.calls, self.ack = [], {} if ack is None else ack

    def call(self, method, argument, mutation=False):
        self.calls.append((method, copy.deepcopy(argument), mutation))
        return "6.0.14" if method == "getVersion" else self.rows if method == "getMonitorData" else self.ack

    def verify(self):
        pass


class Tests(unittest.TestCase):
    def test_shared_engine_has_one_exact_source_call_after_two_witness_checks(self):
        session, checks = Session(), []
        argument = m._transport.replacement_argument("b" * 40)
        with patch.object(m._control, "_check_target_process") as peer:
            result = m._perform(session, m._worker.snapshot(target()), {"pid": 12345}, argument, m._worker.snapshot, lambda: checks.append("owned"))
        self.assertTrue(result["acknowledged"])
        self.assertEqual(checks, ["owned", "owned"])
        self.assertEqual(session.calls[-1], ("restartProcessId", argument, True))
        self.assertEqual(sum(call[2] for call in session.calls), 1)
        peer.assert_called_once()

    def test_missing_duplicate_or_changed_target_never_sends_control(self):
        for rows in ([], [target(), target()], [{**target(), "pid": 54321}]):
            session = Session(rows)
            with patch.object(m._control, "_check_target_process"), self.assertRaises(ValueError):
                m._perform(session, m._worker.snapshot(target()), {"pid": 12345}, {}, m._worker.snapshot, lambda: None)
            self.assertFalse(any(call[2] for call in session.calls))

    def test_lost_witness_before_send_cannot_mutate(self):
        session, checks = Session(), []
        def witness():
            checks.append(True)
            if len(checks) == 2:
                raise ValueError("changed")
        with patch.object(m._control, "_check_target_process"), self.assertRaises(ValueError):
            m._perform(session, m._worker.snapshot(target()), {"pid": 12345}, {}, m._worker.snapshot, witness)
        self.assertFalse(any(call[2] for call in session.calls))

    def test_unknown_ack_is_not_retried(self):
        session = Session(ack={"error": "unknown"})
        with patch.object(m._control, "_check_target_process"), self.assertRaises(ValueError):
            m._perform(session, m._worker.snapshot(target()), {"pid": 12345}, {}, m._worker.snapshot, lambda: None)
        self.assertEqual(sum(call[2] for call in session.calls), 1)

    def test_bad_source_or_old_operation_refuses_before_formal_paths_or_socket(self):
        for operation, revision in [(None, "b" * 40), ("b49808d6-1950-4cb4-b029-97086873d7a7", "b" * 40), ("10000000-0000-4000-8000-000000000001", "../other")]:
            with patch.object(m, "_read") as read, self.assertRaises(ValueError):
                m._formal_witness({"operationId": operation, "revision": revision})
            read.assert_not_called()

    def test_ci_adapter_cannot_run_on_an_ordinary_or_formal_host(self):
        with patch.object(m.os, "getuid", return_value=0, create=True), patch.dict(m.os.environ, {}, clear=True), patch.object(m, "_connect") as connect, self.assertRaises(ValueError):
            m.replace_owned_ci_worker({"root": "/var/lib/faolla-eq-test"})
        connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
