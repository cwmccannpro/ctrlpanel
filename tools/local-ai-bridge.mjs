#!/usr/bin/env node
// CTRLpanel desktop model bridge: runs meal estimates on this computer's Ollama.
// Outbound only — it polls CTRLpanel over HTTPS and talks to Ollama on loopback.
// No port is opened. The ctla_ key is DPAPI-encrypted for this Windows user and
// decrypted in memory; it is never printed, logged or passed as an argument.
// Install/start: powershell -File tools/local-ai-install.ps1   (docs/nutrition-photo-logging.md)
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE_KEY, bridgeConfig, hasModel, ollamaRequest, parseOllamaReply } from './local-ai-core.mjs';

const LOCAL = join(dirname(dirname(fileURLToPath(import.meta.url))), '.local-ai');
const IDLE_MS = 3000;      // poll cadence while the model is ready
const NOT_READY_MS = 15000; // heartbeat only, while Ollama is down / model missing
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(level, message) {
  const file = join(LOCAL, 'bridge.log');
  try { if (statSync(file).size > 500000) truncateSync(file, 0); } catch { /* first write */ }
  try { appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`); } catch { /* never crash on logging */ }
}

function loadCredential() {
  // PowerShell's ConvertTo-SecureString undoes ConvertFrom-SecureString (DPAPI, same user).
  const script = "$s = (Get-Content -LiteralPath $env:CTLA_FILE -Raw).Trim() | ConvertTo-SecureString; " +
    "$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, CTLA_FILE: join(LOCAL, 'credential.dpapi') }, windowsHide: true, timeout: 20000 },
      (error, stdout) => {
        const key = String(stdout || '').trim();
        if (error || !BRIDGE_KEY.test(key)) reject(new Error('No valid desktop key. Run tools/local-ai-install.ps1.'));
        else resolve(key);
      });
  });
}

// One running copy per Windows session: a second instance can't bind the pipe.
const singleInstance = () => new Promise((resolve) => {
  const server = createServer();
  server.once('error', () => resolve(false));
  server.listen('\\\\.\\pipe\\ctrlpanel-local-ai-bridge', () => resolve(true));
});

async function relay(cfg, key, action, body) {
  const res = await fetch(`${cfg.origin}/api/nutrition/local/bridge/${action}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': 'CTRLpanel-LocalAI/1.0' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw Object.assign(new Error(`relay HTTP ${res.status}`), { status: res.status });
  return res.json();
}

async function modelReady(cfg) {
  try {
    const res = await fetch(`${cfg.ollama}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok && hasModel(await res.json(), cfg.model);
  } catch { return false; }
}

// ~1 in 12 answers runs away and hits the token cap; one retry fixes most of those
// when enough time is left before the server gives up and asks Claude instead.
async function runJob(cfg, job) {
  const body = JSON.stringify(ollamaRequest(job.input, cfg));
  for (let attempt = 1; ; attempt += 1) {
    const left = Date.parse(job.expires_at) - Date.now() - 1500;
    if (!(left > 0)) throw new Error('Job expired before it started.');
    try {
      const res = await fetch(`${cfg.ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(left), body });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      return parseOllamaReply(await res.json());
    } catch (e) {
      if (attempt >= 2 || e.name === 'TimeoutError' || Date.parse(job.expires_at) - Date.now() < 20000) throw e;
      log('WARN', `Model answer unusable (${e.message}); retrying once`);
    }
  }
}

async function main() {
  if (!(await singleInstance())) return;
  const cfg = bridgeConfig(JSON.parse(readFileSync(join(LOCAL, 'config.json'), 'utf8').replace(/^﻿/, '')));
  const key = await loadCredential();
  log('INFO', `Bridge started; model ${cfg.model} via ${cfg.ollama}; relay ${cfg.origin}`);
  let backoff = 0, wasReady = null;
  for (;;) {
    const ready = await modelReady(cfg);
    if (ready !== wasReady) { log('INFO', ready ? 'Model ready' : `Model not available (is Ollama running and "${cfg.model}" pulled?)`); wasReady = ready; }
    try {
      const { job } = await relay(cfg, key, 'poll', { ready, model: cfg.model });
      backoff = 0;
      if (job) {
        const started = Date.now();
        let receipt;
        try { receipt = { id: job.id, ok: true, result: await runJob(cfg, job), model: cfg.model }; }
        catch (e) { receipt = { id: job.id, ok: false, error: String(e.message || 'Model failed').slice(0, 240), model: cfg.model }; }
        log(receipt.ok ? 'INFO' : 'WARN', `Meal estimate ${receipt.ok ? 'done' : `failed (${receipt.error})`} in ${Math.round((Date.now() - started) / 100) / 10}s`);
        // job.input is dropped with this scope; nothing is written to disk.
        await relay(cfg, key, 'complete', receipt).catch((e) => log('WARN', `Could not return result (${e.message})`));
        continue;
      }
    } catch (e) {
      if (e.status === 401 || e.status === 403) { log('ERROR', 'Desktop key rejected. Create a new key in Settings → Nutrition and reinstall.'); process.exit(1); }
      backoff = Math.min(60000, (backoff || 2000) * 2);
      log('WARN', `Relay unavailable (${e.status ? `HTTP ${e.status}` : e.name}); retrying in ${backoff / 1000}s`);
    }
    await sleep(backoff || (ready ? IDLE_MS : NOT_READY_MS));
  }
}

main().catch((e) => { log('ERROR', `Bridge stopped: ${e.message}`); process.exit(1); });
