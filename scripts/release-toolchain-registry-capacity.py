"""Bounded large-registry read, not process-control or release authority.

The original 1 MiB session and all its callers remain unchanged. Only the
getMonitorData response has a separately reviewed 4 MiB bound. Requests,
version reads, framing, unique JSON keys, peer/path/lifetime verification,
deadlines and the original 128-row / 512 KiB filtered schema are unchanged.
No monkeypatch, daemon launch, reconnect, retry, gate write or mutation.
"""
import importlib.util
import os
import uuid

_spec = importlib.util.spec_from_file_location(
    '_registry_capacity_original', os.path.join(os.path.dirname(__file__),
                                             'production-maintenance-pm2-control.py'))
_control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_control)
MAX_REGISTRY_FRAME_BYTES = 4 * 1024 * 1024


class RegistryCapacitySession(_control._Session):
    def call(self, method, argument, mutation=False):
        # This adapter is deliberately read-only. A process-control adapter
        # must separately own and validate every allowed mutation.
        if method not in ('getVersion', 'getMonitorData') or argument != {} or mutation:
            _control._fail('pm2_control_invalid_request')
        if method == 'getVersion':
            return super().call(method, argument)
        self.verify()
        request_id = uuid.uuid4().hex + ':0'
        frame = _control._encode(method, argument, request_id)
        _control._peer._timeout(self.connection, self.deadline)
        self.connection.sendall(frame)
        response = bytearray()
        while _control._parts(response, MAX_REGISTRY_FRAME_BYTES) is None:
            _control._peer._timeout(self.connection, self.deadline)
            chunk = self.connection.recv(min(65536, MAX_REGISTRY_FRAME_BYTES + 1 - len(response)))
            if not chunk:
                _control._fail('pm2_control_protocol_invalid')
            response.extend(chunk)
        # The unchanged decoder verifies response correlation, framing, UTF-8,
        # JSON uniqueness and constants. Callers must still apply the original
        # complete row/output validators; never log the raw environment.
        result = _control._decode(response, request_id, MAX_REGISTRY_FRAME_BYTES)
        self.verify()
        return result
