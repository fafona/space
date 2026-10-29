import copy
import base64
import importlib.util
import io
import json
import os
import re
import unittest
from types import SimpleNamespace
import stat
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
    def test_full_formal_witness_positive_path_on_python36_compatible_datetime_never_connects(self):
        original = m.datetime
        class Python36DateTime:
            strptime = staticmethod(original.strptime)
            def __new__(cls, *args, **kwargs):
                return original(*args, **kwargs)
        revision = 'a' * 40
        directory = '/var/lib/faolla-online-code/' + revision
        operation = '10000000-0000-4000-8000-000000000002'
        parent_pid, ticks = 4242, '1234567'
        argv = b'\0'.join([b'/usr/bin/node', (directory + '/scripts/release-toolchain-active-generation-publish-entry.mjs').encode(), b'publish']) + b'\0'
        row = target(); row['pid'] = 3889167
        expected = m._worker.snapshot(row)
        with open(os.path.join(os.path.dirname(__file__), 'test-support', 'release-toolchain-pre-route-closed.mjs'), 'r', encoding='utf-8') as stream:
            closed_raw = base64.b64decode(re.search(r"Buffer\.from\('([^']+)'", stream.read()).group(1))
        closed = json.loads(closed_raw)
        attempt = {'kind':'active-booking-gated-worker-attempt', 'toolRevision':revision, 'window':{'id':operation, 'startedAt':'2026-10-29T16:00:00.000Z', 'deadlineAt':'2026-10-29T16:10:00.000Z'}, 'before':{'rpcExpected':expected}, 'closedIncidentSha256':m.hashlib.sha256(closed_raw).hexdigest(), 'closedDirectory':m._CLOSED_DIRECTORY, 'controller':{'pid':parent_pid, 'uid':0, 'startTicks':ticks, 'cwd':directory, 'commandLineDigest':m.hashlib.sha256(argv).hexdigest()}}
        raw = (json.dumps(attempt, sort_keys=True, separators=(',', ':')) + '\n').encode()
        fields = ['S'] + ['0'] * 19; fields[19] = ticks
        lock = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1, st_dev=1, st_ino=2)
        source = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1)
        def opened(filename, *args, **kwargs):
            if filename == '/proc/4242/cmdline': return io.BytesIO(argv)
            if filename == '/proc/4242/stat': return io.StringIO('4242 (node) ' + ' '.join(fields))
            if filename == '/proc/self/fdinfo/3': return io.StringIO('lock: 1: FLOCK ADVISORY WRITE 4242 00:01:2 0 EOF\n')
            if filename.endswith('/scripts/booking-atomic-worker.mjs'): return io.BytesIO(b'identical-owned-synthetic-worker')
            raise AssertionError('unexpected_read')
        def canonical(filename):
            if filename == '/proc/4242/cwd': return directory
            if filename == '/proc/4242/exe': return '/usr/bin/node'
            return filename
        def read(filename):
            return (closed_raw, closed) if filename.endswith('/closed.json') else (raw, attempt)
        with patch.object(m, 'datetime', Python36DateTime), patch.object(m, '_SOURCE', directory + '/scripts'), patch.object(m.time, 'time', return_value=1793289630.0), patch.object(m.os, 'getppid', return_value=parent_pid), patch.object(m.os.path, 'lexists', return_value=False), patch.object(m.os.path, 'realpath', side_effect=canonical), patch.object(m.os, 'fstat', return_value=lock), patch.object(m.os, 'lstat', side_effect=lambda p:lock if p.endswith('.deploy.lock') else source), patch.object(m, '_read', side_effect=read), patch('builtins.open', side_effect=opened), patch.object(m, '_connect') as connect:
            request = {'operationId':operation, 'revision':revision, 'expected':expected, 'attemptSha256':m.hashlib.sha256(raw).hexdigest()}
            self.assertEqual(m._formal_witness(request), attempt)
            connect.assert_not_called()

    def test_strict_utc_millisecond_parser_does_not_need_python37_datetime_api(self):
        original = m.datetime
        class Python36DateTime:
            strptime = staticmethod(original.strptime)
        self.assertFalse(hasattr(Python36DateTime, "fromisoformat"))
        with patch.object(m, "datetime", Python36DateTime):
            self.assertEqual(m._strict_instant("2026-10-29T15:22:40.547Z"), 1793287360.547)
            for invalid in (None, True, 1, "2026-10-29T15:22:40Z", "2026-10-29T15:22:40.54Z", "2026-10-29T15:22:40.5470Z", "2026-10-29T15:22:40.547+00:00", "2026-02-29T15:22:40.547Z", "2026-10-29T25:22:40.547Z"):
                with self.assertRaisesRegex(ValueError, "^active_worker_time$"):
                    m._strict_instant(invalid)

    def test_exact_historical_source_is_not_relabelled_as_current(self):
        fixture = os.path.join(os.path.dirname(__file__), "test-support", "release-toolchain-pre-route-closed.mjs")
        with open(fixture, "r", encoding="utf-8") as stream:
            text = stream.read()
        raw = base64.b64decode(re.search(r"Buffer\.from\('([^']+)'", text).group(1))
        closed = json.loads(raw)
        self.assertTrue(m._closed_source_matches(raw, closed, "a" * 40, m._CLOSED_DIRECTORY))
        self.assertFalse(m._closed_source_matches(raw + b" ", closed, "a" * 40, m._CLOSED_DIRECTORY))
        self.assertFalse(m._closed_source_matches(raw, closed, "a" * 40, "/other"))
        self.assertFalse(m._closed_source_matches(raw, {**closed, "toolRevision": "b" * 40}, "a" * 40, m._CLOSED_DIRECTORY))
        self.assertTrue(m._closed_source_matches(b"synthetic", {"toolRevision": "a" * 40}, "a" * 40, "/original-same-source"))

    def test_witness_refusal_records_no_socket_or_control_without_secret_text(self):
        request = {key: {} for key in ("daemon", "process", "expected", "revision", "operationId", "attemptSha256")}
        stdin = type("Input", (), {"buffer": io.BytesIO(json.dumps(request).encode())})()
        stderr = io.StringIO()
        with patch.object(m.sys, "stdin", stdin), patch.object(m.sys, "stderr", stderr), patch.object(m.sys, "platform", "linux"), patch.object(m.os, "getuid", return_value=0, create=True), patch.object(m, "_formal_witness", side_effect=ValueError("active_worker_closure")), patch.object(m, "_connect") as connect:
            self.assertEqual(m.main(), 1)
        connect.assert_not_called()
        receipt = json.loads(stderr.getvalue())
        self.assertEqual(receipt["kind"], "active-gated-worker-refused-before-connect")
        self.assertEqual(receipt["code"], "active_worker_closure")
        self.assertIs(receipt["controlSent"], False)
        self.assertIs(receipt["mutationPossible"], False)

    def test_transport_refusal_cannot_claim_no_mutation(self):
        request = {key: {} for key in ("daemon", "process", "expected", "revision", "operationId", "attemptSha256")}
        stdin = type("Input", (), {"buffer": io.BytesIO(json.dumps(request).encode())})()
        stderr = io.StringIO()
        with patch.object(m.sys, "stdin", stdin), patch.object(m.sys, "stderr", stderr), patch.object(m.sys, "platform", "linux"), patch.object(m.os, "getuid", return_value=0, create=True), patch.object(m, "_formal_witness"), patch.object(m._worker, "snapshot", return_value={}), patch.object(m._transport, "replacement_argument", return_value={}), patch.object(m, "_connect", side_effect=RuntimeError("SENSITIVE_SENTINEL")):
            self.assertEqual(m.main(), 1)
        receipt = json.loads(stderr.getvalue())
        self.assertEqual(receipt["kind"], "active-gated-worker-outcome-unconfirmed")
        self.assertIs(receipt["mutationPossible"], True)
        self.assertIsNone(receipt["controlSent"])
        self.assertNotIn("SENSITIVE_SENTINEL", stderr.getvalue())

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
