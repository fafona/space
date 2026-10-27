"""One source-only replacement of the fixed gated PRIVATE booking worker.
Connect-only, peer-bound, no daemon boot, reconnect, env merge or retry.
The reviewed host must exclusively seal its single attempt before invocation.
"""
import importlib.util
import json
import os
import re
import socket
import struct
import sys
import time
import uuid

_spec = importlib.util.spec_from_file_location(
    "_booking_replace_framing", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "production-maintenance-pm2-control.py"))
_control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_control)
_peer = _control._peer

_DIRECTORY = "/www/wwwroot/merchant-space.web-releases/f274ad615550-online"
_BASE = "501b767925dd2956e1916a87d60c6f175882d9a2"
_NAME = "merchant-space-booking-atomic-f274ad615550"
_SOCKET = "/root/.pm2/rpc.sock"
_FIELDS = ("status", "pm_cwd", "pm_exec_path", "exec_interpreter", "exec_mode", "args", "node_args",
           "watch", "cron_restart", "autorestart", "kill_timeout", "shutdown_with_message", "created_at",
           "pm_uptime", "restart_time", "node_version", "version", "exit_code", "prev_restart_delay",
           "unstable_restarts", "FAOLLA_BACKGROUND_JOBS_PAUSED", "env")
def replacement_argument(revision):
    if type(revision) is not str or not re.fullmatch(r"[a-f0-9]{40}", revision) or revision == _BASE:
        _fail("booking_replace_revision")
    return {"id": 27, "env": {"current_conf": {
        "pm_exec_path": "/var/lib/faolla-online-code/" + revision + "/scripts/booking-atomic-worker.mjs"}}}


class BookingReplaceError(Exception):
    pass


def _fail(code="booking_replace_unverified"):
    raise BookingReplaceError(code)


def worker_snapshot(row):
    if type(row) is not dict or type(row.get("pm2_env")) is not dict:
        _fail()
    env = row["pm2_env"]
    result = {"name": row.get("name"), "pid": row.get("pid"), "pm_id": row.get("pm_id"),
              "pm2_env": {key: env.get(key) for key in _FIELDS}}
    # PM2 omits this metadata key on the actual old process. Preserve its
    # established normalized meaning (false), without accepting true or strings.
    if env.get("shutdown_with_message") is None:
        result["pm2_env"]["shutdown_with_message"] = False
    for key in ("args", "node_args"):
        if env.get(key) is None:
            result["pm2_env"][key] = []
    if (env.get("restart_time") != 0 or env.get("env", {}).get("MERCHANT_BOOKING_STORAGE_MODE") != "atomic-v2"
            or env.get("env", {}).get("MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED") != "1"
            or env.get("env", {}).get("MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED") != "0"
            or env.get("env", {}).get("MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED") != "0"):
        _fail("booking_replace_flags")
    if (result["name"] != _NAME or type(result["pm_id"]) is not int or result["pm_id"] != 27
            or type(result["pid"]) is not int or result["pid"] != 830152
            or env.get("status") != "online" or env.get("pm_cwd") != _DIRECTORY
            or env.get("pm_exec_path") != "/var/lib/faolla-online-code/" + _BASE + "/scripts/booking-atomic-worker.mjs"
            or env.get("exec_interpreter") != "/usr/bin/node" or env.get("exec_mode") != "fork_mode"
            or result["pm2_env"]["args"] != [] or result["pm2_env"]["node_args"] != []
            or env.get("watch", False) is not False
            or not (env.get("cron_restart") is None or env.get("cron_restart") is False or
                    type(env.get("cron_restart")) is str and env.get("cron_restart") == "0")
            or env.get("autorestart") is not True or env.get("kill_timeout") is not None
            or (env.get("shutdown_with_message") is not None and env.get("shutdown_with_message") is not False)
            or env.get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0"
            or type(env.get("env")) is not dict or env["env"].get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0"
            or env["env"].get("RESEND_API_KEY") or env["env"].get("BOOKING_CONFIRMATION_EMAIL_FROM")):
        _fail("booking_replace_precondition")
    return result


