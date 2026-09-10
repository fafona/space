"""Private PM2 6.0.14 dump persistence; no CLI, save RPC, retry or resurrection.

Only fixed dump.pm2/dump.pm2.bak beneath the independently frozen socket home.
The caller must hold its durable operation lock, freeze the final healthy full
registry, and keep ingress closed until save AND verification succeed. Raw
environments stay private here. A saved receipt is not health/drain authority.
One file replacement is atomic; the two-file sequence and external PM2 writers
are NOT a transaction/CAS. Failure after replacement begins is unknown, never
an invitation to retry/restore an older dump or open ingress.

Dump content follows https://github.com/Unitech/pm2/blob/v6.0.14/lib/API/Startup.js
lines 476-485: preserve all non-module pm2_env objects, remove only instances,
pm_id and prev_restart_delay. Unlike the CLI, backup failures do not get ignored.
Current-vs-saved comparisons cover restart configuration, not unchanged runtime
telemetry: God.js lines 163-172 resets exactly four top-level axm_* fields on
executeApp. Only those fields are excluded from that comparison. They remain in
the saved bytes and exact file hash; nested env fields are never excluded.
Python 3.6+ / Linux standard library. No import-time filesystem mutation or CLI.
"""

import hashlib
import importlib.util
import json
import os
import posixpath
import socket
import stat
import sys
import time
import uuid


_spec = importlib.util.spec_from_file_location(
    "_faolla_pm2_dump_control", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "production-maintenance-pm2-control.py"))
_control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_control)
_peer = _control._peer
MAX_DUMP_BYTES = 2097152
_FILES = ("dump.pm2", "dump.pm2.bak")
_RESET_ON_EXECUTE = frozenset(("axm_actions", "axm_monitor", "axm_options", "axm_dynamic"))


class PM2DumpError(Exception):
    """Fixed safe error. Raw environment, filename contents and exceptions stay private."""


def _fail(code="pm2_dump_unverified"):
    raise PM2DumpError(code)


def _digest(value):
    return hashlib.sha256(value).hexdigest()


def _copy(value):
    _control._plain(value)
    if len(_control._json(value)) > _control.MAX_OUTPUT_BYTES:
        _fail("pm2_dump_invalid_request")
    return json.loads(_control._json(value).decode("utf-8"))


def _registry(value):
    value = _copy(value)
    if type(value) is not list or not value or len(value) > _control.MAX_REGISTRY_ENTRIES:
        _fail("pm2_dump_invalid_request")
    result = [_control._validate_filtered(item) for item in value]
    if (len(set(item["pm_id"] for item in result)) != len(result)
            or len(set(item["name"] for item in result)) != len(result)):
        _fail("pm2_dump_invalid_request")
    return sorted(result, key=lambda item: item["pm_id"])


def _valid_file(value):
    return value is None or (_control._exact(value, ("identity", "sha256"))
        and type(value["identity"]) is str and _control.re.fullmatch(r"[0-9]{1,25}(?::[0-9]{1,25}){7}", value["identity"])
        and type(value["sha256"]) is str and _control._DIGEST.fullmatch(value["sha256"]))


def _target(value, path, daemon):
    value = _copy(value)
    if (not _control._exact(value, ("version", "socketPath", "daemon", "chain", "dump", "backup"))
            or type(value["version"]) is not int or value["version"] != 1
            or value["socketPath"] != path or value["daemon"] != daemon
            or type(value["chain"]) is not list or not 2 <= len(value["chain"]) <= 128
            or any(type(row) is not list or len(row) != 5
                   or any(type(item) is not str or not _control.re.fullmatch(r"0|[1-9][0-9]{0,24}", item)
                          for item in row) for row in value["chain"])
            or not _valid_file(value["dump"]) or not _valid_file(value["backup"])):
        _fail("pm2_dump_invalid_request")
    if _peer._validate_expected(value["daemon"]) != daemon:
        _fail("pm2_dump_invalid_request")
    return value


def _read_file(directory, name, uid):
    if name not in _FILES and not _control.re.fullmatch(r"\.faolla-maintenance-dump-[a-f0-9]{32}\.tmp", name):
        _fail()
    try:
        before = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None, None
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != uid
            or before.st_mode & 0o022 or before.st_size > MAX_DUMP_BYTES):
        _fail()
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        identity = _peer._file_identity(before)
        if identity != _peer._file_identity(os.fstat(descriptor)):
            _fail()
        chunks, size = [], 0
        while True:
            data = os.read(descriptor, min(65536, MAX_DUMP_BYTES + 1 - size))
            if not data:
                break
            size += len(data)
            if size > MAX_DUMP_BYTES:
                _fail()
            chunks.append(data)
        if (identity != _peer._file_identity(os.fstat(descriptor))
                or identity != _peer._file_identity(os.stat(name, dir_fd=directory, follow_symlinks=False))
                or size != before.st_size):
            _fail()
        content = b"".join(chunks)
        return {"identity": identity, "sha256": _digest(content)}, content
    finally:
        os.close(descriptor)


