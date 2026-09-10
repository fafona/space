"""Bounded, connect-only PM2 6.0.14 transport, not maintenance authority.

Python 3.6+ standard library. The caller owns the durable operation/launch slot,
must persist attempted BEFORE calling a mutation, and must never replay unknown.
Only getVersion/getMonitorData/stopProcessId/deleteProcessId/prepare are used.
There is NO daemon launch, CLI, reconnect, retry, save RPC, or server-side CAS.
PM2 exposes no conditional mutation: the pre-read is NOT an atomic compare/swap.
ACK + registry is not health, drain, successful publication, or /proc termination.
The caller freezes trusted paths/configuration and independently checks descendants,
launch nonce in /proc, and final identities. Monitor hides PM2's _old_ entries.
Raw PM2 environments and ACK objects never leave this module.

Reviewed fixed upstream implementation:
https://github.com/Unitech/pm2/blob/v6.0.14/lib/God/ActionMethods.js
https://github.com/Unitech/pm2/blob/v6.0.14/lib/God.js
https://github.com/Unitech/pm2/blob/v6.0.14/lib/God/ForkMode.js
"""

import hashlib
import importlib.util
import json
import os
import posixpath
import re
import socket
import struct
import sys
import time
import uuid


_spec = importlib.util.spec_from_file_location(
    "_faolla_pm2_control_peer", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "production-maintenance-pm2-connection.py"))
_peer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_peer)

MAX_FRAME_BYTES = 1048576
MAX_REQUEST_BYTES = 65536
MAX_OUTPUT_BYTES = 524288
MAX_REGISTRY_ENTRIES = 128
_ENV_KEYS = frozenset((
    "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MERCHANT_STAFF_BUSINESS_RBAC_MODE", "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS",
    "FAOLLA_CANONICAL_PORTAL_ORIGIN", "FAOLLA_BACKGROUND_JOBS_PAUSED", "PORT",
    "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"))
_META_KEYS = frozenset((
    "name", "pm_id", "status", "created_at", "pm_uptime", "restart_time", "pm_cwd",
    "pm_exec_path", "args", "node_args", "exec_mode", "exec_interpreter", "watch",
    "cron_restart", "autorestart", "FAOLLA_BACKGROUND_JOBS_PAUSED", "nonce", "envDigest"))
_NONCE = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
_DIGEST = re.compile(r"[a-f0-9]{64}\Z")
_NAME = re.compile(r"[A-Za-z0-9._-]{1,150}\Z")
_STATUSES = frozenset(("online", "stopped", "stopping", "launching", "errored",
                       "one-launch-status", "waiting restart"))


class PM2ControlError(Exception):
    """Fixed safe code; any possibly sent mutation fails as outcome_unknown."""


def _fail(code="pm2_control_unverified"):
    raise PM2ControlError(code)


def _integer(value, low=0, high=9007199254740991):
    return type(value) is int and low <= value <= high


def _text(value, maximum=4096, empty=False):
    return (type(value) is str and (empty or bool(value)) and len(value) <= maximum
            and not any(c in value for c in ("\0", "\r", "\n")))


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _plain(value, depth=0):
    # Reject subclasses before __iter__/properties/conversions can execute.
    if depth > 20:
        _fail("pm2_control_invalid_request")
    if value is None or type(value) in (str, int, bool):
        return
    if type(value) is list:
        if len(value) > MAX_REGISTRY_ENTRIES:
            _fail("pm2_control_invalid_request")
        for item in value:
            _plain(item, depth + 1)
    elif type(value) is dict:
        if len(value) > 64 or any(type(key) is not str for key in value):
            _fail("pm2_control_invalid_request")
        for item in value.values():
            _plain(item, depth + 1)
    else:
        _fail("pm2_control_invalid_request")


def _capture_request(value):
    _plain(value)
    if len(_json(value)) > MAX_REQUEST_BYTES:
        _fail("pm2_control_invalid_request")
    return json.loads(_json(value).decode("utf-8"))


def _parts(frame, maximum=MAX_FRAME_BYTES):
    if len(frame) > maximum or (frame and frame[0] != 0x12):
        _fail("pm2_control_protocol_invalid")
    if not frame:
        return None
    offset, result = 1, []
    for _ in range(2):
        if len(frame) < offset + 4:
            return None
        length = struct.unpack("!I", frame[offset:offset + 4])[0]
        offset += 4
        if length < 2 or offset + length > maximum:
            _fail("pm2_control_protocol_invalid")
        if len(frame) < offset + length:
            return None
        result.append(frame[offset:offset + length])
        offset += length
    if offset != len(frame):
        _fail("pm2_control_protocol_invalid")
    return result


