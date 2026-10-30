"""One fixed ACTIVE, still-gated private-worker source transition.
The inactive adapter and all of its refusal rules remain unchanged. The two
closed profiles share the existing peer-bound framing, not a CLI or reconnect.
"""
import hashlib
import base64
import importlib.util
import json
import os
import re
import socket
import stat
import sys
import time
from datetime import datetime, timezone

_SOURCE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("_active_fixed_worker", _SOURCE + "/release-toolchain-pm2-worker.py")
_worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_worker)
_transport, _control, _peer = _worker._transport, _worker._control, _worker._peer
_C = "f274ad615550c83717aa7af2ad32339608e6f8aa"
_ROOT = "/var/lib/faolla-booking-active-publications/" + _C
_OLD = "0fdad28d24245a84f7ced1656b5e1f2313bee0e7"
_CLOSED_SOURCE = "dc80eacba6b3c6a78b271f88786372b026efd7dc"
_CLOSED_SHA256 = "223c7799299cd1086e704eeae5871274fa05cb32c9ec7ce94e1b0e36a08c823a"
_CLOSED_DIRECTORY = "/var/lib/faolla-booking-active-closures/b49808d6-1950-4cb4-b029-97086873d7a7/28c52817-ff38-49bd-94b7-ccd570c4d71b"


def _closed_source_matches(raw, closed, revision, directory):
    """Source identity only, NOT permission, a lease or transport authority.

    Preserve the original same-source rule. The sole cross-source proof is
    the exact immutable historical receipt, never a relabelled JSON object.
    All physical parent/FD/window/peer/script checks remain in the caller.
    """
    return closed.get("toolRevision") == revision or (
        closed.get("toolRevision") == _CLOSED_SOURCE
        and directory == _CLOSED_DIRECTORY
        and hashlib.sha256(raw).hexdigest() == _CLOSED_SHA256
    )


def _read(filename):
    current = "/"
    for part in filename.split("/")[1:-1]:
        current = os.path.join(current, part)
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or os.path.realpath(current) != current:
            raise ValueError("active_worker_path")
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or not 0 < before.st_size <= 524288:
            raise ValueError("active_worker_file")
        raw = os.read(fd, 524289)
        after, disk = os.fstat(fd), os.lstat(filename)
        facts = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_nlink)
        if len(raw) != before.st_size or facts(before) != facts(after) or facts(before) != facts(disk):
            raise ValueError("active_worker_file_changed")
        return raw, json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object)
    finally:
        os.close(fd)


