"""One fixed worker source transition, never a generic restart capability."""
import hashlib
import importlib.util
import json
import os
import re
import socket
import stat
import sys
import time

_SOURCE = os.path.dirname(os.path.abspath(__file__))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, _SOURCE + '/' + filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_active = _load('_registry_recovery_transport', 'release-toolchain-active-generation-pm2-worker.py')
_capacity = _load('_registry_recovery_capacity', 'release-toolchain-registry-capacity.py')
_NAME = 'merchant-space-booking-atomic-f274ad615550'
_OLD = '37fe3c3b8220c73090ba953c7d046a63a5ab1bfc'
_HEAD = '16f2864ac509dcd56652e4ea0e0c294621cac13e00d03016eb2cd1c4f27c41fb'
_GATE = '/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa/worker-enabled.json'


def snapshot(row):
    if type(row) is not dict or type(row.get('pm2_env')) is not dict:
        raise ValueError('registry_worker_shape')
    env = row['pm2_env']
    result = {'name': row.get('name'), 'pid': row.get('pid'), 'pm_id': row.get('pm_id'),
              'pm2_env': {k: env.get(k) for k in _active._transport._FIELDS}}
    for key in ('args', 'node_args'):
        if result['pm2_env'][key] is None:
            result['pm2_env'][key] = []
    if result['pm2_env']['shutdown_with_message'] is None:
        result['pm2_env']['shutdown_with_message'] = False
    configured = env.get('env', {})
    if (result['name'] != _NAME or result['pm_id'] != 24 or result['pid'] != 685108
            or type(env.get('restart_time')) is not int or env.get('restart_time') != 1 or env.get('status') != 'online'
            or env.get('pm_cwd') != '/www/wwwroot/merchant-space.web-releases/f274ad615550-online'
            or env.get('pm_exec_path') != '/var/lib/faolla-online-code/' + _OLD + '/scripts/booking-atomic-worker.mjs'
            or env.get('exec_interpreter') != '/usr/bin/node' or env.get('exec_mode') != 'fork_mode'
            or result['pm2_env']['args'] != [] or result['pm2_env']['node_args'] != []
            or env.get('watch', False) is not False or env.get('cron_restart') not in (None, False, '0')
            or env.get('autorestart') is not True or env.get('kill_timeout') is not None
            or result['pm2_env']['shutdown_with_message'] is not False
            or env.get('FAOLLA_BACKGROUND_JOBS_PAUSED') != '0'
            or configured.get('FAOLLA_BACKGROUND_JOBS_PAUSED') != '0'
            or configured.get('MERCHANT_BOOKING_STORAGE_MODE') != 'atomic-v2'
            or configured.get('MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED') != '1'
            or configured.get('MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED') != '0'
            or configured.get('MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED') != '0'
            or configured.get('RESEND_API_KEY') or configured.get('BOOKING_CONFIRMATION_EMAIL_FROM')):
        raise ValueError('registry_worker_predecessor')
    return result


