"""Read-only connection/service probe for explicitly selected light addresses."""
import asyncio
import json
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / '.room-local' / 'pydeps'))
from bleak import BleakClient, BleakScanner
from room_protocol import WRITE_BULB, NOTIFY_BULB, wrapped

async def probe(address):
    try:
        device = await BleakScanner.find_device_by_address(address, timeout=8)
        if not device:
            print(json.dumps({'address': address, 'error': 'Not advertising'}), flush=True)
            return
        async with BleakClient(device, timeout=12) as client:
            info = {'address': address, 'name': device.name, 'characteristics': [
                {'uuid': c.uuid, 'properties': c.properties} for s in client.services for c in s.characteristics]}
            notifications = []
            if client.services.get_characteristic(NOTIFY_BULB):
                await client.start_notify(NOTIFY_BULB, lambda c, data: notifications.append(bytes(data).hex()))
                c = client.services.get_characteristic(WRITE_BULB)
                await client.write_gatt_char(c, wrapped(bytes.fromhex('818a8b96'), response=True), response='write' in c.properties)
                await asyncio.sleep(2)
            info['notifications'] = notifications
            print(json.dumps(info), flush=True)
    except Exception as exc:
        print(json.dumps({'address': address, 'error': str(exc), 'type': type(exc).__name__}), flush=True)

async def main():
    for address in sys.argv[1:]:
        try:
            await asyncio.wait_for(probe(address), timeout=25)
        except TimeoutError:
            print(json.dumps({'address': address, 'error': 'Connection timed out'}), flush=True)

if __name__ == '__main__':
    asyncio.run(main())
