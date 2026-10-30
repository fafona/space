"""One reviewed post-recovery transition of the still-gated private worker.
The original helper keeps its old predecessor and CLI unchanged. No new
target, PID, program, reconnect, force or witness option is accepted here.
"""
import hashlib
import importlib.util
import json
import os
import re
import sys

_SOURCE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("_origin_active_worker", _SOURCE + "/release-toolchain-active-generation-pm2-worker.py")
_active = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_active)
_PRIOR = "168561aacf3356467facbd4f65e0c0b50ab4e4aa"
_ROOT = "/var/lib/faolla-booking-origin-recovery-closures/592b3195-8dc8-4b34-a0cf-bde4b1834063"
_MANIFEST = "8354c3f37f4cc98d572500e63031f028ba2a254a741c7a333052680a58db334a"


def _recovered_binding(attempt, value, expected, closed_raw, closed):
    """Pure fixed provenance predicate. It cannot open the manager socket."""
    directory = attempt.get("originRecoveryClosedDirectory")
    if not isinstance(directory, str) or not re.fullmatch(re.escape(_ROOT) + r"/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", directory):
        raise ValueError("active_worker_closure_path")
    if hashlib.sha256(closed_raw).hexdigest() != attempt.get("originRecoveryClosedSha256") or closed.get("kind") != "origin-gate-recovered-failure-closed" or closed.get("toolRevision") != value["revision"] or closed.get("priorToolRevision") != _PRIOR or closed.get("priorEvidenceManifestSha256") != _MANIFEST or closed.get("originalOperationInode") != 2624959 or closed.get("originalOperationInodeRetained") is not True or closed.get("originalFailureFilesRetained") is not True or closed.get("mailEnabled") is not False or closed.get("businessDataWritten") is not False or closed.get("processSavePerformed") is not False or closed.get("processControlPerformed") is not False or closed.get("publicationAuthority") is not False:
        raise ValueError("active_worker_closure")
    if _active._strict_instant(closed["completedAt"]) >= _active._strict_instant(attempt["window"]["startedAt"]) or closed["window"]["id"] == value["operationId"]:
        raise ValueError("active_worker_window")
    if expected["pid"] != 416022 or expected["pm_id"] != 27 or expected["pm2_env"]["restart_time"] != 6 or expected["pm2_env"]["pm_exec_path"] != "/var/lib/faolla-online-code/" + _PRIOR + "/scripts/booking-atomic-worker.mjs":
        raise ValueError("active_worker_fixed_predecessor")
    return True


def _formal_witness(value):
    attempt = _active._formal_common_witness(value)
    expected = _active._worker.snapshot(value["expected"])
    directory = attempt.get("originRecoveryClosedDirectory")
    if not isinstance(directory, str) or not re.fullmatch(re.escape(_ROOT) + r"/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", directory):
        raise ValueError("active_worker_closure_path")
    raw, closed = _active._read(directory + "/closed.json")
    _recovered_binding(attempt, value, expected, raw, closed)
    sealed_raw, sealed = _active._read(directory + "/closure-sealed.json")
    if hashlib.sha256(sealed_raw).hexdigest() != closed.get("closureSha256") or sealed.get("toolRevision") != value["revision"] or sealed.get("qualificationSha256") != closed.get("qualificationSha256"):
        raise ValueError("active_worker_closure")
    original = os.lstat(directory + "/operation.lock")
    if not _active.stat.S_ISDIR(original.st_mode) or original.st_uid != 0 or original.st_dev != 64769 or original.st_ino != 2624959 or _active.stat.S_IMODE(original.st_mode) != 0o700 or os.listdir(directory + "/operation.lock"):
        raise ValueError("active_worker_closure")
    for name in ("close-unconfirmed.json", "metadata-reset-unconfirmed.json"):
        if os.path.lexists(directory + "/" + name):
            raise ValueError("active_worker_closure")
    target = _SOURCE + "/booking-atomic-worker.mjs"
    predecessor = "/var/lib/faolla-online-code/" + _PRIOR + "/scripts/booking-atomic-worker.mjs"
    for script in (target, predecessor):
        info = os.lstat(script)
        if not _active.stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or os.path.realpath(script) != script:
            raise ValueError("active_worker_script")
    if open(target, "rb").read() != open(predecessor, "rb").read():
        raise ValueError("active_worker_script_changed")
    return attempt


def main():
    phase = "input"
    try:
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288 or not sys.platform.startswith("linux") or os.getuid() != 0:
            raise ValueError()
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_active._peer._unique_object)
        if type(value) is not dict or set(value) != {"daemon", "process", "expected", "revision", "operationId", "attemptSha256"}:
            raise ValueError()
        phase = "formal-witness"
        _formal_witness(value)
        phase = "transport"
        result = _active._connect("/root/.pm2/rpc.sock", value["daemon"], value["process"], _active._worker.snapshot(value["expected"]), _active._transport.replacement_argument(value["revision"]), _active._worker.snapshot, lambda: _formal_witness(value))
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
        return 0
    except BaseException:
        before = phase in ("input", "formal-witness")
        receipt = {"schemaVersion": 1, "kind": "active-gated-worker-refused-before-connect" if before else "active-gated-worker-outcome-unconfirmed", "stage": phase, "code": "unconfirmed", "socketOpened": False if before else None, "controlSent": False if before else None, "mutationPossible": not before, "automaticRetryAllowed": False, "detailsRedacted": True}
        sys.stderr.write(json.dumps(receipt, separators=(",", ":"), sort_keys=True) + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
