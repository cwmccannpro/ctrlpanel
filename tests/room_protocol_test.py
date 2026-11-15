import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))
from room_protocol import frames, WRITE_BULB, WRITE_LOTUS

class ProtocolTests(unittest.TestCase):
    def test_bulb_power_has_transport_checksum_and_no_delay(self):
        char, packets = frames('lednetwf-v5', {'power': True}, sequence=3)
        self.assertEqual(char, WRITE_BULB)
        self.assertEqual(packets[0].hex(), '00038000000d0e0b3b23000000000000000000005e')

    def test_bulb_white_limits(self):
        for kelvin, percent in [(2700, 0), (6500, 100)]:
            _, packets = frames('lednetwf-v5', {'temperature': kelvin}, {'brightness': 42})
            raw = packets[0][8:]
            self.assertEqual((raw[1], raw[5], raw[6]), (0xb1, percent, 42))
            self.assertEqual(raw[-1], sum(raw[:-1]) & 255)

    def test_bulb_rgb_never_encodes_rgb_as_hours_of_fade(self):
        _, packets = frames('lednetwf-v5', {'color': '#ff0000'}, {'brightness': 60})
        raw = packets[0][8:]
        self.assertEqual(raw[1:5], bytes([0xa1, 0, 100, 60]))
        self.assertEqual(raw[7:12], bytes(5))

    def test_melk_and_lotus_frames(self):
        for profile in ['melk-oa21', 'lotus-lantern']:
            for patch, expected in [({'power': False}, '7e0404000000ff00ef'),
                                    ({'power': True}, '7e0404010001ff00ef'),
                                    ({'brightness': 50}, '7e040132ffffff00ef'),
                                    ({'color': '#123456'}, '7e07050312345610ef')]:
                char, packets = frames(profile, patch)
                self.assertEqual(char, WRITE_LOTUS)
                self.assertEqual(packets[0].hex(), expected)

    def test_invalid_inputs_cannot_become_raw_writes(self):
        for patch in [{'brightness': True}, {'brightness': 101}, {'color': '112233'}, {'power': 1}, {'temperature': 2600}, {'raw': '7e'}, {}]:
            with self.assertRaises(ValueError):
                frames('lednetwf-v5', patch)
        with self.assertRaises(ValueError):
            frames('melk-oa21', {'temperature': 3500})
        with self.assertRaises(ValueError):
            frames('unknown', {'power': True})

if __name__ == '__main__':
    unittest.main()
