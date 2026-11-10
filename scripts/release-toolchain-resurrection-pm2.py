"""PM2 6.0.14's absent stopped PID has a defined zero representation.
Adapt only that read schema before the unchanged validators and dump writer.
No daemon boot, process-control request, validator monkeypatch or retry.
"""
import importlib.util
import os
import posixpath
import socket
import sys
import time

_spec = importlib.util.spec_from_file_location('_original_dump', os.path.join(os.path.dirname(__file__), 'production-maintenance-pm2-dump.py'))
_dump = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_dump)
_control, _peer = _dump._control, _dump._peer


def project(rows):
    if type(rows) is not list or not 1 <= len(rows) <= 128:
        raise ValueError('pm2_resurrection_registry')
    projected = []
    for row in rows:
        if type(row) is not dict or type(row.get('pm2_env')) is not dict:
            raise ValueError('pm2_resurrection_entry')
        # Never replace null, a negative/invalid PID, an online PID, or a
        # getter. JSON objects have own scalar fields; absence alone adapts.
        if 'pid' not in row and row['pm2_env'].get('status') == 'stopped':
            row = dict(row, pid=0)
        projected.append(row)
    _control._filter_registry(projected)
    return projected


class ObservedSession:
    def __init__(self, inner):
        self.inner = inner
        self.expected, self.path, self.path_proof = inner.expected, inner.path, inner.path_proof

    def verify(self):
        return self.inner.verify()

    def call(self, method, argument):
        if method not in ('getVersion', 'getMonitorData') or argument != {}:
            raise ValueError('pm2_resurrection_method')
        result = self.inner.call(method, argument)
        return project(result) if method == 'getMonitorData' else result


def run(path, daemon, action, registry=None, proof=None):
    operation = {'replacementStarted': False}
    try:
        daemon = _peer._validate_expected(_dump._copy(daemon))
        if not _peer._absolute(path) or posixpath.basename(path) != 'rpc.sock' or action not in ('inspect', 'capture', 'persist', 'verify'):
            raise ValueError('pm2_resurrection_request')
        if action in ('persist', 'verify'):
            registry = _dump._registry(registry)
            proof = _dump._target(proof, path, daemon) if action == 'persist' else _dump._receipt(proof, path, daemon, registry)
        elif registry is not None or proof is not None:
            raise ValueError('pm2_resurrection_request')
        if not sys.platform.startswith('linux') or not hasattr(socket, 'SO_PEERCRED'):
            raise ValueError('pm2_resurrection_platform')
        deadline = time.monotonic() + 15
        chain = _peer._path_chain(path, daemon['uid'])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(path)
            session = ObservedSession(_control._Session(connection, daemon, path, chain, deadline))
            if session.call('getVersion', {}) != '6.0.14':
                raise ValueError('pm2_resurrection_version')
            if action == 'inspect':
                rows = _control._filter_registry(session.call('getMonitorData', {}))
                session.verify()
                return {'version': 1, 'pm2Version': '6.0.14', 'peerVerified': True, 'registry': rows}
            descriptor = os.open(posixpath.dirname(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                if action == 'capture':
                    return _dump._read_target(session, descriptor)[0]
                if action == 'persist':
                    return _dump._persist(session, descriptor, registry, proof, operation)
                actual, saved = _dump._read_target(session, descriptor)
                if actual != proof['target']:
                    raise ValueError('pm2_resurrection_dump_changed')
                current = session.call('getMonitorData', {})
                _dump._assert_registry(current, registry)
                _dump._assert_dump_content(current, saved, proof['processCount'])
                if _dump._read_target(session, descriptor)[0] != proof['target']:
                    raise ValueError('pm2_resurrection_dump_changed')
                session.verify()
                return True
            finally:
                os.close(descriptor)
    except BaseException:
        raise RuntimeError('pm2_resurrection_outcome_unknown' if operation['replacementStarted'] else 'pm2_resurrection_unverified') from None