def _read_target(session, directory):
    session.verify()
    # Holding a directory FD is not permission to write an unlinked/replaced home.
    home = posixpath.dirname(session.path)
    actual = os.stat(home, follow_symlinks=False)
    opened = os.fstat(directory)
    stable = lambda item: (item.st_dev, item.st_ino, item.st_mode, item.st_uid, item.st_gid)
    if stable(actual) != stable(opened) or not stat.S_ISDIR(opened.st_mode):
        _fail()
    primary, content = _read_file(directory, "dump.pm2", session.expected["uid"])
    backup, _ = _read_file(directory, "dump.pm2.bak", session.expected["uid"])
    session.verify()
    return {"version": 1, "socketPath": session.path, "daemon": dict(session.expected),
            "chain": [[str(field) for field in item] for item in session.path_proof], "dump": primary, "backup": backup}, content


def _js_truthy(value):
    if value is None or value is False:
        return False
    if type(value) in (int, float):
        return value != 0
    return value != "" if type(value) is str else True


def _dump_content(raw):
    # Validate the entire registry first: an unsupported record fails closed,
    # never silently drops an unrelated application from the saved list.
    _control._filter_registry(raw)
    result = []
    for record in raw:
        if _js_truthy(record["pm2_env"].get("pmx_module")):
            continue
        result.append({key: value for key, value in record["pm2_env"].items()
                       if key not in ("instances", "pm_id", "prev_restart_delay")})
    if not result:
        _fail("pm2_dump_empty_registry")
    content = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode("utf-8")
    if len(content) > MAX_DUMP_BYTES:
        _fail()
    return content, len(result)


def _assert_registry(raw, expected):
    if _control._filter_registry(raw) != expected:
        _fail("pm2_dump_registry_changed")


def _assert_dump_content(raw, expected_content, expected_count):
    content, count = _dump_content(raw)
    # https://github.com/Unitech/pm2/blob/v6.0.14/lib/God.js#L163-L172
    # Do not recursively filter: env.axm_monitor is still launch configuration.
    # The raw saved file is independently bound by exact bytes/identity/hash.
    def restart_configuration(value):
        rows = json.loads(value.decode("utf-8"))
        if type(rows) is not list or any(type(row) is not dict for row in rows):
            _fail()
        return _control._json([{key: item for key, item in row.items()
                                if key not in _RESET_ON_EXECUTE} for row in rows])
    if (count != expected_count
            or restart_configuration(content) != restart_configuration(expected_content)):
        _fail("pm2_dump_registry_changed")


def _stage(directory, data, owned):
    name = ".faolla-maintenance-dump-" + uuid.uuid4().hex + ".tmp"
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
    # Record the exact created inode immediately; never unlink a replacement.
    owned[name] = (os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino)
    try:
        offset = 0
        while offset < len(data):
            count = os.write(descriptor, data[offset:offset + 65536])
            if count <= 0:
                _fail()
            offset += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return name


def _cleanup(directory, owned):
    failed = False
    for name, identity in owned.items():
        try:
            current = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != identity or not stat.S_ISREG(current.st_mode) or current.st_nlink != 1:
                failed = True
                continue
            os.unlink(name, dir_fd=directory)
        except FileNotFoundError:
            continue
        except OSError:
            failed = True
    if failed:
        _fail()


def _assert_renamed(actual, planned):
    fields = actual["identity"].split(":") if actual else []
    previous = planned["identity"].split(":")
    if (len(fields) != 8 or any(fields[index] != previous[index] for index in (0, 1, 2, 3, 5, 6, 7))
            or actual["sha256"] != planned["sha256"]):
        _fail()