def _encode(method, argument, request_id):
    if method not in ("getVersion", "getMonitorData", "stopProcessId", "deleteProcessId", "prepare"):
        _fail("pm2_control_invalid_request")
    if type(request_id) is not str or not re.fullmatch(r"[a-f0-9]{32}:0", request_id):
        _fail("pm2_control_invalid_request")
    if method in ("getVersion", "getMonitorData") and argument != {}:
        _fail("pm2_control_invalid_request")
    if method in ("stopProcessId", "deleteProcessId") and not _integer(argument, 0, 2147483647):
        _fail("pm2_control_invalid_request")
    parts = [b"j:" + _json({"type": "call", "method": method, "args": [argument]}),
             b"s:" + request_id.encode("ascii")]
    frame = b"\x12" + b"".join(struct.pack("!I", len(item)) + item for item in parts)
    if len(frame) > MAX_REQUEST_BYTES:
        _fail("pm2_control_invalid_request")
    return frame


def _decode(frame, request_id, maximum=MAX_FRAME_BYTES):
    parts = _parts(frame, maximum)
    if (parts is None or not parts[0].startswith(b"j:")
            or parts[1] != b"s:" + request_id.encode("ascii")):
        _fail("pm2_control_protocol_invalid")
    try:
        value = json.loads(parts[0][2:].decode("utf-8"), object_pairs_hook=_peer._unique_object,
                           parse_constant=lambda _: _fail("pm2_control_protocol_invalid"))
    except (ValueError, UnicodeError, RecursionError, _peer.PM2ConnectionError):
        _fail("pm2_control_protocol_invalid")
    # RPC errors, including stacks, are discarded without returning their text.
    if not _exact(value, ("args",)) or type(value["args"]) is not list or len(value["args"]) != 1:
        _fail("pm2_control_protocol_invalid")
    return value["args"][0]


def _argument_list(value):
    if value in (None, ""):
        return []
    if type(value) is not list or len(value) > 16 or not all(_text(item) for item in value):
        _fail("pm2_control_registry_invalid")
    return list(value)


def _filter_entry(value):
    if type(value) is not dict or type(value.get("pm2_env")) is not dict:
        _fail("pm2_control_registry_invalid")
    env = value["pm2_env"]
    if (not _integer(value.get("pm_id"), 0, 2147483647)
            or not _integer(value.get("pid"), 0, 2147483647)
            or type(value.get("name")) is not str or not _NAME.fullmatch(value["name"])
            or env.get("name") != value["name"] or env.get("pm_id") != value["pm_id"]
            or type(env.get("pm_id")) is not int or env.get("status") not in _STATUSES
            or any(not _integer(env.get(key), 1) for key in ("created_at", "pm_uptime"))
            or not _integer(env.get("restart_time"), 0, 2147483647)
            or not _peer._absolute(env.get("pm_cwd")) or not _peer._absolute(env.get("pm_exec_path"))
            or not _text(env.get("exec_mode"), 40) or not _text(env.get("exec_interpreter"), 4096)):
        _fail("pm2_control_registry_invalid")
    watch = env.get("watch", False)
    if watch not in (None, False) or (watch is not None and type(watch) is not bool):
        # Do not expose arbitrary watch paths, and never control watched apps.
        _fail("pm2_control_registry_invalid")
    cron = env.get("cron_restart")
    if cron is not None and cron is not False and cron != "":
        _fail("pm2_control_registry_invalid")
    autorestart = env.get("autorestart", True)
    if type(autorestart) is not bool:
        _fail("pm2_control_registry_invalid")
    nonce = env.get("FAOLLA_MAINTENANCE_LAUNCH_NONCE")
    if nonce is not None and (type(nonce) is not str or not _NONCE.fullmatch(nonce)):
        _fail("pm2_control_registry_invalid")
    pause = env.get("FAOLLA_BACKGROUND_JOBS_PAUSED")
    if pause is not None and (type(pause) is not str or pause not in ("0", "1")):
        _fail("pm2_control_registry_invalid")
    digest = None
    if all(key in env for key in _ENV_KEYS):
        selected = {key: env[key] for key in _ENV_KEYS}
        if not all(_text(item, 8192, empty=True) for item in selected.values()):
            _fail("pm2_control_registry_invalid")
        digest = hashlib.sha256(_json(selected)).hexdigest()
    metadata = {key: env[key] for key in ("name", "pm_id", "status", "created_at", "pm_uptime",
                "restart_time", "pm_cwd", "pm_exec_path", "exec_mode", "exec_interpreter")}
    metadata.update({"args": _argument_list(env.get("args")), "node_args": _argument_list(env.get("node_args")),
                     "watch": False, "cron_restart": None, "autorestart": autorestart,
                     "FAOLLA_BACKGROUND_JOBS_PAUSED": pause, "nonce": nonce, "envDigest": digest})
    return {"name": value["name"], "pid": value["pid"], "pm_id": value["pm_id"], "pm2_env": metadata}


