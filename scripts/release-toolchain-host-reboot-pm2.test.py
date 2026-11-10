import importlib.util
import os
import unittest

spec = importlib.util.spec_from_file_location('boot_worker', os.path.join(os.path.dirname(__file__), 'release-toolchain-host-reboot-pm2.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
schema_spec = importlib.util.spec_from_file_location('boot_schema', os.path.join(os.path.dirname(__file__), 'release-toolchain-resurrection-pm2.py'))
schema = importlib.util.module_from_spec(schema_spec)
schema_spec.loader.exec_module(schema)
fixture_spec = importlib.util.spec_from_file_location('original_fixture', os.path.join(os.path.dirname(__file__), 'test_production_maintenance_pm2_control.py'))
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


class RebootSnapshotTests(unittest.TestCase):
    def worker(self):
        env = {'FAOLLA_BACKGROUND_JOBS_PAUSED': '0', 'MERCHANT_BOOKING_STORAGE_MODE': 'atomic-v2', 'MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED': '1', 'MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED': '0', 'MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED': '0'}
        return {'name': module._NAME, 'pid': 2701, 'pm_id': 24, 'pm2_env': {'status': 'online', 'pm_cwd': '/www/wwwroot/merchant-space.web-releases/f274ad615550-online', 'pm_exec_path': '/var/lib/faolla-online-code/' + 'a' * 40 + '/scripts/booking-atomic-worker.mjs', 'exec_interpreter': '/usr/bin/node', 'exec_mode': 'fork_mode', 'autorestart': True, 'restart_time': 0, 'FAOLLA_BACKGROUND_JOBS_PAUSED': '0', 'env': env}}

    def test_actual_id_is_not_relabelled_to_historical_27(self):
        row = self.worker()
        self.assertEqual(module.snapshot(row)['pm_id'], 24)
        self.assertEqual(row['pm_id'], 24)

    def test_every_definition_or_mail_change_is_refused(self):
        for key, value in [('restart_time', 1), ('pm_exec_path', '/foreign'), ('watch', True), ('exec_interpreter', 'node'), ('kill_timeout', 5000), ('status', 'stopped')]:
            row = self.worker()
            row['pm2_env'][key] = value
            with self.assertRaises(ValueError):
                module.snapshot(row)
        row = self.worker()
        row['pm2_env']['env']['RESEND_API_KEY'] = 'synthetic-forbidden'
        with self.assertRaises(ValueError):
            module.snapshot(row)

    def test_noninstalled_source_refuses_before_attempt_or_proc_reads(self):
        with self.assertRaisesRegex(ValueError, 'boot_source'):
            module.witness({'revision': 'a' * 40, 'daemon': {'bootId': '10000000-0000-4000-8000-000000000001'}})

    def test_only_absent_stopped_pid_is_projected_without_mutating_raw_evidence(self):
        row = fixture.raw_entry(pid=0, status='stopped')
        del row['pid']
        with self.assertRaises(Exception):
            schema._control._filter_registry([row])
        projected = schema.project([row])
        self.assertNotIn('pid', row)
        self.assertEqual(projected[0]['pid'], 0)
        self.assertEqual(schema._control._filter_registry(projected)[0]['pid'], 0)
        for status, pid in [('online', None), ('stopped', None), ('stopped', -1), ('stopped', '0')]:
            changed = fixture.raw_entry(pid=pid, status=status)
            if status == 'online':
                del changed['pid']
            with self.assertRaises(Exception):
                schema.project([changed])

    def test_read_schema_cannot_send_process_control_or_dump_rpc(self):
        class Inner:
            expected, path, path_proof = {}, '/synthetic/rpc.sock', []
            def call(self, method, argument):
                raise AssertionError('no RPC may be sent')
        session = schema.ObservedSession(Inner())
        for method in ['restartProcessId', 'deleteProcessId', 'stopProcessId', 'dumpProcessList']:
            with self.assertRaisesRegex(ValueError, 'pm2_resurrection_method'):
                session.call(method, {})


if __name__ == '__main__':
    unittest.main()