class _Session(_control._Session):
    def call(self, method, argument, mutation=False):
        if ((method in ("getVersion", "getMonitorData") and (argument != {} or mutation))
                or (method == "restartProcessId" and (argument != self.worker_argument or not mutation))
                or method not in ("getVersion", "getMonitorData", "restartProcessId")):
            _fail("booking_replace_method")
        self.verify()
        request_id = uuid.uuid4().hex + ":0"
        parts = [b"j:" + _control._json({"type": "call", "method": method, "args": [argument]}),
                 b"s:" + request_id.encode("ascii")]
        frame = b"\x12" + b"".join(struct.pack("!I", len(item)) + item for item in parts)
        _peer._timeout(self.connection, self.deadline)
        if mutation:
            if self.mutation_sent:
                _fail("booking_replace_outcome_unknown")
            self.mutation_sent = True  # BEFORE any potentially partial send.
        self.connection.sendall(frame)
        maximum = 8192 if method == "getVersion" else _control.MAX_FRAME_BYTES
        response = b""
        while _control._parts(response, maximum) is None:
            _peer._timeout(self.connection, self.deadline)
            chunk = self.connection.recv(min(65536, maximum + 1 - len(response)))
            if not chunk:
                _fail()
            response += chunk
        result = _control._decode(response, request_id, maximum)
        self.verify()
        return result


def _perform(session, expected, process, revision):
    argument = replacement_argument(revision)
    session.worker_argument = argument
    if session.call("getVersion", {}) != "6.0.14":
        _fail("booking_replace_version")
    rows = session.call("getMonitorData", {})
    if type(rows) is not list or len(rows) > 128:
        _fail()
    matched = [r for r in rows if type(r) is dict and
               (r.get("name") == _NAME or r.get("pm_id") == 27 or r.get("pid") == 830152)]
    if len(matched) != 1 or worker_snapshot(matched[0]) != expected:
        _fail("booking_replace_precondition")
    _control._check_target_process(process, session.expected)
    ack = session.call("restartProcessId", argument, mutation=True)
    if type(ack) not in (dict, list) or (type(ack) is dict and ack.get("error")):
        _fail()
    session.verify()
    # ACK is not a completed restart, health, drain or successful handoff. The
    # host separately verifies actual new /proc + full configured environments.
    return {"schemaVersion": 1, "kind": "booking-ready-worker-rpc-ack", "acknowledged": True,
            "pm2Version": "6.0.14", "peerVerified": True}


def replace_private_worker(daemon, process, expected, revision):
    replacement_argument(revision)
    session = None
    try:
        daemon = _peer._validate_expected(daemon)
        process = _peer._validate_expected(process)
        if (daemon["uid"] != 0 or daemon["executable"] != "/usr/bin/node"
                or process["pid"] != 830152 or process["uid"] != 0
                or process["bootId"] != daemon["bootId"] or process["executable"] != daemon["executable"]
                or process["executableIdentity"] != daemon["executableIdentity"]
                or worker_snapshot(expected) != expected):
            _fail("booking_replace_request")
        if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
            _fail("booking_replace_platform")
        deadline = time.monotonic() + 30.0
        chain = _peer._path_chain(_SOCKET, 0)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(_SOCKET)
            session = _Session(connection, daemon, _SOCKET, chain, deadline)
            return _perform(session, expected, process, revision)
    except BaseException:
        if session is not None and session.mutation_sent:
            raise BookingReplaceError("booking_replace_outcome_unknown") from None
        raise BookingReplaceError("booking_replace_unverified") from None


def main():
    try:
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144:
            _fail()
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object,
                             parse_constant=lambda _: _fail())
        if type(payload) is not dict or set(payload) != {"daemon", "process", "expected", "revision"}:
            _fail()
        result = replace_private_worker(payload["daemon"], payload["process"], payload["expected"], payload["revision"])
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    except BaseException:
        sys.stderr.write("booking_replace_unconfirmed\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
