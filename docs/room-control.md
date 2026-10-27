# Room Control in CTRLpanel

The `/room` section uses a new React interface built from CTRLpanel’s design
system. No HTML, CSS, JavaScript, screenshots, or front-end components from
Room Control are imported. The existing local controller remains the hardware
engine, preserving its verified Bluetooth drivers, assignments, scenes, routines,
alarm recovery, and audio restoration behavior.

## Architecture

The signed-in browser sends commands to `/api/room`. Express (local development)
and the Cloudflare Worker (production) use the same `backend/room.js` handler.
The Python bridge on the Mac polls outbound over HTTPS, publishes the controller
state, claims a command, and calls the existing `127.0.0.1:8765/api` interface.
The browser never connects to localhost or sees a service-role key. The Mac
does not need an inbound port, a tunnel, or a public Host/origin exception.

Each account pairs its own Mac; new accounts have no devices or seeded scenes.
Bridge keys are random, stored hashed in service-role-only tables, and revocable.
Every session request scopes reads/writes to the authenticated owner. Key
replacement removes old queued actions. State includes device addresses and
room history and is only returned to that owner. Snapshots never include the
alarm engine’s saved audio-output settings. Snapshots remain in the account
until replacement or disconnection; command records expire from storage after
seven days when the bridge next claims work.

## Activate

1. Run **`docs/room-control.sql`** in the existing Supabase SQL editor. It is an
   additive migration and is also appended to `supabase-schema.sql`. Use the
   additive file for an existing installation; the older full schema includes
   historical feature-removal statements unrelated to Room Control.
2. Set the existing backend Supabase URL, anon key, and service-role key. No new
   environment secrets or cloud service is required. Deploy CTRLpanel normally
   with `npm run deploy`, or run `npm run server` and `npm run dev` locally.
3. On the Mac, keep the original Room Control service running. To inspect it:
   `cd '/Users/cmccann219/Documents/Room Control'` then
   `.venv/bin/python service.py status`. If it is not installed, install it
   with `.venv/bin/python service.py install`. Do not run a second controller
   on the same port or move/replace its active configuration.
4. Sign in to CTRLpanel, open **Room → Connection → Create connection**, and
   download the connection file **on the Mac**. Create it at the deployed origin
   for production, or the local app origin for development. Do not publish it.
5. From the CTRLpanel project folder:

   ```sh
   python3 room-bridge/bridge.py check
   python3 room-bridge/bridge.py configure --from-file ~/Downloads/ctrlpanel-room-connection.json
   python3 room-bridge/bridge.py install
   ```

   Delete the downloaded file afterward. `configure` saves a private `0600`
   credential file under `~/Library/Application Support/CTRLpanel Room`.
   `install` copies the bridge there and installs the per-user macOS LaunchAgent
   `pro.cwmccann.ctrlpanel-room`, starting it now and after login. No Python
   packages are required. Python 3.9+ must stay installed at its current path.
   For foreground troubleshooting, uninstall the bridge service first, then
   use `python3 room-bridge/bridge.py run`. Do not run multiple bridges.

Bridge logs: `~/Library/Application Support/CTRLpanel Room/bridge.log`.
Remove just the adapter using `python3 room-bridge/bridge.py uninstall`;
local routines continue. Revoke its key with Room → Connection → Disconnect.

## Preserved controls and behavior

- Whole room and individual light power, brightness, RGB, and white temperature.
- Scene creation, application, and deletion (a scene in use cannot be deleted).
- Daily / weekday / one-time routines, enable/disable, full editing and deletion.
- Speaker alarm state, stop, explicit full-volume three-second preview, and
  optional alarm duration per routine. Stop can bypass a pending Bluetooth action.
- Bluetooth / LAN discovery, assignment, rename, supported-driver selection,
  local Wi-Fi IP validation, GATT inspection, and removal from active controls.
- Detailed per-device errors and recent local history. Failed commands are never
  presented as success. The light bar is labeled as unverified and RGB white is
  labeled approximate. Existing removed devices remain excluded.

The UI polls the published snapshot every three seconds; the bridge polls every
two seconds. These are last-command states, not continuous physical light-state
readbacks. A missing heartbeat (15 seconds) disables controls. The Mac must stay
logged in, powered, awake, online, and within Bluetooth range for remote control.
Local schedules continue without internet or an open page, as before. The
controller’s America/New_York schedule, five-minute catch-up window, and
at-most-once local daily execution are unchanged.

Commands waiting over 20 seconds expire without dispatch. Claimed commands are
never automatically retried; a crash or lost completion acknowledgement can
leave an unknown outcome. Check Activity and the room before manually retrying.
The local controller retains its existing device-level reconnect/retry logic.

## Verification

```sh
npm run build
npm run test:room
python3 room-bridge/bridge.py check
```

The tests mock physical I/O. `check` only reads state and alarm status. No test
switches lights, changes routines, rings an alarm, or alters Mac audio settings.
Queue tests use an isolated embedded PostgreSQL instance (development-only
PGlite), covering migration reruns, permissions, key revocation, serialized
claims, stop priority, expiry, unknown outcomes, and account isolation.
The migration, paired cloud round trip, and physical commands require the
deployment’s credentials and a signed-in connection before live acceptance.

## Interface direction

Uses the [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
CTRLpanel owns the token system: base `#0a0808`, surface `#141010`, elevated
`#1a1414`, border `#2a2020`, primary text `#f0e8e8`, and the user's `--accent`.
Inter stays the single type family. Existing `.card`, `.btn`, `.input`, and
`.segmented` primitives stay in use. A lighting instrument preview gives the
lighting console its focal point; scenes and schedules remain quiet and direct.

Layout: `[whole-room lighting | wake & rest]`, then `[scenes]`, `[individual
lights]`, `[daily rhythm]`, and `[activity]`. Content is left aligned, numbers
use tabular figures, and mobile collapses into a single column. The preview
represents the selected setting, never a fake live light reading. The original
project's blue interface, visual hierarchy, and front-end code are not reused.
