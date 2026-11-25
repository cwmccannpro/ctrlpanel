"""Windows bridge tests; uses the installed Bleak dependency, no physical radio."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

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

class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_discovery_pauses_for_write_and_resumes(self):
        scanner = types.SimpleNamespace(stop=AsyncMock(), start=AsyncMock())
        radio = types.SimpleNamespace(scanner=scanner, get=lambda address: object())
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.services = types.SimpleNamespace(get_characteristic=lambda uuid: types.SimpleNamespace(properties=['write']))
        device = {'address': 'AA:BB:CC:DD:EE:FF', 'profile': 'lednetwf-v5'}
        with patch.object(bridge, 'BleakClient', return_value=client), patch.object(bridge.asyncio, 'sleep', new=AsyncMock()):
            await bridge.send_light(device, {'power': True}, {}, radio)
        scanner.stop.assert_awaited_once()
        scanner.start.assert_awaited_once()
        client.write_gatt_char.assert_awaited_once()

    async def test_elk_bleddm_writes_without_response_and_settles(self):
        radio = types.SimpleNamespace(scanner=None, get=lambda address: object())
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.services = types.SimpleNamespace(get_characteristic=lambda uuid: types.SimpleNamespace(properties=['write', 'write-without-response', 'read']))
        sleep = AsyncMock()
        with patch.object(bridge, 'BleakClient', return_value=client), patch.object(bridge.asyncio, 'sleep', new=sleep):
            await bridge.send_light({'address': 'BE:68:7D:0C:48:02', 'profile': 'elk-bleddm'}, {'power': True}, {}, radio)
        args, kwargs = client.write_gatt_char.await_args
        self.assertEqual(args[1].hex(), '7e0404f00001ff00ef')
        self.assertIs(kwargs['response'], False)
        sleep.assert_awaited_with(.3)

    async def test_failed_connection_resumes_discovery_without_replaying(self):
        scanner = types.SimpleNamespace(stop=AsyncMock(), start=AsyncMock())
        radio = types.SimpleNamespace(scanner=scanner, get=lambda address: object())
        client = AsyncMock()
        client.__aenter__.side_effect = RuntimeError('unreachable')
        with patch.object(bridge, 'BleakClient', return_value=client), self.assertRaisesRegex(RuntimeError, 'unreachable'):
            await bridge.send_light({'address':'AA:BB:CC:DD:EE:FF','profile':'lednetwf-v5'}, {'power': True}, {}, radio)
        scanner.start.assert_awaited_once()
        client.write_gatt_char.assert_not_awaited()

if __name__ == '__main__': unittest.main()