def _filter_registry(value):
    if type(value) is not list or len(value) > MAX_REGISTRY_ENTRIES:
        _fail("pm2_control_registry_invalid")
    result = [_filter_entry(item) for item in value]
    if (len(set(item["pm_id"] for item in result)) != len(result)
            or len(set(item["name"] for item in result)) != len(result)
            or len(_json(result)) > MAX_OUTPUT_BYTES):
        _fail("pm2_control_registry_invalid")
    return sorted(result, key=lambda item: item["pm_id"])


def _validate_filtered(value):
    if not _exact(value, ("name", "pid", "pm_id", "pm2_env")) or not _exact(value["pm2_env"], _META_KEYS):
        _fail("pm2_control_invalid_request")
    # Filtering a captured entry is intentionally idempotent, except its two
    # independently derived fields whose values are checked explicitly below.
    copy = _capture_request(value)
    metadata = copy["pm2_env"]
    nonce, digest = metadata.pop("nonce"), metadata.pop("envDigest")
    if nonce is not None and (type(nonce) is not str or not _NONCE.fullmatch(nonce)):
        _fail("pm2_control_invalid_request")
    if digest is not None and (type(digest) is not str or not _DIGEST.fullmatch(digest)):
        _fail("pm2_control_invalid_request")
    result = _filter_entry(copy)
    result["pm2_env"].update({"nonce": nonce, "envDigest": digest})
    if result != value:
        _fail("pm2_control_invalid_request")
    return result