def _persist(session, directory, expected, target, operation):
    observed, original = _read_target(session, directory)
    if observed != target:
        _fail("pm2_dump_target_changed")
    raw = session.call("getMonitorData", {})
    _assert_registry(raw, expected)
    content, count = _dump_content(raw)
    owned = {}
    try:
        primary_name = _stage(directory, content, owned)
        backup_name = _stage(directory, original, owned) if original is not None else None
        # Read the exact staged bytes through the same strict reader.
        primary_proof, primary_bytes = _read_file(directory, primary_name, session.expected["uid"])
        if primary_bytes != content:
            _fail()
        backup_proof = None
        if backup_name is not None:
            backup_proof, backup_bytes = _read_file(directory, backup_name, session.expected["uid"])
            if backup_bytes != original:
                _fail()
        if _read_target(session, directory)[0] != target:
            _fail("pm2_dump_target_changed")
        current = session.call("getMonitorData", {})
        _assert_registry(current, expected)
        _assert_dump_content(current, content, count)
        session.verify()
        # There is deliberately no retry or rollback of a completed replace.
        operation["replacementStarted"] = True
        if backup_name is not None:
            os.replace(backup_name, "dump.pm2.bak", src_dir_fd=directory, dst_dir_fd=directory)
            del owned[backup_name]
            os.fsync(directory)
            actual, _ = _read_target(session, directory)
            _assert_renamed(actual["backup"], backup_proof)
            backup_proof = actual["backup"]
            if actual != dict(target, backup=backup_proof):
                _fail()
        os.replace(primary_name, "dump.pm2", src_dir_fd=directory, dst_dir_fd=directory)
        del owned[primary_name]
        os.fsync(directory)
        actual, saved = _read_target(session, directory)
        wanted = dict(target, dump=primary_proof, backup=backup_proof if backup_name else target["backup"])
        # rename changes ctime on some filesystems. Require the created inode,
        # bytes, mode and ownership, then freeze the ACTUAL post-rename identity.
        for key in ("dump", "backup"):
            if key == "backup" and backup_name is None:
                if actual[key] != wanted[key]:
                    _fail()
                continue
            _assert_renamed(actual[key], wanted[key])
        if saved != content:
            _fail()
        current = session.call("getMonitorData", {})
        _assert_registry(current, expected)
        _assert_dump_content(current, content, count)
        session.verify()
        return {"version": 1, "pm2Version": "6.0.14", "peerVerified": True, "saved": True,
                "processCount": count, "registryHash": _digest(_control._json(expected)), "target": actual}
    finally:
        _cleanup(directory, owned)


def _receipt(value, path, daemon, registry):
    value = _copy(value)
    if (not _control._exact(value, ("version", "pm2Version", "peerVerified", "saved", "processCount", "registryHash", "target"))
            or type(value["version"]) is not int or value["version"] != 1 or value["pm2Version"] != "6.0.14"
            or value["peerVerified"] is not True or value["saved"] is not True
            or not _control._integer(value["processCount"], 1, _control.MAX_REGISTRY_ENTRIES)
            or value["registryHash"] != _digest(_control._json(registry))):
        _fail("pm2_dump_invalid_request")
    value["target"] = _target(value["target"], path, daemon)
    if value["target"]["dump"] is None:
        _fail("pm2_dump_invalid_request")
    return value


def _run(path, daemon, action, registry=None, proof=None, timeout_ms=15000):
    operation = {"replacementStarted": False}
    try:
        daemon = _peer._validate_expected(_copy(daemon))
        if (not _peer._absolute(path) or posixpath.basename(path) != "rpc.sock"
                or not _control._integer(timeout_ms, 1, 45000)):
            _fail("pm2_dump_invalid_request")
        if action != "capture":
            registry = _registry(registry)
            proof = _target(proof, path, daemon) if action == "persist" else _receipt(proof, path, daemon, registry)
        if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
            _fail("pm2_dump_platform_unsupported")
        deadline = time.monotonic() + timeout_ms / 1000.0
        chain = _peer._path_chain(path, daemon["uid"])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(path)
            session = _control._Session(connection, daemon, path, chain, deadline)
            if session.call("getVersion", {}) != "6.0.14":
                _fail("pm2_dump_version_unsupported")
            descriptor = os.open(posixpath.dirname(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                if action == "capture":
                    return _read_target(session, descriptor)[0]
                if action == "persist":
                    return _persist(session, descriptor, registry, proof, operation)
                actual, saved = _read_target(session, descriptor)
                if actual != proof["target"]:
                    _fail("pm2_dump_target_changed")
                current = session.call("getMonitorData", {})
                _assert_registry(current, registry)
                _assert_dump_content(current, saved, proof["processCount"])
                if _read_target(session, descriptor)[0] != proof["target"]:
                    _fail("pm2_dump_target_changed")
                session.verify()
                return True
            finally:
                os.close(descriptor)
    except Exception as error:
        if operation["replacementStarted"]:
            raise PM2DumpError("pm2_dump_outcome_unknown") from None
        if type(error) is PM2DumpError:
            raise
        raise PM2DumpError("pm2_dump_unverified") from None


def capture_pm2_dump_target(socket_path, daemon, *, timeout_ms=15000):
    """Read-only freeze of the private fixed directory/files, after peer binding."""
    return _run(socket_path, daemon, "capture", timeout_ms=timeout_ms)


def persist_pm2_dump(socket_path, daemon, expected_registry, target_proof, *, timeout_ms=15000):
    """One bounded save attempt. Any possibly started replace is unknown on failure."""
    return _run(socket_path, daemon, "persist", expected_registry, target_proof, timeout_ms)


def verify_pm2_dump(socket_path, daemon, expected_registry, receipt, *, timeout_ms=15000):
    """Exact persisted identity/hash, instance registry and restart configuration."""
    return _run(socket_path, daemon, "verify", expected_registry, receipt, timeout_ms)