def _strict_instant(text):
    # Trusted EL8 Python is 3.6. Keep its executable boundary, not a 3.7+ API.
    if not isinstance(text, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", text):
        raise ValueError("active_worker_time")
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
    except (ValueError, OverflowError):
        raise ValueError("active_worker_time") from None


def _formal_common_witness(value):
    operation, revision = value["operationId"], value["revision"]
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", operation or "") or operation == "b49808d6-1950-4cb4-b029-97086873d7a7" or not re.fullmatch(r"[a-f0-9]{40}", revision or "") or revision == _OLD or _SOURCE != "/var/lib/faolla-online-code/" + revision + "/scripts":
        raise ValueError("active_worker_source")
    if os.path.lexists("/var/lib/faolla-booking-handoff/" + _C + "/worker-enabled.json"):
        raise ValueError("active_worker_gate_open")
    filename = _ROOT + "/" + operation + "/worker-attempt.json"
    raw, attempt = _read(filename)
    if hashlib.sha256(raw).hexdigest() != value["attemptSha256"] or attempt.get("kind") != "active-booking-gated-worker-attempt" or attempt.get("toolRevision") != revision or attempt.get("window", {}).get("id") != operation or attempt.get("before", {}).get("rpcExpected") != value["expected"] or attempt.get("closedIncidentSha256") is None:
        raise ValueError("active_worker_attempt")
    window = attempt["window"]
    if set(window) != {"id", "startedAt", "deadlineAt"} or not re.fullmatch(r"[a-f0-9]{64}", attempt["closedIncidentSha256"]):
        raise ValueError("active_worker_binding")
    instant = _strict_instant
    start, deadline = instant(window["startedAt"]), instant(window["deadlineAt"])
    if deadline - start != 600 or not start <= time.time() < deadline or start <= datetime(2026, 10, 28, 18, 59, 45, 425000, tzinfo=timezone.utc).timestamp():
        raise ValueError("active_worker_window")
    parent = attempt.get("controller", {})
    parent_root = "/proc/" + str(os.getppid())
    command = open(parent_root + "/cmdline", "rb").read()
    fields = open(parent_root + "/stat", "r", encoding="utf-8").read().rsplit(")", 1)[1].strip().split()
    if parent.get("pid") != os.getppid() or parent.get("uid") != 0 or parent.get("startTicks") != fields[19] or parent.get("cwd") != os.path.dirname(_SOURCE) or os.path.realpath(parent_root + "/cwd") != parent["cwd"] or os.path.realpath(parent_root + "/exe") != "/usr/bin/node" or parent.get("commandLineDigest") != hashlib.sha256(command).hexdigest() or command.rstrip(b"\0").split(b"\0") != [b"/usr/bin/node", (_SOURCE + "/release-toolchain-active-generation-publish-entry.mjs").encode(), b"publish"]:
        raise ValueError("active_worker_controller")
    closed_directory = attempt.get("closedDirectory")
    if not isinstance(closed_directory, str) or not re.fullmatch(r"/var/lib/faolla-booking-active-closures/b49808d6-1950-4cb4-b029-97086873d7a7/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", closed_directory):
        raise ValueError("active_worker_closure_path")
    closed_raw, closed = _read(closed_directory + "/closed.json")
    if hashlib.sha256(closed_raw).hexdigest() != attempt["closedIncidentSha256"] or closed.get("kind") != "active-incident-closed-on-compatible-rollback" or not _closed_source_matches(closed_raw, closed, revision, closed_directory) or closed.get("oldOperationId") != "b49808d6-1950-4cb4-b029-97086873d7a7" or closed.get("generation") != "9b85e75c-f474-4b17-b2a5-75601f7940b4" or closed.get("originalOperationInodeRetained") is not True or closed.get("publicationAuthority") is not False or instant(closed["completedAt"]) >= start or closed["window"]["id"] == operation:
        raise ValueError("active_worker_closure")
    # The helper inherits the parent's real OFD, never acquires another lock.
    actual = os.fstat(3)
    disk = os.lstat("/www/wwwroot/merchant-space.deploy.lock")
    if not stat.S_ISREG(actual.st_mode) or actual.st_uid != 0 or stat.S_IMODE(actual.st_mode) != 0o600 or actual.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (disk.st_dev, disk.st_ino):
        raise ValueError("active_worker_inherited_fd")
    flags = open("/proc/self/fdinfo/3", "r", encoding="ascii").read()
    if "FLOCK" not in flags or "WRITE" not in flags:
        raise ValueError("active_worker_lock_not_held")
    return attempt


def _formal_witness(value):
    # The original entry retains its exact fixed predecessor. The separate
    # recovered profile shares only these unchanged parent/FD/window guards.
    attempt = _formal_common_witness(value)
    expected = _worker.snapshot(value["expected"])
    if expected["pid"] != 3889167 or expected["pm2_env"]["pm_exec_path"] != "/var/lib/faolla-online-code/" + _OLD + "/scripts/booking-atomic-worker.mjs":
        raise ValueError("active_worker_fixed_predecessor")
    # The application worker itself is unchanged; only its audited tool imports
    # (including the new explicit certificate grammar) acquire a new location.
    target = _SOURCE + "/booking-atomic-worker.mjs"
    predecessor = "/var/lib/faolla-online-code/" + _OLD + "/scripts/booking-atomic-worker.mjs"
    for script in (target, predecessor):
        info = os.lstat(script)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or os.path.realpath(script) != script:
            raise ValueError("active_worker_script")
    if open(target, "rb").read() != open(predecessor, "rb").read():
        raise ValueError("active_worker_script_changed")
    return attempt


def _perform(session, expected, process, argument, snapshot, witness):
    session.worker_argument = argument
    witness()
    if session.call("getVersion", {}) != "6.0.14":
        raise ValueError("active_worker_version")
    rows = session.call("getMonitorData", {})
    if type(rows) is not list or len(rows) > 128:
        raise ValueError("active_worker_registry")
    matched = [row for row in rows if type(row) is dict and (row.get("name") == expected["name"] or row.get("pm_id") == expected["pm_id"] or row.get("pid") == process["pid"])]
    if len(matched) != 1 or snapshot(matched[0]) != expected:
        raise ValueError("active_worker_stale_target")
    _control._check_target_process(process, session.expected)
    witness()
    ack = session.call("restartProcessId", argument, mutation=True)
    if type(ack) not in (dict, list) or type(ack) is dict and ack.get("error"):
        raise ValueError("active_worker_ack")
    session.verify()
    return {"schemaVersion": 1, "kind": "booking-ready-worker-rpc-ack", "acknowledged": True, "pm2Version": "6.0.14", "peerVerified": True}


def _connect(socket_path, daemon, process, expected, argument, snapshot, witness):
    daemon, process = _peer._validate_expected(daemon), _peer._validate_expected(process)
    if daemon["uid"] != 0 or daemon["executable"] != "/usr/bin/node" or process["uid"] != 0 or process["pid"] != expected["pid"] or process["bootId"] != daemon["bootId"] or process["executableIdentity"] != daemon["executableIdentity"]:
        raise ValueError("active_worker_peer")
    session = None
    try:
        deadline = time.monotonic() + 30
        chain = _peer._path_chain(socket_path, 0)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(socket_path)
            session = _transport._Session(connection, daemon, socket_path, chain, deadline)
            return _perform(session, expected, process, argument, snapshot, witness)
    except BaseException:
        raise RuntimeError("active_worker_outcome_unknown" if session is not None and session.mutation_sent else "active_worker_unverified") from None


def _owned_closed_source_vectors(root):
    """Pure shared-source predicate + private fixture evidence, NOT a lease."""
    filename = _SOURCE + "/test-support/release-toolchain-pre-route-closed.mjs"
    info = os.lstat(filename)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or os.path.realpath(filename) != filename:
        raise ValueError("ci_source_fixture")
    text = open(filename, "r", encoding="utf-8").read()
    match = re.search(r"Buffer\.from\('([A-Za-z0-9+/=]+)'", text)
    if not match:
        raise ValueError("ci_source_fixture")
    raw = base64.b64decode(match.group(1), validate=True)
    closed = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object)
    revision = os.path.basename(os.path.dirname(_SOURCE))
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or revision == _CLOSED_SOURCE or not _closed_source_matches(raw, closed, revision, _CLOSED_DIRECTORY) or _closed_source_matches(raw + b" ", closed, revision, _CLOSED_DIRECTORY) or _closed_source_matches(raw, {**closed, "toolRevision": "b" * 40}, revision, _CLOSED_DIRECTORY) or _closed_source_matches(raw, closed, revision, "/foreign") or not _closed_source_matches(b"owned-model", {"toolRevision": revision}, revision, "/owned-same-source"):
        raise ValueError("ci_source_binding")
    proof = {"kind": "owned-shared-worker-closed-source-predicate-verified", "toolRevision": revision, "closedSource": _CLOSED_SOURCE, "closedSha256": hashlib.sha256(raw).hexdigest(), "sameSourceAccepted": True, "exactHistoricalSourceAccepted": True, "alteredBytesSourceAndDirectoryRefused": True, "historicalBytesNotRelabelled": True, "sourceProofDoesNotOpenSocket": True, "componentProofOnly": True, "formalHostTouched": False, "publicationAuthority": False}
    output = root + "/reports/worker-closed-source-predicate-verified.json"
    encoded = (json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if not os.path.lexists(output):
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, encoded)
            os.fsync(fd)
        finally:
            os.close(fd)
    data, actual = _read(output)
    if data != encoded or actual != proof:
        raise ValueError("ci_source_evidence_changed")


