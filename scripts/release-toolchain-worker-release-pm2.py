"""Reviewed worker-only successor under a real inherited deployment lock.
Uses the unchanged peer-bound one-mutation transport; no CLI or reconnect.
"""
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import time

_SOURCE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('_worker_release_transport', _SOURCE + '/release-toolchain-active-generation-pm2-worker.py')
_active = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_active)


def _witness(value):
    revision = value['revision']
    if not re.fullmatch(r'[a-f0-9]{40}', revision or '') or _SOURCE != '/var/lib/faolla-online-code/' + revision + '/scripts':
        raise ValueError('worker_release_source')
    raw, attempt = _active._read('/var/lib/faolla-booking-worker-releases/' + revision + '/worker-attempt.json')
    if hashlib.sha256(raw).hexdigest() != value['attemptSha256'] or attempt.get('kind') != 'booking-worker-source-restart-attempt' or attempt.get('toolRevision') != revision or attempt.get('before', {}).get('rpcExpected') != value['expected']:
        raise ValueError('worker_release_attempt')
    r = attempt['workerRelease']
    start, end = _active._strict_instant(r['window']['startedAt']), _active._strict_instant(r['window']['deadlineAt'])
    if end - start != 600 or not start <= time.time() < end or r.get('mailEnabled') is not False or r.get('toolRevision') != revision:
        raise ValueError('worker_release_window')
    gate_raw, gate = _active._read('/var/lib/faolla-booking-handoff/' + _active._C + '/worker-enabled.json')
    if hashlib.sha256(gate_raw).hexdigest() != r['gateSha256'] or gate.get('enabled') is not True or gate.get('certificateSha256') != r['publicationCertificateSha256']:
        raise ValueError('worker_release_gate')
    expected = _active._worker.snapshot(value['expected'])
    if expected['pm2_env']['pm_exec_path'] != '/var/lib/faolla-online-code/' + r['priorToolRevision'] + '/scripts/booking-atomic-worker.mjs' or expected['pid'] != r['priorWorker']['pid'] or expected['pm2_env']['restart_time'] != r['priorWorker']['restartCount']:
        raise ValueError('worker_release_predecessor')
    root = '/proc/' + str(os.getppid())
    fields = open(root + '/stat', 'r').read().rsplit(')', 1)[1].strip().split()
    command = open(root + '/cmdline', 'rb').read()
    parent = attempt['controller']
    allowed_controllers = [
        [b'/usr/bin/node', (_SOURCE + '/release-toolchain-worker-release-entry.mjs').encode(), b'publish'],
        [b'/usr/bin/node', (_SOURCE + '/application-release-worker-entry.mjs').encode(), b'publish'],
    ]
    if parent['pid'] != os.getppid() or parent['uid'] != 0 or parent['startTicks'] != fields[19] or parent['commandLineDigest'] != hashlib.sha256(command).hexdigest() or os.path.realpath(root + '/cwd') != os.path.dirname(_SOURCE) or os.path.realpath(root + '/exe') != '/usr/bin/node' or command.rstrip(b'\0').split(b'\0') not in allowed_controllers:
        raise ValueError('worker_release_controller')
    actual, disk = os.fstat(3), os.lstat('/www/wwwroot/merchant-space.deploy.lock')
    if not stat.S_ISREG(actual.st_mode) or actual.st_uid != 0 or stat.S_IMODE(actual.st_mode) != 0o600 or actual.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (disk.st_dev, disk.st_ino):
        raise ValueError('worker_release_fd')
    info = open('/proc/self/fdinfo/3', 'r').read()
    if 'FLOCK' not in info or 'WRITE' not in info:
        raise ValueError('worker_release_lock')
    return attempt


def main():
    stage = 'input'
    try:
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288 or not sys.platform.startswith('linux') or os.getuid() != 0:
            raise ValueError()
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_active._peer._unique_object)
        if type(value) is not dict or set(value) != {'daemon', 'process', 'expected', 'revision', 'attemptSha256'}:
            raise ValueError()
        stage = 'witness'
        _witness(value)
        stage = 'transport'
        result = _active._connect('/root/.pm2/rpc.sock', value['daemon'], value['process'], _active._worker.snapshot(value['expected']), _active._transport.replacement_argument(value['revision']), _active._worker.snapshot, lambda: _witness(value))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except BaseException:
        print(json.dumps({'kind': 'booking-worker-release-refused', 'stage': stage, 'mutationPossible': stage == 'transport', 'automaticRetryAllowed': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
