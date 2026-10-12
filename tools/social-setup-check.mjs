// Read-only diagnostics. Never print secret values or account rows.
import fs from 'node:fs';
import dotenv from 'dotenv';
for (const path of ['.env', '.env.local']) if (fs.existsSync(path)) Object.assign(process.env, dotenv.parse(fs.readFileSync(path)));
const { socialSetup } = await import('../backend/socials.js');
for (const platform of ['youtube', 'instagram', 'x']) {
  const setup = await socialSetup(platform, '00000000-0000-0000-0000-000000000000');
  console.log(JSON.stringify({ platform, ...setup }));
}
