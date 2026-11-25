# Room Control

`/room` controls the owner's enrolled BLE lights through a Windows desktop. It is
also available in the sidebar, command palette, and optional Home dashboard panel.
Power, brightness, and color support individual lights or the room. Room white
temperature applies only to bulbs, 2700–6500 K.

Presets change the whole room. Day uses bright white, Relax uses warm white at
40%, Work uses bright purple, Party uses red, and Night turns every light off.
The daily schedule runs through the desktop heartbeat in Eastern time: Day at
7 AM, Work at 5 PM, Party at 9 PM, and Night at midnight. Relax is manual. The
paired bridge must connect during the scheduled minute for the preset to queue.

## Connection and security

The browser sends a Supabase Bearer session to `/api/room/*`. `backend/room.js`
validates it with Auth, derives the owner from the verified user, and dispatches
through the service-only `room_relay` RPC. Express and Cloudflare use this same
handler. Query-string tokens are never accepted. A signed-in account with no
provisioned controller cannot create or claim one.

The desktop makes outbound HTTPS requests to `https://ctrlpanel.cwmccann.pro`.
No listener, public tunnel, router forwarding, or inbound firewall rule is needed.
Its separate random 256-bit `ctrb_` credential can poll and acknowledge commands;
it cannot create commands, rotate credentials, or read any other app data. Only a
SHA-256 hash is stored server-side. The local credential uses Windows DPAPI under
the signed-in Windows account; `.room-local` has a restricted ACL and is ignored
by Git. The bridge refuses redirects and any other relay origin. A local device
allowlist independently pins each light's address and protocol.

`room_controllers` and `room_commands` have RLS enabled, no browser policies, and
explicit revocations for anon/authenticated. The RPC is security-invoker and only
service_role may execute it. Every action locks and checks the controller's owner
or credential. Pair/revoke cancels queued work. Already transmitted BLE packets
cannot be recalled. The desktop checks its credential again before each light.

Commands expire after 90 seconds. An offline desktop (no heartbeat for 30 seconds)
cannot accept new commands. The queue is limited to 8 pending commands and 60 per
minute. Only one command is claimed at once; no automatic hardware replay follows
an uncertain send or process restart. Receipts may retry idempotently. Each light
has its own result; room changes can be partially successful. History is retained;
there is **no automatic history deletion**.

“Sent over Bluetooth” means the GATT write completed, not that a sensor confirmed
the room's appearance. Displayed settings are the last successful sends. Phone
apps or remotes can change a light without updating these values. The desktop
must remain awake and online. Weak Bluetooth signal and phone connections can
prevent control. Close the vendor apps and check the desktop antenna placement.

## Hardware enrolled for this installation

| Light | Advertised name | BLE address | Profile |
| --- | --- | --- | --- |
| Bulb 1 | LEDnetWF02003529CCF3 | 08:65:F0:29:CC:F3 | lednetwf-v5 |
| Bulb 2 | LEDnetWF0200352AC5D4 | 08:65:F0:2A:C5:D4 | lednetwf-v5 |
| Light bar | MELK-OA21 14 | BE:28:D2:00:01:14 | melk-oa21 |
| Headboard | ELK-BLEDDM F9 | BE:68:7D:0C:48:02 | elk-bleddm |

Both bulbs advertise product 0x35, BLE v5. Do not enroll an unnamed nearby device
by guessing. `lotus-lantern` packet support is implemented for the standard
unencrypted fff3 profile; encrypted ELK-* variants need separate verification.

The headboard (Lotus Lantern app) is an ELK-BLEDDM controller: service fff0,
write fff3, notify fff4, no login. Its `elk-bleddm` profile uses the bytes from
elkbledom's ELK-BLEDDM model entry (on `7e0404f00001ff00ef`, off
`7e0404000000ff00ef`, color `7e000503RRGGBB00ef`, brightness
`7e0401NNff00ff00ef`), written without response with a 0.3 s settle. Red/off/on
was verified on the hardware on 2026-11-21. It has no white-temperature channel
in Room Control. It advertises rarely (seconds to minutes apart) and is easiest
to find just after power-up, so a command can fail with "Not in Bluetooth range"
until it advertises again; power-cycling it makes it reachable.

