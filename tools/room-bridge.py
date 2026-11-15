"""Outbound HTTPS room bridge. Requires Python 3.12+ and bleak (Windows).

Credential is decrypted with Windows DPAPI in this process. It is never
printed or passed on a command line. Only explicitly installed MACs are allowed.
"""
import asyncio
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
import os
from pathlib import Path
import sys
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.room-local'
sys.path.insert(0, str(LOCAL / 'pydeps'))
from bleak import BleakClient, BleakScanner
from room_protocol import frames

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Relay redirects are refused')

def relay(origin, key, action, body=None):
    request = urllib.request.Request(origin + '/api/room/bridge/' + action,
        data=json.dumps(body or {}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                 'User-Agent': 'CTRLpanel-RoomBridge/1.0'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=12) as response:
        return json.loads(response.read(65536))

def expired(command):
    return datetime.fromisoformat(command['expires_at'].replace('Z', '+00:00')) <= datetime.now(timezone.utc)

def load_credential():
    """Read PowerShell ConvertFrom-SecureString's DPAPI hex, same Windows user."""
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    encrypted = bytes.fromhex((LOCAL / 'credential.dpapi').read_text(encoding='utf-8-sig').strip())
    buffer = (ctypes.c_ubyte * len(encrypted)).from_buffer_copy(encrypted)
    source, output = Blob(len(encrypted), buffer), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.data, output.size).decode('utf-16-le')
    finally:
        ctypes.memset(output.data, 0, output.size)
        kernel.LocalFree(output.data)

class DiscoveryCache:
    """Remember only installed radios; do not collect other nearby devices."""
    def __init__(self, devices):
        self.allowed = {d['address'].upper() for d in devices}
        self.seen = {}

    def remember(self, device, advertisement):
        address = device.address.upper()
        if address in self.allowed:
            self.seen[address] = (device, time.monotonic())

    def get(self, address):
        device, seen_at = self.seen.get(address.upper(), (None, 0))
        return device if time.monotonic() - seen_at < 120 else None


async def send_light(device, patch, previous, discovery=None):
    address = device['address'].upper()
    found = discovery.get(address) if discovery else None
    if found is None:
        found = await BleakScanner.find_device_by_address(address, timeout=8)
    if found is None:
        raise RuntimeError('Not in Bluetooth range. Close the phone app and move the adapter closer.')
    async with BleakClient(found, timeout=10, winrt={'use_cached_services': False}) as client:
        characteristic, packets = frames(device['profile'], patch, previous, int(time.monotonic()) % 256)
        char = client.services.get_characteristic(characteristic)
        if char is None:
            raise RuntimeError('Expected light service is unavailable; protocol needs checking.')
        response = 'write' in char.properties
        if not response and 'write-without-response' not in char.properties:
            raise RuntimeError('Light characteristic is not writable.')
        for packet in packets:
            await client.write_gatt_char(char, packet, response=response)
            await asyncio.sleep(.15)

async def execute(command, server_devices, states, config, api, discovery=None):
    installed = {d['id']: d for d in config['devices']}
    configured = {d['id']: d for d in server_devices}
    results = []
    for target in command['targets']:
        result = {'id': target, 'ok': False}
        try:
            if expired(command):
                raise RuntimeError('Command expired before it could be sent.')
            # Recheck credential before each physical device, including room commands.
            await api('poll')
            device = installed.get(target)
            remote = configured.get(target)
            if not device or not remote or any(device.get(k) != remote.get(k) for k in ('address', 'profile')):
                raise RuntimeError('This light is not in the desktop allowlist.')
            await asyncio.wait_for(send_light(device, command['patch'], states.get(target, {}), discovery), timeout=20)
            result['ok'] = True
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise
            result['error'] = 'Cannot verify the room connection. Nothing sent.'
        except Exception as exc:
            result['error'] = ('Bluetooth operation timed out. Check range and close the phone app.' if isinstance(exc, TimeoutError) else str(exc))[:240]
        results.append(result)
        logging.info('Light %s: %s', target, 'sent' if result['ok'] else result.get('error'))
    receipt = {'id': command['id'], 'results': results}
    # Retry the receipt, NEVER replay a physical command after an uncertain send.
    while not expired(command):
        try:
            await api('ack', receipt)
            return
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 409):
                raise
        except Exception:
            pass
        await asyncio.sleep(2)
    logging.warning('Receipt expired; device state is uncertain.')

async def main():
    key = load_credential()
    if not key.startswith('ctrb_') or len(key) != 69:
        raise RuntimeError('Run room-install.ps1 to install a desktop credential.')
    config = json.loads((LOCAL / 'config.json').read_text(encoding='utf-8-sig'))
    origin = config.get('origin', 'https://ctrlpanel.cwmccann.pro').rstrip('/')
    if origin != 'https://ctrlpanel.cwmccann.pro':
        raise RuntimeError('Untrusted relay origin')
    # Single instance, even if Windows starts the task twice.
    lock = open(LOCAL / 'bridge.lock', 'a+b')
    lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return
    async def api(action, body=None):
        return await asyncio.to_thread(relay, origin, key, action, body)
    task = None
    delay = 3
    discovery = DiscoveryCache(config['devices'])
    scanner = BleakScanner(detection_callback=discovery.remember)
    await scanner.start()
    logging.info('Room bridge started; %d allowed lights', len(config['devices']))
    try:
        while True:
            try:
                if task and task.done():
                    task.result()
                    task = None
                if task:
                    await asyncio.sleep(2)
                    continue
                # execute() refreshes the heartbeat before each bounded BLE operation.
                response = await api('poll')
                if response.get('command'):
                    if task:
                        raise RuntimeError('Another command is already executing')
                    task = asyncio.create_task(execute(response['command'], response['devices'], response.get('last_sent', {}), config, api, discovery))
                delay = 3
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    logging.error('Relay access denied (HTTP %s). Check the desktop key and host access rules.', exc.code)
                    return
                logging.warning('Relay unavailable (HTTP %s)', exc.code)
                delay = min(30, delay*2)
            except Exception as exc:
                logging.warning('Bridge connection interrupted (%s)', type(exc).__name__)
                if task and task.done():
                    task = None
                delay = min(30, delay*2)
            await asyncio.sleep(delay)
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await scanner.stop()
        lock.close()

if __name__ == '__main__':
    LOCAL.mkdir(exist_ok=True)
    handler = RotatingFileHandler(LOCAL / 'bridge.log', maxBytes=500000, backupCount=2)
    logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(message)s')
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        logging.error('Bridge stopped (%s). Check setup and configuration.', type(exc).__name__)
        sys.exit(1)
