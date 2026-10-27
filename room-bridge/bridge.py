#!/usr/bin/env python3
"""Outbound CTRLpanel adapter for the existing Room Control engine. No UI,
Bluetooth implementation, public listener, or third-party dependencies here.
The original Mac service keeps owning devices, saved routines and alarm audio.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import getpass
import json
import logging
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

LOG = logging.getLogger('ctrlpanel-room')
LOCAL = 'http://127.0.0.1:8765'
DEFAULT_CONFIG = Path.home() / 'Library/Application Support/CTRLpanel Room/connection.json'
ID = r'[A-Za-z0-9_-]{1,100}'
ACTIONS = {
    'POST': [r'/(room/command|scan|alarm/(stop|preview)|presets|schedules)',
             rf'/devices/{ID}/command', rf'/presets/{ID}/apply', rf'/inspect/{ID}'],
    'PUT': [rf'/(devices|schedules)/{ID}'],
    'DELETE': [rf'/(devices|presets|schedules)/{ID}'],
}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the bridge secret across redirects.

def api(url, method='GET', body=None, key=None, timeout=12):
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    data = json.dumps(body).encode() if body is not None else None
    # Local requests must not use environment-configured HTTP proxies.
    handlers = [NoRedirect()]
    if url.startswith(LOCAL + '/'):
        handlers.append(ProxyHandler({}))
    with build_opener(*handlers).open(Request(url, data=data, headers=headers, method=method), timeout=timeout) as response:
        return json.load(response)

def validate_config(config):
    url = urlparse(config.get('server', ''))
    local = url.hostname in ('localhost', '127.0.0.1')
    if url.scheme != 'https' and not (url.scheme == 'http' and local):
        raise ValueError('Use your HTTPS CTRLpanel URL (HTTP is allowed only for localhost).')
    if not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('Enter only the CTRLpanel origin, without a path, query, or credentials.')
    if not re.fullmatch(r'ctrb_[a-f0-9]{64}', config.get('key', '')):
        raise ValueError('Invalid bridge key. Create a connection in CTRLpanel → Room.')
    return {'server': config['server'].rstrip('/'), 'key': config['key']}

def snapshot():
    try:
        state = api(LOCAL + '/api/state')
        # Only the public alarm endpoint is copied; no saved audio preferences.
        state['alarm'] = api(LOCAL + '/api/alarm')
        return {k: state[k] for k in ('devices', 'presets', 'schedules', 'history', 'nearby',
            'last_scan', 'scan_error', 'timezone', 'now', 'alarm') if k in state}
    except Exception:
        return {'controller_error': 'Room Control is not responding on this Mac. Start its login service.'}

def execute(command):
    result = {'id': command['id']}
    method, path = command.get('method'), command.get('path', '')
    if not any(re.fullmatch(pattern, path) for pattern in ACTIONS.get(method, [])):
        return {**result, 'error': 'Unsupported room action.'}
    try:
        # Commands are never retried after a timeout: physical action may
        # already have happened. The local engine handles device reconnects.
        result['data'] = api(LOCAL + '/api' + path, method, command.get('body', {}), timeout=150)
        data = result['data']
        failures = [r for r in data.get('results', [data]) if r.get('ok') is False]
        if failures:
            result['error'] = '; '.join(r.get('error', 'Device did not confirm the command') for r in failures)
    except HTTPError as error:
        try:
            detail = json.load(error).get('detail')
            result['error'] = detail if isinstance(detail, str) else json.dumps(detail)
        except Exception:
            result['error'] = f'Room controller returned HTTP {error.code}.'
    except Exception:
        result['error'] = 'Controller did not confirm completion. Check room activity before retrying.'
    return result

def run(config):
    endpoint = config['server'] + '/api/room/bridge/sync'
    pending, future = [], None
    with ThreadPoolExecutor(max_workers=1) as pool:
        while True:
            try:
                if future and future.done():
                    pending.append(future.result())
                    future = None
                sent = list(pending)
                reply = api(endpoint, 'POST', {'snapshot': snapshot(), 'busy': future is not None,
                            'results': sent}, config['key'])
                del pending[:len(sent)]  # Keep ack until the server accepts it.
                for command in reply.get('commands', []):
                    if command.get('path') == '/alarm/stop':
                        pending.append(execute(command))
                        continue
                    if future is not None:
                        break
                    future = pool.submit(execute, command)
            except HTTPError as error:
                if error.code == 401:
                    raise SystemExit('Bridge key revoked. Reconnect in CTRLpanel → Room.')
                LOG.warning('CTRLpanel unavailable (HTTP %s). Reconnecting.', error.code)
            except Exception as error:
                LOG.warning('Connection unavailable (%s). Reconnecting.', type(error).__name__)
            time.sleep(2)

def configure(path, from_file=None):
    if from_file:
        config = validate_config(json.loads(Path(from_file).read_text()))
    else:
        config = validate_config({'server': input('CTRLpanel URL: ').strip(),
                                  'key': getpass.getpass('Bridge key: ').strip()})
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create privately from the first write; the credential never enters argv.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(path, 0o600)
    with os.fdopen(fd, 'w') as target:
        json.dump(config, target)
    print('Connection saved. Delete any downloaded connection file after setup.')

def service(config_path, action):
    if sys.platform != 'darwin':
        raise SystemExit('The login service installer requires macOS.')
    label = 'pro.cwmccann.ctrlpanel-room'
    runtime = DEFAULT_CONFIG.parent
    plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
    domain = f'gui/{os.getuid()}'
    if action == 'uninstall':
        subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], check=False)
        plist.unlink(missing_ok=True)
        print('Bridge login service removed. Room Control and saved routines are unchanged.')
        return
    if not config_path.exists():
        raise SystemExit('Configure the bridge first: python3 bridge.py configure')
    validate_config(json.loads(config_path.read_text()))
    runtime.mkdir(parents=True, exist_ok=True)
    destination = runtime / 'bridge.py'
    if Path(__file__).resolve() != destination.resolve():
        shutil.copy2(__file__, destination)
    if config_path.resolve() != DEFAULT_CONFIG.resolve():
        configure(DEFAULT_CONFIG, config_path)
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps({'Label': label, 'RunAtLoad': True, 'KeepAlive': True,
        'ThrottleInterval': 10, 'WorkingDirectory': str(runtime),
        'ProgramArguments': [sys.executable, str(destination), 'run'],
        'StandardOutPath': str(runtime / 'bridge.log'), 'StandardErrorPath': str(runtime / 'bridge.log')}))
    subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], check=False)
    subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
    print('Bridge installed. It starts at login; the existing Room Control service must also be running.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['configure', 'run', 'check', 'install', 'uninstall'])
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--from-file')
    args = parser.parse_args()
    if args.action == 'configure':
        configure(args.config, args.from_file)
    elif args.action in ('install', 'uninstall'):
        service(args.config, args.action)
    elif args.action == 'check':
        state = snapshot()
        print(json.dumps({'controller_reachable': not state.get('controller_error'),
                          'devices': len(state.get('devices', [])), 'routines': len(state.get('schedules', [])),
                          'error': state.get('controller_error')}, indent=2))
        if state.get('controller_error'):
            raise SystemExit(1)
    else:
        run(validate_config(json.loads(args.config.read_text())))

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    main()
