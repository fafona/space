"""One post-boot verifier-only restart; exact observed ID, never historical 27.
The old bridge and its fixed-ID scopes remain unchanged.
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
_spec = importlib.util.spec_from_file_location('_boot_transport', _SOURCE + '/release-toolchain-active-generation-pm2-worker.py')
_active = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_active)
_NAME = 'merchant-space-booking-atomic-f274ad615550'
_C = 'f274ad615550c83717aa7af2ad32339608e6f8aa'


def snapshot(row):
    if type(row) is not dict or type(row.get('pm2_env')) is not dict:
        raise ValueError('boot_worker_shape')
    env = row['pm2_env']
    result = {'name': row.get('name'), 'pid': row.get('pid'), 'pm_id': row.get('pm_id'),
              'pm2_env': {k: env.get(k) for k in _active._transport._FIELDS}}
    for key in ('args', 'node_args'):
        if result['pm2_env'][key] is None:
            result['pm2_env'][key] = []
    if result['pm2_env']['shutdown_with_message'] is None:
        result['pm2_env']['shutdown_with_message'] = False
    configured = env.get('env', {})
    if (result['name'] != _NAME or type(result['pm_id']) is not int or result['pm_id'] < 0
            or type(result['pid']) is not int or result['pid'] <= 0
            or env.get('status') != 'online' or env.get('pm_cwd') != '/www/wwwroot/merchant-space.web-releases/f274ad615550-online'
            or not re.fullmatch(r'/var/lib/faolla-online-code/[a-f0-9]{40}/scripts/booking-atomic-worker\.mjs', env.get('pm_exec_path', ''))
            or env.get('exec_interpreter') != '/usr/bin/node' or env.get('exec_mode') != 'fork_mode'
            or result['pm2_env']['args'] != [] or result['pm2_env']['node_args'] != []
            or env.get('watch', False) is not False or env.get('cron_restart') not in (None, False, '0')
            or env.get('autorestart') is not True or env.get('kill_timeout') is not None
            or result['pm2_env']['shutdown_with_message'] is not False
            or type(env.get('restart_time')) is not int or env['restart_time'] != 0
            or env.get('FAOLLA_BACKGROUND_JOBS_PAUSED') != '0'
            or configured.get('FAOLLA_BACKGROUND_JOBS_PAUSED') != '0'
            or configured.get('MERCHANT_BOOKING_STORAGE_MODE') != 'atomic-v2'
            or configured.get('MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED') != '1'
            or configured.get('MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED') != '0'
            or configured.get('MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED') != '0'
            or configured.get('RESEND_API_KEY') or configured.get('BOOKING_CONFIRMATION_EMAIL_FROM')):
        raise ValueError('boot_worker_definition')
    return result


def witness(value):
    revision, boot = value['revision'], value['daemon']['bootId']
    if not re.fullmatch(r'[a-f0-9]{40}', revision or '') or _SOURCE != '/var/lib/faolla-online-code/' + revision + '/scripts' or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', boot or ''):
        raise ValueError('boot_source')
    root = '/var/lib/faolla-host-reboots/' + boot
    raw, attempt = _active._read(root + '/worker-attempt.json')
    if hashlib.sha256(raw).hexdigest() != value['attemptSha256'] or attempt.get('kind') != 'host-reboot-verifier-restart-attempt' or attempt.get('revision') != revision or attempt.get('expected') != value['expected']:
        raise ValueError('boot_attempt')
    binding_raw, binding = _active._read(root + '/restart-binding.json')
    if binding.get('kind') != 'host-reboot-restart-binding' or binding.get('revision') != revision or hashlib.sha256(binding_raw).hexdigest() != attempt.get('bindingSha256'):
        raise ValueError('boot_binding')
    r = binding['before']['hostReboot']
    if (r['bootId'] != boot or r['previousBootId'] == boot or r.get('verifierAction') != 'upgrade' or binding['before']['toolRevision'] != revision
            or r['mailEnabled'] is not False or r['window'] != attempt['window']
            or open('/proc/sys/kernel/random/boot_id', 'r').read().strip() != boot):
        raise ValueError('boot_identity')
    start, end = (_active._strict_instant(r['window'][k]) for k in ('startedAt', 'deadlineAt'))
    if end - start != 600 or not start <= time.time() < end:
        raise ValueError('boot_window')
    gate_raw, gate = _active._read('/var/lib/faolla-booking-handoff/' + _C + '/worker-enabled.json')
    if hashlib.sha256(gate_raw).hexdigest() != r['gateSha256'] or gate.get('enabled') is not True or gate.get('certificateSha256') != r['publicationCertificateSha256']:
        raise ValueError('boot_gate')
    expected = snapshot(value['expected'])
    old = next(p for p in r['resurrectedProcesses'] if p['name'] == _NAME)
    if (expected['pid'] != old['pid'] or expected['pm_id'] != old['pmId']
            or expected['pm2_env']['pm_exec_path'] != old['executable']):
        raise ValueError('boot_predecessor')
    parent = attempt['controller']
    proc = '/proc/' + str(os.getppid())
    command = open(proc + '/cmdline', 'rb').read()
    fields = open(proc + '/stat', 'r').read().rsplit(')', 1)[1].strip().split()
    if (parent['pid'] != os.getppid() or parent['uid'] != 0 or parent['startTicks'] != fields[19]
            or parent['commandLineDigest'] != hashlib.sha256(command).hexdigest()
            or command.rstrip(b'\0').split(b'\0') != [b'/usr/bin/node', (_SOURCE + '/application-release-host-reboot.mjs').encode(), b'reconcile']
            or os.path.realpath(proc + '/cwd') != os.path.dirname(_SOURCE) or os.path.realpath(proc + '/exe') != '/usr/bin/node'):
        raise ValueError('boot_controller')
    actual, disk = os.fstat(3), os.lstat('/www/wwwroot/merchant-space.deploy.lock')
    if not stat.S_ISREG(actual.st_mode) or actual.st_uid != 0 or stat.S_IMODE(actual.st_mode) != 0o600 or actual.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (disk.st_dev, disk.st_ino):
        raise ValueError('boot_fd')
    info = open('/proc/self/fdinfo/3', 'r').read()
    if 'FLOCK' not in info or 'WRITE' not in info:
        raise ValueError('boot_lock')


def main():
    stage = 'input'
    try:
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288 or not sys.platform.startswith('linux') or os.getuid() != 0:
            raise ValueError('boot_runtime')
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_active._peer._unique_object)
        if type(value) is not dict or set(value) != {'daemon', 'process', 'expected', 'revision', 'attemptSha256'}:
            raise ValueError('boot_input')
        stage = 'witness'
        witness(value)
        expected = snapshot(value['expected'])
        argument = {'id': expected['pm_id'], 'env': {'current_conf': {'pm_exec_path': _SOURCE + '/booking-atomic-worker.mjs'}}}
        stage = 'transport'
        result = _active._connect('/root/.pm2/rpc.sock', value['daemon'], value['process'], expected, argument, snapshot, lambda: witness(value))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except BaseException:
        print(json.dumps({'kind': 'host-reboot-verifier-refused', 'stage': stage, 'mutationPossible': stage == 'transport', 'automaticRetryAllowed': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
