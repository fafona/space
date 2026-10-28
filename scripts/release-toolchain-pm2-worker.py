"""One peer-bound source-only restart of the fixed, still-gated private worker.
Reuses the audited connect-only transport, never its historical PID exception.
"""
import hashlib
import importlib.util
import json
import os
import re
import socket
import stat
import sys
import time

_spec = importlib.util.spec_from_file_location("_toolchain_transport", os.path.join(os.path.dirname(os.path.abspath(__file__)), "booking-ready-pm2-replace.py"))
_transport = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_transport)
_control, _peer = _transport._control, _transport._peer
_ROOT = "/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa"


def snapshot(row):
    if type(row) is not dict or type(row.get("pm2_env")) is not dict:
        raise ValueError()
    env = row["pm2_env"]
    result = {"name": row.get("name"), "pid": row.get("pid"), "pm_id": row.get("pm_id"), "pm2_env": {k: env.get(k) for k in _transport._FIELDS}}
    if env.get("shutdown_with_message") is None:
        result["pm2_env"]["shutdown_with_message"] = False
    for key in ("args", "node_args"):
        if env.get(key) is None:
            result["pm2_env"][key] = []
    configured = env.get("env", {})
    if (result["name"] != _transport._NAME or result["pm_id"] != 27 or type(result["pid"]) is not int or result["pid"] <= 0
            or env.get("status") != "online" or env.get("pm_cwd") != _transport._DIRECTORY
            or not re.fullmatch(r"/var/lib/faolla-online-code/[a-f0-9]{40}/scripts/booking-atomic-worker\.mjs", env.get("pm_exec_path", ""))
            or type(env.get("restart_time")) is not int or env["restart_time"] < 1
            or env.get("exec_interpreter") != "/usr/bin/node" or env.get("exec_mode") != "fork_mode"
            or result["pm2_env"]["args"] != [] or result["pm2_env"]["node_args"] != [] or env.get("watch", False) is not False
            or env.get("cron_restart") not in (None, False, "0") or env.get("autorestart") is not True
            or env.get("kill_timeout") is not None or env.get("shutdown_with_message") not in (None, False)
            or env.get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0" or configured.get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0"
            or configured.get("MERCHANT_BOOKING_STORAGE_MODE") != "atomic-v2" or configured.get("MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED") != "1"
            or configured.get("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED") != "0" or configured.get("MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED") != "0"
            or configured.get("RESEND_API_KEY") or configured.get("BOOKING_CONFIRMATION_EMAIL_FROM")):
        raise ValueError()
    return result


def verify_attempt(revision, expected, attempt_sha256):
    if not re.fullmatch(r"[a-f0-9]{40}", revision or "") or not re.fullmatch(r"[a-f0-9]{64}", attempt_sha256 or ""):
        raise ValueError()
    for name in ("worker-enabled.json", "watchdog-lease.json", "preflight.json"):
        if os.path.lexists(_ROOT + "/" + name):
            raise ValueError()
    filename = _ROOT + "/toolchain-runtime/" + revision + "/worker-attempt.json"
    current = "/"
    for component in filename.split("/")[1:-1]:
        current = os.path.join(current, component)
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or os.path.realpath(current) != current:
            raise ValueError()
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or not 0 < before.st_size <= 262144:
            raise ValueError()
        raw = os.read(fd, 262145)
        if len(raw) != before.st_size or hashlib.sha256(raw).hexdigest() != attempt_sha256:
            raise ValueError()
        attempt = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object)
        if attempt.get("kind") != "release-toolchain-private-worker-attempt" or attempt.get("toolRevision") != revision or attempt.get("originalObservation", {}).get("rpcExpected") != expected:
            raise ValueError()
        after = os.fstat(fd)
        disk = os.lstat(filename)
        if any((before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size) != (item.st_dev, item.st_ino, item.st_mtime_ns, item.st_ctime_ns, item.st_size) for item in (after, disk)):
            raise ValueError()
    finally:
        os.close(fd)


def perform(session, expected, process, revision, attempt_sha256):
    argument = _transport.replacement_argument(revision)
    session.worker_argument = argument
    if session.call("getVersion", {}) != "6.0.14":
        raise ValueError()
    rows = session.call("getMonitorData", {})
    if type(rows) is not list or len(rows) > 128:
        raise ValueError()
    matched = [r for r in rows if type(r) is dict and (r.get("name") == _transport._NAME or r.get("pm_id") == 27 or r.get("pid") == process["pid"])]
    if len(matched) != 1 or snapshot(matched[0]) != expected:
        raise ValueError()
    _control._check_target_process(process, session.expected)
    verify_attempt(revision, expected, attempt_sha256)
    ack = session.call("restartProcessId", argument, mutation=True)
    if type(ack) not in (dict, list) or type(ack) is dict and ack.get("error"):
        raise ValueError()
    session.verify()
    return {"schemaVersion": 1, "kind": "booking-ready-worker-rpc-ack", "acknowledged": True, "pm2Version": "6.0.14", "peerVerified": True}


def main():
    session = None
    try:
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144 or not sys.platform.startswith("linux") or os.getuid() != 0 or not hasattr(socket, "SO_PEERCRED"):
            raise ValueError()
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if type(value) is not dict or set(value) != {"daemon", "process", "expected", "revision", "attemptSha256"}:
            raise ValueError()
        daemon, process = _peer._validate_expected(value["daemon"]), _peer._validate_expected(value["process"])
        expected = snapshot(value["expected"])
        if (daemon["uid"] != 0 or daemon["executable"] != "/usr/bin/node" or process["uid"] != 0 or process["pid"] != expected["pid"]
                or process["bootId"] != daemon["bootId"] or process["executableIdentity"] != daemon["executableIdentity"]):
            raise ValueError()
        deadline = time.monotonic() + 30.0
        chain = _peer._path_chain(_transport._SOCKET, 0)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(_transport._SOCKET)
            session = _transport._Session(connection, daemon, _transport._SOCKET, chain, deadline)
            result = perform(session, expected, process, value["revision"], value["attemptSha256"])
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
        return 0
    except BaseException:
        sys.stderr.write("release_toolchain_worker_outcome_unknown\n" if session is not None and session.mutation_sent else "release_toolchain_worker_unverified\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
