"""Read-only BLE discovery; run with the bridge's Python environment."""
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / '.room-local' / 'pydeps'))
from bleak import BleakScanner

async def scan():
    found = await BleakScanner.discover(timeout=20, return_adv=True)
    rows = [{"name": adv.local_name or dev.name or "", "address": dev.address,
             "rssi": adv.rssi, "services": adv.service_uuids,
             "manufacturer": {str(k): v.hex() for k, v in adv.manufacturer_data.items()},
             "service_data": {k: v.hex() for k, v in adv.service_data.items()}}
            for dev, adv in found.values()]
    print(json.dumps(sorted(rows, key=lambda x: -x['rssi']), indent=2))

if __name__ == '__main__':
    asyncio.run(scan())
