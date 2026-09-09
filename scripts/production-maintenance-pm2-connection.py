"""Connect-only PM2 getVersion capability probe; NOT maintenance authorization.

Linux standard library only. No CLI, daemon launch, reconnect, retry, mutation,
PM2 directory writes, monitor request, or import-time I/O. The caller must supply
an independently frozen daemon identity and trusted socket path. No raw response
or process/environment data is returned or included in an exception.

Protocol references (reviewed 2026-09-09; NOT a production version allowlist):
https://github.com/Unitech/pm2-axon-rpc/blob/master/lib/client.js
https://github.com/Unitech/pm2-axon/blob/master/lib/sockets/req.js
https://github.com/tj/node-amp/blob/master/lib/encode.js
https://github.com/tj/node-amp-message/blob/master/index.js
https://github.com/Unitech/pm2/blob/master/lib/God/ActionMethods.js
AMP v1 has a version/count byte, then uint32-BE length-prefixed arguments.
The fixed RPC object is the j: argument; the s: argument is a correlation ID.
"""

import json
import os
import posixpath
import re
import select
import socket
import stat
import struct
import sys
import time
import uuid


MAX_FRAME_BYTES = 8192
_IDENTITY_KEYS = {"pid", "uid", "startTicks", "bootId", "executable", "executableIdentity"}
_UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
_ID = re.compile(r"[a-f0-9]{32}:0\Z")
_SEMVER = re.compile(
    r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\Z"
)


class PM2ConnectionError(Exception):
    """Fixed safe failure; never contains response bytes or filesystem details."""


def _fail(code="pm2_connection_unverified"):
    raise PM2ConnectionError(code)


def _absolute(value):
    return (type(value) is str and value.startswith("/") and value != "/"
            and len(value) <= 4096 and posixpath.normpath(value) == value
            and not any(c in value for c in ("\0", "\r", "\n")))


def _validate_expected(value):
    if type(value) is not dict or set(value) != _IDENTITY_KEYS:
        _fail("pm2_connection_invalid_request")
    if (type(value["pid"]) is not int or not 1 <= value["pid"] <= 2147483647
            or type(value["uid"]) is not int or not 0 <= value["uid"] <= 4294967295
            or type(value["startTicks"]) is not str
            or not re.fullmatch(r"[1-9][0-9]{0,24}", value["startTicks"])
            or type(value["bootId"]) is not str or not _UUID.fullmatch(value["bootId"])
            or not _absolute(value["executable"])
            or type(value["executableIdentity"]) is not str
            or not re.fullmatch(r"[0-9]{1,25}(?::[0-9]{1,25}){7}", value["executableIdentity"])):
        _fail("pm2_connection_invalid_request")
    return dict(value)


def _version(value):
    match = _SEMVER.fullmatch(value) if type(value) is str and len(value) <= 128 else None
    if not match or (match.group(4) and any(
            part.isdigit() and len(part) > 1 and part.startswith("0")
            for part in match.group(4).split("."))):
        _fail("pm2_connection_protocol_invalid")
    return value


def _encode_get_version(request_id):
    if type(request_id) is not str or not _ID.fullmatch(request_id):
        _fail("pm2_connection_invalid_request")
    parts = [b'j:{"type":"call","method":"getVersion","args":[{}]}',
             b"s:" + request_id.encode("ascii")]
    return b"\x12" + b"".join(struct.pack("!I", len(part)) + part for part in parts)


def _parts(frame):
    """Return exactly two complete AMP parts, or None for an incomplete frame."""
    if len(frame) > MAX_FRAME_BYTES or (frame and frame[0] != 0x12):
        _fail("pm2_connection_protocol_invalid")
    if not frame:
        return None
    offset, parts = 1, []
    for _ in range(2):
        if len(frame) < offset + 4:
            return None
        size = struct.unpack("!I", frame[offset:offset + 4])[0]
        offset += 4
        if size < 2 or offset + size > MAX_FRAME_BYTES:
            _fail("pm2_connection_protocol_invalid")
        if len(frame) < offset + size:
            return None
        parts.append(frame[offset:offset + size])
        offset += size
    if offset != len(frame):
        _fail("pm2_connection_protocol_invalid")
    return parts


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("pm2_connection_protocol_invalid")
        result[key] = value
    return result


def _decode_version(frame, request_id):
    parts = _parts(frame)
    if (parts is None or not parts[0].startswith(b"j:")
            or parts[1] != b"s:" + request_id.encode("ascii")):
        _fail("pm2_connection_protocol_invalid")
    try:
        body = json.loads(parts[0][2:].decode("utf-8"), object_pairs_hook=_unique_object,
                          parse_constant=lambda _: _fail("pm2_connection_protocol_invalid"))
    except (ValueError, UnicodeError, RecursionError):
        raise PM2ConnectionError("pm2_connection_protocol_invalid") from None
    if type(body) is not dict or set(body) != {"args"} or type(body["args"]) is not list or len(body["args"]) != 1:
        _fail("pm2_connection_protocol_invalid")
    return _version(body["args"][0])


