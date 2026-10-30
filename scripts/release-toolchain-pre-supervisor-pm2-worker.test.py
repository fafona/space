import hashlib
import importlib.util
import io
import json
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("disposition_worker_test", os.path.join(os.path.dirname(__file__), "release-toolchain-pre-supervisor-pm2-worker.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture():
    revision = "a" * 40
    closed = {"kind": "pre-supervisor-disposition-closed", "toolRevision": revision, "inventorySha256": "b" * 64, "failureManifestSha256": m._FAILURE, "originalOperationInode": 2624966, "originalEvidenceRetained": True, "completedAt": "2026-10-30T17:01:00.000Z", "window": {"id": "10000000-0000-4000-8000-000000000001"}}
    for key in ("mailEnabled", "businessDataWritten", "metadataWritten", "activationReplayed", "legacyRestarted", "publicationAuthority"):
        closed[key] = False
    attempt = {"preSupervisorClosedDirectory": m._ROOT + "/10000000-0000-4000-8000-000000000001", "window": {"startedAt": "2026-10-30T17:02:00.000Z"}}
    value = {"revision": revision, "operationId": "10000000-0000-4000-8000-000000000002"}
    expected = {"pid": 2437948, "pm_id": 27, "pm2_env": {"restart_time": 9, "pm_exec_path": "/var/lib/faolla-online-code/" + m._PRIOR + "/scripts/booking-atomic-worker.mjs"}}
    raw = encode(closed)
    attempt["preSupervisorClosedSha256"] = hashlib.sha256(raw).hexdigest()
    return attempt, value, expected, raw, closed


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


class Tests(unittest.TestCase):
    def test_pure_fixed_binding_opens_no_socket(self):
        with patch.object(m._active, "_connect") as connect:
            self.assertTrue(m._pre_supervisor_binding(*fixture()))
            connect.assert_not_called()

    def test_foreign_pid_slot_restart_and_source_refuse(self):
        for change in (lambda e: e.update(pid=1), lambda e: e.update(pm_id=28), lambda e: e["pm2_env"].update(restart_time=6), lambda e: e["pm2_env"].update(pm_exec_path="/foreign")):
            a, v, e, raw, c = fixture()
            change(e)
            with self.assertRaisesRegex(ValueError, "active_worker_fixed_predecessor"):
                m._pre_supervisor_binding(a, v, e, raw, c)

    def test_semantic_closure_mutations_cannot_be_green_even_with_matching_hashes(self):
        for key, value in [("originalOperationInode", 1), ("failureManifestSha256", "f" * 64), ("toolRevision", "c" * 40), ("originalEvidenceRetained", False)] + [(key, True) for key in ("mailEnabled", "businessDataWritten", "metadataWritten", "activationReplayed", "legacyRestarted", "publicationAuthority")]:
            a, v, e, raw, c = fixture()
            c[key] = value
            raw = encode(c)
            a["preSupervisorClosedSha256"] = hashlib.sha256(raw).hexdigest()
            with self.assertRaisesRegex(ValueError, "active_worker_closure"):
                m._pre_supervisor_binding(a, v, e, raw, c)

    def test_foreign_path_old_window_or_changed_raw_bytes_refuse(self):
        for mode in ("path", "window", "raw"):
            a, v, e, raw, c = fixture()
            if mode == "path":
                a["preSupervisorClosedDirectory"] = "/foreign"
            if mode == "window":
                a["window"]["startedAt"] = c["completedAt"]
            if mode == "raw":
                raw += b" "
            with self.assertRaises(ValueError):
                m._pre_supervisor_binding(a, v, e, raw, c)

    def test_formal_witness_keeps_shared_parent_fd_window_guards_and_archived_inode(self):
        a, v, e, raw, c = fixture()
        v["expected"] = e
        sealed = {"toolRevision": v["revision"], "inventorySha256": c["inventorySha256"], "failureManifestSha256": m._FAILURE}
        sealed_raw = encode(sealed)
        c["closureSha256"] = hashlib.sha256(sealed_raw).hexdigest()
        raw = encode(c)
        a["preSupervisorClosedSha256"] = hashlib.sha256(raw).hexdigest()
        original = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_dev=64769, st_ino=2624966)
        script = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1)
        def read(filename):
            return (sealed_raw, sealed) if filename.endswith("/closure-sealed.json") else (raw, c)
        with patch.object(m._active, "_formal_common_witness", return_value=a) as common, patch.object(m._active._worker, "snapshot", return_value=e), patch.object(m._active, "_read", side_effect=read), patch.object(m.os, "lstat", side_effect=lambda p: original if p.endswith("operation.lock") else script), patch.object(m.os, "listdir", return_value=[]), patch.object(m.os.path, "realpath", side_effect=lambda p: p), patch.object(m.os.path, "lexists", return_value=False), patch("builtins.open", side_effect=lambda *args, **kw: io.BytesIO(b"same-worker")), patch.object(m._active, "_connect") as connect:
            self.assertEqual(m._formal_witness(v), a)
            common.assert_called_once_with(v)
            connect.assert_not_called()

    def test_preconnect_and_transport_unknowns_never_retry_or_echo_secrets(self):
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
            self.assertNotIn("SENSITIVE_SENTINEL", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