def witness(value):
    revision = value['revision']
    if not re.fullmatch(r'[a-f0-9]{40}', revision or '') or _SOURCE != '/var/lib/faolla-online-code/' + revision + '/scripts':
        raise ValueError('registry_worker_source')
    raw, attempt = _active._read('/var/lib/faolla-booking-registry-recovery/' + revision + '/worker-attempt.json')
    if (hashlib.sha256(raw).hexdigest() != value['attemptSha256']
            or attempt.get('kind') != 'booking-registry-capacity-restart-attempt'
            or attempt.get('revision') != revision or attempt.get('expected') != value['expected']):
        raise ValueError('registry_worker_attempt')
    r = attempt['context']
    expected_context = {'kind': 'booking-registry-capacity-recovery-v1', 'maximumFrameBytes': 4194304,
                        'historyHeadSha256': _HEAD,
                        'priorVerifierCertificateSha256': '07aae44f3edd4fbd072c4142756fdaa927993dacffa4292f5dddb7c5683cd5fb'}
    if (r.get('version') != 2 or r.get('registryAdapter') != expected_context
            or r.get('toolRevision') != revision or r.get('priorToolRevision') != _OLD
            or r.get('mailEnabled') is not False):
        raise ValueError('registry_worker_context')
    start, end = (_active._strict_instant(r['window'][k]) for k in ('startedAt', 'deadlineAt'))
    if end - start != 600 or not start <= time.time() < end:
        raise ValueError('registry_worker_window')
    gate_raw, gate = _active._read(_GATE)
    if (hashlib.sha256(gate_raw).hexdigest() != r['gateSha256']
            or r['gateSha256'] != '803239b45780b35ad7c265da57f39f053764cf79d8c7d4c9e8799f1ebc9ecab6'
            or gate.get('enabled') is not True or gate.get('certificateSha256') != r['publicationCertificateSha256']):
        raise ValueError('registry_worker_gate')
    snapshot(value['expected'])
    proc = '/proc/' + str(os.getppid())
    command = open(proc + '/cmdline', 'rb').read()
    fields = open(proc + '/stat', 'r').read().rsplit(')', 1)[1].strip().split()
    parent = attempt['controller']
    if (parent['pid'] != os.getppid() or parent['uid'] != 0 or parent['startTicks'] != fields[19]
            or parent['commandLineDigest'] != hashlib.sha256(command).hexdigest()
            or command.rstrip(b'\0').split(b'\0') != [b'/usr/bin/node', (_SOURCE + '/release-toolchain-registry-recovery.mjs').encode(), b'publish']
            or os.path.realpath(proc + '/cwd') != os.path.dirname(_SOURCE) or os.path.realpath(proc + '/exe') != '/usr/bin/node'):
        raise ValueError('registry_worker_controller')
    actual, disk = os.fstat(3), os.lstat('/www/wwwroot/merchant-space.deploy.lock')
    if (not stat.S_ISREG(actual.st_mode) or actual.st_uid != 0 or stat.S_IMODE(actual.st_mode) != 0o600
            or actual.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (disk.st_dev, disk.st_ino)):
        raise ValueError('registry_worker_fd')
    info = open('/proc/self/fdinfo/3', 'r').read()
    if 'FLOCK' not in info or 'WRITE' not in info:
        raise ValueError('registry_worker_lock')
    return attempt


class WorkerCapacitySession(_active._transport._Session):
    def call(self, method, argument, mutation=False):
        if method == 'getMonitorData':
            return _capacity.RegistryCapacitySession(self.connection, self.expected, self.path,
                                                      self.path_proof, self.deadline).call(method, argument, mutation)
        # Original single-mutation state and exact worker_argument validation.
        return super().call(method, argument, mutation)


def main():
    stage, session = 'input', None
    try:
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288 or not sys.platform.startswith('linux') or os.getuid() != 0:
            raise ValueError('registry_worker_runtime')
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_active._peer._unique_object)
        if type(value) is not dict or set(value) != {'daemon', 'process', 'expected', 'revision', 'attemptSha256'}:
            raise ValueError('registry_worker_input')
        stage = 'witness'
        witness(value)
        expected = snapshot(value['expected'])
        peer = _active._peer
        daemon, process = peer._validate_expected(value['daemon']), peer._validate_expected(value['process'])
        if (daemon['uid'] != 0 or daemon['executable'] != '/usr/bin/node' or process['uid'] != 0
                or process['pid'] != expected['pid'] or process['bootId'] != daemon['bootId']
                or process['executableIdentity'] != daemon['executableIdentity']):
            raise ValueError('registry_worker_peer')
        argument = {'id': 24, 'env': {'current_conf': {'pm_exec_path': _SOURCE + '/booking-atomic-worker.mjs'}}}
        deadline = time.monotonic() + 30
        chain = peer._path_chain('/root/.pm2/rpc.sock', 0)
        stage = 'transport'
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            peer._timeout(connection, deadline)
            connection.connect('/root/.pm2/rpc.sock')
            session = WorkerCapacitySession(connection, daemon, '/root/.pm2/rpc.sock', chain, deadline)
            result = _active._perform(session, expected, process, argument, snapshot, lambda: witness(value))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except BaseException:
        print(json.dumps({'kind': 'booking-registry-recovery-refused', 'stage': stage,
                          'mutationPossible': bool(session and session.mutation_sent),
                          'automaticRetryAllowed': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