def _bounded_read(path, maximum):
    with open(path, "rb") as handle:
        data = handle.read(maximum + 1)
    if len(data) > maximum:
        _fail()
    return data


def _file_identity(value):
    return ":".join(str(item) for item in (
        value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
        value.st_ctime_ns, value.st_nlink, value.st_uid, value.st_mode))


def _read_daemon_identity(pid):
    base = "/proc/" + str(pid)
    boot = _bounded_read("/proc/sys/kernel/random/boot_id", 64).decode("ascii").strip()
    before = _bounded_read(base + "/stat", 16384)
    status = _bounded_read(base + "/status", 65536).decode("ascii")
    uid_rows = re.findall(r"^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$", status, re.MULTILINE)
    executable = os.readlink(base + "/exe")
    identity = _file_identity(os.stat(base + "/exe"))
    def start_ticks(data):
        if not data.startswith((str(pid) + " (").encode("ascii")):
            _fail()
        fields = data[data.rfind(b")") + 2:].split()
        if len(fields) < 20 or not re.fullmatch(b"[1-9][0-9]{0,24}", fields[19]):
            _fail()
        return fields[19].decode("ascii")
    ticks = start_ticks(before)
    if (ticks != start_ticks(_bounded_read(base + "/stat", 16384))
            or executable != os.readlink(base + "/exe")
            or identity != _file_identity(os.stat(base + "/exe"))
            or boot != _bounded_read("/proc/sys/kernel/random/boot_id", 64).decode("ascii").strip()
            or len(uid_rows) != 1 or len(set(uid_rows[0])) != 1):
        _fail()
    return {"pid": pid, "uid": int(uid_rows[0][0]), "startTicks": ticks,
            "bootId": boot, "executable": executable, "executableIdentity": identity}


def _path_chain(path, uid):
    if not _absolute(path) or len(os.fsencode(path)) > 107 or os.path.realpath(path) != path:
        _fail("pm2_connection_invalid_request")
    components = path.split("/")[1:]
    current, proof = "/", []
    for index in range(len(components) + 1):
        metadata = os.lstat(current)
        final = index == len(components)
        if metadata.st_uid not in (0, uid) or stat.S_ISLNK(metadata.st_mode):
            _fail()
        if final:
            if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != uid or metadata.st_nlink != 1:
                _fail()
        elif not stat.S_ISDIR(metadata.st_mode):
            _fail()
        elif metadata.st_mode & 0o022:
            _fail()
        proof.append((metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid, metadata.st_gid))
        if not final:
            current = os.path.join(current, components[index])
    return tuple(proof)


def _verify_peer(connection, expected):
    credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("=iII"))
    pid, uid, _gid = struct.unpack("=iII", credentials)
    if pid != expected["pid"] or uid != expected["uid"]:
        _fail()
    if _read_daemon_identity(pid) != expected:
        _fail()


def _timeout(connection, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        _fail("pm2_connection_timeout")
    connection.settimeout(remaining)


def _reject_unsolicited(connection):
    if select.select([connection], [], [], 0)[0]:
        # Readability includes EOF: the bound peer must stay connected throughout the exchange.
        _fail("pm2_connection_protocol_invalid")


def inspect_pm2_connection(socket_path, expected_daemon, *, timeout_ms=3000):
    """Send one fixed getVersion on one authenticated connection, or fail closed.

    Input and return values are internal metadata, not a signed release proof.
    No PM2 version is treated as permission to issue any subsequent method.
    """
    expected = _validate_expected(expected_daemon)
    if type(timeout_ms) is not int or not 1 <= timeout_ms <= 5000:
        _fail("pm2_connection_invalid_request")
    if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
        _fail("pm2_connection_platform_unsupported")
    deadline = time.monotonic() + timeout_ms / 1000.0
    try:
        path_proof = _path_chain(socket_path, expected["uid"])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _timeout(connection, deadline)
            connection.connect(socket_path)
            # Kernel peer credentials precede /proc reads and every request byte.
            _verify_peer(connection, expected)
            if _path_chain(socket_path, expected["uid"]) != path_proof:
                _fail()
            _reject_unsolicited(connection)
            request_id = uuid.uuid4().hex + ":0"
            _timeout(connection, deadline)
            connection.sendall(_encode_get_version(request_id))
            frame = b""
            while _parts(frame) is None:
                _timeout(connection, deadline)
                data = connection.recv(MAX_FRAME_BYTES + 1 - len(frame))
                if not data:
                    _fail("pm2_connection_protocol_invalid")
                frame += data
            version = _decode_version(frame, request_id)
            _verify_peer(connection, expected)
            if _path_chain(socket_path, expected["uid"]) != path_proof:
                _fail()
            _reject_unsolicited(connection)
            _timeout(connection, deadline)
            return {"version": 1, "pm2Version": version, "peerVerified": True}
    except PM2ConnectionError:
        raise
    except (socket.timeout, TimeoutError):
        raise PM2ConnectionError("pm2_connection_timeout") from None
    except (OSError, ValueError, UnicodeError, struct.error, OverflowError):
        raise PM2ConnectionError("pm2_connection_unverified") from None