def replace_owned_ci_worker(value):
    """Closed disposable adapter; never selectable by the formal CLI payload."""
    root = value.get("root")
    if os.getuid() != 0 or os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted" or os.environ.get("FAOLLA_RELEASE_PRODUCTION_EQ") != "1" or any(os.path.lexists(path) for path in ("/root/.pm2/pm2.pid", "/var/lib/faolla-online-release/active.json", "/www/wwwroot/merchant-space.current")) or not isinstance(root, str) or not re.fullmatch(r"/var/lib/faolla-eq-[A-Za-z0-9]+", root):
        raise ValueError("ci_only")
    info = os.lstat(root)
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700 or os.path.realpath(root) != root:
        raise ValueError("ci_owner")
    def snapshot(row):
        if type(row) is not dict or type(row.get("pm2_env")) is not dict:
            raise ValueError("ci_worker_shape")
        env = row["pm2_env"]
        result = {"name": row.get("name"), "pid": row.get("pid"), "pm_id": row.get("pm_id"), "pm2_env": {key: env.get(key) for key in _transport._FIELDS}}
        if env.get("shutdown_with_message") is None:
            result["pm2_env"]["shutdown_with_message"] = False
        for key in ("args", "node_args"):
            if env.get(key) is None:
                result["pm2_env"][key] = []
        flags = env.get("env", {})
        if row.get("name") != "owned-gated-worker" or row.get("pm_id") != 2 or type(row.get("pid")) is not int or row["pid"] <= 0 or env.get("pm_cwd") != root + "/app" or env.get("pm_exec_path") != root + "/app/scripts/owned-worker-old.cjs" or env.get("status") != "online" or env.get("exec_interpreter") != "/usr/bin/node" or env.get("exec_mode") != "fork_mode" or result["pm2_env"]["args"] != [] or result["pm2_env"]["node_args"] != [] or env.get("watch", False) is not False or env.get("cron_restart") not in (None, False, "0") or env.get("autorestart") is not True or env.get("shutdown_with_message") not in (None, False) or flags.get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0" or flags.get("MERCHANT_BOOKING_STORAGE_MODE") != "atomic-v2" or flags.get("MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED") != "1" or flags.get("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED") != "0" or flags.get("MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED") != "0" or flags.get("RESEND_API_KEY") or flags.get("BOOKING_CONFIRMATION_EMAIL_FROM"):
            raise ValueError("ci_worker_identity")
        return result
    expected = snapshot(value["expected"])
    def witness():
        _owned_closed_source_vectors(root)
        if os.path.lexists(root + "/worker-enabled.json"):
            raise ValueError("ci_gate_open")
        if open("/proc/" + str(value["daemon"]["pid"]) + "/cmdline", "rb").read().rstrip(b"\0") != ("PM2 v6.0.14: God Daemon (" + root + "/pm2)").encode():
            raise ValueError("ci_daemon_home")
    argument = {"id": 2, "env": {"current_conf": {"pm_exec_path": root + "/app/scripts/owned-worker-new.cjs"}}}
    witness()
    return _connect(root + "/pm2/rpc.sock", value["daemon"], value["process"], expected, argument, snapshot, witness)


