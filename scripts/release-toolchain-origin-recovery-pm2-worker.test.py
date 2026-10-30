import copy
import hashlib
import importlib.util
import io
import json
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("origin_worker_test", os.path.join(os.path.dirname(__file__), "release-toolchain-origin-recovery-pm2-worker.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture():
    revision = "a" * 40
    closed = {"kind": "origin-gate-recovered-failure-closed", "toolRevision": revision, "priorToolRevision": m._PRIOR, "priorEvidenceManifestSha256": m._MANIFEST, "originalOperationInode": 2624959, "originalOperationInodeRetained": True, "originalFailureFilesRetained": True, "mailEnabled": False, "businessDataWritten": False, "processSavePerformed": False, "processControlPerformed": False, "publicationAuthority": False, "completedAt": "2026-10-30T09:01:00.000Z", "window": {"id": "10000000-0000-4000-8000-000000000001"}}
    raw = (json.dumps(closed, sort_keys=True, separators=(",", ":")) + "\n").encode()
    attempt = {"originRecoveryClosedDirectory": m._ROOT + "/10000000-0000-4000-8000-000000000001", "originRecoveryClosedSha256": hashlib.sha256(raw).hexdigest(), "window": {"startedAt": "2026-10-30T09:02:00.000Z"}}
    value = {"revision": revision, "operationId": "10000000-0000-4000-8000-000000000002"}
    expected = {"pid": 416022, "pm_id": 27, "pm2_env": {"restart_time": 6, "pm_exec_path": "/var/lib/faolla-online-code/" + m._PRIOR + "/scripts/booking-atomic-worker.mjs"}}
    return attempt, value, expected, raw, closed


class Tests(unittest.TestCase):
    def test_fixed_recovered_binding_is_not_socket_authority(self):
        with patch.object(m._active, "_connect") as connect:
            self.assertTrue(m._recovered_binding(*fixture()))
            connect.assert_not_called()

    def test_different_pid_restart_source_or_process_slot_refuses(self):
        for change in (lambda e: e.update(pid=1), lambda e: e.update(pm_id=28), lambda e: e["pm2_env"].update(restart_time=5), lambda e: e["pm2_env"].update(pm_exec_path="/other")):
            a, v, e, raw, c = fixture()
            change(e)
            with self.assertRaisesRegex(ValueError, "active_worker_fixed_predecessor"):
                m._recovered_binding(a, v, e, raw, c)

    def test_wrong_closure_bytes_source_inodes_or_effect_flags_refuse(self):
        for change in (lambda c: c.update(originalOperationInode=1), lambda c: c.update(priorToolRevision="b" * 40), lambda c: c.update(priorEvidenceManifestSha256="b" * 64), lambda c: c.update(mailEnabled=True), lambda c: c.update(businessDataWritten=True), lambda c: c.update(processSavePerformed=True), lambda c: c.update(processControlPerformed=True), lambda c: c.update(publicationAuthority=True), lambda c: c.update(originalFailureFilesRetained=False)):
            a, v, e, raw, c = fixture()
            change(c)
            with self.assertRaisesRegex(ValueError, "active_worker_closure"):
                m._recovered_binding(a, v, e, raw, c)
        a, v, e, raw, c = fixture()
        with self.assertRaisesRegex(ValueError, "active_worker_closure"):
            m._recovered_binding(a, v, e, raw + b" ", c)

    def test_foreign_directory_and_old_or_shared_window_refuse(self):
        a, v, e, raw, c = fixture()
        a["originRecoveryClosedDirectory"] = "/foreign"
        with self.assertRaisesRegex(ValueError, "active_worker_closure_path"):
            m._recovered_binding(a, v, e, raw, c)
        a, v, e, raw, c = fixture()
        a["window"]["startedAt"] = c["completedAt"]
        with self.assertRaisesRegex(ValueError, "active_worker_window"):
            m._recovered_binding(a, v, e, raw, c)

    def test_new_witness_keeps_shared_parent_fd_window_guards_and_exact_archived_inode(self):
        a, v, e, raw, c = fixture()
        v["expected"] = e
        sealed = {"toolRevision": v["revision"], "qualificationSha256": "b" * 64}
        sealed_raw = json.dumps(sealed).encode()
        c.update(closureSha256=hashlib.sha256(sealed_raw).hexdigest(), qualificationSha256="b" * 64)
        raw = json.dumps(c).encode()
        a["originRecoveryClosedSha256"] = hashlib.sha256(raw).hexdigest()
        original = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_dev=64769, st_ino=2624959)
        script = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1)
        def read(filename):
            return (sealed_raw, sealed) if filename.endswith("/closure-sealed.json") else (raw, c)
        with patch.object(m._active, "_formal_common_witness", return_value=a) as common, patch.object(m._active._worker, "snapshot", return_value=e), patch.object(m._active, "_read", side_effect=read), patch.object(m.os, "lstat", side_effect=lambda p: original if p.endswith("operation.lock") else script), patch.object(m.os, "listdir", return_value=[]), patch.object(m.os.path, "realpath", side_effect=lambda p: p), patch.object(m.os.path, "lexists", return_value=False), patch("builtins.open", side_effect=lambda *args, **kw: io.BytesIO(b"same-worker")), patch.object(m._active, "_connect") as connect:
            self.assertEqual(m._formal_witness(v), a)
            common.assert_called_once_with(v)
            connect.assert_not_called()

    def test_preconnect_and_transport_failures_are_distinct_and_never_retryable(self):
        request = {key: {} for key in ("daemon", "process", "expected", "revision", "operationId", "attemptSha256")}
        for before in (True, False):
            stdin = SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode()))
            stderr = io.StringIO()
            with patch.object(m.sys, "stdin", stdin), patch.object(m.sys, "stderr", stderr), patch.object(m.sys, "platform", "linux"), patch.object(m.os, "getuid", return_value=0, create=True), patch.object(m, "_formal_witness", side_effect=ValueError("SENSITIVE_SENTINEL") if before else None), patch.object(m._active._worker, "snapshot", return_value={}), patch.object(m._active._transport, "replacement_argument", return_value={}), patch.object(m._active, "_connect", side_effect=RuntimeError("SENSITIVE_SENTINEL")) as connect:
                self.assertEqual(m.main(), 1)
                if before:
                    connect.assert_not_called()
            receipt = json.loads(stderr.getvalue())
            self.assertIs(receipt["mutationPossible"], not before)
            self.assertIs(receipt["automaticRetryAllowed"], False)
            self.assertEqual(receipt["controlSent"], False if before else None)
            self.assertNotIn("SENSITIVE_SENTINEL", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
