"""The original filtered dump transaction with a bounded large read session.
No PM2 mutation RPC is exposed; original file/receipt/CAS checks are retained.
"""
import importlib.util
import os
import posixpath
import socket
import sys
import time


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(os.path.dirname(__file__), filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_representation = _load('_registry_dump_representation', 'release-toolchain-resurrection-pm2.py')
_capacity = _load('_registry_dump_capacity', 'release-toolchain-registry-capacity.py')
_dump, _control, _peer = _representation._dump, _representation._control, _representation._peer


def run(path, daemon, action, registry=None, proof=None):
    operation = {'replacementStarted': False}
    try:
        daemon = _peer._validate_expected(_dump._copy(daemon))
        if (not _peer._absolute(path) or posixpath.basename(path) != 'rpc.sock'
                or action not in ('inspect', 'capture', 'persist', 'verify')):
            raise ValueError('registry_dump_request')
        if action in ('persist', 'verify'):
            registry = _dump._registry(registry)
            proof = _dump._target(proof, path, daemon) if action == 'persist' else _dump._receipt(proof, path, daemon, registry)
        elif registry is not None or proof is not None:
            raise ValueError('registry_dump_request')
        if not sys.platform.startswith('linux') or not hasattr(socket, 'SO_PEERCRED'):
            raise ValueError('registry_dump_platform')
        deadline = time.monotonic() + 15
        chain = _peer._path_chain(path, daemon['uid'])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            _peer._timeout(connection, deadline)
            connection.connect(path)
            session = _representation.ObservedSession(
                _capacity.RegistryCapacitySession(connection, daemon, path, chain, deadline))
            if session.call('getVersion', {}) != '6.0.14':
                raise ValueError('registry_dump_version')
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
                    raise ValueError('registry_dump_changed')
                current = session.call('getMonitorData', {})
                _dump._assert_registry(current, registry)
                _dump._assert_dump_content(current, saved, proof['processCount'])
                if _dump._read_target(session, descriptor)[0] != proof['target']:
                    raise ValueError('registry_dump_changed')
                session.verify()
                return True
            finally:
                os.close(descriptor)
    except BaseException:
        raise RuntimeError('registry_dump_outcome_unknown' if operation['replacementStarted'] else 'registry_dump_unverified') from None
