import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def test_secret_requires_tls_except_loopback(self):
        key = 'ctrb_' + 'a' * 64
        for server in ['https://ctrlpanel.example', 'http://127.0.0.1:3001', 'http://localhost:5173']:
            self.assertEqual(bridge.validate_config({'server': server, 'key': key})['server'], server)
        for server in ['http://example.com', 'https://user:password@example.com', 'https://example.com/path',
                       'https://example.com?secret=key', 'file:///tmp/room']:
            with self.assertRaises(ValueError): bridge.validate_config({'server': server, 'key': key})

    def test_snapshot_never_publishes_private_audio_runtime_or_removed_devices(self):
        with patch.object(bridge, 'api', side_effect=[{'devices': [], 'alarm_runtime': {'previous_audio': 'private'},
            'removed_devices': ['bed']}, {'active': False}]):
            self.assertEqual(bridge.snapshot(), {'devices': [], 'alarm': {'active': False}})

    def test_unsupported_command_cannot_reach_http(self):
        with patch.object(bridge, 'api') as request:
            self.assertIn('error', bridge.execute({'id': '1', 'method': 'POST', 'path': '/../../private'}))
            request.assert_not_called()

    def test_partial_device_failure_is_propagated(self):
        with patch.object(bridge, 'api', return_value={'results': [{'ok': True}, {'ok': False, 'error': 'Bulb offline'}]}):
            result = bridge.execute({'id': '1', 'method': 'POST', 'path': '/room/command', 'body': {'power': True}})
        self.assertEqual(result['error'], 'Bulb offline')
        self.assertEqual(len(result['data']['results']), 2)

    def test_uncertain_physical_commands_are_not_retried(self):
        with patch.object(bridge, 'api', side_effect=TimeoutError) as request:
            result = bridge.execute({'id': '1', 'method': 'POST', 'path': '/alarm/preview'})
        self.assertEqual(request.call_count, 1)
        self.assertIn('not confirm', result['error'])

    def test_connection_file_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'download.json'
            source.write_text('{"server":"https://ctrlpanel.example","key":"ctrb_' + 'a'*64 + '"}')
            target = Path(tmp) / 'private.json'
            bridge.configure(target, source)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

if __name__ == '__main__': unittest.main()