def main():
    phase = "input"
    try:
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288 or not sys.platform.startswith("linux") or os.getuid() != 0:
            raise ValueError()
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object)
        if type(value) is not dict or set(value) != {"daemon", "process", "expected", "revision", "operationId", "attemptSha256"}:
            raise ValueError()
        phase = "formal-witness"
        _formal_witness(value)
        phase = "transport"
        result = _connect("/root/.pm2/rpc.sock", value["daemon"], value["process"], _worker.snapshot(value["expected"]), _transport.replacement_argument(value["revision"]), _worker.snapshot, lambda: _formal_witness(value))
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
        return 0
    except BaseException as error:
        # Only this control-flow boundary proves the socket was never opened.
        # Transport errors stay UNKNOWN, even if the current target looks old.
        before_connect = phase in ("input", "formal-witness")
        codes = {"active_worker_source", "active_worker_gate_open", "active_worker_attempt", "active_worker_binding", "active_worker_time", "active_worker_window", "active_worker_controller", "active_worker_closure_path", "active_worker_closure", "active_worker_inherited_fd", "active_worker_lock_not_held", "active_worker_fixed_predecessor", "active_worker_script", "active_worker_script_changed", "active_worker_path", "active_worker_file", "active_worker_file_changed"}
        code = error.args[0] if type(error) is ValueError and len(error.args) == 1 and type(error.args[0]) is str and error.args[0] in codes else "unconfirmed"
        receipt = {"schemaVersion": 1, "kind": "active-gated-worker-refused-before-connect" if before_connect else "active-gated-worker-outcome-unconfirmed", "stage": phase, "code": code, "socketOpened": False if before_connect else None, "controlSent": False if before_connect else None, "mutationPossible": not before_connect, "automaticRetryAllowed": False, "detailsRedacted": True}
        sys.stderr.write(json.dumps(receipt, separators=(",", ":"), sort_keys=True) + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
