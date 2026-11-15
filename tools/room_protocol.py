"""Small, audited subset of LEDnetWF v5+ / MELK-OA21 / Lotus Lantern.

Protocol references and limitations: docs/room-control.md. No raw command API.
"""
import colorsys
import re

WRITE_BULB = '0000ff01-0000-1000-8000-00805f9b34fb'
NOTIFY_BULB = '0000ff02-0000-1000-8000-00805f9b34fb'
WRITE_LOTUS = '0000fff3-0000-1000-8000-00805f9b34fb'

def wrapped(payload, sequence=1, response=False):
    payload = bytes(payload)
    return bytes([0, sequence % 256, 0x80, 0, 0, len(payload), len(payload)+1, 10 if response else 11]) + payload

def frames(profile, patch, previous=None, sequence=1):
    previous = previous or {}
    if not isinstance(patch, dict) or len(patch) != 1:
        raise ValueError('Exactly one setting is required')
    key, value = next(iter(patch.items()))
    if key == 'power':
        if type(value) is not bool:
            raise ValueError('Power must be boolean')
    elif key in ('brightness', 'temperature'):
        low, high = (1, 100) if key == 'brightness' else (2700, 6500)
        if type(value) is not int or not low <= value <= high:
            raise ValueError('Setting is outside the supported range')
    elif key == 'color':
        if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ValueError('Invalid RGB color')
    else:
        raise ValueError('Unsupported setting')

    if profile == 'lednetwf-v5':
        raw = [0x3b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        if key == 'power':
            raw[1] = 0x23 if value else 0x24
        elif key == 'brightness':
            raw[1], raw[4], raw[6] = 1, value, value
        elif key == 'temperature':
            raw[1], raw[5], raw[6] = 0xb1, round((value-2700)*100/3800), previous.get('brightness', 100)
        elif key == 'color':
            rgb = [int(value[i:i+2], 16)/255 for i in (1, 3, 5)]
            hue, sat, val = colorsys.rgb_to_hsv(*rgb)
            packed = (round(hue*360) << 7) | round(sat*100)
            raw[1:5] = [0xa1, packed >> 8, packed & 255, round(previous.get('brightness', 100)*val)]
        raw.append(sum(raw) & 255)
        return WRITE_BULB, [wrapped(raw, sequence)]
    if profile in ('melk-oa21', 'lotus-lantern'):
        if key == 'temperature':
            raise ValueError('This light has no white-temperature channel')
        if key == 'power':
            payload = [0x7e, 4, 4, int(value), 0, int(value), 255, 0, 0xef]
        elif key == 'brightness':
            payload = [0x7e, 4, 1, value, 255, 255, 255, 0, 0xef]
        else:
            payload = [0x7e, 7, 5, 3, *[int(value[i:i+2], 16) for i in (1, 3, 5)], 0x10, 0xef]
        return WRITE_LOTUS, [bytes(payload)]
    raise ValueError('Unknown Bluetooth profile')
