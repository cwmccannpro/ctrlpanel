"""Windows bridge tests; uses the installed Bleak dependency, no physical radio."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('room_bridge', ROOT / 'tools' / 'room-bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class DiscoveryTests(unittest.TestCase):
    def test_cache_accepts_only_enrolled_addresses_and_expires(self):
        cache = bridge.DiscoveryCache([{'address': 'AA:BB:CC:DD:EE:FF'}])
        known = types.SimpleNamespace(address='aa:bb:cc:dd:ee:ff')
        with patch.object(bridge.time, 'monotonic', return_value=100):
            cache.remember(known, None)
            cache.remember(types.SimpleNamespace(address='00:11:22:33:44:55'), None)
            self.assertIs(cache.get('AA:BB:CC:DD:EE:FF'), known)
            self.assertEqual(len(cache.seen), 1)
        with patch.object(bridge.time, 'monotonic', return_value=221):
            self.assertIsNone(cache.get('AA:BB:CC:DD:EE:FF'))

    def test_relay_identifies_client_and_refuses_redirects(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return b'{}'
        opener = types.SimpleNamespace(open=lambda req, timeout: Response())
        with patch.object(bridge.urllib.request, 'build_opener', return_value=opener), patch.object(opener, 'open', return_value=Response()) as call:
            bridge.relay('https://ctrlpanel.cwmccann.pro', 'test', 'poll')
            req = call.call_args.args[0]
            self.assertEqual(req.get_header('User-agent'), 'CTRLpanel-RoomBridge/1.0')
            self.assertEqual(req.get_header('Authorization'), 'Bearer test')
        with self.assertRaises(RuntimeError): bridge.NoRedirect().redirect_request(None)

if __name__ == '__main__': unittest.main()