def _prepare_config(launch, socket_path, daemon):
    if not _exact(launch, ("role", "appName", "appPort", "release", "node", "nonce", "envDigest", "env")):
        _fail("pm2_control_invalid_request")
    role, release, environment = launch["role"], launch["release"], launch["env"]
    if (role not in ("candidate-web", "final-web", "final-worker")
            or type(launch["appName"]) is not str or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", launch["appName"])
            or not _integer(launch["appPort"], 1, 65535) or not _peer._absolute(release)
            or not re.fullmatch(r"[a-f0-9]{12}-[0-9]{14}", posixpath.basename(release))
            or not posixpath.dirname(release).endswith(".releases")
            or launch["node"] != daemon["executable"]
            or type(launch["nonce"]) is not str or not _NONCE.fullmatch(launch["nonce"])
            or not _exact(environment, _ENV_KEYS)
            or not all(_text(item, 8192, empty=True) for item in environment.values())
            or hashlib.sha256(_json(environment)).hexdigest() != launch["envDigest"]):
        _fail("pm2_control_invalid_request")
    paused = "1" if role == "candidate-web" else "0"
    if (environment["FAOLLA_BACKGROUND_JOBS_PAUSED"] != paused
            or environment["PORT"] != str(launch["appPort"])
            or environment["MERCHANT_STAFF_BUSINESS_RBAC_MODE"] not in ("off", "enforce")
            or any(environment[key] not in ("true", "false") for key in (
                "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"))
            or not environment["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
            or any(not environment[key] for key in ("SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL"))):
        _fail("pm2_control_invalid_request")
    name = launch["appName"] + ("-enterprise-automation-worker" if role == "final-worker" else "")
    worker = role == "final-worker"
    home = posixpath.dirname(socket_path)
    fixed_env = dict(environment, NODE_ENV="production", PATH="/usr/bin:/bin", LANG="C", LC_ALL="C",
                     FAOLLA_MAINTENANCE_LAUNCH_NONCE=launch["nonce"])
    config = {"name": name, "namespace": "default", "pm_cwd": release,
              "pm_exec_path": release + ("/node_modules/tsx/dist/cli.mjs" if worker else "/node_modules/next/dist/bin/next"),
              "args": [release + "/scripts/run-merchant-enterprise-automation-worker.ts"] if worker else ["start", "-p", str(launch["appPort"])],
              "node_args": [], "exec_interpreter": launch["node"], "exec_mode": "fork_mode",
              "env": fixed_env, "autostart": True, "autorestart": role != "candidate-web",
              "watch": False, "cron_restart": None, "vizion": False,
              "kill_timeout": 30000 if worker else 10000, "wait_ready": worker,
              "listen_timeout": 20000 if worker else 8000, "restart_delay": 5000 if worker else 0,
              "pm_pid_path": home + "/pids/" + name + ".pid",
              "pm_out_log_path": home + "/logs/" + name + "-out.log",
              "pm_err_log_path": home + "/logs/" + name + "-error.log", "merge_logs": False}
    return config


def _validate_request(request, socket_path, daemon):
    request = _capture_request(request)
    if type(request) is not dict:
        _fail("pm2_control_invalid_request")
    if request.get("action") == "prepare" and _exact(request, ("action", "launch")):
        return request, _prepare_config(request["launch"], socket_path, daemon)
    if request.get("action") not in ("stop", "delete") or not _exact(request, ("action", "expected", "expectedProcess")):
        _fail("pm2_control_invalid_request")
    expected = _validate_filtered(request["expected"])
    metadata = expected["pm2_env"]
    if metadata["status"] not in ("online", "stopped") or metadata["exec_mode"] != "fork_mode" or metadata["node_args"] != []:
        _fail("pm2_control_invalid_request")
    if expected["pid"] == 0:
        if metadata["status"] != "stopped" or request["expectedProcess"] is not None:
            _fail("pm2_control_invalid_request")
    else:
        target = _peer._validate_expected(request["expectedProcess"])
        if (metadata["status"] != "online" or target["pid"] != expected["pid"]
                or target["pid"] == daemon["pid"] or target["uid"] != daemon["uid"]
                or target["bootId"] != daemon["bootId"] or target["executable"] != daemon["executable"]
                or target["executableIdentity"] != daemon["executableIdentity"]):
            _fail("pm2_control_invalid_request")
    return request, expected["pm_id"]


class _Session:
    def __init__(self, connection, expected, path, path_proof, deadline):
        self.connection, self.expected, self.path = connection, expected, path
        self.path_proof, self.deadline, self.mutation_sent = path_proof, deadline, False

    def verify(self):
        _peer._timeout(self.connection, self.deadline)
        _peer._verify_peer(self.connection, self.expected)
        if _peer._path_chain(self.path, self.expected["uid"]) != self.path_proof:
            _fail()
        _peer._reject_unsolicited(self.connection)
        _peer._timeout(self.connection, self.deadline)

    def call(self, method, argument, mutation=False):
        self.verify()
        request_id = uuid.uuid4().hex + ":0"
        frame = _encode(method, argument, request_id)
        _peer._timeout(self.connection, self.deadline)
        # sendall can partially send before throwing. Unknown starts BEFORE it.
        if mutation:
            if self.mutation_sent:
                _fail("pm2_control_outcome_unknown")
            self.mutation_sent = True
        self.connection.sendall(frame)
        maximum = 8192 if method == "getVersion" else MAX_FRAME_BYTES
        response = b""
        while _parts(response, maximum) is None:
            _peer._timeout(self.connection, self.deadline)
            chunk = self.connection.recv(min(65536, maximum + 1 - len(response)))
            if not chunk:
                _fail("pm2_control_protocol_invalid")
            response += chunk
        result = _decode(response, request_id, maximum)
        self.verify()
        return result


def _check_target_process(expected, daemon):
    if expected is None:
        return
    if _peer._read_daemon_identity(expected["pid"]) != expected:
        _fail("pm2_control_precondition_failed")
    data = _peer._bounded_read("/proc/" + str(expected["pid"]) + "/stat", 16384)
    fields = data[data.rfind(b")") + 2:].split()
    if (len(fields) < 20 or fields[1] != str(daemon["pid"]).encode("ascii")
            or _peer._read_daemon_identity(expected["pid"]) != expected):
        _fail("pm2_control_precondition_failed")


def _select(registry, expected):
    matches = [item for item in registry if item["pm_id"] == expected["pm_id"] or item["name"] == expected["name"]]
    if len(matches) != 1 or matches[0] != expected:
        _fail("pm2_control_precondition_failed")


def _perform(session, request, argument):
    if session.call("getVersion", {}) != "6.0.14":
        _fail("pm2_control_version_unsupported")
    before = _filter_registry(session.call("getMonitorData", {}))
    if request is None:
        return {"version": 1, "pm2Version": "6.0.14", "peerVerified": True, "registry": before}
    action = request["action"]
    if action == "prepare":
        if any(item["name"] == argument["name"] or item["pm2_env"]["nonce"] == request["launch"]["nonce"] for item in before):
            _fail("pm2_control_precondition_failed")
        method = "prepare"
    else:
        _select(before, request["expected"])
        _check_target_process(request["expectedProcess"], session.expected)
        method = "stopProcessId" if action == "stop" else "deleteProcessId"
    acknowledgement = session.call(method, argument, mutation=True)
    # Do not return arbitrary ACKs (prepare's actual return is an array of
    # internal clusters, not formatted monitor entries). Success still requires
    # a fresh registry and operation-specific postconditions.
    if action == "prepare":
        if (type(acknowledgement) is not list or len(acknowledgement) != 1
                or type(acknowledgement[0]) is not dict or acknowledgement[0].get("error")):
            _fail()
        raw = acknowledgement[0]
        if type(raw.get("process")) is not dict or type(raw.get("pm2_env")) is not dict:
            _fail()
        ack = _filter_entry({"pid": raw["process"].get("pid"), "name": raw["pm2_env"].get("name"),
                             "pm_id": raw["pm2_env"].get("pm_id"), "pm2_env": raw["pm2_env"]})
    else:
        if type(acknowledgement) is not dict or "error" in acknowledgement:
            _fail()
        ack = _filter_entry(acknowledgement)
        wanted = request["expected"]
        stable = {key: value for key, value in wanted["pm2_env"].items() if key != "status"}
        if (ack["pid"] != 0 or ack["name"] != wanted["name"] or ack["pm_id"] != wanted["pm_id"]
                or ack["pm2_env"]["status"] != "stopped"
                or {key: value for key, value in ack["pm2_env"].items() if key != "status"} != stable):
            _fail()
    after = _filter_registry(session.call("getMonitorData", {}))
    if action == "delete":
        if any(item["pm_id"] == ack["pm_id"] or item["name"] == ack["name"] for item in after):
            _fail()
    else:
        _select(after, ack)
    if action == "prepare":
        meta = ack["pm2_env"]
        if (ack["pid"] <= 0 or ack["name"] != argument["name"] or meta["status"] != "online"
                or meta["restart_time"] != 0 or meta["nonce"] != request["launch"]["nonce"]
                or meta["envDigest"] != request["launch"]["envDigest"]
                or any(meta[key] != argument[key] for key in ("pm_cwd", "pm_exec_path", "args", "node_args",
                    "exec_mode", "exec_interpreter", "watch", "cron_restart", "autorestart"))):
            _fail()
    # Other managed entries must not change or disappear as a side effect.
    old_others = [item for item in before if action == "prepare" or item["pm_id"] != request["expected"]["pm_id"]]
    new_others = [item for item in after if item["pm_id"] != ack["pm_id"]]
    if old_others != new_others:
        _fail()
    session.verify()
    return {"version": 1, "pm2Version": "6.0.14", "peerVerified": True,
            "registry": after, "acknowledged": True}


def _run(socket_path, expected_daemon, request, timeout_ms):
    session = None
    try:
        expected = _peer._validate_expected(_capture_request(expected_daemon))
        if (not _integer(timeout_ms, 1, 45000) or not _peer._absolute(socket_path)
                or posixpath.basename(socket_path) != "rpc.sock"):
            _fail("pm2_control_invalid_request")
        argument = None
        if request is not None:
            request, argument = _validate_request(request, socket_path, expected)
        if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
            _fail("pm2_control_platform_unsupported")
        deadline = time.monotonic() + timeout_ms / 1000.0
        path_proof = _peer._path_chain(socket_path, expected["uid"])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(socket_path)
            session = _Session(connection, expected, socket_path, path_proof, deadline)
            return _perform(session, request, argument)
    except Exception as error:
        if session is not None and session.mutation_sent:
            raise PM2ControlError("pm2_control_outcome_unknown") from None
        if type(error) is PM2ControlError:
            raise
        if isinstance(error, (socket.timeout, TimeoutError)):
            raise PM2ControlError("pm2_control_timeout") from None
        raise PM2ControlError("pm2_control_unverified") from None


def inspect_pm2_registry(socket_path, expected_daemon, *, timeout_ms=5000):
    """Read a filtered registry after authenticating this connection/version."""
    return _run(socket_path, expected_daemon, None, timeout_ms)


def control_pm2_process(socket_path, expected_daemon, request, *, timeout_ms=35000):
    """Send at most ONE mutation; unknown is terminal and MUST NOT be replayed."""
    if request is None:
        _fail("pm2_control_invalid_request")
    return _run(socket_path, expected_daemon, request, timeout_ms)
