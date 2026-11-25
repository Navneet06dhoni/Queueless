const http = require('http');
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');

async function testCurl(url) {
  try {
    const out = execSync(`curl.exe -i -s --connect-timeout 2 "${url}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out;
  } catch (err) {
    return `CONNECTION FAILED (Code ${err.status}): ${err.stderr || err.message}`;
  }
}

async function main() {
  console.log('=== UNAUTHENTICATED CURL ON 127.0.0.1:3003 ===');
  const me401 = await testCurl('http://127.0.0.1:3003/api/queue/me');
  console.log('--- GET /api/queue/me ---');
  console.log(me401);

  const stats401 = await testCurl('http://127.0.0.1:3003/internal/stats');
  console.log('--- GET /internal/stats ---');
  console.log(stats401);

  console.log('\n=== LAN IPV4 BINDING CHECK ON PORT 3003 ===');
  const ifaces = os.networkInterfaces();
  let lanIp = null;
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        lanIp = net.address;
        break;
      }
    }
    if (lanIp) break;
  }

  console.log(`Detected LAN IPv4: ${lanIp}`);
  if (lanIp) {
    const lanCheck = await testCurl(`http://${lanIp}:3003/health`);
    console.log(`--- GET http://${lanIp}:3003/health ---`);
    console.log(lanCheck);
  } else {
    console.log('No external LAN IPv4 found');
  }
}

main().catch(console.error);
