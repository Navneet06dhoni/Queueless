import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const K6_IMAGE =
  'grafana/k6@sha256:1f40432b1cbe7234e977f96c362c9bc550a2d2b583d014dd8669fe40d3e9e755';

async function main() {
  const res = await fetch('http://localhost:8080/api/businesses?limit=5');
  if (!res.ok) {
    throw new Error(`Failed to fetch businesses from gateway: ${res.status}`);
  }
  const body = (await res.json()) as { businesses?: Array<{ id: string }>; data?: Array<{ id: string }> };
  const list = body.businesses || body.data || [];
  const businessId = list[0]?.id || '';
  if (!businessId) {
    throw new Error('No business found to target in demo:load');
  }

  console.log(`Starting k6 demo:load (20 VUs, 60s, anonymous) targeting businessId=${businessId}`);
  const scriptPath = path.resolve(__dirname, '../monitoring/k6/demo-load.js');
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--network',
      'queueless_backend',
      '-e',
      'BASE_URL=http://gateway:8080',
      '-e',
      `BUSINESS_ID=${businessId}`,
      K6_IMAGE,
      'run',
      '-',
    ],
    {
      input: scriptContent,
      stdio: ['pipe', 'inherit', 'inherit'],
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