## Install / reconnect

1. Apply `migrations/20261115-room-control.sql` (also appended to the authoritative
   `supabase-schema.sql`). It adds only the Room Control tables, index, and RPC.
2. A server administrator provisions one real controller row for the verified
   owner's auth UUID, with the actual discovered devices. There is deliberately
   no public enrollment endpoint and no seeded user/device data in the migration.
3. Store the same device records in `.room-local/config.json` with `origin` set to
   the production origin, and `python` set to a Python 3.12+ executable. Each device
   has `id`, `name`, `bluetooth_name`, `address`, `profile`, and `cct`.
4. Room Control → Desktop connection → Create/Replace desktop key. Run
   `powershell -File tools/room-install.ps1 -Python "C:\path\to\python.exe"`
   and paste the key into the secure prompt. It is shown once. The installer
   installs Bleak, protects local files, registers **CTRLpanel Room Bridge** as a
   hidden, non-admin task at this user's Windows logon, and starts it. The task
   owns `pythonw.exe` directly, so stopping it also stops Bluetooth work. The
   process decrypts the DPAPI credential itself; no key is passed in arguments
   or inherited environment variables. Discovery caches only enrolled radios.
5. Confirm “Desktop connected” in Room Control and test each light. The bridge's
   rotating local log is `.room-local/bridge.log` (no credentials).

For an already provisioned encrypted credential, `-KeepCredential` skips the key
prompt. To stop: `Stop-ScheduledTask -TaskName 'CTRLpanel Room Bridge'`. To revoke
remote access immediately, use **Disconnect desktop** in Room Control. To remove
automatic startup: `Unregister-ScheduledTask -TaskName 'CTRLpanel Room Bridge'`.

For a fourth light, run `python tools/room-scan.py` with the vendor app closed.
Verify its name and GATT service using `python tools/room-probe.py AA:BB:CC:DD:EE:FF`,
then explicitly add the confirmed device to both server and local allowlists.
Discovery never automatically controls an unknown nearby device.

## API and verification

- Session: `GET /api/room/status`, `POST /api/room/command` `{target,patch}`,
  `POST /api/room/preset` `{preset}` (queues ordered single-setting commands),
  `POST /api/room/pair`, `POST /api/room/revoke`.
- Desktop: `POST /api/room/bridge/poll`, `POST /api/room/bridge/ack` `{id,results}`.
- Exactly one setting per command: `power:boolean`, `brightness:1..100`,
  `color:#rrggbb`, or `temperature:2700..6500`. No raw BLE writes or addresses in
  browser commands. `target` is a configured ID or `all`.
- Run `npm test`, `npm run build`, `python tests/room_protocol_test.py`, and
  `python tests/room_bridge_test.py` (Windows, with Bleak installed).
- Database integration checks covered ownership, invalid keys, single claim,
  partial receipts and revocation in a rolled-back transaction.
- `.room-local/preview.html` is an isolated, nondeployed UI fixture used for
  responsive, offline and command-routing checks; it sends no real commands.

## Protocol references

The small packet builders in `tools/room_protocol.py` implement published wire
formats, with byte-exact tests; the Home Assistant integrations are not runtime
dependencies. LEDnetWF commands include the transport envelope and checksum;
the unified color packet keeps transition bytes zero to avoid long fades.

- [LEDnetWF transport](https://github.com/8none1/lednetwf_ble/blob/main/protocol_docs/04_connection_transport.md)
- [LEDnetWF commands](https://github.com/8none1/lednetwf_ble/blob/main/protocol_docs/05_basic_commands.md)
- [MELK-OA21 protocol](https://github.com/tgmstudios/duoco-stripx-ha/blob/main/custom_components/duoco_stripx/protocol.py)
- [Lotus Lantern protocol](https://github.com/Rxflex/LotusLantern/blob/main/docs/PROTOCOL.md)
- [ELK-BLEDDM (elkbledom models.json)](https://github.com/dave-code-ruiz/elkbledom/blob/main/custom_components/elkbledom/models.json)
