"""ONE fixed legacy booking restart; a connect-only transport, not authority.

The host must durably claim its exclusive one-attempt slot BEFORE invoking this
helper. Unknown results are terminal. Existing maintenance transports and their
method allowlists remain byte-for-byte unchanged. No CLI/daemon boot/reconnect,
stop, delete, generic restart target, caller env merge, or automatic retry.
"""
import importlib.util
import json
import os
import socket
import struct
import sys
import time
import uuid

_spec = importlib.util.spec_from_file_location(
    "_booking_pause_framing", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "production-maintenance-pm2-control.py"))
_control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_control)
_peer = _control._peer

_DIRECTORY = "/www/wwwroot/merchant-space.releases/e3e685852a63-20260922183053"
_SOCKET = "/root/.pm2/rpc.sock"
_FIELDS = ("status", "pm_cwd", "pm_exec_path", "exec_interpreter", "exec_mode", "args", "node_args",
           "watch", "cron_restart", "autorestart", "kill_timeout", "shutdown_with_message", "created_at",
           "pm_uptime", "restart_time", "node_version", "version", "exit_code", "prev_restart_delay",
           "unstable_restarts", "FAOLLA_BACKGROUND_JOBS_PAUSED", "env")
_ARGUMENT = {"id": 0, "env": {"FAOLLA_BACKGROUND_JOBS_PAUSED": "1"}}


class BookingPauseError(Exception):
    pass


def _fail(code="booking_pause_unverified"):
    raise BookingPauseError(code)


def legacy_snapshot(row):
    if type(row) is not dict or type(row.get("pm2_env")) is not dict:
        _fail()
    env = row["pm2_env"]
    result = {"name": row.get("name"), "pid": row.get("pid"), "pm_id": row.get("pm_id"),
              "pm2_env": {key: env.get(key) for key in _FIELDS}}
    # PM2 omits this metadata key on the actual old process. Preserve its
    # established normalized meaning (false), without accepting true or strings.
    if env.get("shutdown_with_message") is None:
        result["pm2_env"]["shutdown_with_message"] = False
    if (result["name"] != "merchant-space" or type(result["pm_id"]) is not int or result["pm_id"] != 0
            or type(result["pid"]) is not int or result["pid"] != 1590381
            or env.get("status") != "online" or env.get("pm_cwd") != _DIRECTORY
            or env.get("pm_exec_path") != _DIRECTORY + "/node_modules/next/dist/bin/next"
            or env.get("exec_interpreter") != "/usr/bin/node" or env.get("exec_mode") != "fork_mode"
            or env.get("args") != ["start", "-p", "3000"] or env.get("node_args", []) != []
            or env.get("watch", False) is not False or env.get("cron_restart") not in (None, False, "0")
            or env.get("autorestart") is not True or env.get("kill_timeout") != 10000
            or (env.get("shutdown_with_message") is not None and env.get("shutdown_with_message") is not False)
            or env.get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0"
            or type(env.get("env")) is not dict or env["env"].get("FAOLLA_BACKGROUND_JOBS_PAUSED") != "0"
            or env["env"].get("RESEND_API_KEY") or env["env"].get("BOOKING_CONFIRMATION_EMAIL_FROM")):
        _fail("booking_pause_precondition")
    return result


class _Session(_control._Session):
    def call(self, method, argument, mutation=False):
        if ((method in ("getVersion", "getMonitorData") and (argument != {} or mutation))
                or (method == "restartProcessId" and (argument != _ARGUMENT or not mutation))
                or method not in ("getVersion", "getMonitorData", "restartProcessId")):
            _fail("booking_pause_method")
        self.verify()
        request_id = uuid.uuid4().hex + ":0"
        parts = [b"j:" + _control._json({"type": "call", "method": method, "args": [argument]}),
                 b"s:" + request_id.encode("ascii")]
        frame = b"\x12" + b"".join(struct.pack("!I", len(item)) + item for item in parts)
        _peer._timeout(self.connection, self.deadline)
        if mutation:
            if self.mutation_sent:
                _fail("booking_pause_outcome_unknown")
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


def _perform(session, expected, process):
    if session.call("getVersion", {}) != "6.0.14":
        _fail("booking_pause_version")
    rows = session.call("getMonitorData", {})
    if type(rows) is not list or len(rows) > 128:
        _fail()
    matched = [r for r in rows if type(r) is dict and
               (r.get("name") == "merchant-space" or r.get("pm_id") == 0 or r.get("pid") == 1590381)]
    if len(matched) != 1 or legacy_snapshot(matched[0]) != expected:
        _fail("booking_pause_precondition")
    _control._check_target_process(process, session.expected)
    ack = session.call("restartProcessId", _ARGUMENT, mutation=True)
    if type(ack) not in (dict, list) or (type(ack) is dict and ack.get("error")):
        _fail()
    session.verify()
    # ACK is not a completed restart, health, drain or successful handoff. The
    # host separately verifies actual new /proc + full configured environments.
    return {"schemaVersion": 1, "kind": "booking-legacy-pause-rpc-ack", "acknowledged": True,
            "pm2Version": "6.0.14", "peerVerified": True}


def pause_legacy_booking(daemon, process, expected):
    session = None
    try:
        daemon = _peer._validate_expected(daemon)
        process = _peer._validate_expected(process)
        if (daemon["uid"] != 0 or daemon["executable"] != "/usr/bin/node"
                or process["pid"] != 1590381 or process["uid"] != 0
                or process["bootId"] != daemon["bootId"] or process["executable"] != daemon["executable"]
                or process["executableIdentity"] != daemon["executableIdentity"]
                or legacy_snapshot(expected) != expected):
            _fail("booking_pause_request")
        if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
            _fail("booking_pause_platform")
        deadline = time.monotonic() + 30.0
        chain = _peer._path_chain(_SOCKET, 0)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(_SOCKET)
            session = _Session(connection, daemon, _SOCKET, chain, deadline)
            return _perform(session, expected, process)
    except BaseException:
        if session is not None and session.mutation_sent:
            raise BookingPauseError("booking_pause_outcome_unknown") from None
        raise BookingPauseError("booking_pause_unverified") from None


def main():
    try:
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144:
            _fail()
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_peer._unique_object,
                             parse_constant=lambda _: _fail())
        if type(payload) is not dict or set(payload) != {"daemon", "process", "expected"}:
            _fail()
        result = pause_legacy_booking(payload["daemon"], payload["process"], payload["expected"])
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    except BaseException:
        sys.stderr.write("booking_pause_unconfirmed\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
